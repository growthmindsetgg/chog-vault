# Chog Vault

A non-custodial **60/40 MON/USDC vault** rebalanced by an **autonomous, non-LLM, on-chain-verified agent** on Monad testnet.

You deposit native MON + USDC. An off-chain agent watches the on-chain MON/USD price and, whenever the ratio drifts outside the ±5% band, signs a single `rebalance()` transaction that the vault itself executes. The vault — not the agent — writes the proof of every rebalance to an on-chain `LogBook` in the same transaction. The agent has exactly one power and zero ability to move user funds.

> **Honest framing.** Constant-mix rebalancing earns when MON moves around. It does **not** beat a one-way price run (it'll trail HODL on a sustained pump or dump). This is not financial advice. Funds remain withdrawable even while the kill switch is engaged.

---

## What's interesting

- **Agent isolation is enforced at the bytecode level.** `deposit()` and `withdraw()` both `require(msg.sender != agent)`. The agent's only power is to call `rebalance()`. There is no admin path that lets the agent withdraw or move user funds.
- **The vault writes its own proof.** `LogBook.record(...)` is `onlyVault` — the vault writes `(priceE8, bpsBefore, bpsAfter, navBefore, navAfter, ts)` to the LogBook in the same transaction as the rebalance, using its own computed numbers. The agent cannot forge an entry by passing different numbers off-chain.
- **Kill switch is not a fund trap.** The owner can `setPaused(true)` to stop rebalancing, but `withdraw()` is intentionally not gated by `paused`. Pausing freezes the agent's hand, not the user's funds.
- **No keys in the web bundle.** The frontend reads addresses + ABIs only; both signing keys live in local `.env` files (`contracts/.env`, `agent/.env`) that are git-ignored.

---

## Architecture

```
┌───────────────────────┐     ┌──────────────────────────┐
│ web/  (Next.js 16)    │     │ agent/  (TS + viem)      │
│ wagmi + RainbowKit    │     │ runs LOCALLY             │
│ reads only            │     │ ┌──────────────────────┐ │
└──────────┬────────────┘     │ │ run.ts (autonomous)  │ │
           │ reads            │ │  reads on-chain price│ │
           │                  │ │  signs rebalance only│ │
           ▼                  │ └──────────────────────┘ │
   ┌───────────────┐          │ ┌──────────────────────┐ │
   │ Monad testnet │ ◀────────┤ │ pyth-pusher.ts       │ │
   │  chainId 10143│ setPrice │ │  Pyth beta Hermes    │ │
   └───────┬───────┘          │ │  → OracleAMM.setPrice│ │
           │                  │ └──────────────────────┘ │
           ▼                  └──────────────────────────┘
  ┌─────────────────────────────────────────┐
  │ RebalanceVault       (60/40 ±5% band)   │
  │   ├─ deposit(usdcAmount) payable        │  user only — agent blocked
  │   ├─ withdraw(shares)                   │  user only, works when paused
  │   ├─ rebalance()    onlyAgent           │
  │   │     └─ logBook.record(...)          │  vault-signed, same tx
  │   └─ setPaused(bool) onlyOwner          │
  └────┬──────────────┬─────────────────────┘
       │              │
       ▼              ▼
 ┌──────────┐  ┌──────────────┐      ┌──────────────┐
 │ LogBook  │  │ OracleAMM    │      │ MockUSDC     │
 │ onlyVault│  │ priceE8 +    │      │ ERC20, 6 dec │
 │ append   │  │ 30 bps fee   │      │ public mint  │
 └──────────┘  └──────────────┘      └──────────────┘
```

Three pieces:
1. **`contracts/`** — Solidity (Monad Foundry, solc 0.8.28): `RebalanceVault`, `OracleAMM`, `LogBook`, `MockUSDC`, OZ-based. 9/9 Foundry tests green.
2. **`agent/`** — TypeScript + viem (no LLM, no framework). Runs locally. Two distinct keys: `DEPLOYER_PK` (owner; signs `setPrice` from `pyth-pusher`) and `AGENT_PK` (signs `rebalance` only). Money STOP: the agent never pays a 402, never deposits, never withdraws.
3. **`web/`** — Next.js 16 + wagmi v2 + viem + RainbowKit + Tailwind v4 + shadcn primitives. Read-only relative to the protocol; the only writes are the user's own `approve`/`deposit`/`withdraw`/`setPaused` from their connected wallet.

---

## Security model

| Property | How it's enforced |
|---|---|
| Agent cannot move user funds | `deposit()` and `withdraw()` both `require(msg.sender != agent)`. The agent EOA reverts on either. |
| Agent cannot forge a rebalance record | `LogBook.record(...)` is `onlyVault`. The vault writes the numbers it computed itself in the same tx. |
| Owner pausing doesn't trap funds | `withdraw()` is not gated by `paused`. Pausing stops new rebalances only. |
| No private keys in deployed artifacts | `contracts/.env`, `agent/.env`, `web/.env.local` are git-ignored. The Vercel build reads `NEXT_PUBLIC_RPC_URL` only. |
| Owner / agent / demo user are independent EOAs | Distinct private keys; deploy script asserts `deployer != agent`. |

---

## Price source

- **Phase 5+**: live **Pyth Beta Hermes** MON/USD feed `0xe786153c…ba5d6b`, fetched by `agent/scripts/pyth-pusher.ts` and pushed onto `OracleAMM.setPrice` every ~10s, signed by `DEPLOYER_PK`.
- **On-chain verification (V2 roadmap)**: today the oracle is a one-method `setPrice` admin contract; V2 will accept a Pyth update bytes payload and verify it against the on-chain Pyth verifier so the agent can no longer set arbitrary prices.

---

## Lessons we encoded into this rebuild

These are the bugs we hit the first time around, now wired into the design / scripts as defaults:

- **Use Ankr RPC, not the official.** `https://testnet-rpc.monad.xyz` 429-throttles under any read storm. Both the agent (`RPC_URL`) and the web (`NEXT_PUBLIC_RPC_URL`) default to `https://rpc.ankr.com/monad_testnet`, with `https://10143.rpc.thirdweb.com` as fallback in the wagmi transport.
- **Seed the AMM with 120 MON, not 20.** With low MON depth the first rebalance reverts at `swapMonForUsdc` → `mon xfer fail`. The deploy script seeds 120 MON + 1M USDC.
- **Use the Pyth *beta* feed id.** Mainnet and beta have different feed ids; only `e786153c…ba5d6b` returns parsed data on Hermes Beta.
- **Monad testnet has no Multicall3.** Both the agent (`makePublicClient`) and the web (wagmi config) set `batch: { multicall: false }`. All reads are individual.
- **Read native MON via `getBalance`, not a contract call.** `useVaultSnapshot` calls `publicClient.getBalance(user)` for native MON; multicall would silently fail anyway since there's no Multicall3.
- **Use Monad Foundry, not stock.** `curl -L https://foundry.category.xyz | bash && foundryup -n monad` — installs the Monad-flavored `forge`/`cast`/`anvil`/`chisel` (currently `1.5.0-stable-monad`).
- **EIP-1559 + Monad gas estimation occasionally under-budgets.** The agent's `rebalance` write, `setPrice`, and `nudge-price` all use `type: "legacy"` with an explicit `gas` ceiling. The deploy script uses `--legacy` for the same reason.

---

## Setup

Prereqs: Node 20+, Monad Foundry on PATH, a GitHub auth via `gh`, two funded Monad testnet EOAs (deployer ≥ ~130 MON, agent ≥ ~3 MON).

```bash
# 1. Contracts
cd contracts
cp .env.example .env        # paste DEPLOYER_PK, AGENT_PK, AGENT_ADDR, DEMO_USER
forge install --no-git OpenZeppelin/openzeppelin-contracts
forge test -vv              # 9/9 green
forge script script/Deploy.s.sol:Deploy --rpc-url monad --broadcast --legacy

# 2. Wire the deploy output into config/addresses.json (and copy into web/src/addresses.json).
#    Extract ABIs into web/src/abis/*.json from contracts/out/.

# 3. Agent (runs LOCALLY — keys live here)
cd ../agent
cp .env.example .env        # paste AGENT_PK, DEPLOYER_PK, RPC_URL=Ankr
npm install
npm run pyth-probe          # confirm live MON/USD ≈ $0.02 from Pyth Beta Hermes
npm run pyth-pusher         # background: setPrice every ~10s, signed by DEPLOYER_PK
npm run tick                # foreground: autonomous rebalance, signed by AGENT_PK

# 4. Web (Vercel deploys this; no keys)
cd ../web
cp .env.example .env.local  # NEXT_PUBLIC_RPC_URL=https://rpc.ankr.com/monad_testnet
npm install
npm run dev                 # http://localhost:3000
npm run build               # production build, clean
```

The agent and pyth-pusher are **always run locally** — they hold private keys and there is no scenario in which they should run on a shared host.

---

## 90-second demo

1. **Open the live URL.** Header shows "Chog Vault · Monad testnet". Connect a wallet (the demo user wallet).
2. **Deposit tab.** Enter MON + USDC, hit MAX to pad gas. If USDC > 0, the button reads **"Approve USDC"** — click once, the allowance is re-read from chain, then the button flips to **"Deposit"**. Two clicks, two txs, exactly one per click.
3. **Dashboard tab.** Position value + ROI vs deposit + ROI vs HODL. The Vault-vs-HODL chart (purple vs gray) starts blank until the first rebalance; honest caption explains why.
4. **Agent tab.** Pulsing purple dot. Live MON/USD. Each `Rebalanced` event in the feed has a working MonadScan link. The **On-chain proof** panel below renders `LogBook` entries in JetBrains Mono — every row is a number the vault wrote, not the agent.
5. **Kill switch.** Connect with the owner wallet → the rose **Engage kill switch** button activates. Two-stage confirm. After engaging, rebalances stop; withdrawals still work — verify by withdrawing 25% from Dashboard.

If the live MON/USD is flat enough that no rebalance has fired in a while, the operator can `npm run nudge-price -- 250000000` (from `agent/`) to push priceE8 to $2.50 and force the next agent tick to rebalance.

---

## Roadmap

- **On-chain Pyth verification** — replace the admin `setPrice` with a Pyth update bytes path verified against the on-chain Pyth verifier, so the agent can no longer set arbitrary prices.
- **Real USDC** — swap MockUSDC for a Monad-bridged USDC once it's stable on testnet.
- **AMM depth + LP** — replace `OracleAMM` with a real DEX route (Uniswap-style or a Monad-native AMM) and let the vault accept LP fees.
- **Multi-asset bands** — generalize 60/40 MON/USDC into N-asset target bands; the agent stays a pure `decide()` function.
- **Per-deposit cost basis** — track basis per deposit instead of first-deposit-only, so multi-deposit users see accurate ROI vs HODL.
- **Pause-and-rotate operator key** — owner can rotate `agent` without redeploying the vault.

---

## Repo layout

```
chog-vault/
├─ contracts/        # Solidity + Monad Foundry (RebalanceVault, OracleAMM, LogBook, MockUSDC)
├─ agent/            # TS + viem; runs locally; signs rebalance (+ optional pyth-pusher)
├─ web/              # Next.js 16 + wagmi v2 + RainbowKit + Tailwind v4; the Vercel target
├─ config/           # addresses.json (canonical) — copied into web/src/ on deploy
└─ README.md
```

— Built for Monad Blitz Mumbai. Volatility ≠ direction. Not financial advice.
