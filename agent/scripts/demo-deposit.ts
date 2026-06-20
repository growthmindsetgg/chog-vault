// One-off: deployer (= DEMO_USER in Phase 4) deposits 60 MON + 40 USDC so the
// vault has assets to rebalance during Phase 5 verification.
//
// Phase 5 only — judges and end users will deposit through the web UI.
import { parseEther } from "viem";
import { ADDRESSES, getDeployerAccount, monadTestnet, requireDeployed } from "../config.js";
import { makePublicClient, makeWalletClient } from "../tickCore.js";
import { usdcAbi, vaultAbi } from "../abi.js";

// Deployer only has ~15 MON after seeding the AMM with 120 MON in Phase 4.
// 10 MON + 6 USDC at $2 → NAV $26, MON share ~76.9% → above 65% upper band
// → first agent tick rebalances. Total cost: 10 MON + gas, fits the budget.
const MON_IN  = parseEther("10"); // 10 MON
const USDC_IN = 6_000_000n;       // 6 USDC (6 dec)

async function main() {
  requireDeployed();
  const deployer = getDeployerAccount();
  const pub      = makePublicClient();
  const wallet   = makeWalletClient(deployer);

  console.log(`[demo-deposit] user=${deployer.address}  vault=${ADDRESSES.RebalanceVault}`);
  console.log(`[demo-deposit] depositing ${MON_IN} wei MON + ${USDC_IN} USDC (6 dec)`);

  // 1) Approve USDC for the vault.
  const approveTx = await wallet.writeContract({
    address: ADDRESSES.MockUSDC, abi: usdcAbi, functionName: "approve",
    args: [ADDRESSES.RebalanceVault, USDC_IN],
    chain: monadTestnet, account: deployer,
  });
  console.log(`approve tx ${approveTx}`);
  await pub.waitForTransactionReceipt({ hash: approveTx });

  // 2) Deposit. Set explicit gas (Monad sometimes underestimates payable+ERC20
  // pull-and-write combos) and force legacy type (matches the deploy script).
  const depositTx = await wallet.writeContract({
    address: ADDRESSES.RebalanceVault, abi: vaultAbi, functionName: "deposit",
    args: [USDC_IN], value: MON_IN,
    chain: monadTestnet, account: deployer,
    gas: 400_000n,
    type: "legacy",
  });
  console.log(`deposit tx ${depositTx}`);
  const rcpt = await pub.waitForTransactionReceipt({ hash: depositTx });
  console.log(`deposit mined in block ${rcpt.blockNumber}`);

  // 3) Verify.
  const [shares, nav] = await Promise.all([
    pub.readContract({ address: ADDRESSES.RebalanceVault, abi: vaultAbi, functionName: "balanceOf", args: [deployer.address] }),
    pub.readContract({ address: ADDRESSES.RebalanceVault, abi: vaultAbi, functionName: "nav" }),
  ]);
  console.log(`user shares: ${shares}`);
  console.log(`vault NAV (6dec USDC): ${nav}`);
}

main().catch((e) => {
  console.error("[demo-deposit] failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
