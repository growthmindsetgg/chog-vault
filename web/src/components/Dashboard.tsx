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
import { formatBps, formatMON, formatPriceE8, formatUSDC } from "@/lib/utils";
import { classifyTxError } from "@/lib/tx";
import { NavChart } from "@/components/NavChart";

// Signed percentage display — handles negative bps cleanly (the older pct()
// truncated -0.5% to "0.5%" because BigInt division rounds toward zero).
function pct(num: bigint, denom: bigint): string {
  if (denom === 0n) return "—";
  const bps = (num * 10_000n) / denom;
  const sign = bps < 0n ? "−" : "+";
  const abs = bps < 0n ? -bps : bps;
  const whole = abs / 100n;
  const frac  = (abs % 100n).toString().padStart(2, "0").slice(0, 1);
  return `${sign}${whole}.${frac}%`;
}

function signedDollar(delta: bigint): string {
  const sign = delta < 0n ? "−" : "+";
  const abs = delta < 0n ? -delta : delta;
  return `${sign}$${formatUSDC(abs, 2)}`;
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

  // STEP 4 — your share of the vault, broken into MON + USDC + their USD values
  // at the LIVE on-chain price. These move every time priceE8 ticks.
  const breakdown = useMemo(() => {
    if (!snap || snap.totalShares === 0n) {
      return { userMon: 0n, userUsdc: 0n, userMonValue: 0n };
    }
    const userMon  = (snap.monBalance  * snap.userShares) / snap.totalShares;
    const userUsdc = (snap.usdcBalance * snap.userShares) / snap.totalShares;
    const userMonValue = snap.priceE8 > 0n ? (userMon * snap.priceE8) / 10n ** 20n : 0n;
    return { userMon, userUsdc, userMonValue };
  }, [snap]);

  // Share of the vault, in bps → "X.X% of vault".
  const userPctOfVault = useMemo<string>(() => {
    if (!snap || snap.totalShares === 0n) return "—";
    const bps = (snap.userShares * 10_000n) / snap.totalShares;
    const whole = bps / 100n;
    const frac  = (bps % 100n).toString().padStart(2, "0").slice(0, 1);
    return `${whole}.${frac}% of vault`;
  }, [snap]);

  // STEP 3 — v2 basis (cumulative across deposits).
  const basisMonAmount  = basis ? BigInt(basis.monAmount)      : 0n;
  const basisUsdcAmount = basis ? BigInt(basis.usdcAmount)     : 0n;
  const basisDepositUsd = basis ? BigInt(basis.depositUsd)     : 0n;
  const basisPriceE8    = basis ? BigInt(basis.priceAtDeposit) : 0n;

  // HODL counterfactual: your ORIGINAL deposited tokens, marked at the live
  // on-chain price. Independent of basisDepositUsd.
  const hodlValue = useMemo<bigint>(() => {
    if (!snap || !basis) return 0n;
    return (basisMonAmount * snap.priceE8) / 10n ** 20n + basisUsdcAmount;
  }, [snap, basis, basisMonAmount, basisUsdcAmount]);

  // ROI numbers — INDEPENDENT. ROI vs deposit measures "did the vault grow
  // beyond the dollars I put in"; ROI vs HODL measures "did rebalancing beat
  // simply holding what I deposited". With one-way price moves HODL usually
  // beats the rebalanced vault → ROI vs HODL can (and should) go negative.
  const roiVsDeposit = (basis && basisDepositUsd > 0n)
    ? pct(userValue - basisDepositUsd, basisDepositUsd) : "—";
  const roiVsHodl    = (basis && hodlValue > 0n)
    ? pct(userValue - hodlValue, hodlValue) : "—";

  const [percent, setPercent] = useState(100);
  // Internal math: raw bigint shares. NEVER shown directly in the UI.
  const withdrawShares = useMemo<bigint>(() => {
    if (!snap) return 0n;
    return (snap.userShares * BigInt(percent)) / 100n;
  }, [snap, percent]);

  // STEP 2 — what the user will actually receive at the selected slider %.
  // Shown as USD + MON + USDC, NOT shares.
  const willReceive = useMemo(() => {
    if (!snap || snap.totalShares === 0n || withdrawShares === 0n) {
      return { usd: 0n, mon: 0n, usdc: 0n };
    }
    const mon  = (snap.monBalance  * withdrawShares) / snap.totalShares;
    const usdc = (snap.usdcBalance * withdrawShares) / snap.totalShares;
    const monVal = snap.priceE8 > 0n ? (mon * snap.priceE8) / 10n ** 20n : 0n;
    return { usd: monVal + usdc, mon, usdc };
  }, [snap, withdrawShares]);

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
            <CardDescription>Your share of the vault, valued at the current on-chain price.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-4">
            <Stat
              label="Position value"
              value={`$${formatUSDC(userValue, 2)}`}
              subtitle={userPctOfVault}
              big
            />
            <Stat label="ROI vs deposit" value={roiVsDeposit} accent />
            <Stat label="ROI vs HODL"    value={roiVsHodl}    accent />
          </CardContent>
        </Card>

        {/* STEP 4 — Your position breakdown. MON-led with USD secondary; HODL
            counterfactual + agent effect right alongside, so the comparison
            the user actually cares about is one card, not two columns apart. */}
        <Card>
          <CardHeader>
            <CardTitle>Your position</CardTitle>
            <CardDescription>What you hold, valued live. Compared with: just holding what you deposited, no agent.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">You hold</div>
              <div className="mt-2 space-y-1.5">
                <div className="flex items-baseline gap-2 font-mono tabular-nums">
                  <span className="text-2xl font-extrabold text-[var(--text)]">{formatMON(breakdown.userMon, 4)}</span>
                  <span className="text-base font-bold text-[var(--text-muted)]">MON</span>
                  <span className="text-sm text-[var(--text-muted)]">≈ ${formatUSDC(breakdown.userMonValue, 2)}</span>
                </div>
                <div className="flex items-baseline gap-2 font-mono tabular-nums">
                  <span className="text-2xl font-extrabold text-[var(--text)]">+ {formatUSDC(breakdown.userUsdc, 2)}</span>
                  <span className="text-base font-bold text-[var(--text-muted)]">USDC</span>
                </div>
                <div className="flex items-baseline justify-between pt-2 mt-1 border-t border-[var(--border)]">
                  <span className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Total</span>
                  <span className="text-3xl font-extrabold text-[var(--purple-strong)] tabular-nums">
                    ${formatUSDC(userValue, 2)}
                  </span>
                </div>
              </div>
            </div>

            <div className="border-t border-[var(--border)] pt-3 space-y-2 text-sm">
              <Row k="Live MON price" v={snap ? formatPriceE8(snap.priceE8) : "—"} />
              {basis ? (
                <>
                  <Row k="If you'd just held (no agent)" v={`$${formatUSDC(hodlValue, 2)}`} />
                  <div className="flex justify-between items-baseline">
                    <span className="text-[var(--text-muted)]">Agent effect</span>
                    <span className={`font-mono font-bold tabular-nums ${
                      userValue >= hodlValue ? "text-[var(--green)]" : "text-[var(--rose)]"
                    }`}>
                      {signedDollar(userValue - hodlValue)}
                      {hodlValue > 0n && (
                        <span className="ml-1.5 text-xs opacity-80">
                          ({pct(userValue - hodlValue, hodlValue)})
                        </span>
                      )}
                    </span>
                  </div>
                </>
              ) : (
                <div className="text-xs text-[var(--text-muted)] italic">
                  Deposit MON to compare against the HODL counterfactual.
                </div>
              )}
            </div>
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
                depositUsd={basisDepositUsd}
                monAmount={basisMonAmount}
                usdcAmount={basisUsdcAmount}
                priceAtDeposit={basisPriceE8}
                currentPriceE8={snap?.priceE8 ?? 0n}
                currentVaultValue={userValue}
                userShares={snap?.userShares ?? 0n}
                totalShares={snap?.totalShares ?? 0n}
                entries={feed?.entries ?? []}
              />
            ) : (
              <div className="h-56 flex items-center justify-center text-sm text-[var(--text-muted)]">
                Deposit MON to start a basis. The chart needs a starting point.
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

            {/* You'll receive — USD + MON + USDC, NOT raw shares. */}
            <div className="rounded-xl bg-[var(--purple-soft)] p-3 space-y-1">
              <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">You'll receive</div>
              <div className="text-xl font-extrabold text-[var(--purple-strong)] tabular-nums">
                ≈ ${formatUSDC(willReceive.usd, 2)}
              </div>
              <div className="text-xs font-mono text-[var(--text-muted)] tabular-nums">
                {formatMON(willReceive.mon, 4)} MON + {formatUSDC(willReceive.usdc, 2)} USDC
              </div>
            </div>

            <Button onClick={onWithdraw} disabled={tx.loading || withdrawShares === 0n} size="lg" className="w-full">
              {tx.loading ? "Confirming…" : "Withdraw"}
            </Button>
            <div className="text-xs text-[var(--text-muted)] text-center">
              Native MON + USDC, split by the vault&apos;s current mix. Works even when paused.
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

function Stat({ label, value, subtitle, big, accent }: {
  label: string; value: string; subtitle?: string; big?: boolean; accent?: boolean;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
      <div className={
        big ? "mt-1 text-3xl font-extrabold text-[var(--purple-strong)] tabular-nums" :
        accent ? "mt-1 text-xl font-bold text-[var(--green)] tabular-nums" :
        "mt-1 text-xl font-bold tabular-nums"
      }>
        {value}
      </div>
      {subtitle && <div className="mt-0.5 text-xs text-[var(--text-muted)]">{subtitle}</div>}
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
