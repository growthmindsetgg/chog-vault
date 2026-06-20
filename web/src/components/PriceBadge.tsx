"use client";

import { useVaultSnapshot } from "@/hooks/useVaultSnapshot";
import { usePythLive } from "@/hooks/usePythLive";
import { formatPriceE8 } from "@/lib/utils";

// PriceBadge — header MON/USD pill.
//
// Source of truth for the displayed value: OracleAMM.priceE8() (drives NAV).
// Independent comparison source: live Pyth beta Hermes.
// If the on-chain oracle and the live feed diverge by >2%, an amber chip
// surfaces so a frozen oracle is NEVER silently presented as truth.
//
// Label: "MON/USD · Pyth live" (in the tooltip — small label keeps the header
// compact). Format: always 4 decimal places, so $0.0210 reads cleanly and
// $2.0000 (the stale seed) reads honestly as a 4-dp number.
export function PriceBadge() {
  const { data: snap, isLoading, isFetching } = useVaultSnapshot();
  const { data: pythE8 } = usePythLive();

  const onChain = snap?.priceE8 ?? 0n;
  const ready = onChain > 0n;
  const label = ready
    ? formatPriceE8(onChain)
    : (isLoading || isFetching ? "…" : "—");

  // Divergence (bps of live).
  let driftBps = 0n;
  if (pythE8 && pythE8 > 0n && onChain > 0n) {
    const diff = onChain > pythE8 ? onChain - pythE8 : pythE8 - onChain;
    driftBps = (diff * 10_000n) / pythE8;
  }
  const diverged = driftBps > 200n; // >2%

  return (
    <div className="flex items-center gap-1.5">
      <span
        className="font-mono text-xs px-2.5 py-1 rounded-lg bg-[var(--purple-soft)] text-[var(--purple-strong)] tabular-nums"
        title={`MON/USD · Pyth live. Displayed = OracleAMM.priceE8() (drives NAV). Live Pyth = ${pythE8 ? formatPriceE8(pythE8) : "…"}.`}
      >
        MON {label}
      </span>
      {diverged && (
        <span
          className="font-medium text-[10px] px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-300"
          title={`Live Pyth: ${pythE8 ? formatPriceE8(pythE8) : "—"} — on-chain oracle drifted ${(Number(driftBps) / 100).toFixed(1)}%.`}
        >
          oracle syncing — start pyth-pusher
        </span>
      )}
    </div>
  );
}
