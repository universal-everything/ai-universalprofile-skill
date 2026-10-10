// Decodes raw Universal Profile calldata (as executed by the profile through a
// UserOperation) into what the consent model needs: inner calls, total native
// value, real target(s), inner selector(s) and the risk class.
// Local to the 4337 module until the account core ships a shared
// decodeProfilePayload in src/exec/common.ts.
//   execute / executeBatch           → "write", value = Σ inner values, targets = inner targets
//   setData / setDataBatch           → "admin" if any key touches AddressPermissions*, LSP17 extensions
//                                      or LSP1 universal receiver delegates; otherwise "write"
//   transfer/accept/renounceOwnership→ "admin"
//   anything else (batchCalls, unknown selectors, malformed) → "admin" (needs a human approval)
import { decodeFunctionData, getAddress, slice, type Address, type Hex } from "viem";
import { UpError } from "../core/errors.ts";
import { OPERATION, type ExecCall, type OperationType } from "../exec/transport.ts";
import { KEY_ADDRESS_PERMISSIONS_ARRAY_PREFIX, LSP17_EXTENSION_PREFIX, UP_ABI } from "./constants.ts";

export const SELECTORS = {
  execute: "0x44c028fe",
  executeBatch: "0x31858452",
  setData: "0x7f23690c",
  setDataBatch: "0x97902421",
  transferOwnership: "0xf2fde38b",
  acceptOwnership: "0x79ba5097",
  renounceOwnership: "0x715018a6",
} as const;

/** AddressPermissions:* (bytes6 0x4b80742de2bf) */
const ADDRESS_PERMISSIONS_PREFIX = "0x4b80742de2bf";
/** LSP1UniversalReceiverDelegate and LSP1UniversalReceiverDelegate:<typeId> (bytes10 of keccak256("LSP1UniversalReceiverDelegate")) */
const LSP1_DELEGATE_PREFIX = "0x0cfc51aec37c55a4d0b1";

export type DataKeyClass = "permissions" | "lsp17-extension" | "lsp1-delegate" | "other";

export function classifyKey(key: Hex): DataKeyClass {
  const k = key.toLowerCase();
  if (k.startsWith(ADDRESS_PERMISSIONS_PREFIX) || k.startsWith(KEY_ADDRESS_PERMISSIONS_ARRAY_PREFIX.toLowerCase())) return "permissions";
  if (k.startsWith(LSP17_EXTENSION_PREFIX.toLowerCase())) return "lsp17-extension";
  if (k.startsWith(LSP1_DELEGATE_PREFIX)) return "lsp1-delegate";
  return "other";
}

export interface DecodedProfilePayload {
  kind: "execute" | "executeBatch" | "setData" | "ownership" | "unknown";
  /** payload selector */
  selector: Hex;
  /** inner ERC725X calls (execute / executeBatch) */
  calls: ExecCall[];
  totalValue: bigint;
  /** real targets: inner call targets, or the profile itself for setData/ownership/unknown */
  targets: Address[];
  /** inner selector of each call ("0x" = plain value transfer) */
  innerSelectors: Hex[];
  dataKeys?: { key: Hex; class: DataKeyClass }[];
  risk: "write" | "admin";
  reasons: string[];
}

const innerSelector = (data: Hex): Hex => (data.length >= 10 ? (data.slice(0, 10).toLowerCase() as Hex) : "0x");

function toCall(op: bigint, to: Address, value: bigint, data: Hex): ExecCall {
  if (op === BigInt(OPERATION.DELEGATECALL)) throw new UpError("NOT_SUPPORTED", "DELEGATECALL is always rejected by the Key Manager (DelegateCallDisallowedViaKeyManager)");
  if (op > 3n) throw new UpError("BAD_ARGS", `unknown ERC725X operation ${op}`);
  return { operation: Number(op) as OperationType, to: getAddress(to), value, data };
}

export function decodeProfilePayload(payload: Hex, profile: Address): DecodedProfilePayload {
  if (!/^0x([0-9a-fA-F]{2}){4,}$/.test(payload)) throw new UpError("BAD_ARGS", "payload must be hex calldata of at least 4 bytes");
  const selector = slice(payload, 0, 4).toLowerCase() as Hex;
  const self = getAddress(profile);
  const base = { selector, calls: [] as ExecCall[], totalValue: 0n, targets: [self], innerSelectors: [] as Hex[] };
  let decoded: { functionName: string; args?: readonly unknown[] } | undefined;
  try {
    decoded = decodeFunctionData({ abi: UP_ABI, data: payload });
  } catch {
    decoded = undefined;
  }
  if (!decoded) return { ...base, kind: "unknown", risk: "admin", reasons: [`unknown or malformed profile payload (selector ${selector}); a human approval is required`] };
  const a = decoded.args ?? [];
  switch (decoded.functionName) {
    case "execute":
    case "executeBatch": {
      const calls =
        decoded.functionName === "execute"
          ? [toCall(a[0] as bigint, a[1] as Address, a[2] as bigint, a[3] as Hex)]
          : (() => {
              const [ops, tos, vals, datas] = a as [readonly bigint[], readonly Address[], readonly bigint[], readonly Hex[]];
              if (ops.length !== tos.length || ops.length !== vals.length || ops.length !== datas.length) throw new UpError("BAD_ARGS", "executeBatch arrays have different lengths (ERC725X_ExecuteParametersLengthMismatch)");
              if (ops.length === 0) throw new UpError("BAD_ARGS", "executeBatch with no calls (ERC725X_ExecuteParametersEmptyArray)");
              return ops.map((op, i) => toCall(op, tos[i], vals[i], datas[i]));
            })();
      const reasons = calls.some((c) => c.to === self && c.data !== "0x") ? ["an inner call targets the profile itself"] : [];
      return {
        kind: decoded.functionName,
        selector,
        calls,
        totalValue: calls.reduce((s, c) => s + c.value, 0n),
        targets: [...new Set(calls.map((c) => c.to))],
        innerSelectors: calls.map((c) => innerSelector(c.data)),
        risk: "write",
        reasons,
      };
    }
    case "setData":
    case "setDataBatch": {
      const keys = (decoded.functionName === "setData" ? [a[0] as Hex] : [...(a[0] as readonly Hex[])]).map((key) => ({ key, class: classifyKey(key) }));
      const admin = keys.filter((k) => k.class !== "other");
      return {
        ...base,
        kind: "setData",
        dataKeys: keys,
        risk: admin.length ? "admin" : "write",
        reasons: admin.map((k) => `data key ${k.key} changes ${k.class === "permissions" ? "controller permissions" : k.class === "lsp17-extension" ? "an LSP17 extension" : "the universal receiver delegate"}`),
      };
    }
    case "transferOwnership":
    case "acceptOwnership":
    case "renounceOwnership":
      return { ...base, kind: "ownership", risk: "admin", reasons: [`${decoded.functionName} changes who owns the profile`] };
    default:
      return { ...base, kind: "unknown", risk: "admin", reasons: [`profile function ${decoded.functionName} is not classified; a human approval is required`] };
  }
}

/** Same shape for explicit ExecCall[] requests. */
export function describeCalls(calls: ExecCall[]): DecodedProfilePayload {
  if (calls.length === 0) throw new UpError("BAD_ARGS", "nothing to execute: no calls and no payload");
  for (const c of calls) toCall(BigInt(c.operation), c.to, c.value, c.data);
  return {
    kind: calls.length === 1 ? "execute" : "executeBatch",
    selector: calls.length === 1 ? SELECTORS.execute : SELECTORS.executeBatch,
    calls,
    totalValue: calls.reduce((s, c) => s + c.value, 0n),
    targets: [...new Set(calls.map((c) => getAddress(c.to)))],
    innerSelectors: calls.map((c) => innerSelector(c.data)),
    risk: "write",
    reasons: [],
  };
}
