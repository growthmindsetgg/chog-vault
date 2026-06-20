// Pure strategy. No I/O, no globals — easy to unit-test or reason about.
// monValueBps is the MON share of NAV in basis points (0–10_000).
// Target = 6000 bps (60%). Band = ±500 bps → trigger when outside [5500, 6500].

export type Action = "hold" | "trim_mon" | "buy_mon";

export interface Decision {
  action: Action;
  reason: string;
}

export const BPS_TARGET = 6000n;
export const BPS_BAND   = 500n;
export const BPS_LO     = BPS_TARGET - BPS_BAND; // 5500
export const BPS_HI     = BPS_TARGET + BPS_BAND; // 6500

export function formatBps(bps: bigint): string {
  // 6234 -> "62.3%"
  const whole = bps / 100n;
  const frac  = bps % 100n;
  const fracStr = frac < 10n ? `0${frac}` : `${frac}`;
  return `${whole}.${fracStr.slice(0, 1)}%`;
}

export function decide(monValueBps: bigint): Decision {
  const pct = formatBps(monValueBps);
  if (monValueBps > BPS_HI) {
    return { action: "trim_mon", reason: `MON ran to ${pct} — trimming MON, buying USDC…` };
  }
  if (monValueBps < BPS_LO) {
    return { action: "buy_mon",  reason: `MON dipped to ${pct} — buying MON with USDC…` };
  }
  return { action: "hold", reason: `MON at ${pct} — inside 60/40 band, holding.` };
}
