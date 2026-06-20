"use client";

import { useEffect, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import addresses from "@addresses";
import { vaultAbi, ammAbi, usdcAbi } from "@/abi";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

export interface VaultSnapshot {
  priceE8: bigint;
  paused: boolean;
  monBalance: bigint;
  usdcBalance: bigint;
  nav: bigint;
  totalShares: bigint;
  userShares: bigint;
  userMonBalance: bigint;
  userUsdcBalance: bigint;
  userUsdcAllowance: bigint;
  monValueBps: bigint;
  monValueUsdc: bigint;
  owner: `0x${string}` | null;
  agent: `0x${string}` | null;
}

const EMPTY: VaultSnapshot = {
  priceE8: 0n,
  paused: false,
  monBalance: 0n,
  usdcBalance: 0n,
  nav: 0n,
  totalShares: 0n,
  userShares: 0n,
  userMonBalance: 0n,
  userUsdcBalance: 0n,
  userUsdcAllowance: 0n,
  monValueBps: 0n,
  monValueUsdc: 0n,
  owner: null,
  agent: null,
};

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

export function useVaultSnapshot() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const visible = useVisible();

  const vaultAddr = addresses.RebalanceVault as `0x${string}`;
  const ammAddr   = addresses.OracleAMM      as `0x${string}`;
  const usdcAddr  = addresses.MockUSDC       as `0x${string}`;

  const deployed =
    vaultAddr.toLowerCase() !== ZERO &&
    ammAddr.toLowerCase() !== ZERO   &&
    usdcAddr.toLowerCase() !== ZERO;

  const userAddr = (address ?? ZERO) as `0x${string}`;

  return useQuery<VaultSnapshot>({
    queryKey: ["chogvault.snapshot", vaultAddr, userAddr],
    queryFn: async () => {
      if (!publicClient || !deployed) return EMPTY;
      const reads = await Promise.all([
        publicClient.readContract({ address: ammAddr,   abi: ammAbi,   functionName: "priceE8"       }),
        publicClient.readContract({ address: vaultAddr, abi: vaultAbi, functionName: "paused"        }),
        publicClient.readContract({ address: vaultAddr, abi: vaultAbi, functionName: "monBalance"    }),
        publicClient.readContract({ address: vaultAddr, abi: vaultAbi, functionName: "usdcBalance"   }),
        publicClient.readContract({ address: vaultAddr, abi: vaultAbi, functionName: "totalShares"   }),
        publicClient.readContract({ address: vaultAddr, abi: vaultAbi, functionName: "owner"         }),
        publicClient.readContract({ address: vaultAddr, abi: vaultAbi, functionName: "agent"         }),
        userAddr.toLowerCase() === ZERO
          ? Promise.resolve(0n)
          : publicClient.readContract({
              address: vaultAddr, abi: vaultAbi, functionName: "balanceOf", args: [userAddr],
            }),
        userAddr.toLowerCase() === ZERO
          ? Promise.resolve(0n)
          : publicClient.getBalance({ address: userAddr }),
        userAddr.toLowerCase() === ZERO
          ? Promise.resolve(0n)
          : publicClient.readContract({
              address: usdcAddr, abi: usdcAbi, functionName: "balanceOf", args: [userAddr],
            }),
        userAddr.toLowerCase() === ZERO
          ? Promise.resolve(0n)
          : publicClient.readContract({
              address: usdcAddr, abi: usdcAbi, functionName: "allowance", args: [userAddr, vaultAddr],
            }),
      ]);

      const [priceE8, paused, monBalance, usdcBalance, totalShares, owner, agent, userShares, userMonBalance, userUsdcBalance, userUsdcAllowance] = reads as [
        bigint, boolean, bigint, bigint, bigint, `0x${string}`, `0x${string}`, bigint, bigint, bigint, bigint
      ];

      const monValueUsdc = priceE8 > 0n ? (monBalance * priceE8) / 10n ** 20n : 0n;
      const nav = monValueUsdc + usdcBalance;
      const monValueBps = nav > 0n ? (monValueUsdc * 10_000n) / nav : 0n;

      return {
        priceE8,
        paused,
        monBalance,
        usdcBalance,
        nav,
        totalShares,
        userShares,
        userMonBalance,
        userUsdcBalance,
        userUsdcAllowance,
        monValueBps,
        monValueUsdc,
        owner,
        agent,
      };
    },
    enabled: !!publicClient,
    refetchInterval: visible ? 12_000 : false,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev ?? EMPTY,
  });
}
