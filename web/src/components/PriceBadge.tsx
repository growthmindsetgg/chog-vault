"use client";

import { useVaultSnapshot } from "@/hooks/useVaultSnapshot";
import { formatPriceE8 } from "@/lib/utils";

// STEP 8 — Live oracle MON/USD in the header. Sources the price from the
// same useVaultSnapshot the rest of the app uses, so:
//   - refreshes every 12s alongside the snapshot tick
//   - refreshes the moment after any tx, because every tx-handler calls
//     refetch() on the snapshot
// JetBrains Mono per spec ("small, clean, monospace").
export function PriceBadge() {
  const { data: snap, isLoading, isFetching } = useVaultSnapshot();
  const ready = snap && snap.priceE8 > 0n;
  const label = ready ? formatPriceE8(snap.priceE8) : (isLoading || isFetching ? "…" : "—");

  return (
    <span
      className="font-mono text-xs px-2.5 py-1 rounded-lg bg-[var(--purple-soft)] text-[var(--purple-strong)] tabular-nums"
      title="Live MON/USD from OracleAMM.priceE8(). Updated each snapshot tick (~12s) and after every tx."
    >
      MON {label}
    </span>
  );
}
