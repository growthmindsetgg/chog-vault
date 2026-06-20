// Typed re-exports of the contract ABIs. The raw JSON imports lose literal
// types, so wagmi/viem can't infer them as `Abi`. Cast once here, import the
// typed names everywhere else.

import type { Abi } from "viem";
import vaultRaw   from "@abis/RebalanceVault.json";
import ammRaw     from "@abis/OracleAMM.json";
import usdcRaw    from "@abis/MockUSDC.json";
import logBookRaw from "@abis/LogBook.json";

export const vaultAbi:   Abi = vaultRaw   as unknown as Abi;
export const ammAbi:     Abi = ammRaw     as unknown as Abi;
export const usdcAbi:    Abi = usdcRaw    as unknown as Abi;
export const logBookAbi: Abi = logBookRaw as unknown as Abi;
