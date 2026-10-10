// EntryPoint v0.6 "AAxx" reason dictionary with Universal-Profile-specific
// meanings (erc4337-plan §3), plus ERC-7769 bundler JSON-RPC error codes.
// Reason strings are the literal FailedOp reasons of EntryPoint.sol v0.6.0.
import type { ErrorCode } from "../core/errors.ts";
import { UpError } from "../core/errors.ts";

export interface AAEntry {
  /** literal EntryPoint reason (prefix) */
  reason: string;
  meaning: string;
  /** what it means for a Universal Profile + Extension4337 */
  up?: string;
  hint: string;
  errorCode: ErrorCode;
}

export const AA_ERRORS: Record<string, AAEntry> = {
  AA10: { reason: "AA10 sender already constructed", meaning: "initCode given but the sender already exists", up: "the skill never sends initCode (profiles are deployed with LSP23)", hint: "send the op with empty initCode", errorCode: "BAD_ARGS" },
  AA13: { reason: "AA13 initCode failed or OOG", meaning: "account factory call failed", hint: "deploy the profile with LSP23 first (up account deploy)", errorCode: "BAD_ARGS" },
  AA14: { reason: "AA14 initCode must return sender", meaning: "factory returned a different address", hint: "deploy the profile with LSP23 first", errorCode: "BAD_ARGS" },
  AA15: { reason: "AA15 initCode must create sender", meaning: "factory did not deploy the sender", hint: "deploy the profile with LSP23 first", errorCode: "BAD_ARGS" },
  AA20: { reason: "AA20 account not deployed", meaning: "no code at the sender", up: "the Universal Profile does not exist on this chain", hint: "check --profile and --chain; deploy the profile on this chain first", errorCode: "NOT_DEPLOYED" },
  AA21: { reason: "AA21 didn't pay prefund", meaning: "the sender's EntryPoint deposit does not cover the required prefund", up: "Extension4337 never pays prefund (it ignores missingAccountFunds): the profile needs an EntryPoint deposit or a paymaster", hint: "top up the deposit: up account 4337 deposit --amount <value>", errorCode: "TX_FAILED" },
  AA22: { reason: "AA22 expired or not due", meaning: "validUntil/validAfter not satisfied", up: "Extension4337 returns no time range, so this should not occur", hint: "rebuild and re-sign the UserOperation", errorCode: "TX_FAILED" },
  AA23: { reason: "AA23 reverted", meaning: "validateUserOp reverted", up: "'Only EntryPoint contract can call this' = the extension is bound to a different EntryPoint; '(or OOG)' = the signer lacks the LSP6 permissions for this payload (KM lsp20VerifyCall reverted with a custom error such as NotAuthorised/NotAllowedCall) or verificationGasLimit is too low", hint: "check the signer's permissions for the payload (up account 4337 status) and the extension's EntryPoint", errorCode: "NOT_AUTHORISED" },
  AA24: { reason: "AA24 signature error", meaning: "validateUserOp returned SIG_VALIDATION_FAILED", up: "bad signature, OR the signer lacks the 4337 permission (bit 23), OR the Key Manager returned a non-success status", hint: "grant bit 23 with: up account 4337 enable (or re-sign over the exact userOpHash)", errorCode: "NOT_AUTHORISED" },
  AA25: { reason: "AA25 invalid account nonce", meaning: "nonce already used or wrong key/sequence", up: "the skill uses EntryPoint.getNonce(profile, key = controller address)", hint: "rebuild the UserOperation with a fresh nonce", errorCode: "TX_FAILED" },
  AA30: { reason: "AA30 paymaster not deployed", meaning: "no code at the paymaster", hint: "check paymasterAndData", errorCode: "BAD_ARGS" },
  AA31: { reason: "AA31 paymaster deposit too low", meaning: "the paymaster's EntryPoint deposit is too low", hint: "use another paymaster or the profile's own deposit", errorCode: "TX_FAILED" },
  AA32: { reason: "AA32 paymaster expired or not due", meaning: "paymaster time range not satisfied", hint: "request fresh paymaster data", errorCode: "TX_FAILED" },
  AA33: { reason: "AA33 reverted", meaning: "validatePaymasterUserOp reverted", hint: "request fresh paymaster data or drop the paymaster", errorCode: "TX_FAILED" },
  AA34: { reason: "AA34 signature error", meaning: "paymaster signature invalid", hint: "request fresh paymaster data", errorCode: "TX_FAILED" },
  AA40: { reason: "AA40 over verificationGasLimit", meaning: "validation used more gas than verificationGasLimit", hint: "raise --verification-gas-limit", errorCode: "TX_FAILED" },
  AA41: { reason: "AA41 too little verificationGas", meaning: "paymaster validation ran out of the remaining verification gas", hint: "raise --verification-gas-limit", errorCode: "TX_FAILED" },
  AA50: { reason: "AA50 postOp reverted", meaning: "paymaster postOp reverted", hint: "check the paymaster", errorCode: "TX_FAILED" },
  AA51: { reason: "AA51 prefund below actualGasCost", meaning: "prefund did not cover the actual cost", hint: "raise gas limits / deposit", errorCode: "TX_FAILED" },
  AA90: { reason: "AA90 invalid beneficiary", meaning: "beneficiary is the zero address", hint: "self-bundling uses the controller address as beneficiary", errorCode: "BAD_ARGS" },
  AA91: { reason: "AA91 failed send to beneficiary", meaning: "beneficiary refused the compensation", hint: "use an EOA beneficiary", errorCode: "TX_FAILED" },
  AA92: { reason: "AA92 internal call only", meaning: "innerHandleOp called externally", hint: "internal EntryPoint error", errorCode: "INTERNAL" },
  AA93: { reason: "AA93 invalid paymasterAndData", meaning: "paymasterAndData shorter than 20 bytes", hint: "pass 0x or ≥ 20 bytes", errorCode: "BAD_ARGS" },
  AA94: { reason: "AA94 gas values overflow", meaning: "a gas field exceeds uint120", hint: "check the gas fields", errorCode: "BAD_ARGS" },
  AA95: { reason: "AA95 out of gas", meaning: "the bundle transaction gas limit is below callGasLimit + verificationGasLimit + overhead", hint: "self-bundling: raise the handleOps gas limit", errorCode: "TX_FAILED" },
  AA96: { reason: "AA96 invalid aggregator", meaning: "aggregator address is invalid", hint: "Extension4337 does not use aggregators", errorCode: "BAD_ARGS" },
};

export interface AAExplained {
  code?: string;
  reason: string;
  meaning?: string;
  up?: string;
  hint?: string;
  errorCode: ErrorCode;
}

/** Explains a FailedOp reason string or a bundler error message that embeds one. */
export function explainAA(reason: string): AAExplained {
  const m = /\bAA(\d\d)\b/.exec(reason);
  if (!m) return { reason, errorCode: "TX_FAILED" };
  const code = `AA${m[1]}`;
  const e = AA_ERRORS[code];
  if (!e) return { code, reason, errorCode: "TX_FAILED" };
  let up = e.up;
  if (code === "AA23") {
    if (/Only EntryPoint contract can call this/.test(reason)) up = "the profile's Extension4337 is bound to a different EntryPoint than the one that called it";
    else if (/\(or OOG\)/.test(reason)) up = "the signer is not allowed to run this payload (Key Manager custom error inside lsp20VerifyCall, e.g. NotAuthorised/NotAllowedCall/NoPermissionsSet) or verificationGasLimit is too low";
  }
  return { code, reason, meaning: e.meaning, up, hint: e.hint, errorCode: e.errorCode };
}

export function aaUpError(reason: string, context: string, details: Record<string, unknown> = {}, extraHint?: string): UpError {
  const x = explainAA(reason);
  const msg = `${context}: ${reason}${x.up ? ` — ${x.up}` : x.meaning ? ` — ${x.meaning}` : ""}`;
  return new UpError(x.errorCode, msg, { hint: extraHint ?? x.hint, details: { ...details, aa: x } });
}

/** ERC-7769 bundler JSON-RPC error codes. */
export const BUNDLER_RPC_ERRORS: Record<number, string> = {
  [-32602]: "invalid UserOperation struct or fields",
  [-32500]: "rejected by EntryPoint simulateValidation (account creation or validation)",
  [-32501]: "rejected by paymaster validatePaymasterUserOp",
  [-32502]: "rejected by ERC-7562 opcode/storage validation rules",
  [-32503]: "UserOperation out of time range",
  [-32504]: "paymaster or aggregator throttled/banned",
  [-32505]: "paymaster or aggregator stake/unstake delay too low",
  [-32506]: "unsupported signature aggregator",
  [-32507]: "signature check failed",
  [-32508]: "paymaster balance cannot cover all pending UserOperations",
};
