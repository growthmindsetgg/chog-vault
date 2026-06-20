"use client";

import { useMemo } from "react";
import {
  Area, CartesianGrid, Line, ResponsiveContainer,
  Tooltip, XAxis, YAxis, ComposedChart,
} from "recharts";
import type { LogEntry } from "@/hooks/useLoggedEvents";

interface Props {
  // Cost basis (v2 schema).
  depositUsd: bigint;       // 6 dec USDC — sum of $ contributions at deposit time
  monAmount: bigint;        // 18 dec wei — sum of MON contributions
  usdcAmount: bigint;       // 6 dec      — sum of USDC contributions
  priceAtDeposit: bigint;   // 8 dec      — last deposit's priceE8 (informational)

  // Live state.
  currentPriceE8: bigint;
  currentVaultValue: bigint;  // 6 dec USDC — user's position right now
  userShares: bigint;
  totalShares: bigint;

  entries: LogEntry[];        // LogBook entries (any order)
}

interface Point {
  i: number;
  label: string;
  vault: number;
  hodl: number;
}

const toFloat6 = (n: bigint): number => Number(n) / 1_000_000;

function hodlAt(monAmount: bigint, usdcAmount: bigint, priceE8: bigint): bigint {
  return (monAmount * priceE8) / 10n ** 20n + usdcAmount;
}

export function NavChart({
  depositUsd, monAmount, usdcAmount,
  currentPriceE8, currentVaultValue, userShares, totalShares,
  entries,
}: Props) {
  const data = useMemo<Point[]>(() => {
    // Both series START at depositUsd.
    const start: Point = {
      i: 0, label: "deposit",
      vault: toFloat6(depositUsd),
      hodl:  toFloat6(depositUsd),
    };

    // Sort entries oldest→newest by seq.
    const sorted = [...entries].sort((a, b) => Number(a.seq - b.seq));

    // User-fraction scale (* 1e6 for fixed-point math). For multi-user vaults
    // this is an approximation — we don't have per-block per-user share counts
    // on chain. For the single-LP case it's exact.
    const userFracX1e6 = totalShares === 0n
      ? 1_000_000n
      : (userShares * 1_000_000n) / totalShares;

    const middle: Point[] = sorted.map((e, idx) => ({
      i: idx + 1,
      label: `r${e.seq}`,
      // Vault: aggregate navAfter * user-fraction-now.
      vault: toFloat6((e.navAfter * userFracX1e6) / 1_000_000n),
      // HODL: the user's ORIGINAL deposited tokens, marked at the price recorded
      // at this rebalance. Exact.
      hodl: toFloat6(hodlAt(monAmount, usdcAmount, e.priceE8)),
    }));

    const last: Point = {
      i: middle.length + 1,
      label: "now",
      vault: toFloat6(currentVaultValue),
      hodl:  toFloat6(hodlAt(monAmount, usdcAmount, currentPriceE8)),
    };

    return [start, ...middle, last];
  }, [
    depositUsd, monAmount, usdcAmount,
    currentPriceE8, currentVaultValue, userShares, totalShares, entries,
  ]);

  if (data.length < 2) {
    return (
      <div className="h-56 flex items-center justify-center text-sm text-[var(--text-muted)]">
        Not enough rebalance history yet. Comes alive after the first rebalance.
      </div>
    );
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <defs>
            <linearGradient id="vaultLead" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6B5CF0" stopOpacity={0.18} />
              <stop offset="100%" stopColor="#6B5CF0" stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#E7E5F4" strokeDasharray="3 6" vertical={false} />
          <XAxis dataKey="label" stroke="#A8A6B8" tickLine={false} axisLine={false} fontSize={11} />
          <YAxis
            stroke="#A8A6B8" tickLine={false} axisLine={false} fontSize={11} width={56}
            domain={["auto", "auto"]}
            tickFormatter={(v) => `$${Number(v).toFixed(2)}`}
          />
          <Tooltip
            cursor={{ stroke: "#A8A6B8", strokeDasharray: "3 3" }}
            contentStyle={{ borderRadius: 12, border: "1px solid #E7E5F4", background: "#fff", fontFamily: "var(--font-jakarta)" }}
            labelFormatter={(l) => `Point: ${l}`}
            formatter={(v, name) => [`$${typeof v === "number" ? v.toFixed(2) : v}`, String(name)]}
          />
          <Area type="monotone" dataKey="vault" stroke="none" fill="url(#vaultLead)" name="Vault lead" />
          <Line type="monotone" dataKey="hodl"  stroke="#A8A6B8" strokeWidth={1.5} dot={false} name="HODL" />
          <Line type="monotone" dataKey="vault" stroke="#6B5CF0" strokeWidth={2.5} dot={false} name="Vault" className="nav-line-draw" />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-xs text-[var(--text-muted)] mt-2">
        Vault (purple) vs HODL (gray). Both start at the dollars you put in.
        HODL = your original MON + USDC marked at each rebalance&apos;s price; Vault
        = your share of the vault NAV at the same points. Vault wins on
        volatility, loses on one-way moves.
      </p>
    </div>
  );
}
