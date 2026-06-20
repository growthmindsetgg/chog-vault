// STEP 9: pause vault, simulate a small withdraw from the deployer, assert it
// works while paused, then unpause. No real withdraw broadcast — pure simulate
// to keep the verification cheap and idempotent.

import { ADDRESSES, getDeployerAccount, monadTestnet, requireDeployed } from "../config.js";
import { makePublicClient, makeWalletClient } from "../tickCore.js";
import { vaultAbi } from "../abi.js";

async function main() {
  requireDeployed();
  const deployer = getDeployerAccount();
  const pub      = makePublicClient();
  const wallet   = makeWalletClient(deployer);

  const sharesBefore = (await pub.readContract({
    address: ADDRESSES.RebalanceVault, abi: vaultAbi,
    functionName: "balanceOf", args: [deployer.address],
  })) as bigint;
  console.log(`deployer shares: ${sharesBefore}`);
  if (sharesBefore === 0n) {
    console.error("FAIL: deployer has no shares — test cannot run.");
    process.exit(1);
  }

  // 1) Pause
  console.log("pausing vault…");
  const pauseTx = await wallet.writeContract({
    address: ADDRESSES.RebalanceVault, abi: vaultAbi,
    functionName: "setPaused", args: [true],
    chain: monadTestnet, account: deployer,
    gas: 80_000n, type: "legacy",
  });
  await pub.waitForTransactionReceipt({ hash: pauseTx, pollingInterval: 500 });
  const paused = (await pub.readContract({
    address: ADDRESSES.RebalanceVault, abi: vaultAbi, functionName: "paused",
  })) as boolean;
  console.log(`paused=${paused}  pauseTx=${pauseTx}`);
  if (!paused) { console.error("pause didn't stick"); process.exit(1); }

  // 2) While paused, simulate a small withdraw (1% of shares) from deployer.
  const withdrawSim = sharesBefore / 100n;
  console.log(`simulating withdraw(${withdrawSim}) while paused…`);
  try {
    await pub.simulateContract({
      address: ADDRESSES.RebalanceVault, abi: vaultAbi,
      functionName: "withdraw", args: [withdrawSim],
      account: deployer.address,
    });
    console.log("PASS: withdraw simulate succeeds while paused.");
  } catch (e) {
    console.error("FAIL: withdraw simulate reverted while paused:", e instanceof Error ? e.message : e);
    process.exit(1);
  }

  // 3) While paused, simulate that the AGENT cannot rebalance.
  console.log("simulating rebalance() while paused — should revert with 'vault: paused'…");
  try {
    const { getAgentAccount } = await import("../config.js");
    const agent = getAgentAccount();
    await pub.simulateContract({
      address: ADDRESSES.RebalanceVault, abi: vaultAbi,
      functionName: "rebalance", args: [],
      account: agent.address,
    });
    console.error("FAIL: rebalance simulate succeeded while paused!");
    process.exit(1);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/vault:\s*paused/i.test(msg)) {
      console.log("PASS: rebalance correctly blocked while paused.");
    } else {
      console.error("UNEXPECTED revert reason:", msg);
      process.exit(1);
    }
  }

  // 4) Unpause to leave the vault sane for further demos.
  console.log("unpausing…");
  const unpauseTx = await wallet.writeContract({
    address: ADDRESSES.RebalanceVault, abi: vaultAbi,
    functionName: "setPaused", args: [false],
    chain: monadTestnet, account: deployer,
    gas: 80_000n, type: "legacy",
  });
  await pub.waitForTransactionReceipt({ hash: unpauseTx, pollingInterval: 500 });
  const pausedAfter = (await pub.readContract({
    address: ADDRESSES.RebalanceVault, abi: vaultAbi, functionName: "paused",
  })) as boolean;
  console.log(`paused=${pausedAfter}  unpauseTx=${unpauseTx}`);
}

main().catch((e) => {
  console.error("script error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
