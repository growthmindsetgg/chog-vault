// Transaction error classifier — single source of truth for what a user sees
// when a write reverts. Handles both pre-flight simulate errors and on-chain
// receipts where status==='reverted'.
//
// Used by Deposit (approve/deposit) and Dashboard (withdraw).

import { BaseError, ContractFunctionRevertedError } from "viem";

export type TxErrorKind =
  | "user-rejected"
  | "agent-blocked"
  | "insufficient-allowance"
  | "vault-paused"
  | "zero-deposit"
  | "price-unset"
  | "reverted"
  | "unknown";

export interface TxErrorInfo {
  kind: TxErrorKind;
  message: string;
  /** Original error text for logging — never shown to the user unfiltered. */
  raw: string;
}

export function classifyTxError(e: unknown): TxErrorInfo {
  const raw = errorText(e);

  // 1) User-rejected from the wallet UI.
  if (/user rejected|rejected the request|user denied/i.test(raw)) {
    return { kind: "user-rejected", message: "Cancelled in wallet.", raw };
  }

  // 2) Solidity require strings (RebalanceVault).
  if (/vault:\s*agent blocked|vault:\s*not agent/i.test(raw)) {
    return {
      kind: "agent-blocked",
      message: "This wallet is the agent and cannot deposit/withdraw.",
      raw,
    };
  }
  if (/vault:\s*paused/i.test(raw)) {
    return {
      kind: "vault-paused",
      message: "Vault is paused. Withdrawals still work.",
      raw,
    };
  }
  if (/vault:\s*zero deposit/i.test(raw)) {
    return { kind: "zero-deposit", message: "Enter an amount above zero.", raw };
  }
  if (/vault:\s*price unset/i.test(raw)) {
    return {
      kind: "price-unset",
      message: "Oracle price is not set yet. Try again in a few seconds.",
      raw,
    };
  }

  // 3) ERC20 custom error.
  // 0xfb8f41b2 = ERC20InsufficientAllowance(address,uint256,uint256)
  if (raw.includes("0xfb8f41b2") || /InsufficientAllowance/i.test(raw)) {
    return {
      kind: "insufficient-allowance",
      message: "USDC not approved for the vault. Approve first.",
      raw,
    };
  }

  // 4) Fallback: generic on-chain revert.
  return { kind: "reverted", message: `Transaction reverted on-chain.`, raw };
}

function errorText(e: unknown): string {
  if (e instanceof BaseError) {
    // Walk the cause chain for the revert frame; it has the decoded reason.
    const rev = e.walk((err) => err instanceof ContractFunctionRevertedError);
    if (rev instanceof ContractFunctionRevertedError) {
      const parts: string[] = [];
      if (rev.shortMessage) parts.push(rev.shortMessage);
      if (rev.reason) parts.push(rev.reason);
      if (rev.signature) parts.push(rev.signature);
      if (rev.data?.errorName) parts.push(rev.data.errorName);
      return parts.join(" | ");
    }
    const parts: string[] = [];
    if (e.shortMessage) parts.push(e.shortMessage);
    if (e.details) parts.push(e.details);
    if (e.message) parts.push(e.message);
    return parts.join(" | ");
  }
  if (e instanceof Error) return e.message;
  return String(e);
}
