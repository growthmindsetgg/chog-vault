"use client";

import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import addresses from "@addresses";
import { logBookAbi } from "@/abi";
import { parseAbiItem, type AbiEvent } from "viem";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

// STEP 0 finding: ALL three Monad-testnet RPCs cap eth_getLogs at ≤100 blocks
// (Ankr/official: -32614 "limited to a 100 range"; even smaller on Ankr for
// some queries). The Tier-1 hook asked for ~50k → every getLogs call threw →
// React Query errored the whole feed → action log empty even with LogBook
// entries on chain.
//
// STEP 5 fix:
//   - LogBook entries ALWAYS come from entries(i) reads (work regardless of
//     getLogs limits). That powers the Proof panel + the live action log even
//     when getLogs is unavailable.
//   - getLogs runs over a tight ≤LIVE_TAIL_BLOCKS window for live tx-hash +
//     blockNumber + Deposited-event detection on fresh rebalances. If it
//     throws, we silently fall back to entries-only (old rebalances simply
//     don't get a per-tx link).
const LIVE_TAIL_BLOCKS = 100n;

export type ActionKind = "split" | "trim" | "add" | "hold";

export interface LogEntry {
  seq: number;
  priceE8: bigint;
  bpsBefore: bigint;
  bpsAfter: bigint;
  navBefore: bigint;
  navAfter: bigint;
  ts: bigint;
  // Enriched from the Logged event if it falls inside LIVE_TAIL_BLOCKS.
  blockNumber?: bigint;
  txHash?: `0x${string}`;
  kind?: ActionKind;
}

export interface RebalanceEvent {
  txHash: `0x${string}`;
  blockNumber: bigint;
  priceE8: bigint;
  monValueBps: bigint;
}

export interface DepositedEvent {
  txHash: `0x${string}`;
  blockNumber: bigint;
  user: `0x${string}`;
  monIn: bigint;
  usdcIn: bigint;
  shares: bigint;
}

export interface LoggedFeed {
  logBookCount: number;
  entries: LogEntry[];           // newest first; ALWAYS populated when count > 0
  rebalances: RebalanceEvent[];  // newest first; live tail only
  deposits: DepositedEvent[];    // newest first; live tail only
  getLogsAvailable: boolean;     // false → recent enrichment may be missing
}

function useVisible(): boolean {
  const [v, setV] = useState(typeof document === "undefined" ? true : !document.hidden);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVis = () => setV(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  return v;
}

function classifyByBps(bpsBefore: bigint): ActionKind {
  if (bpsBefore > 6500n) return "trim";
  if (bpsBefore < 5500n) return "add";
  return "hold";
}

export function useLoggedFeed() {
  const publicClient = usePublicClient();
  const visible = useVisible();

  const vaultAddr   = addresses.RebalanceVault as `0x${string}`;
  const logBookAddr = addresses.LogBook as `0x${string}`;

  const deployed =
    vaultAddr.toLowerCase()   !== ZERO &&
    logBookAddr.toLowerCase() !== ZERO;

  return useQuery<LoggedFeed>({
    queryKey: ["chogvault.feed", vaultAddr, logBookAddr],
    queryFn: async () => {
      if (!publicClient || !deployed) {
        return { logBookCount: 0, entries: [], rebalances: [], deposits: [], getLogsAvailable: false };
      }

      // 1) PRIMARY — LogBook entries via entries(i). Always works.
      const count = (await publicClient.readContract({
        address: logBookAddr, abi: logBookAbi, functionName: "count",
      })) as bigint;
      const n = Number(count);
      const entryIdxs = Array.from({ length: n }, (_, i) => BigInt(n - 1 - i)); // newest first
      const rawEntries: LogEntry[] = await Promise.all(
        entryIdxs.map(async (idx) => {
          const e = (await publicClient.readContract({
            address: logBookAddr, abi: logBookAbi, functionName: "entries", args: [idx],
          })) as readonly [bigint, bigint, bigint, bigint, bigint, bigint];
          return {
            seq: Number(idx),
            priceE8:   e[0],
            bpsBefore: e[1],
            bpsAfter:  e[2],
            navBefore: e[3],
            navAfter:  e[4],
            ts:        e[5],
          };
        }),
      );

      // 2) SECONDARY — live-tail getLogs for tx-hash enrichment + Deposited
      //    correlation. Tight 100-block window; survive any RPC failure.
      let getLogsAvailable = true;
      let loggedLogs: Awaited<ReturnType<typeof publicClient.getLogs>> = [];
      let rebLogs:    Awaited<ReturnType<typeof publicClient.getLogs>> = [];
      let depositLogs:Awaited<ReturnType<typeof publicClient.getLogs>> = [];

      try {
        const head = await publicClient.getBlockNumber();
        const fromBlock = head > LIVE_TAIL_BLOCKS ? head - LIVE_TAIL_BLOCKS : 0n;
        const loggedEvent    = parseAbiItem("event Logged(uint256 indexed seq, uint256 priceE8, uint256 bpsBefore, uint256 bpsAfter, uint256 navBefore, uint256 navAfter, uint256 ts)") as AbiEvent;
        const rebEvent       = parseAbiItem("event Rebalanced(uint256 priceE8, uint256 monValueBps)") as AbiEvent;
        const depositedEvent = parseAbiItem("event Deposited(address indexed user, uint256 monIn, uint256 usdcIn, uint256 shares)") as AbiEvent;

        [loggedLogs, rebLogs, depositLogs] = await Promise.all([
          publicClient.getLogs({ address: logBookAddr, event: loggedEvent,    fromBlock, toBlock: head }),
          publicClient.getLogs({ address: vaultAddr,   event: rebEvent,       fromBlock, toBlock: head }),
          publicClient.getLogs({ address: vaultAddr,   event: depositedEvent, fromBlock, toBlock: head }),
        ]);
      } catch (e) {
        getLogsAvailable = false;
        // eslint-disable-next-line no-console
        console.warn("[useLoggedFeed] getLogs failed — entries-only render:", e instanceof Error ? e.message : e);
      }

      // 3) Enrich entries with blockNumber + txHash by seq.
      const enrichBySeq = new Map<number, { blockNumber: bigint; txHash: `0x${string}` }>();
      for (const l of loggedLogs) {
        const seqArg = (l as unknown as { args: { seq: bigint } }).args.seq;
        if (l.transactionHash && l.blockNumber !== null && l.blockNumber !== undefined) {
          enrichBySeq.set(Number(seqArg), {
            blockNumber: l.blockNumber!, txHash: l.transactionHash,
          });
        }
      }

      const deposits: DepositedEvent[] = depositLogs
        .map((l) => {
          const a = (l as unknown as { args: { user: `0x${string}`; monIn: bigint; usdcIn: bigint; shares: bigint } }).args;
          return {
            txHash: l.transactionHash!, blockNumber: l.blockNumber!,
            user: a.user, monIn: a.monIn, usdcIn: a.usdcIn, shares: a.shares,
          };
        })
        .sort((a, b) => (b.blockNumber > a.blockNumber ? 1 : -1));

      // 4) Classify each entry. Newest→oldest in the rawEntries array, so the
      //    "previous" entry in time is at index i+1.
      const entries: LogEntry[] = rawEntries.map((e, i) => {
        const meta = enrichBySeq.get(e.seq);
        const thisBlock = meta?.blockNumber;
        const prevMeta  = rawEntries[i + 1] ? enrichBySeq.get(rawEntries[i + 1].seq) : undefined;
        const prevBlock = prevMeta?.blockNumber ?? 0n;

        let kind: ActionKind = classifyByBps(e.bpsBefore);
        // Only label "split" when we have enough on-chain visibility to be sure
        // (both this entry AND a Deposited in the window between).
        if (thisBlock !== undefined && deposits.some(
          (d) => d.blockNumber > prevBlock && d.blockNumber <= thisBlock,
        )) {
          kind = "split";
        }

        return {
          ...e,
          blockNumber: thisBlock,
          txHash: meta?.txHash,
          kind,
        };
      });

      const rebalances: RebalanceEvent[] = rebLogs
        .map((l) => {
          const args = (l as unknown as { args: { priceE8: bigint; monValueBps: bigint } }).args;
          return {
            txHash: l.transactionHash!, blockNumber: l.blockNumber!,
            priceE8: args.priceE8, monValueBps: args.monValueBps,
          };
        })
        .sort((a, b) => (b.blockNumber > a.blockNumber ? 1 : -1));

      return { logBookCount: n, entries, rebalances, deposits, getLogsAvailable };
    },
    enabled: !!publicClient,
    refetchInterval: visible ? 18_000 : false,
    refetchOnWindowFocus: true,
  });
}
