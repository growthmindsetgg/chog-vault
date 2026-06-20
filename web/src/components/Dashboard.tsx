"use client";

import { useMemo, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { toast } from "sonner";
import addresses from "@addresses";
import { vaultAbi } from "@/abi";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useVaultSnapshot } from "@/hooks/useVaultSnapshot";
import { useLoggedFeed } from "@/hooks/useLoggedEvents";
import { useBasis } from "@/hooks/useBasis";
import { useSendTransactionSync } from "@/hooks/useSendTransactionSync";
import { formatBps, formatMON, formatUSDC } from "@/lib/utils";
import { classifyTxError } from "@/lib/tx";
import { NavChart } from "@/components/NavChart";

function pct(num: bigint, denom: bigint): string {
  if (denom === 0n) return "—";
  const bps = (num * 10_000n) / denom;
  const sign = bps >= 0n ? "+" : "";
  const whole = bps / 100n;
  const frac  = bps < 0n ? -bps % 100n : bps % 100n;
  return `${sign}${whole}.${frac.toString().padStart(2, "0").slice(0, 1)}%`;
}

export function Dashboard() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: snap, refetch } = useVaultSnapshot();
  const { data: feed } = useLoggedFeed();
  const { basis } = useBasis(snap?.userShares);
  const tx = useSendTransactionSync();

  const userValue = useMemo<bigint>(() => {
    if (!snap || snap.totalShares === 0n) return 0n;
    return (snap.nav * snap.userShares) / snap.totalShares;
  }, [snap]);

  const basisMonIn  = basis ? BigInt(basis.monIn)  : 0n;
  const basisUsdcIn = basis ? BigInt(basis.usdcIn) : 0n;
  const basisNAV    = basis ? BigInt(basis.basisNAV) : 0n;
  const basisPrice  = basis ? BigInt(basis.basisPriceE8) : 0n;

  const hodlValue = useMemo<bigint>(() => {
    if (!snap || !basis) return 0n;
    return (basisMonIn * snap.priceE8) / 10n ** 20n + basisUsdcIn;
  }, [snap, basis, basisMonIn, basisUsdcIn]);

  const roiVsDeposit = basis ? pct(userValue - basisNAV, basisNAV) : "—";
  const roiVsHodl    = (basis && hodlValue > 0n) ? pct(userValue - hodlValue, hodlValue) : "—";

  const [percent, setPercent] = useState(100);
  const withdrawShares = useMemo<bigint>(() => {
    if (!snap) return 0n;
    return (snap.userShares * BigInt(percent)) / 100n;
  }, [snap, percent]);

  const onWithdraw = async () => {
    if (!address || !publicClient) { toast.error("Connect wallet first"); return; }
    if (withdrawShares === 0n) { toast.error("Choose an amount"); return; }

    // Pre-flight simulate: AGENT wallet hits "vault: agent blocked" here too.
    try {
      await publicClient.simulateContract({
        address: addresses.RebalanceVault as `0x${string}`,
        abi: vaultAbi, functionName: "withdraw",
        args: [withdrawShares], account: address,
      });
    } catch (preErr) {
      const cls = classifyTxError(preErr);
      // eslint-disable-next-line no-console
      console.warn("[withdraw pre-flight]", cls);
      toast.error(cls.message);
      return;
    }

    try {
      const receipt = await tx.send({
        address: addresses.RebalanceVault as `0x${string}`,
        abi: vaultAbi, functionName: "withdraw",
        args: [withdrawShares],
      });
      if (receipt.status !== "success") {
        toast.error("Withdraw reverted on-chain.");
        return;
      }
      await refetch();
      toast.success(percent === 100 ? "Withdrew all. Basis cleared." : "Withdraw confirmed.");
    } catch (e) {
      const cls = classifyTxError(e);
      toast.error(cls.message);
    }
  };

  if (!address) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-[var(--text-muted)]">
          Connect a wallet to see your position.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <div className="md:col-span-2 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Position</CardTitle>
            <CardDescription>Your share of the vault, valued at current price.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-4">
            <Stat label="Position value" value={`$${formatUSDC(userValue, 2)}`} big />
            <Stat label="ROI vs deposit" value={roiVsDeposit} accent />
            <Stat label="ROI vs HODL"    value={roiVsHodl}    accent />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Vault vs HODL</CardTitle>
            <CardDescription>Where 60/40 rebalancing helps when MON moves around — not when it just runs one way.</CardDescription>
          </CardHeader>
          <CardContent>
            {basis ? (
              <NavChart
                basisMonIn={basisMonIn}
                basisUsdcIn={basisUsdcIn}
                basisPriceE8={basisPrice}
                currentPriceE8={snap?.priceE8 ?? 0n}
                currentVaultValue={userValue}
                entries={feed?.entries ?? []}
              />
            ) : (
              <div className="h-56 flex items-center justify-center text-sm text-[var(--text-muted)]">
                Deposit MON + USDC to start a basis. The chart needs a starting point.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Withdraw</CardTitle>
            <CardDescription>Pro-rata MON + USDC. Works even when paused.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--text-muted)]">Shares</span>
              <span className="font-mono">{snap?.userShares?.toString() ?? "0"}</span>
            </div>
            <input
              type="range" min={0} max={100} value={percent} onChange={(e) => setPercent(Number(e.target.value))}
              className="w-full accent-[var(--purple)]"
            />
            <div className="text-center text-2xl font-bold text-[var(--purple-strong)]">{percent}%</div>
            <div className="flex gap-2">
              {[25, 50, 75, 100].map((p) => (
                <Button key={p} variant="secondary" size="sm" onClick={() => setPercent(p)} className="flex-1">
                  {p === 100 ? "MAX" : `${p}%`}
                </Button>
              ))}
            </div>
            <Button onClick={onWithdraw} disabled={tx.loading || withdrawShares === 0n} size="lg" className="w-full">
              {tx.loading ? "Confirming…" : "Withdraw"}
            </Button>
            <div className="text-xs text-[var(--text-muted)] text-center">
              You'll receive native MON and USDC, split by the vault's current mix.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Vault state</CardTitle>
            <CardDescription>Aggregate, not your share.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row k="MON" v={`${formatMON(snap?.monBalance ?? 0n, 4)}`} />
            <Row k="USDC" v={formatUSDC(snap?.usdcBalance ?? 0n, 2)} />
            <Row k="NAV (USD)" v={`$${formatUSDC(snap?.nav ?? 0n, 2)}`} />
            <Row k="MON %" v={snap ? formatBps(snap.monValueBps) : "—"} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, big, accent }: { label: string; value: string; big?: boolean; accent?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
      <div className={
        big ? "mt-1 text-3xl font-extrabold text-[var(--purple-strong)]" :
        accent ? "mt-1 text-xl font-bold text-[var(--green)]" :
        "mt-1 text-xl font-bold"
      }>
        {value}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-[var(--text-muted)]">{k}</span>
      <span className="font-mono font-semibold">{v}</span>
    </div>
  );
}
