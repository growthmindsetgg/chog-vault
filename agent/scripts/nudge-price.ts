import { ADDRESSES, getDeployerAccount, monadTestnet, requireDeployed } from "../config.js";
import { makePublicClient, makeWalletClient } from "../tickCore.js";
import { ammAbi } from "../abi.js";
import { formatPriceE8 } from "../pyth.js";

// One-shot owner-signed setPrice. Use this to provoke a rebalance for judges
// if live MON happens to be flat.
//
// Usage: tsx scripts/nudge-price.ts <newPriceE8>
//   e.g. tsx scripts/nudge-price.ts 4000000     (= $0.04)
async function main() {
  requireDeployed();

  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: tsx scripts/nudge-price.ts <newPriceE8>");
    process.exit(2);
  }
  const priceE8 = BigInt(arg);
  if (priceE8 <= 0n) {
    console.error("nudge-price: priceE8 must be > 0");
    process.exit(2);
  }

  const deployer = getDeployerAccount();
  const pub      = makePublicClient();
  const wallet   = makeWalletClient(deployer);

  const txHash = await wallet.writeContract({
    address: ADDRESSES.OracleAMM, abi: ammAbi, functionName: "setPrice",
    args: [priceE8], chain: monadTestnet, account: deployer,
    gas: 120_000n, type: "legacy",
  });
  console.log(`nudge: setPrice(${priceE8}) = ${formatPriceE8(priceE8)} → tx ${txHash}`);
  const rcpt = await pub.waitForTransactionReceipt({ hash: txHash });
  console.log(`mined in block ${rcpt.blockNumber}`);
}

main().catch((e) => {
  console.error("nudge-price failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
