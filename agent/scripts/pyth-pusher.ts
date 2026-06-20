import { ADDRESSES, POLL_MS, getDeployerAccount, monadTestnet, requireDeployed } from "../config.js";
import { makePublicClient, makeWalletClient } from "../tickCore.js";
import { ammAbi } from "../abi.js";
import { getMonUsdE8, formatPriceE8 } from "../pyth.js";

// Pushes live MON/USD from Pyth Beta Hermes onto OracleAMM.setPrice every POLL_MS.
// Signed by DEPLOYER_PK (owner). Skip-and-continue on any failure.
async function main() {
  requireDeployed();

  const deployer = getDeployerAccount();
  const pub      = makePublicClient();
  const wallet   = makeWalletClient(deployer);

  console.log(`[pyth-pusher] deployer=${deployer.address}  amm=${ADDRESSES.OracleAMM}  poll=${POLL_MS}ms`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const priceE8 = await getMonUsdE8();
      const txHash = await wallet.writeContract({
        address: ADDRESSES.OracleAMM, abi: ammAbi, functionName: "setPrice",
        args: [priceE8],
        chain: monadTestnet, account: deployer,
        gas: 120_000n, type: "legacy",
      });
      // Wait for receipt to keep nonces clean across cycles.
      await pub.waitForTransactionReceipt({ hash: txHash });
      console.log(`pyth MON/USD = ${formatPriceE8(priceE8)} → setPrice tx ${txHash}`);
    } catch (e) {
      console.warn("[pyth-pusher] skipped cycle:", e instanceof Error ? e.message : e);
    }
    await new Promise((res) => setTimeout(res, POLL_MS));
  }
}

main().catch((e) => {
  console.error("[pyth-pusher] fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
