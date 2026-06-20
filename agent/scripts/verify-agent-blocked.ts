// STEP 9 verification: simulating deposit() with the agent EOA as msg.sender
// MUST revert with "vault: agent blocked" — this is exactly the path the
// frontend's pre-flight `simulateContract` exercises before signing.

import { ADDRESSES, getAgentAccount, monadTestnet, RPC_URL } from "../config.js";
import { vaultAbi } from "../abi.js";
import { createPublicClient, http } from "viem";

async function main() {
  const agent = getAgentAccount();
  const pub = createPublicClient({
    chain: monadTestnet,
    transport: http(RPC_URL),
    batch: { multicall: false },
  });

  console.log(`simulating vault.deposit(0) with msg.sender=${agent.address} (agent)`);
  console.log(`  vault=${ADDRESSES.RebalanceVault}`);

  try {
    await pub.simulateContract({
      address: ADDRESSES.RebalanceVault,
      abi: vaultAbi,
      functionName: "deposit",
      args: [0n],
      value: 1_000_000_000_000_000n, // 0.001 MON
      account: agent.address,
    });
    console.error("UNEXPECTED: simulate succeeded. Agent invariant is broken!");
    process.exit(2);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const matched = /vault:\s*agent blocked/i.test(msg);
    console.log("revert detected:", matched ? "YES" : "NO");
    console.log("revert reason snippet:", (msg.match(/vault:\s*agent blocked/i) ?? ["(no match)"])[0]);
    if (!matched) {
      console.error("FULL ERROR for diagnosis:");
      console.error(msg);
      process.exit(1);
    }
    console.log("PASS: agent EOA cannot deposit. The frontend will catch this in pre-flight.");
  }

  // Also verify withdraw is blocked.
  console.log("");
  console.log(`simulating vault.withdraw(1) with msg.sender=${agent.address} (agent)`);
  try {
    await pub.simulateContract({
      address: ADDRESSES.RebalanceVault,
      abi: vaultAbi,
      functionName: "withdraw",
      args: [1n],
      account: agent.address,
    });
    console.error("UNEXPECTED: withdraw simulate succeeded.");
    process.exit(2);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const matched = /vault:\s*agent blocked/i.test(msg);
    console.log("withdraw revert detected:", matched ? "YES" : "NO");
    if (!matched) {
      console.error("withdraw error:", msg);
      process.exit(1);
    }
    console.log("PASS: agent EOA cannot withdraw either.");
  }
}

main().catch((e) => {
  console.error("script error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
