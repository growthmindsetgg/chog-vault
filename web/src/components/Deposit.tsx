"use client";

import { useMemo, useState } from "react";
import { useAccount, usePublicClient, useReadContract } from "wagmi";
import { toast } from "sonner";
import addresses from "@addresses";
import { usdcAbi, vaultAbi } from "@/abi";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useVaultSnapshot } from "@/hooks/useVaultSnapshot";
import { useBasis } from "@/hooks/useBasis";
import { useSendTransactionSync } from "@/hooks/useSendTransactionSync";
import { formatMON, formatUSDC, parseMONInput, parseUSDCInput } from "@/lib/utils";
import { classifyTxError } from "@/lib/tx";

const GAS_PAD_WEI = 10_000_000_000_000_000n; // 0.01 MON

type Mode = "mon-only" | "advanced";

// Strict 4-state machine for the advanced (MON+USDC) button. Order matters.
// "wait" means DISABLED — the button MUST NOT fall through to "deposit"
// while allowance is undefined or loading.
type AdvancedButton = "deposit" | "wait" | "approve";

export function Deposit() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: snap, refetch, isLoading: snapLoading, isFetching: snapFetching } = useVaultSnapshot();
  const { basis, setBasis } = useBasis(snap?.userShares);

  const [mode, setMode] = useState<Mode>("mon-only");
  const [monStr,  setMonStr]  = useState("");
  const [usdcStr, setUsdcStr] = useState("");

  const monIn  = useMemo(() => parseMONInput(monStr),   [monStr]);
  const usdcIn = useMemo(
    () => (mode === "mon-only" ? 0n : parseUSDCInput(usdcStr)),
    [usdcStr, mode],
  );

  // STEP 3 — dedicated allowance read, NOT derived from the shared snapshot.
  // Enabled only when an allowance check actually matters. Refetched manually
  // after every approve / deposit receipt; the queryKey changes on usdcIn,
  // so input edits don't force a refetch (we trigger explicitly).
  const allowanceQuery = useReadContract({
    address: addresses.MockUSDC as `0x${string}`,
    abi: usdcAbi,
    functionName: "allowance",
    args: address ? [address, addresses.RebalanceVault as `0x${string}`] : undefined,
    query: {
      enabled: isConnected && !!address && mode === "advanced" && usdcIn > 0n,
      // Treat anything older than 1s as stale so input edits get a fresh check.
      staleTime: 1_000,
    },
  });

  const allowance = allowanceQuery.data as bigint | undefined;
  const allowanceLoading =
    allowanceQuery.isPending || allowanceQuery.isLoading || allowanceQuery.isFetching;

  // ---- 4-state machine (advanced only) ----
  const advancedButton: AdvancedButton = useMemo(() => {
    if (usdcIn === 0n)                  return "deposit"; // no approve needed for MON-only or empty USDC
    if (allowance === undefined)        return "wait";    // never fall through while undefined
    if (allowanceLoading)               return "wait";    // never fall through while loading
    if (allowance < usdcIn)             return "approve";
    return "deposit";
  }, [usdcIn, allowance, allowanceLoading]);

  if (typeof window !== "undefined") {
    // eslint-disable-next-line no-console
    console.log("[Deposit render]", {
      mode,
      rawInput: { mon: monStr, usdc: usdcStr },
      monParsed: monIn.toString(),
      usdcParsed: usdcIn.toString(),
      allowance: allowance === undefined ? "undefined" : allowance.toString(),
      allowanceLoading,
      chosenBranch:
        mode === "mon-only" ? "mon-only-deposit" : advancedButton,
      snapDefined: !!snap,
      snapLoading: snapLoading || snapFetching,
    });
  }

  const tx = useSendTransactionSync();

  const handleMonMax = () => {
    if (!snap) return;
    const max = snap.userMonBalance > GAS_PAD_WEI ? snap.userMonBalance - GAS_PAD_WEI : 0n;
    setMonStr(formatMON(max, 4));
  };

  const handleUsdcMax = () => {
    if (!snap) return;
    setUsdcStr(formatUSDC(snap.userUsdcBalance, 2));
  };

  const approve = async () => {
    if (!address || !publicClient) { toast.error("Connect wallet first"); return; }
    if (usdcIn === 0n) return;

    // Pre-flight simulate. Catches reverts BEFORE the wallet asks the user
    // to sign — no gas burned for the agent-blocked / paused / bad-state case.
    try {
      await publicClient.simulateContract({
        address: addresses.MockUSDC as `0x${string}`,
        abi: usdcAbi, functionName: "approve",
        args: [addresses.RebalanceVault as `0x${string}`, usdcIn],
        account: address,
      });
    } catch (preErr) {
      const cls = classifyTxError(preErr);
      // eslint-disable-next-line no-console
      console.warn("[approve pre-flight]", cls);
      toast.error(cls.message);
      return;
    }

    try {
      const receipt = await tx.send({
        address: addresses.MockUSDC as `0x${string}`,
        abi: usdcAbi, functionName: "approve",
        args: [addresses.RebalanceVault as `0x${string}`, usdcIn],
      });
      // STRICT: success only if the on-chain receipt says so.
      if (receipt.status !== "success") {
        toast.error("Approve reverted on-chain.");
        return;
      }
      // AWAIT a fresh on-chain allowance read before the next render flips the
      // button to "Deposit". One tx per click; never auto-fire deposit.
      await allowanceQuery.refetch();
      toast.success("USDC approved. You can deposit now.");
    } catch (e) {
      const cls = classifyTxError(e);
      toast.error(cls.message);
    }
  };

  const deposit = async () => {
    if (!address || !publicClient) { toast.error("Connect wallet first"); return; }
    if (monIn === 0n && usdcIn === 0n) { toast.error("Enter MON"); return; }

    // Pre-flight simulate. This is THE acceptance criterion for STEP 4: the
    // agent wallet hits "vault: agent blocked" here, never reaches the wallet
    // prompt, never sees "Deposit confirmed".
    try {
      await publicClient.simulateContract({
        address: addresses.RebalanceVault as `0x${string}`,
        abi: vaultAbi, functionName: "deposit",
        args: [usdcIn], value: monIn,
        account: address,
      });
    } catch (preErr) {
      const cls = classifyTxError(preErr);
      // eslint-disable-next-line no-console
      console.warn("[deposit pre-flight]", cls);
      toast.error(cls.message);
      return;
    }

    try {
      const receipt = await tx.send({
        address: addresses.RebalanceVault as `0x${string}`,
        abi: vaultAbi, functionName: "deposit",
        args: [usdcIn], value: monIn,
      });
      if (receipt.status !== "success") {
        toast.error("Deposit reverted on-chain.");
        return;
      }

      const sharesAfter = (await publicClient.readContract({
        address: addresses.RebalanceVault as `0x${string}`,
        abi: vaultAbi, functionName: "balanceOf",
        args: [address],
      })) as bigint;

      if (!basis && sharesAfter > 0n && snap) {
        const basisNAV = (monIn * snap.priceE8) / 10n ** 20n + usdcIn;
        setBasis({
          monIn:  monIn.toString(),
          usdcIn: usdcIn.toString(),
          basisNAV: basisNAV.toString(),
          basisPriceE8: snap.priceE8.toString(),
          basisBlock: Number(receipt.blockNumber),
        });
      }

      setMonStr(""); setUsdcStr("");
      await Promise.all([refetch(), allowanceQuery.refetch()]);
      toast.success("Deposit confirmed.");
    } catch (e) {
      const cls = classifyTxError(e);
      toast.error(cls.message);
    }
  };

  // ---- button decision ----
  // mon-only: always "Deposit MON". Never approve.
  // advanced: strict state machine, "wait" is a hard disabled state.
  const isMon = mode === "mon-only";
  const buttonLabel = isMon
    ? "Deposit MON"
    : advancedButton === "wait"    ? "Checking allowance…"
    : advancedButton === "approve" ? "Approve USDC"
    :                                "Deposit";

  const onClick = isMon
    ? deposit
    : advancedButton === "approve" ? approve
    : advancedButton === "deposit" ? deposit
    : undefined;

  const disabled =
    tx.loading ||
    (isMon
      ? monIn === 0n
      : advancedButton === "wait" || (monIn === 0n && usdcIn === 0n));

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Chog Vault</CardTitle>
          <CardDescription className="mt-2 text-base">
            {isMon
              ? "Deposit MON. The agent automatically splits it to 60/40 and rebalances — no USDC needed."
              : "Deposit MON + USDC. The agent keeps you at 60/40 and earns from volatility — withdraw anytime."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <ModeToggle mode={mode} onChange={setMode} />

          {isMon ? (
            <Field
              label="MON"
              value={monStr}
              onChange={setMonStr}
              balance={snap?.userMonBalance ? `${formatMON(snap.userMonBalance, 4)} MON` : "—"}
              onMax={handleMonMax}
            />
          ) : (
            <>
              <Field
                label="MON"
                value={monStr}
                onChange={setMonStr}
                balance={snap?.userMonBalance ? `${formatMON(snap.userMonBalance, 4)} MON` : "—"}
                onMax={handleMonMax}
              />
              <Field
                label="USDC"
                value={usdcStr}
                onChange={setUsdcStr}
                balance={snap?.userUsdcBalance ? `${formatUSDC(snap.userUsdcBalance, 2)} USDC` : "—"}
                onMax={handleUsdcMax}
              />
            </>
          )}

          <Button onClick={onClick} disabled={disabled} size="lg" className="w-full">
            {tx.loading ? "Confirming…" : buttonLabel}
          </Button>

          {!isMon && advancedButton === "approve" && (
            <p className="text-xs text-[var(--text-muted)] text-center">
              Two-step flow: approve USDC first, then click Deposit.
            </p>
          )}
          {!isMon && advancedButton === "wait" && (
            <p className="text-xs text-[var(--text-muted)] text-center">
              Reading current allowance from chain so we don&apos;t over-prompt you.
            </p>
          )}
          {isMon && (
            <p className="text-xs text-[var(--text-muted)] text-center">
              One click. The agent buys USDC for you on its next rebalance.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-[var(--purple-soft)] text-sm">
      <button
        type="button"
        onClick={() => onChange("mon-only")}
        className={cn(
          "py-2 rounded-xl font-semibold transition-colors",
          mode === "mon-only"
            ? "bg-white text-[var(--purple-strong)] shadow-sm"
            : "text-[var(--text-muted)] hover:text-[var(--purple-strong)]"
        )}
      >
        MON only <span className="opacity-70">(auto-split)</span>
      </button>
      <button
        type="button"
        onClick={() => onChange("advanced")}
        className={cn(
          "py-2 rounded-xl font-semibold transition-colors",
          mode === "advanced"
            ? "bg-white text-[var(--purple-strong)] shadow-sm"
            : "text-[var(--text-muted)] hover:text-[var(--purple-strong)]"
        )}
      >
        MON + USDC <span className="opacity-70">(advanced)</span>
      </button>
    </div>
  );
}

function Field({
  label, value, onChange, balance, onMax,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  balance: string;
  onMax: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-[var(--text)]">{label}</span>
        <span className="text-[var(--text-muted)]">Balance: {balance}</span>
      </div>
      <div className="relative">
        <Input
          inputMode="decimal"
          placeholder="0.00"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
          className="pr-20"
        />
        <button
          type="button"
          onClick={onMax}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[var(--purple-strong)] hover:underline"
        >
          MAX
        </button>
      </div>
    </div>
  );
}
