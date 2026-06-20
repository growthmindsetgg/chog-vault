import { ADDRESSES, getDeployerAccount, monadTestnet, RPC_URL, POLL_MS } from "../config.js";
import { makePublicClient, makeWalletClient } from "../tickCore.js";
import { ammAbi } from "../abi.js";
import { formatPriceE8 } from "../pyth.js";

// LOCAL-ANVIL ONLY oscillator: walks priceE8 in a ±25% sine around a base price
// to exercise the strategy in the dev env. Refuses to run against the real RPC.
//
// Set BASE_PRICE_E8 and STEP_MS via env. Defaults: $0.02 base, 5s steps.
const ALLOWED_LOCAL_HOSTS = ["127.0.0.1", "localhost"];

function isAnvil(): boolean {
  try {
    const u = new URL(RPC_URL);
    return ALLOWED_LOCAL_HOSTS.includes(u.hostname);
  } catch { return false; }
}

async function main() {
  if (!isAnvil()) {
    console.error(`price-driver refuses non-anvil RPC: ${RPC_URL}`);
    process.exit(2);
  }
  const base = BigInt(process.env.BASE_PRICE_E8 ?? "2000000"); // $0.02
  const step = Number(process.env.STEP_MS ?? POLL_MS);

  const deployer = getDeployerAccount();
  const pub      = makePublicClient();
  const wallet   = makeWalletClient(deployer);

  console.log(`[price-driver] anvil mode  base=${formatPriceE8(base)}  step=${step}ms`);

  let theta = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // priceE8 = base * (1 + 0.25 * sin(theta))
    const mult = Math.round(1e6 + 250_000 * Math.sin(theta));
    const priceE8 = (base * BigInt(mult)) / 1_000_000n;
    try {
      const txHash = await wallet.writeContract({
        address: ADDRESSES.OracleAMM, abi: ammAbi, functionName: "setPrice",
        args: [priceE8], chain: monadTestnet, account: deployer,
      });
      await pub.waitForTransactionReceipt({ hash: txHash });
      console.log(`driver: priceE8=${priceE8} (${formatPriceE8(priceE8)})  tx=${txHash}`);
    } catch (e) {
      console.warn("[price-driver] skip:", e instanceof Error ? e.message : e);
    }
    theta += Math.PI / 12; // 24 steps per full cycle
    await new Promise((res) => setTimeout(res, step));
  }
}

main().catch((e) => {
  console.error("[price-driver] fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
