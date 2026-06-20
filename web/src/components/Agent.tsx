"use client";

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { ExternalLink, ShieldOff, ShieldCheck } from "lucide-react";
import addresses from "@addresses";
import { vaultAbi } from "@/abi";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useVaultSnapshot } from "@/hooks/useVaultSnapshot";
import { useLoggedFeed, type LogEntry } from "@/hooks/useLoggedEvents";
import { useSendTransactionSync } from "@/hooks/useSendTransactionSync";
import { EXPLORER_BASE } from "@/wagmi";
import { formatBps, formatPriceE8, formatUSDC, shortAddress } from "@/lib/utils";

interface ActionLine {
  title: string;
  subtitle: string;
  accent: "purple" | "rose" | "green" | "muted";
}

function narrate(e: LogEntry): ActionLine {
  const before = formatBps(e.bpsBefore);
  const after  = formatBps(e.bpsAfter);
  const price  = formatPriceE8(e.priceE8);
  switch (e.kind) {
    case "split":
      return {
        title: "Split deposit — sold MON → USDC to 60/40",
        subtitle: `at ${price} · ${before} → ${after}`,
        accent: "purple",
      };
    case "trim":
      return {
        title: `Trim — sold MON → USDC (${before} → ${after})`,
        subtitle: `at ${price}`,
        accent: "rose",
      };
    case "add":
      return {
        title: `Add — bought MON ← USDC (${before} → ${after})`,
        subtitle: `at ${price}`,
        accent: "green",
      };
    case "hold":
    default:
      return {
        title: "Holding — inside the 60/40 band",
        subtitle: `at ${price} · ${before}`,
        accent: "muted",
      };
  }
}

function accentClass(a: ActionLine["accent"]): string {
  switch (a) {
    case "purple": return "text-[var(--purple-strong)]";
    case "rose":   return "text-[var(--rose)]";
    case "green":  return "text-[var(--green)]";
    case "muted":
    default:       return "text-[var(--text-muted)]";
  }
}

export function Agent() {
  const { address } = useAccount();
  const { data: snap, refetch } = useVaultSnapshot();
  const { data: feed } = useLoggedFeed();
  const tx = useSendTransactionSync();

  const isOwner = !!address && !!snap?.owner && address.toLowerCase() === snap.owner.toLowerCase();
  const paused  = snap?.paused ?? false;

  const [confirmStage, setConfirmStage] = useState<0 | 1>(0);

  const toggle = async () => {
    if (!isOwner) { toast.error("Owner-only action."); return; }
    if (confirmStage === 0) { setConfirmStage(1); return; }
    try {
      await tx.send({
        address: addresses.RebalanceVault as `0x${string}`,
        abi: vaultAbi,
        functionName: "setPaused",
        args: [!paused],
      });
      await refetch();
      setConfirmStage(0);
      toast.success(paused ? "Vault resumed." : "Kill switch engaged. Funds remain withdrawable.");
    } catch (e) {
      setConfirmStage(0);
      toast.error(`Action failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const ksLabel = useMemo(() => {
    if (!isOwner) return paused ? "Engaged (owner-only)" : "Owner-only";
    if (confirmStage === 1) return paused ? "Confirm: RESUME vault" : "Confirm: ENGAGE kill switch";
    return paused ? "Resume vault" : "Engage kill switch";
  }, [isOwner, paused, confirmStage]);

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <div className="md:col-span-2 space-y-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle>Agent status</CardTitle>
              <CardDescription className="mt-1">
                Autonomous, non-custodial. Signs rebalance() only.
              </CardDescription>
            </div>
            <span className={`pulse-dot ${paused ? "muted" : ""}`} aria-label={paused ? "paused" : "active"} />
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-4">
            <Field label="MON / USD"     value={snap ? formatPriceE8(snap.priceE8) : "—"} />
            <Field label="MON % of NAV"  value={snap ? formatBps(snap.monValueBps) : "—"} />
            <Field label="Agent EOA"     value={snap?.agent ? shortAddress(snap.agent) : "—"} mono />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Live activity</CardTitle>
            <CardDescription>
              Newest first. Each line is a Rebalanced event classified by what the agent did.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(!feed || feed.entries.length === 0) ? (
              <div className="py-6 text-center text-[var(--text-muted)]">Waiting for the first rebalance…</div>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {feed.entries.slice(0, 12).map((e) => {
                  const line = narrate(e);
                  return (
                    <li key={e.seq} className="py-3 flex flex-col gap-1">
                      <div className="flex items-baseline gap-2">
                        <span className={`text-sm font-semibold ${accentClass(line.accent)}`}>{line.title}</span>
                      </div>
                      <div className="text-xs text-[var(--text-muted)]">{line.subtitle}</div>
                      <div className="text-xs font-mono text-[var(--text-muted)] flex items-center gap-2">
                        <span>{new Date(Number(e.ts) * 1000).toLocaleTimeString()}</span>
                        {e.blockNumber !== undefined && <span>· block #{e.blockNumber.toString()}</span>}
                        {e.txHash ? (
                          <a
                            href={`${EXPLORER_BASE}/tx/${e.txHash}`}
                            target="_blank" rel="noreferrer"
                            className="text-[var(--purple-strong)] hover:underline inline-flex items-center gap-1"
                          >
                            {shortAddress(e.txHash, 10, 8)}
                            <ExternalLink className="size-3" />
                          </a>
                        ) : (
                          <span className="opacity-70">tx out of window</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <ProofPanel entries={feed?.entries ?? []} />
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {paused ? <ShieldOff className="size-5 text-[var(--rose)]" /> : <ShieldCheck className="size-5 text-[var(--green)]" />}
              Kill switch
            </CardTitle>
            <CardDescription>
              Owner-only. {paused ? "Currently engaged — agent can't rebalance." : "Currently disengaged — agent can rebalance."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              variant={confirmStage === 1 ? "danger" : (paused ? "secondary" : "danger")}
              disabled={!isOwner || tx.loading}
              onClick={toggle}
              size="lg"
              className="w-full"
            >
              {tx.loading ? "Confirming…" : ksLabel}
            </Button>
            {confirmStage === 1 && (
              <Button variant="ghost" size="sm" onClick={() => setConfirmStage(0)} className="w-full">
                Cancel
              </Button>
            )}
            <p className="text-xs text-[var(--text-muted)]">
              {paused
                ? "Withdraws still work even while paused. Funds are not trapped."
                : "Engaging the switch stops new rebalances. Funds remain withdrawable."}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
      <div className={`mt-1 text-lg font-bold ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function ProofPanel({ entries }: { entries: LogEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>On-chain proof</CardTitle>
        <CardDescription>Written on-chain by the vault. Each row is a LogBook entry — NAV/bps before and after, signed by the vault contract itself.</CardDescription>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <div className="py-4 text-center text-[var(--text-muted)] text-sm">No entries yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-[var(--text-muted)]">
                  <th className="text-left py-2 pr-3">seq</th>
                  <th className="text-left py-2 pr-3">priceE8</th>
                  <th className="text-left py-2 pr-3">bps</th>
                  <th className="text-left py-2 pr-3">NAV ($)</th>
                  <th className="text-left py-2 pr-3">ts</th>
                  <th className="text-left py-2 pr-3">tx</th>
                </tr>
              </thead>
              <tbody>
                {entries.slice(0, 20).map((e) => (
                  <tr key={e.seq} className="border-t border-[var(--border)]">
                    <td className="py-2 pr-3">#{e.seq}</td>
                    <td className="py-2 pr-3">{e.priceE8.toString()}</td>
                    <td className="py-2 pr-3">{e.bpsBefore.toString()}→{e.bpsAfter.toString()}</td>
                    <td className="py-2 pr-3">{formatUSDC(e.navBefore, 2)} → {formatUSDC(e.navAfter, 2)}</td>
                    <td className="py-2 pr-3">{new Date(Number(e.ts) * 1000).toLocaleTimeString()}</td>
                    <td className="py-2 pr-3">
                      <a
                        href={`${EXPLORER_BASE}/${e.txHash ? `tx/${e.txHash}` : `address/${addresses.LogBook}`}`}
                        target="_blank" rel="noreferrer"
                        className="text-[var(--purple-strong)] hover:underline inline-flex items-center gap-1"
                      >
                        view <ExternalLink className="size-3" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
