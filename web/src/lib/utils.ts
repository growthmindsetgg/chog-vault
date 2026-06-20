import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function shortAddress(addr: string | undefined, head = 6, tail = 4): string {
  if (!addr) return "";
  if (addr.length <= head + tail + 2) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

// USDC: 6 decimals → string with up to 2 frac digits ("123.45")
export function formatUSDC(amount: bigint, frac = 2): string {
  const sign = amount < 0n ? "-" : "";
  const abs  = amount < 0n ? -amount : amount;
  const whole = abs / 1_000_000n;
  const remainder = (abs % 1_000_000n).toString().padStart(6, "0");
  if (frac === 0) return `${sign}${whole.toString()}`;
  return `${sign}${whole.toString()}.${remainder.slice(0, frac)}`;
}

// MON wei: 18 decimals → string with up to 4 frac digits
export function formatMON(wei: bigint, frac = 4): string {
  const sign = wei < 0n ? "-" : "";
  const abs  = wei < 0n ? -wei : wei;
  const whole = abs / 10n ** 18n;
  const remainder = (abs % 10n ** 18n).toString().padStart(18, "0");
  if (frac === 0) return `${sign}${whole.toString()}`;
  return `${sign}${whole.toString()}.${remainder.slice(0, frac)}`;
}

// priceE8 → "$0.0207"
export function formatPriceE8(priceE8: bigint): string {
  const whole = priceE8 / 100_000_000n;
  const frac  = priceE8 % 100_000_000n;
  return `$${whole}.${frac.toString().padStart(8, "0").slice(0, 4)}`;
}

// 6234n bps → "62.3%"
export function formatBps(bps: bigint): string {
  const whole = bps / 100n;
  const frac  = bps % 100n;
  const fracStr = frac < 10n ? `0${frac}` : `${frac}`;
  return `${whole}.${fracStr.slice(0, 1)}%`;
}

export function parseUSDCInput(s: string): bigint {
  if (!s) return 0n;
  const [w, f = ""] = s.split(".");
  const frac = (f + "000000").slice(0, 6);
  return BigInt(w || "0") * 1_000_000n + BigInt(frac || "0");
}

export function parseMONInput(s: string): bigint {
  if (!s) return 0n;
  const [w, f = ""] = s.split(".");
  const frac = (f + "000000000000000000").slice(0, 18);
  return BigInt(w || "0") * 10n ** 18n + BigInt(frac || "0");
}
