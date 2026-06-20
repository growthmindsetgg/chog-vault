"use client";

import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import addresses from "@addresses";
import { logBookAbi, vaultAbi } from "@/abi";
import { parseAbiItem, type AbiEvent, type Abi } from "viem";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

export interface LogEntry {
  seq: number;
  priceE8: bigint;
  bpsBefore: bigint;
  bpsAfter: bigint;
  navBefore: bigint;
  navAfter: bigint;
  ts: bigint;
}

export interface RebalanceEvent {
  txHash: `0x${string}`;
  blockNumber: bigint;
  priceE8: bigint;
  monValueBps: bigint;
}

export interface LoggedFeed {
  logBookCount: number;
  entries: LogEntry[];      // newest first
  rebalances: RebalanceEvent[]; // newest first
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
        return { logBookCount: 0, entries: [], rebalances: [] };
      }

      const count = (await publicClient.readContract({
        address: logBookAddr, abi: logBookAbi, functionName: "count",
      })) as bigint;

      const n = Number(count);
      const entryIdxs = Array.from({ length: n }, (_, i) => BigInt(n - 1 - i)); // newest first
      const entries: LogEntry[] = await Promise.all(
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

      // Rebalanced(uint256 priceE8, uint256 monValueBps) — pull recent window.
      const head = await publicClient.getBlockNumber();
      const fromBlock = head > deployBlock + 50_000n
        ? head - 50_000n
        : (deployBlock || head);
      const rebEvent = parseAbiItem("event Rebalanced(uint256 priceE8, uint256 monValueBps)") as AbiEvent;
      const logs = await publicClient.getLogs({
        address: vaultAddr,
        event: rebEvent,
        fromBlock,
        toBlock: head,
      });
      const rebalances: RebalanceEvent[] = logs
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

      // Silence linter on unused import.
      void (vaultAbi as Abi);

      return { logBookCount: n, entries, rebalances };
    },
    enabled: !!publicClient,
    refetchInterval: visible ? 18_000 : false,
    refetchOnWindowFocus: true,
  });
}
