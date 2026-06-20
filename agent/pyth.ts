import { PYTH_HERMES_URL, MON_USD_FEED_ID } from "./config.js";

interface HermesPrice {
  price: string;
  expo: number;
  conf: string;
  publish_time: number;
}

interface HermesResponse {
  parsed?: Array<{ id: string; price: HermesPrice; ema_price?: HermesPrice }>;
}

// Returns MON/USD priceE8 (8 decimals). Resilient: validates structure,
// tolerates any signed expo by normalizing to -8. Throws on bad input —
// callers (tickCore, scripts) catch and skip the cycle.
export async function getMonUsdE8(): Promise<bigint> {
  const url = new URL("/v2/updates/price/latest", PYTH_HERMES_URL);
  url.searchParams.append("ids[]", MON_USD_FEED_ID);
  url.searchParams.set("parsed", "true");
  url.searchParams.set("encoding", "hex");

  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Hermes ${res.status} ${res.statusText}`);

  const body = (await res.json()) as HermesResponse;
  const entry = body.parsed?.[0];
  if (!entry) throw new Error("Hermes: parsed[0] missing");

  const raw = BigInt(entry.price.price); // signed-as-string in JSON
  if (raw <= 0n) throw new Error(`Hermes: non-positive price ${raw}`);

  const expo = entry.price.expo; // negative integer, typically -8
  // Normalize to 8 decimals: priceE8 = raw * 10^(expo + 8)
  const shift = expo + 8;
  if (shift === 0) return raw;
  if (shift > 0)   return raw * 10n ** BigInt(shift);
  return raw / 10n ** BigInt(-shift);
}

export function formatPriceE8(priceE8: bigint): string {
  // 2_077_622 -> "$0.0208" (6 dec precision is enough for display)
  const whole = priceE8 / 100_000_000n;
  const frac  = priceE8 % 100_000_000n;
  const fracStr = frac.toString().padStart(8, "0").slice(0, 4);
  return `$${whole}.${fracStr}`;
}
