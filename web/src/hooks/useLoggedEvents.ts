"use client";

import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import addresses from "@addresses";
import { logBookAbi } from "@/abi";
import { parseAbiItem, type AbiEvent } from "viem";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

export type ActionKind = "split" | "trim" | "add" | "hold";

export interface LogEntry {
  seq: number;
  priceE8: bigint;
  bpsBefore: bigint;
  bpsAfter: bigint;
  navBefore: bigint;
  navAfter: bigint;
  ts: bigint;
  // Enriched from the Logged event (matched by seq). Undefined if the rebalance
  // is older than the getLogs window (~50k blocks ≈ several hours of Monad).
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
  entries: LogEntry[];           // newest first, enriched + classified
  rebalances: RebalanceEvent[];  // newest first, kept for the live narration card
  deposits: DepositedEvent[];    // newest first
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

// Classification by bps when no deposit was detected in the window.
function classifyByBps(bpsBefore: bigint): ActionKind {
  if (bpsBefore > 6500n) return "trim";
  if (bpsBefore < 5500n) return "add";
  return "hold"; // can only happen if rebalance() was called while inside band
}

export function useLoggedFeed() {
  const publicClient = usePublicClient();
  const visible = useVisible();

  const vaultAddr = addresses.RebalanceVault as `0x${string}`;
  const logBookAddr = addresses.LogBook as `0x${string}`;
  const deployBlock = BigInt(addresses.deployBlock || 0);

  const deployed =
    vaultAddr.toLowerCase()   !== ZERO &&
    logBookAddr.toLowerCase() !== ZERO;

  return useQuery<LoggedFeed>({
    queryKey: ["chogvault.feed", vaultAddr, logBookAddr],
    queryFn: async () => {
      if (!publicClient || !deployed) {
        return { logBookCount: 0, entries: [], rebalances: [], deposits: [] };
      }

      // Read LogBook entries via entries(i) — covers the full on-chain history,
      // not just the getLogs window.
      const count = (await publicClient.readContract({
        address: logBookAddr, abi: logBookAbi, functionName: "count",
      })) as bigint;

      const n = Number(count);
      const entryIdxs = Array.from({ length: n }, (_, i) => BigInt(n - 1 - i)); // newest first

      const head = await publicClient.getBlockNumber();
      const fromBlock = head > deployBlock + 50_000n
        ? head - 50_000n
        : (deployBlock || head);

      const loggedEvent     = parseAbiItem("event Logged(uint256 indexed seq, uint256 priceE8, uint256 bpsBefore, uint256 bpsAfter, uint256 navBefore, uint256 navAfter, uint256 ts)") as AbiEvent;
      const rebEvent        = parseAbiItem("event Rebalanced(uint256 priceE8, uint256 monValueBps)") as AbiEvent;
      const depositedEvent  = parseAbiItem("event Deposited(address indexed user, uint256 monIn, uint256 usdcIn, uint256 shares)") as AbiEvent;

      const [rawEntries, loggedLogs, rebLogs, depositLogs] = await Promise.all([
        Promise.all(
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
            } satisfies LogEntry;
          }),
        ),
        publicClient.getLogs({
          address: logBookAddr, event: loggedEvent, fromBlock, toBlock: head,
        }),
        publicClient.getLogs({
          address: vaultAddr, event: rebEvent, fromBlock, toBlock: head,
        }),
        publicClient.getLogs({
          address: vaultAddr, event: depositedEvent, fromBlock, toBlock: head,
        }),
      ]);

      // Build a per-seq enrichment map from the Logged events.
      const enrichBySeq = new Map<number, { blockNumber: bigint; txHash: `0x${string}` }>();
      for (const l of loggedLogs) {
        const seqArg = (l as unknown as { args: { seq: bigint } }).args.seq;
        if (l.transactionHash && l.blockNumber !== null) {
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

      // Enrich + classify each entry. Iterate newest→oldest so we know each
      // entry's PRIOR rebalance block to bound the deposit window.
      const entries: LogEntry[] = rawEntries.map((e, i) => {
        const meta = enrichBySeq.get(e.seq);
        const thisBlock = meta?.blockNumber;
        // "Previous" rebalance in time = NEXT in the newest-first list (i+1).
        const prev = rawEntries[i + 1];
        const prevBlock = prev ? enrichBySeq.get(prev.seq)?.blockNumber ?? deployBlock : deployBlock;

        let kind: ActionKind = classifyByBps(e.bpsBefore);
        if (thisBlock !== undefined) {
          const hadDeposit = deposits.some(
            (d) => d.blockNumber > prevBlock && d.blockNumber <= thisBlock,
          );
          if (hadDeposit) kind = "split";
        }

        return {
          ...e,
          blockNumber: thisBlock,
          txHash: meta?.txHash,
          kind,
        } satisfies LogEntry;
      });

      const rebalances: RebalanceEvent[] = rebLogs
        .map((l) => {
          const args = (l as unknown as { args: { priceE8: bigint; monValueBps: bigint } }).args;
          return {
            txHash: l.transactionHash!,
            blockNumber: l.blockNumber!,
            priceE8: args.priceE8,
            monValueBps: args.monValueBps,
          };
        })
        .sort((a, b) => (b.blockNumber > a.blockNumber ? 1 : -1));

      return { logBookCount: n, entries, rebalances, deposits };
    },
    enabled: !!publicClient,
    refetchInterval: visible ? 18_000 : false,
    refetchOnWindowFocus: true,
  });
}
