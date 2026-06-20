// STEP 9 verification helper: deployer does a MON-only deposit (deposit(0)
// with msg.value = AMOUNT). This is the exact path the frontend's
// "MON only (auto-split)" mode takes. Used to trigger the agent's
// "Split deposit" log line.

import { parseEther } from "viem";
import { ADDRESSES, getDeployerAccount, monadTestnet, requireDeployed } from "../config.js";
import { makePublicClient, makeWalletClient } from "../tickCore.js";
import { vaultAbi } from "../abi.js";

const MON_IN = parseEther(process.env.MON ?? "2"); // default 2 MON

async function main() {
  requireDeployed();
  const deployer = getDeployerAccount();
  const pub      = makePublicClient();
  const wallet   = makeWalletClient(deployer);

  console.log(`[mon-only-deposit] user=${deployer.address}  amount=${MON_IN} wei (${Number(MON_IN) / 1e18} MON)`);

  const tx = await wallet.writeContract({
    address: ADDRESSES.RebalanceVault, abi: vaultAbi, functionName: "deposit",
    args: [0n], value: MON_IN,
    chain: monadTestnet, account: deployer,
    gas: 400_000n, type: "legacy",
  });
  console.log(`deposit tx ${tx}`);
  const rcpt = await pub.waitForTransactionReceipt({ hash: tx, pollingInterval: 500 });
  console.log(`mined in block ${rcpt.blockNumber}  status=${rcpt.status}`);

  const shares = (await pub.readContract({
    address: ADDRESSES.RebalanceVault, abi: vaultAbi, functionName: "balanceOf", args: [deployer.address],
  })) as bigint;
  const nav = (await pub.readContract({
    address: ADDRESSES.RebalanceVault, abi: vaultAbi, functionName: "nav",
  })) as bigint;
  console.log(`user shares: ${shares}  NAV(6dec USDC): ${nav}`);
}

main().catch((e) => {
  console.error("failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
