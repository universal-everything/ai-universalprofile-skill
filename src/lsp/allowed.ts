// AllowedCalls and AllowedERC725YDataKeys (LSP6) — CompactBytesArray encode/decode.
//
// AllowedCalls value = CompactBytesArray of 32-byte tuples, each prefixed with
// its uint16 length 0x0020:  callTypes(bytes4) ‖ address(20) ‖ interfaceId(bytes4) ‖ selector(bytes4).
// AllowedERC725YDataKeys = CompactBytesArray of 1..32-byte keys or key prefixes.
// Validation mirrors LSP6Utils.isCompactBytesArrayOfAllowedCalls / …AllowedERC725YDataKeys
// and LSP6ExecuteModule (all-wildcard entries revert InvalidWhitelistedCall).
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { CALLTYPE, WILDCARD_ADDRESS, WILDCARD_BYTES4, type CallTypeName } from "./constants.ts";

export interface AllowedCall {
  /** bitmask of CALLTYPE (VALUE 0x1, CALL 0x2, STATICCALL 0x4, DELEGATECALL 0x8) */
  callTypes: number;
  /** target address or the wildcard 0xffff…ffff */
  address: string;
  /** ERC-165 interface id the target must support, or 0xffffffff */
  standard: string;
  /** function selector, or 0xffffffff */
  selector: string;
}

export interface AllowedCallInput {
  callTypes?: number | string | string[];
  address?: string;
  standard?: string;
  selector?: string;
  /** aliases accepted from JSON input */
  to?: string;
  interfaceId?: string;
  function?: string;
}

const strip = (h: string) => h.toLowerCase().replace(/^0x/, "");

function hex4(v: string | undefined, field: string): string {
  if (v === undefined || v === "*" || v === "any") return WILDCARD_BYTES4;
  const s = strip(v);
  if (!/^[0-9a-f]{8}$/.test(s)) throw new Error(`AllowedCalls ${field} must be a bytes4 hex (0x12345678) or "*", got "${v}"`);
  return "0x" + s;
}

/** Parses call types: number, hex "0x00000003", or names ["CALL","VALUE"] / "CALL|VALUE". */
export function parseCallTypes(v: number | string | string[] | undefined): number {
  if (v === undefined) return CALLTYPE.CALL;
  if (typeof v === "number") return v >>> 0;
  if (typeof v === "string" && /^0x[0-9a-fA-F]{1,8}$/.test(v)) return Number(BigInt(v)) >>> 0;
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v) >>> 0;
  const names = Array.isArray(v) ? v : v.split(/[|,+\s]+/).filter(Boolean);
  let out = 0;
  for (const n of names) {
    const key = n.trim().toUpperCase().replace("TRANSFERVALUE", "VALUE") as CallTypeName;
    if (CALLTYPE[key] === undefined) throw new Error(`unknown call type "${n}" (VALUE, CALL, STATICCALL, DELEGATECALL)`);
    out |= CALLTYPE[key];
  }
  return out;
}

export function callTypeNames(t: number): CallTypeName[] {
  return (Object.keys(CALLTYPE) as CallTypeName[]).filter((k) => (t & CALLTYPE[k]) !== 0);
}

export function normaliseAllowedCall(input: AllowedCallInput | AllowedCall): AllowedCall {
  const i = input as AllowedCallInput;
  const rawAddr = i.address ?? i.to;
  let address: string;
  if (rawAddr === undefined || rawAddr === "*" || rawAddr === "any" || strip(rawAddr) === "f".repeat(40)) address = WILDCARD_ADDRESS;
  else if (isAddress(rawAddr, { strict: false })) address = getAddress(rawAddr);
  else throw new Error(`AllowedCalls address must be an address or "*", got "${rawAddr}"`);
  return {
    callTypes: parseCallTypes(i.callTypes),
    address,
    standard: hex4(i.standard ?? i.interfaceId, "standard"),
    selector: hex4(i.selector ?? i.function, "selector"),
  };
}

export function isWildcardAddress(a: string): boolean {
  return strip(a) === "f".repeat(40);
}

/** Problems that make the KM revert or the entry useless (errors) and risky patterns (warnings). */
export function validateAllowedCall(c: AllowedCall): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const allWild = isWildcardAddress(c.address) && c.standard.toLowerCase() === WILDCARD_BYTES4 && c.selector.toLowerCase() === WILDCARD_BYTES4;
  if (allWild) errors.push("address, standard and function are all wildcards: the Key Manager rejects such an entry (InvalidWhitelistedCall); use SUPER_CALL/SUPER_TRANSFERVALUE instead or restrict one field");
  if (c.callTypes === 0) errors.push("no call type set (VALUE, CALL, STATICCALL or DELEGATECALL)");
  if (c.callTypes & ~0xf) warnings.push(`unknown call type bits 0x${(c.callTypes & ~0xf).toString(16)}`);
  if (c.callTypes & CALLTYPE.DELEGATECALL) warnings.push("DELEGATECALL call type: delegate calls are always rejected through the Key Manager");
  if (c.standard.toLowerCase() !== WILDCARD_BYTES4) warnings.push("a non-wildcard standard makes the Key Manager do an ERC-165 check on the target (30,000 gas); calls to EOAs or non-ERC-165 contracts will be rejected");
  return { errors, warnings };
}

export function encodeAllowedCalls(entries: (AllowedCallInput | AllowedCall)[]): Hex {
  if (entries.length === 0) return "0x";
  let out = "0x";
  for (const e of entries) {
    const c = normaliseAllowedCall(e);
    const v = validateAllowedCall(c);
    if (v.errors.length) throw new Error(v.errors.join("; "));
    out += "0020" + (c.callTypes >>> 0).toString(16).padStart(8, "0") + strip(c.address) + strip(c.standard) + strip(c.selector);
  }
  return out as Hex;
}

export function decodeAllowedCalls(value: Hex | undefined | null): AllowedCall[] {
  const d = !value || value === "0x" ? "" : strip(value);
  const out: AllowedCall[] = [];
  let p = 0;
  while (p < d.length) {
    if (p + 4 > d.length) throw new Error("invalid AllowedCalls encoding: truncated length prefix");
    const len = parseInt(d.slice(p, p + 4), 16);
    if (len !== 32) throw new Error(`invalid AllowedCalls encoding: element length ${len} (must be 32)`);
    const e = d.slice(p + 4, p + 4 + 64);
    if (e.length !== 64) throw new Error("invalid AllowedCalls encoding: truncated element");
    const address = "0x" + e.slice(8, 48);
    out.push({
      callTypes: parseInt(e.slice(0, 8), 16) >>> 0,
      address: isWildcardAddress(address) ? WILDCARD_ADDRESS : getAddress(address),
      standard: "0x" + e.slice(48, 56),
      selector: "0x" + e.slice(56, 64),
    });
    p += 4 + 64;
  }
  return out;
}

/** Human description of one AllowedCalls entry. */
export function describeAllowedCall(c: AllowedCall): string {
  const types = callTypeNames(c.callTypes).join("+") || "none";
  const addr = isWildcardAddress(c.address) ? "any address" : c.address;
  const std = c.standard.toLowerCase() === WILDCARD_BYTES4 ? "any standard" : `contracts supporting ${c.standard}`;
  const fn = c.selector.toLowerCase() === WILDCARD_BYTES4 ? "any function" : `function ${c.selector}`;
  return `${types} → ${addr}, ${std}, ${fn}`;
}

// ---------------------------------------------------------------------------
// AllowedERC725YDataKeys
// ---------------------------------------------------------------------------

export function encodeAllowedDataKeys(keys: string[]): Hex {
  if (keys.length === 0) return "0x";
  let out = "0x";
  for (const k of keys) {
    const s = strip(k);
    if (!/^[0-9a-f]*$/.test(s) || s.length % 2 !== 0) throw new Error(`allowed data key must be hex bytes: ${k}`);
    const len = s.length / 2;
    if (len === 0 || len > 32) throw new Error(`allowed data key must be 1..32 bytes (prefix or full key), got ${len} bytes: ${k}`);
    out += len.toString(16).padStart(4, "0") + s;
  }
  return out as Hex;
}

export function decodeAllowedDataKeys(value: Hex | undefined | null): Hex[] {
  const d = !value || value === "0x" ? "" : strip(value);
  const out: Hex[] = [];
  let p = 0;
  while (p < d.length) {
    if (p + 4 > d.length) throw new Error("invalid AllowedERC725YDataKeys encoding: truncated length prefix");
    const len = parseInt(d.slice(p, p + 4), 16);
    if (len === 0 || len > 32) throw new Error(`invalid AllowedERC725YDataKeys encoding: element length ${len}`);
    const e = d.slice(p + 4, p + 4 + len * 2);
    if (e.length !== len * 2) throw new Error("invalid AllowedERC725YDataKeys encoding: truncated element");
    out.push(("0x" + e) as Hex);
    p += 4 + len * 2;
  }
  return out;
}

/** True if `key` matches one of the allowed keys/prefixes (prefix match as in LSP6SetDataModule). */
export function isDataKeyAllowed(key: Hex, allowed: Hex[]): boolean {
  const k = strip(key);
  return allowed.some((a) => k.startsWith(strip(a)));
}

export function toAddressOrWildcard(a: string): Address {
  return (isWildcardAddress(a) ? WILDCARD_ADDRESS : getAddress(a)) as Address;
}
