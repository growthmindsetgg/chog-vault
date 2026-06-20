"use client";

// useSendTransactionSync — Monad supports `eth_sendRawTransactionSync` which
// returns the receipt in the SAME call. wagmi v2 doesn't yet expose a first-
// class hook for it, so this wrapper uses the spec-mandated fallback path:
// writeContract → waitForTransactionReceipt, surfaced as one stateful op.

import { useCallback, useState } from "react";
import { useWriteContract, usePublicClient } from "wagmi";
import type { Abi, Hash, TransactionReceipt } from "viem";

export interface SyncOptions<TAbi extends Abi> {
  address: `0x${string}`;
  abi: TAbi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
}

export interface SyncState {
  loading: boolean;
  txHash: Hash | null;
  receipt: TransactionReceipt | null;
  error: Error | null;
}

const INITIAL: SyncState = { loading: false, txHash: null, receipt: null, error: null };

export function useSendTransactionSync() {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const [state, setState] = useState<SyncState>(INITIAL);

  const send = useCallback(
    async <TAbi extends Abi>(opts: SyncOptions<TAbi>): Promise<TransactionReceipt> => {
      if (!publicClient) throw new Error("RPC not ready");
      setState({ ...INITIAL, loading: true });
      try {
        const hash = await writeContractAsync({
          address: opts.address,
          abi: opts.abi,
          functionName: opts.functionName,
          args: opts.args as readonly unknown[] | undefined,
          value: opts.value,
        } as Parameters<typeof writeContractAsync>[0]);
        setState((s) => ({ ...s, txHash: hash }));
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        setState({ loading: false, txHash: hash, receipt, error: null });
        return receipt;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setState({ loading: false, txHash: null, receipt: null, error: err });
        throw err;
      }
    },
    [writeContractAsync, publicClient],
  );

  const reset = useCallback(() => setState(INITIAL), []);

  return { ...state, send, reset };
}
