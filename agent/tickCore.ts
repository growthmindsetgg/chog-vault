import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  type Account,
  type Hash,
  type PublicClient,
  type WalletClient,
} from "viem";
import { ADDRESSES, monadTestnet, RPC_URL } from "./config.js";
import { vaultAbi, ammAbi } from "./abi.js";
import { decide, formatBps, type Decision } from "./strategy.js";
import { formatPriceE8 } from "./pyth.js";

export interface PriceResult {
  priceE8: bigint;
  setPriceTx?: Hash;
}

export type PriceSource = () => Promise<PriceResult>;

export interface TickDeps {
  publicClient: PublicClient;
  agentWallet?: WalletClient & { account: Account };
}

export interface TickResult {
  ok: boolean;
  error?: string;
  priceE8?: bigint;
  bpsBefore?: bigint;
  decision?: Decision;
  rebalanceTx?: Hash;
  bpsAfter?: bigint;
  setPriceTx?: Hash;
}

// Public clients are cheap; build them on demand for scripts.
export function makePublicClient(rpc: string = RPC_URL): PublicClient {
  return createPublicClient({
    chain: monadTestnet,
    transport: http(rpc),
    batch: { multicall: false }, // Monad testnet has no Multicall3.
  });
}

export function makeWalletClient(account: Account, rpc: string = RPC_URL): WalletClient & { account: Account } {
  return createWalletClient({
    account,
    chain: monadTestnet,
    transport: http(rpc),
  }) as WalletClient & { account: Account };
}

// Single tick. Sequential awaits → nonce-safe even if both setPrice and
// rebalance need to land. Never throws — callers loop on the result.
export async function coreTick(priceSource: PriceSource, deps: TickDeps): Promise<TickResult> {
  const { publicClient, agentWallet } = deps;
  try {
    // 1) Price (may also push setPrice).
    const { priceE8, setPriceTx } = await priceSource();
    if (setPriceTx) {
      await publicClient.waitForTransactionReceipt({ hash: setPriceTx });
    }

    // 2) Read vault state.
    const [monBal, usdcBal, paused] = await Promise.all([
      publicClient.readContract({
        address: ADDRESSES.RebalanceVault, abi: vaultAbi, functionName: "monBalance",
      }) as Promise<bigint>,
      publicClient.readContract({
        address: ADDRESSES.RebalanceVault, abi: vaultAbi, functionName: "usdcBalance",
      }) as Promise<bigint>,
      publicClient.readContract({
        address: ADDRESSES.RebalanceVault, abi: vaultAbi, functionName: "paused",
      }) as Promise<boolean>,
    ]);

    const monValue = (monBal * priceE8) / 10n ** 20n; // 6 dec
    const nav = monValue + usdcBal;
    const bpsBefore = nav === 0n ? 0n : (monValue * 10_000n) / nav;
    const decision  = decide(bpsBefore);

    // 3) Maybe rebalance.
    let rebalanceTx: Hash | undefined;
    let bpsAfter: bigint | undefined;

    if (decision.action !== "hold" && !paused && agentWallet) {
      rebalanceTx = await agentWallet.writeContract({
        address: ADDRESSES.RebalanceVault, abi: vaultAbi, functionName: "rebalance",
        chain: monadTestnet, account: agentWallet.account,
        // Monad gas estimation occasionally under-budgets payable + ERC20-pull
        // + LogBook write combos; cap legacy gas at 600k to be safe.
        gas: 600_000n, type: "legacy",
      });
      await publicClient.waitForTransactionReceipt({ hash: rebalanceTx });

      // Re-read for after-bps.
      const [m2, u2] = await Promise.all([
        publicClient.readContract({
          address: ADDRESSES.RebalanceVault, abi: vaultAbi, functionName: "monBalance",
        }) as Promise<bigint>,
        publicClient.readContract({
          address: ADDRESSES.RebalanceVault, abi: vaultAbi, functionName: "usdcBalance",
        }) as Promise<bigint>,
      ]);
      const mv2 = (m2 * priceE8) / 10n ** 20n;
      const nav2 = mv2 + u2;
      bpsAfter = nav2 === 0n ? 0n : (mv2 * 10_000n) / nav2;
    }

    return { ok: true, priceE8, bpsBefore, decision, rebalanceTx, bpsAfter, setPriceTx };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export function formatTick(r: TickResult): string {
  if (!r.ok) return `tick error: ${r.error ?? "unknown"}`;
  const price = r.priceE8 !== undefined ? formatPriceE8(r.priceE8) : "?";
  const bps   = r.bpsBefore !== undefined ? formatBps(r.bpsBefore) : "?";
  const lines: string[] = [];
  lines.push(`tick: price=${price}  bps=${bps}  action=${r.decision?.action ?? "?"}  reason=${r.decision?.reason ?? ""}`);
  if (r.rebalanceTx) {
    const after = r.bpsAfter !== undefined ? formatBps(r.bpsAfter) : "?";
    lines.push(`  → rebalanced: ${bps} → ${after}  tx=${r.rebalanceTx}`);
  }
  if (r.setPriceTx) lines.push(`  setPrice tx=${r.setPriceTx}`);
  return lines.join("\n");
}

// Silence unused-import lint when formatEther isn't used in this file's body.
export const _formatEtherForReExport = formatEther;
