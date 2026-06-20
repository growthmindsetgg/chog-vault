"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import addresses from "@addresses";

// STEP 3 cost-basis store.
//
// Schema (v2):
//   monAmount       — wei, 18 dec, sum across ALL deposits
//   usdcAmount      — 6 dec, sum across ALL deposits
//   depositUsd      — 6 dec USDC, sum of (deposit's $ value at the price AT THAT
//                     deposit moment). NOT "current value of MON" — it's the
//                     money that went in.
//   priceAtDeposit  — 8 dec, last deposit's priceE8 (informational only)
//   depositBlock    — block of the FIRST deposit (so the chart anchors there)
//
// ROI vs deposit = (userValueNow / depositUsd) − 1.
// HODL counterfactual = monAmount * currentPriceE8 + usdcAmount  (the user's
// ORIGINAL deposited tokens, marked at the LIVE on-chain price).
// ROI vs HODL = (userValueNow / hodlNow) − 1.  Independent of ROI vs deposit.
//
// Auto-clear at 0 shares — the basis is meaningless once the position is gone.

export interface Basis {
  monAmount: string;
  usdcAmount: string;
  depositUsd: string;
  priceAtDeposit: string;
  depositBlock: number;
}

function key(chainId: number, vault: string, user: string): string {
  return `chogvault.basis.${chainId}.${vault.toLowerCase()}.${user.toLowerCase()}`;
}

function read(k: string): Basis | null {
  if (typeof window === "undefined") return null;
  let parsed: unknown;
  try {
    const raw = window.localStorage.getItem(k);
    if (!raw) return null;
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;

  // v2 (current) schema.
  if (
    typeof p.monAmount === "string" &&
    typeof p.usdcAmount === "string" &&
    typeof p.depositUsd === "string" &&
    typeof p.priceAtDeposit === "string" &&
    typeof p.depositBlock === "number"
  ) {
    return p as unknown as Basis;
  }

  // v1 (Tier 1) schema — migrate inline. Old keys: monIn, usdcIn, basisNAV,
  // basisPriceE8, basisBlock.
  if (
    typeof p.monIn === "string" &&
    typeof p.usdcIn === "string" &&
    typeof p.basisNAV === "string" &&
    typeof p.basisPriceE8 === "string" &&
    typeof p.basisBlock === "number"
  ) {
    return {
      monAmount: p.monIn as string,
      usdcAmount: p.usdcIn as string,
      depositUsd: p.basisNAV as string,
      priceAtDeposit: p.basisPriceE8 as string,
      depositBlock: p.basisBlock as number,
    };
  }

  return null;
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

  useEffect(() => {
    if (!k) { setBasis(null); return; }
    setBasis(read(k));
  }, [k]);

  // Auto-clear at 0 shares.
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
