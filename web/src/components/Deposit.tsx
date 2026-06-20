"use client";

import { useMemo, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { toast } from "sonner";
import addresses from "@addresses";
import { usdcAbi, vaultAbi } from "@/abi";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useVaultSnapshot } from "@/hooks/useVaultSnapshot";
import { useBasis } from "@/hooks/useBasis";
import { useSendTransactionSync } from "@/hooks/useSendTransactionSync";
import { formatMON, formatUSDC, parseMONInput, parseUSDCInput } from "@/lib/utils";

const GAS_PAD_WEI = 10_000_000_000_000_000n; // 0.01 MON

// 0xfb8f41b2 = ERC20InsufficientAllowance(address,uint256,uint256)
function isInsufficientAllowance(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("0xfb8f41b2") || msg.includes("ERC20InsufficientAllowance");
}

export function Deposit() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: snap, refetch } = useVaultSnapshot();
  const { basis, setBasis } = useBasis(snap?.userShares);

  const [monStr,  setMonStr]  = useState("");
  const [usdcStr, setUsdcStr] = useState("");

  const monIn  = useMemo(() => parseMONInput(monStr),   [monStr]);
  const usdcIn = useMemo(() => parseUSDCInput(usdcStr), [usdcStr]);

  const allowance = snap?.userUsdcAllowance ?? 0n;
  const needsApproval = usdcIn > 0n && allowance < usdcIn;

  const tx = useSendTransactionSync();

  const handleMax = () => {
    if (!snap) return;
    const max = snap.userMonBalance > GAS_PAD_WEI ? snap.userMonBalance - GAS_PAD_WEI : 0n;
    setMonStr(formatMON(max, 4));
  };

  const handleUsdcMax = () => {
    if (!snap) return;
    setUsdcStr(formatUSDC(snap.userUsdcBalance, 2));
  };

  const approve = async () => {
    if (!address) { toast.error("Connect wallet first"); return; }
    if (usdcIn === 0n) return;
    try {
      await tx.send({
        address: addresses.MockUSDC as `0x${string}`,
        abi: usdcAbi,
        functionName: "approve",
        args: [addresses.RebalanceVault as `0x${string}`, usdcIn],
      });
      // Re-read allowance from chain (not cache). Spec rule.
      await refetch();
      toast.success("USDC approved. You can deposit now.");
    } catch (e) {
      if (e instanceof Error && /User rejected/i.test(e.message)) {
        toast.message("Approve cancelled");
      } else {
        toast.error(`Approve failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };

  const deposit = async () => {
    if (!address) { toast.error("Connect wallet first"); return; }
    if (monIn === 0n && usdcIn === 0n) { toast.error("Enter MON or USDC"); return; }
    if (!publicClient) return;

    try {
      const receipt = await tx.send({
        address: addresses.RebalanceVault as `0x${string}`,
        abi: vaultAbi,
        functionName: "deposit",
        args: [usdcIn],
        value: monIn,
      });

      // Set cost basis on the first deposit (if none yet). Capture price at the
      // block the tx mined in.
      const sharesAfter = (await publicClient.readContract({
        address: addresses.RebalanceVault as `0x${string}`,
        abi: vaultAbi,
        functionName: "balanceOf",
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
      await refetch();
      toast.success("Deposit confirmed.");
    } catch (e) {
      if (isInsufficientAllowance(e)) {
        toast.error("USDC not approved for the vault. Approve first, then deposit.");
        return;
      }
      if (e instanceof Error && /User rejected/i.test(e.message)) {
        toast.message("Deposit cancelled");
      } else {
        toast.error(`Deposit failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };

  const buttonLabel = needsApproval ? "Approve USDC" : "Deposit";
  const onClick     = needsApproval ? approve : deposit;
  const disabled    = tx.loading || (monIn === 0n && usdcIn === 0n);

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Chog Vault</CardTitle>
          <CardDescription className="mt-2 text-base">
            Deposit MON + USDC. The agent keeps you at 60/40 and earns from volatility — withdraw anytime.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Field
            label="MON"
            value={monStr}
            onChange={setMonStr}
            balance={snap?.userMonBalance ? `${formatMON(snap.userMonBalance, 4)} MON` : "—"}
            onMax={handleMax}
          />
          <Field
            label="USDC"
            value={usdcStr}
            onChange={setUsdcStr}
            balance={snap?.userUsdcBalance ? `${formatUSDC(snap.userUsdcBalance, 2)} USDC` : "—"}
            onMax={handleUsdcMax}
          />

          <Button onClick={onClick} disabled={disabled} size="lg" className="w-full">
            {tx.loading ? "Confirming…" : buttonLabel}
          </Button>

          {needsApproval && (
            <p className="text-xs text-[var(--text-muted)] text-center">
              Two-step flow: approve USDC first, then click Deposit.
            </p>
          )}
        </CardContent>
      </Card>
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
