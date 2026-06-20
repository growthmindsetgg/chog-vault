// STEP 0 gap report: on-chain priceE8 vs live Pyth; LogBook count + entries;
// Rebalanced getLogs in the 50k-block window. Read-only.

import { ADDRESSES } from "../config.js";
import { makePublicClient } from "../tickCore.js";
import { ammAbi, logBookAbi, vaultAbi } from "../abi.js";
import { getMonUsdE8, formatPriceE8 } from "../pyth.js";
import { parseAbiItem, type AbiEvent } from "viem";

async function main() {
  const pub = makePublicClient();

  console.log("============================================================");
  console.log("=== STEP 0: gap report (no writes) ============================");
  console.log("============================================================");

  // 1) Side-by-side price.
  const [onChain, pyth] = await Promise.all([
    pub.readContract({
      address: ADDRESSES.OracleAMM, abi: ammAbi, functionName: "priceE8",
    }) as Promise<bigint>,
    getMonUsdE8(),
  ]);
  const driftBps = onChain === 0n ? -1n : ((onChain > pyth ? onChain - pyth : pyth - onChain) * 10_000n) / pyth;

  console.log("\n[A] PRICE (priceE8 = USD * 1e8)");
  console.log(`    on-chain OracleAMM.priceE8():  ${onChain}  (${formatPriceE8(onChain)})`);
  console.log(`    live Pyth beta MON/USD:        ${pyth}  (${formatPriceE8(pyth)})`);
  console.log(`    drift (bps of live):           ${driftBps} bps  (= ${Number(driftBps) / 100}% off)`);
  if (driftBps > 200n) {
    console.log(`    → DIVERGED >2% — the on-chain oracle is stale; NAV/ROI/chart are computed on stale numbers.`);
  } else {
    console.log(`    → within 2% (pusher is fresh).`);
  }

  // 2) LogBook count + entries.
  const count = (await pub.readContract({
    address: ADDRESSES.LogBook, abi: logBookAbi, functionName: "count",
  })) as bigint;
  console.log(`\n[B] LogBook.count() = ${count}`);
  for (let i = 0n; i < count; i++) {
    const e = (await pub.readContract({
      address: ADDRESSES.LogBook, abi: logBookAbi, functionName: "entries", args: [i],
    })) as readonly [bigint, bigint, bigint, bigint, bigint, bigint];
    console.log(`    #${i}: priceE8=${e[0]}  bps ${e[1]}→${e[2]}  NAV ${e[3]}→${e[4]}  ts=${e[5]}`);
  }

  // 3) Rebalanced getLogs in the 50k-block window.
  const head = await pub.getBlockNumber();
  const deployBlock = BigInt(ADDRESSES.deployBlock);
  const fromBlock = head > deployBlock + 50_000n ? head - 50_000n : (deployBlock || head);
  const rebEvent = parseAbiItem("event Rebalanced(uint256 priceE8, uint256 monValueBps)") as AbiEvent;
  const logs = await pub.getLogs({
    address: ADDRESSES.RebalanceVault, event: rebEvent, fromBlock, toBlock: head,
  });
  console.log(`\n[C] Rebalanced getLogs window: head=${head}, fromBlock=${fromBlock}`);
  console.log(`    matches: ${logs.length}`);
  for (const l of logs) {
    const args = (l as unknown as { args: { priceE8: bigint; monValueBps: bigint } }).args;
    console.log(`    block #${l.blockNumber}  priceE8=${args.priceE8}  monValueBps=${args.monValueBps}  tx=${l.transactionHash}`);
  }

  // 4) Logged getLogs (enrichment used by the action-log classifier).
  const logBookEvt = parseAbiItem("event Logged(uint256 indexed seq, uint256 priceE8, uint256 bpsBefore, uint256 bpsAfter, uint256 navBefore, uint256 navAfter, uint256 ts)") as AbiEvent;
  const loggedLogs = await pub.getLogs({
    address: ADDRESSES.LogBook, event: logBookEvt, fromBlock, toBlock: head,
  });
  console.log(`\n[D] LogBook Logged getLogs window: matches: ${loggedLogs.length}`);
  for (const l of loggedLogs) {
    const args = (l as unknown as { args: { seq: bigint } }).args;
    console.log(`    seq=${args.seq}  block #${l.blockNumber}  tx=${l.transactionHash}`);
  }

  // 5) Vault snapshot (paused, owner, agent for the dashboard sanity).
  const [paused, totalShares, monBal, usdcBal, owner, agent] = await Promise.all([
    pub.readContract({ address: ADDRESSES.RebalanceVault, abi: vaultAbi, functionName: "paused" }) as Promise<boolean>,
    pub.readContract({ address: ADDRESSES.RebalanceVault, abi: vaultAbi, functionName: "totalShares" }) as Promise<bigint>,
    pub.readContract({ address: ADDRESSES.RebalanceVault, abi: vaultAbi, functionName: "monBalance" }) as Promise<bigint>,
    pub.readContract({ address: ADDRESSES.RebalanceVault, abi: vaultAbi, functionName: "usdcBalance" }) as Promise<bigint>,
    pub.readContract({ address: ADDRESSES.RebalanceVault, abi: vaultAbi, functionName: "owner" }) as Promise<`0x${string}`>,
    pub.readContract({ address: ADDRESSES.RebalanceVault, abi: vaultAbi, functionName: "agent" }) as Promise<`0x${string}`>,
  ]);
  const monValueAtOnchain = (monBal * onChain) / 10n ** 20n;
  const monValueAtPyth    = (monBal * pyth) / 10n ** 20n;
  const navAtOnchain = monValueAtOnchain + usdcBal;
  const navAtPyth    = monValueAtPyth + usdcBal;
  console.log(`\n[E] Vault snapshot`);
  console.log(`    paused=${paused}  totalShares=${totalShares}`);
  console.log(`    monBalance=${monBal} wei  (${Number(monBal) / 1e18} MON)`);
  console.log(`    usdcBalance=${usdcBal}  (${Number(usdcBal) / 1e6} USDC)`);
  console.log(`    NAV @ on-chain price: ${navAtOnchain} (${Number(navAtOnchain) / 1e6} USDC) — this drives the UI`);
  console.log(`    NAV @ live Pyth:      ${navAtPyth} (${Number(navAtPyth) / 1e6} USDC) — what it WOULD show if synced`);
  console.log(`    owner=${owner}`);
  console.log(`    agent=${agent}`);

  console.log("\n============================================================");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
