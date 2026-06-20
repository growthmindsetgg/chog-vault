import { coreTick, formatTick, makePublicClient, makeWalletClient, type PriceSource, type TickResult } from "./tickCore.js";
import { ADDRESSES, POLL_MS, getAgentAccount, requireDeployed } from "./config.js";
import { ammAbi } from "./abi.js";
import { formatBps } from "./strategy.js";

// run.ts — autonomous tick. READS on-chain price (no setPrice). Rebalances
// only when off-band, signed by AGENT_PK. Loop survives bad cycles.
//
// Money STOP: this agent never auto-pays 402/entry fees and never moves funds
// beyond a single rebalance() swap. setPrice is intentionally out of scope here
// — that's the pyth-pusher's job (signed by a DIFFERENT key).
//
// STEP 6: when a user deposit between ticks pushes monValueBps off-band, the
// agent rebalances and tags the log line as "Split deposit:". Detection is
// pure: totalShares increased since last tick + rebalance fired this tick.

function formatMon(wei: bigint, dp = 4): string {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, dp);
  return `${whole}.${frac}`;
}

function classifyRebalance(curr: TickResult, prevTotalShares: bigint | undefined): "split" | "trim" | "add" | "other" {
  if (!curr.rebalanceTx) return "other";
  const sharesUp = prevTotalShares !== undefined &&
                   curr.totalShares !== undefined &&
                   curr.totalShares > prevTotalShares;
  if (sharesUp) return "split";
  if (curr.decision?.action === "trim_mon") return "trim";
  if (curr.decision?.action === "buy_mon")  return "add";
  return "other";
}

async function main() {
  requireDeployed();

  const agent  = getAgentAccount();
  const pub    = makePublicClient();
  const wallet = makeWalletClient(agent);

  // On-chain price source — no writes.
  const priceSource: PriceSource = async () => {
    const p = (await pub.readContract({
      address: ADDRESSES.OracleAMM, abi: ammAbi, functionName: "priceE8",
    })) as bigint;
    return { priceE8: p };
  };

  console.log(`[agent] starting. agent=${agent.address}  vault=${ADDRESSES.RebalanceVault}  poll=${POLL_MS}ms`);

  // Track totalShares across ticks so we can detect deposit-driven rebalances.
  let prevTotalShares: bigint | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const r = await coreTick(priceSource, { publicClient: pub, agentWallet: wallet });

    const kind = classifyRebalance(r, prevTotalShares);

    if (r.ok && r.rebalanceTx && kind === "split") {
      // Deposit-driven rebalance — narrate as a split.
      const bpsBeforeStr = r.bpsBefore !== undefined ? formatBps(r.bpsBefore) : "?";
      const bpsAfterStr  = r.bpsAfter  !== undefined ? formatBps(r.bpsAfter)  : "?";
      const sold = (r.monBefore !== undefined && r.monAfter !== undefined && r.monBefore > r.monAfter)
        ? (r.monBefore - r.monAfter)
        : 0n;
      console.log(
        `Split deposit: MON ran to ${bpsBeforeStr} -> sold ${formatMon(sold)} MON worth to USDC, back to ${bpsAfterStr}. tx ${r.rebalanceTx}`,
      );
    } else {
      // Default narration (hold / non-split trim / non-split add).
      console.log(formatTick(r));
    }

    if (r.ok && r.totalShares !== undefined) {
      prevTotalShares = r.totalShares;
    }

    await new Promise((res) => setTimeout(res, POLL_MS));
  }
}

main().catch((e) => {
  // The loop itself doesn't throw — this only fires for startup errors
  // (missing env, zero addresses).
  console.error("[agent] fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
