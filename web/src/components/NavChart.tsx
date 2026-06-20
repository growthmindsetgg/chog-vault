"use client";

import { useMemo } from "react";
import {
  Area, CartesianGrid, Line, ResponsiveContainer,
  Tooltip, XAxis, YAxis, ComposedChart,
} from "recharts";
import type { LogEntry } from "@/hooks/useLoggedEvents";

interface Props {
  basisMonIn: bigint;
  basisUsdcIn: bigint;
  basisPriceE8: bigint;
  currentPriceE8: bigint;
  currentVaultValue: bigint; // user's position value in 6dec USDC
  entries: LogEntry[];       // newest first, but we re-sort here
}

interface Point {
  i: number;
  vault: number;
  hodl: number;
}

// HODL value at price p, given the basis (monIn, usdcIn):
//   monIn (18 dec) * p (8 dec) / 1e20 = 6 dec
function hodlAt(monIn: bigint, usdcIn: bigint, priceE8: bigint): bigint {
  return (monIn * priceE8) / 10n ** 20n + usdcIn;
}

const toFloat6 = (n: bigint): number => Number(n) / 1_000_000;

export function NavChart({
  basisMonIn, basisUsdcIn, basisPriceE8, currentPriceE8, currentVaultValue, entries,
}: Props) {
  const data = useMemo<Point[]>(() => {
    // Build a time-ordered series from oldest log to "now".
    // Vault value at each log = navAfter scaled to user's share fraction. We
    // don't have per-block share fraction history, so we approximate by
    // anchoring to (basisNAV → currentVaultValue) and interpolating linearly
    // between entries, keeping the HODL benchmark exact.
    const sorted = [...entries].sort((a, b) => Number(a.seq - b.seq));
    const oldestPrice = sorted[0]?.priceE8 ?? basisPriceE8;

    const start: Point = {
      i: 0,
      vault: toFloat6(hodlAt(basisMonIn, basisUsdcIn, oldestPrice)),
      hodl:  toFloat6(hodlAt(basisMonIn, basisUsdcIn, oldestPrice)),
    };

    const middle: Point[] = sorted.map((e, idx) => ({
      i: idx + 1,
      vault: toFloat6(e.navAfter > 0n
        ? (e.navAfter * currentVaultValue) / (entries[0]?.navAfter ?? e.navAfter)
        : 0n),
      hodl: toFloat6(hodlAt(basisMonIn, basisUsdcIn, e.priceE8)),
    }));

    const last: Point = {
      i: middle.length + 1,
      vault: toFloat6(currentVaultValue),
      hodl:  toFloat6(hodlAt(basisMonIn, basisUsdcIn, currentPriceE8)),
    };

    return [start, ...middle, last];
  }, [entries, basisMonIn, basisUsdcIn, basisPriceE8, currentPriceE8, currentVaultValue]);

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
        <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <defs>
            <linearGradient id="vaultLead" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6B5CF0" stopOpacity={0.18} />
              <stop offset="100%" stopColor="#6B5CF0" stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#E7E5F4" strokeDasharray="3 6" vertical={false} />
          <XAxis dataKey="i" stroke="#A8A6B8" tickLine={false} axisLine={false} fontSize={11} />
          <YAxis stroke="#A8A6B8" tickLine={false} axisLine={false} fontSize={11} width={48}
                 tickFormatter={(v) => `$${Number(v).toFixed(0)}`} />
          <Tooltip
            cursor={{ stroke: "#A8A6B8", strokeDasharray: "3 3" }}
            contentStyle={{ borderRadius: 12, border: "1px solid #E7E5F4", background: "#fff", fontFamily: "var(--font-jakarta)" }}
            labelFormatter={(l) => `Step ${l}`}
            formatter={(v, name) => [`$${typeof v === "number" ? v.toFixed(2) : v}`, String(name)]}
          />
          <Area type="monotone" dataKey="vault" stroke="none" fill="url(#vaultLead)" name="Vault lead" />
          <Line type="monotone" dataKey="hodl"  stroke="#A8A6B8" strokeWidth={1.5} dot={false} name="HODL" />
          <Line type="monotone" dataKey="vault" stroke="#6B5CF0" strokeWidth={2.5} dot={false} name="Vault" className="nav-line-draw" />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-xs text-[var(--text-muted)] mt-2">
        Vault (purple) vs HODL (gray). HODL is your initial mix held unchanged;
        Vault is the rebalanced 60/40 position. Honest: no oracle history is
        stored on-chain — between rebalance points we interpolate, the HODL
        benchmark uses the price recorded at each rebalance.
      </p>
    </div>
  );
}
