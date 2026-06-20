"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import addresses from "@addresses";

export interface Basis {
  monIn: string;        // wei (18 dec)
  usdcIn: string;       // 6 dec
  basisNAV: string;     // 6 dec USDC
  basisPriceE8: string; // 8 dec
  basisBlock: number;
}

function key(chainId: number, vault: string, user: string): string {
  return `chogvault.basis.${chainId}.${vault.toLowerCase()}.${user.toLowerCase()}`;
}

function read(k: string): Basis | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(k);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.monIn === "string" &&
      typeof parsed.usdcIn === "string" &&
      typeof parsed.basisNAV === "string" &&
      typeof parsed.basisPriceE8 === "string" &&
      typeof parsed.basisBlock === "number"
    ) {
      return parsed as Basis;
    }
    return null;
  } catch {
    return null;
  }
}

function write(k: string, b: Basis | null): void {
  if (typeof window === "undefined") return;
  if (b === null) {
    window.localStorage.removeItem(k);
  } else {
    window.localStorage.setItem(k, JSON.stringify(b));
  }
}

export function useBasis(userShares: bigint | undefined) {
  const { address } = useAccount();
  const k = address ? key(addresses.chainId, addresses.RebalanceVault, address) : "";

  const [basis, setBasis] = useState<Basis | null>(null);

  // Read on mount/key change.
  useEffect(() => {
    if (!k) { setBasis(null); return; }
    setBasis(read(k));
  }, [k]);

  // Auto-clear at 0 shares (handles full withdraw).
  useEffect(() => {
    if (!k) return;
    if (userShares !== undefined && userShares === 0n && basis) {
      write(k, null);
      setBasis(null);
    }
  }, [k, userShares, basis]);

  const set = useCallback((b: Basis | null) => {
    if (!k) return;
    write(k, b);
    setBasis(b);
  }, [k]);

  return { basis, setBasis: set };
}
