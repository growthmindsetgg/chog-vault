// Minimal ABIs for the agent. Full ABIs land in web/src/abis/* in Phase 4.

export const vaultAbi = [
  { type: "function", name: "rebalance",   stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "owner",       stateMutability: "view",       inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "agent",       stateMutability: "view",       inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "paused",      stateMutability: "view",       inputs: [], outputs: [{ type: "bool"    }] },
  { type: "function", name: "monBalance",  stateMutability: "view",       inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "usdcBalance", stateMutability: "view",       inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "nav",         stateMutability: "view",       inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalShares", stateMutability: "view",       inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf",   stateMutability: "view",       inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "logBook",     stateMutability: "view",       inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "deposit",     stateMutability: "payable",    inputs: [{ type: "uint256", name: "usdcAmount" }], outputs: [] },
  { type: "function", name: "withdraw",    stateMutability: "nonpayable", inputs: [{ type: "uint256", name: "shares"    }], outputs: [] },
  {
    type: "event", name: "Rebalanced", anonymous: false,
    inputs: [
      { name: "priceE8",     type: "uint256", indexed: false },
      { name: "monValueBps", type: "uint256", indexed: false },
    ],
  },
] as const;

export const ammAbi = [
  { type: "function", name: "priceE8", stateMutability: "view",       inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "owner",   stateMutability: "view",       inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "agent",   stateMutability: "view",       inputs: [], outputs: [{ type: "address" }] },
  {
    type: "function", name: "setPrice", stateMutability: "nonpayable",
    inputs: [{ name: "_priceE8", type: "uint256" }], outputs: [],
  },
  {
    type: "event", name: "PriceSet", anonymous: false,
    inputs: [{ name: "priceE8", type: "uint256", indexed: false }],
  },
] as const;

export const usdcAbi = [
  {
    type: "function", name: "balanceOf", stateMutability: "view",
    inputs: [{ type: "address" }], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "decimals", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint8" }],
  },
  {
    type: "function", name: "approve", stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }],
  },
  {
    type: "function", name: "allowance", stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }],
  },
] as const;

export const logBookAbi = [
  { type: "function", name: "count", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "vault", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "function", name: "entries", stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [
      { name: "priceE8",   type: "uint256" },
      { name: "bpsBefore", type: "uint256" },
      { name: "bpsAfter",  type: "uint256" },
      { name: "navBefore", type: "uint256" },
      { name: "navAfter",  type: "uint256" },
      { name: "ts",        type: "uint256" },
    ],
  },
  {
    type: "event", name: "Logged", anonymous: false,
    inputs: [
      { name: "seq",       type: "uint256", indexed: true  },
      { name: "priceE8",   type: "uint256", indexed: false },
      { name: "bpsBefore", type: "uint256", indexed: false },
      { name: "bpsAfter",  type: "uint256", indexed: false },
      { name: "navBefore", type: "uint256", indexed: false },
      { name: "navAfter",  type: "uint256", indexed: false },
      { name: "ts",        type: "uint256", indexed: false },
    ],
  },
] as const;
