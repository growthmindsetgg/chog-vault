import { coreTick, formatTick, makePublicClient, makeWalletClient, type PriceSource } from "./tickCore.js";
import { ADDRESSES, POLL_MS, getAgentAccount, requireDeployed } from "./config.js";
import { ammAbi } from "./abi.js";

// run.ts — autonomous tick. READS on-chain price (no setPrice). Rebalances
// only when off-band, signed by AGENT_PK. Loop survives bad cycles.
//
// Money STOP: this agent never auto-pays 402/entry fees and never moves funds
// beyond a single rebalance() swap. setPrice is intentionally out of scope here
// — that's the pyth-pusher's job (signed by a DIFFERENT key).
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

  // Infinite loop. Each tick is self-contained.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const r = await coreTick(priceSource, { publicClient: pub, agentWallet: wallet });
    console.log(formatTick(r));
    await new Promise((res) => setTimeout(res, POLL_MS));
  }
}

main().catch((e) => {
  // The loop itself doesn't throw — this only fires for startup errors
  // (missing env, zero addresses).
  console.error("[agent] fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
