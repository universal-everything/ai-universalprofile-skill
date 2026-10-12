// Union of all custom errors of the LSP/ERC725 contracts + EntryPoint v0.6 +
// standard Error(string)/Panic(uint256) + the swap-router errors agents meet most
// (Uniswap Universal Router and forks), used to decode reverts on every path.
import type { Abi } from "viem";
import { assetJson } from "../core/assets.ts";

const standard: Abi = [
  { type: "error", name: "Error", inputs: [{ name: "message", type: "string" }] },
  { type: "error", name: "Panic", inputs: [{ name: "code", type: "uint256" }] },
  { type: "error", name: "FailedOp", inputs: [{ name: "opIndex", type: "uint256" }, { name: "reason", type: "string" }] },
  { type: "error", name: "SignatureValidationFailed", inputs: [{ name: "aggregator", type: "address" }] },
  // "ETH" means the chain's native coin (LYX on LUKSO)
  { type: "error", name: "InsufficientETH", inputs: [] },
  { type: "error", name: "TransactionDeadlinePassed", inputs: [] },
];

export const ERROR_ABIS: Abi[] = [standard, assetJson<Abi>("abis", "errors.json")];
