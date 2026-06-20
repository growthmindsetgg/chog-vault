"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import addresses from "@addresses";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Deposit } from "@/components/Deposit";
import { Dashboard } from "@/components/Dashboard";
import { Agent } from "@/components/Agent";

export default function Home() {
  const notDeployed = addresses.RebalanceVault.toLowerCase() === "0x0000000000000000000000000000000000000000";

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <header className="border-b border-[var(--border)] bg-white/70 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="size-7 rounded-lg bg-[var(--purple)]" aria-hidden />
            <span className="font-extrabold tracking-tight text-lg">Chog Vault</span>
            <span className="text-xs text-[var(--text-muted)] hidden sm:inline">· Monad testnet</span>
          </div>
          <ConnectButton showBalance={false} chainStatus="icon" />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {notDeployed && (
          <div className="mb-6 rounded-2xl border border-[var(--border)] bg-white p-4 text-sm">
            <span className="font-semibold text-[var(--purple-strong)]">No deployment loaded.</span>{" "}
            Run Phase 4 to populate <code className="font-mono text-xs">src/addresses.json</code>; the
            UI then connects to a fresh testnet deploy.
          </div>
        )}

        <Tabs defaultValue="deposit" className="w-full">
          <div className="flex justify-center">
            <TabsList>
              <TabsTrigger value="deposit">Deposit</TabsTrigger>
              <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
              <TabsTrigger value="agent">Agent</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="deposit">  <Deposit />   </TabsContent>
          <TabsContent value="dashboard"><Dashboard /></TabsContent>
          <TabsContent value="agent">    <Agent />    </TabsContent>
        </Tabs>
      </main>

      <footer className="mx-auto max-w-6xl px-6 py-10 text-xs text-[var(--text-muted)] text-center">
        Volatility ≠ direction. Not financial advice. Funds remain withdrawable while paused.
      </footer>
    </div>
  );
}
