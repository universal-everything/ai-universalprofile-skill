// Local LSP6 encodings used by the 4337 module (kept here so the opt-in module
// does not depend on the account-core permission encoder). Encodings follow
// LSP6Constants.sol / LSP6SetDataModule.sol:
//   AddressPermissions:Permissions:<addr>          = 0x4b80742de2bf82acb3630000 ++ addr   → bytes32 BitArray
//   AddressPermissions:AllowedCalls:<addr>         = 0x4b80742de2bf393a64c70000 ++ addr   → (bytes4,address,bytes4,bytes4)[CompactBytesArray]
//   AddressPermissions:AllowedERC725YDataKeys:<a>  = 0x4b80742de2bf866c29110000 ++ addr   → bytes[CompactBytesArray]
//   AddressPermissions[]                           = 0xdf30…cb0e3 → uint128 (16 bytes)
//   AddressPermissions[i]                          = 0xdf30dba06db6a30e65354d9a64c60986 ++ uint128(i) → address (20 bytes)
import { concat, getAddress, isAddress, isHex, pad, size, slice, toHex, type Address, type Hex } from "viem";
import type { VerbContext } from "../core/types.ts";
import { UpError } from "../core/errors.ts";
import {
  CALL_TYPES,
  KEY_ADDRESS_PERMISSIONS_ARRAY,
  KEY_ADDRESS_PERMISSIONS_ARRAY_PREFIX,
  KEY_PREFIX_ALLOWED_CALLS,
  KEY_PREFIX_ALLOWED_DATA_KEYS,
  KEY_PREFIX_PERMISSIONS,
  PERMISSION_BITS,
  UP_ABI,
  type PermissionName,
} from "./constants.ts";
import { read } from "./rpc.ts";

export const permissionsKey = (a: Address): Hex => concat([KEY_PREFIX_PERMISSIONS, a.toLowerCase() as Hex]);
export const allowedCallsKey = (a: Address): Hex => concat([KEY_PREFIX_ALLOWED_CALLS, a.toLowerCase() as Hex]);
export const allowedDataKeysKey = (a: Address): Hex => concat([KEY_PREFIX_ALLOWED_DATA_KEYS, a.toLowerCase() as Hex]);
export const arrayLengthKey = KEY_ADDRESS_PERMISSIONS_ARRAY;
export const arrayIndexKey = (i: bigint | number): Hex => concat([KEY_ADDRESS_PERMISSIONS_ARRAY_PREFIX, pad(toHex(BigInt(i)), { size: 16 })]);

export const encodePermissions = (bits: bigint): Hex => pad(toHex(bits), { size: 32 });
export function decodePermissions(v: Hex | undefined): bigint {
  if (!v || v === "0x") return 0n;
  return BigInt(v);
}
export const encodeArrayLength = (n: bigint): Hex => pad(toHex(n), { size: 16 });
export function decodeArrayLength(v: Hex | undefined): bigint {
  if (!v || v === "0x") return 0n;
  // LSP2 Array length is uint128 (16 bytes); tolerate legacy 32-byte values.
  return BigInt(v);
}

export function permissionNames(bits: bigint): PermissionName[] {
  return (Object.entries(PERMISSION_BITS) as [PermissionName, number][]).filter(([, b]) => (bits >> BigInt(b)) & 1n).map(([n]) => n);
}

export function permissionsFromNames(names: readonly string[]): bigint {
  let out = 0n;
  for (const raw of names) {
    const n = raw.trim().toUpperCase().replace(/^_?4337(_PERMISSION)?$/, "ERC4337") as PermissionName;
    if (!(n in PERMISSION_BITS)) throw new UpError("BAD_ARGS", `unknown LSP6 permission "${raw}"`, { hint: `use names like ${Object.keys(PERMISSION_BITS).slice(8, 14).join(", ")}` });
    out |= 1n << BigInt(PERMISSION_BITS[n]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// CompactBytesArray encodings
// ---------------------------------------------------------------------------

export function encodeCompactBytesArray(items: Hex[]): Hex {
  if (items.length === 0) return "0x";
  return concat(
    items.flatMap((it) => {
      const n = size(it);
      if (n > 0xffff) throw new UpError("BAD_ARGS", `CompactBytesArray item too long (${n} bytes)`);
      return [pad(toHex(n), { size: 2 }), it];
    }),
  );
}

export function decodeCompactBytesArray(v: Hex | undefined): Hex[] {
  if (!v || v === "0x") return [];
  const out: Hex[] = [];
  let i = 0;
  const total = size(v);
  while (i < total) {
    if (i + 2 > total) throw new UpError("BAD_ARGS", `malformed CompactBytesArray ${v}`);
    const n = Number(BigInt(slice(v, i, i + 2)));
    if (i + 2 + n > total) throw new UpError("BAD_ARGS", `malformed CompactBytesArray ${v}`);
    out.push(n === 0 ? "0x" : slice(v, i + 2, i + 2 + n));
    i += 2 + n;
  }
  return out;
}

export interface AllowedCallInput {
  /** e.g. ["CALL","VALUE"] or "0x00000003" */
  callTypes: string[] | string | number;
  /** address or "*" */
  address: string;
  /** ERC-165 interface id or "*" (default "*") */
  standard?: string;
  /** function selector or "*" (default "*") */
  function?: string;
}

export interface AllowedCall {
  callTypes: Hex;
  callTypeNames: string[];
  address: Address | "*";
  standard: Hex | "*";
  function: Hex | "*";
}

const WILD4 = "0xffffffff" as Hex;
const WILD20 = "0xffffffffffffffffffffffffffffffffffffffff" as Hex;

function parseCallTypes(ct: AllowedCallInput["callTypes"]): number {
  if (typeof ct === "number") return ct;
  if (typeof ct === "string" && isHex(ct)) return Number(BigInt(ct));
  const list = Array.isArray(ct) ? ct : String(ct).split(/[,|]/);
  let bits = 0;
  for (const raw of list) {
    const n = raw.trim().toUpperCase().replace(/^TRANSFERVALUE$/, "VALUE") as keyof typeof CALL_TYPES;
    if (!(n in CALL_TYPES)) throw new UpError("BAD_ARGS", `unknown AllowedCalls call type "${raw}" (use VALUE, CALL, STATICCALL)`);
    if (n === "DELEGATECALL") throw new UpError("BAD_ARGS", "DELEGATECALL is never allowed for the EntryPoint controller");
    bits |= CALL_TYPES[n];
  }
  return bits;
}

function four(v: string | undefined, what: string): Hex {
  if (v === undefined || v === "*" || v.toLowerCase() === WILD4) return WILD4;
  if (!isHex(v) || size(v as Hex) !== 4) throw new UpError("BAD_ARGS", `AllowedCalls ${what} must be a 4-byte hex value or "*", got ${v}`);
  return v.toLowerCase() as Hex;
}

export function encodeAllowedCalls(entries: AllowedCallInput[]): Hex {
  return encodeCompactBytesArray(
    entries.map((e) => {
      const ct = parseCallTypes(e.callTypes);
      if (ct === 0) throw new UpError("BAD_ARGS", "AllowedCalls entry needs at least one call type");
      const addr = e.address === "*" ? WILD20 : isAddress(e.address, { strict: false }) ? (e.address.toLowerCase() as Hex) : undefined;
      if (!addr) throw new UpError("BAD_ARGS", `AllowedCalls address must be an address or "*", got ${e.address}`);
      const std = four(e.standard, "standard");
      const fn = four(e.function, "function");
      if (addr === WILD20 && std === WILD4 && fn === WILD4) throw new UpError("BAD_ARGS", 'an AllowedCalls entry cannot wildcard address, standard and function at once (LSP6 rejects it: InvalidWhitelistedCall); use --ep-scope super instead');
      return concat([pad(toHex(ct), { size: 4 }), addr, std, fn]);
    }),
  );
}

export function decodeAllowedCalls(v: Hex | undefined): AllowedCall[] {
  return decodeCompactBytesArray(v).map((it) => {
    if (size(it) !== 32) throw new UpError("BAD_ARGS", `malformed AllowedCalls entry ${it}`);
    const ct = slice(it, 0, 4);
    const bits = Number(BigInt(ct));
    const addr = slice(it, 4, 24);
    const std = slice(it, 24, 28);
    const fn = slice(it, 28, 32);
    return {
      callTypes: ct,
      callTypeNames: (Object.entries(CALL_TYPES) as [string, number][]).filter(([, b]) => bits & b).map(([n]) => n),
      address: addr === WILD20 ? "*" : getAddress(addr),
      standard: std === WILD4 ? "*" : std,
      function: fn === WILD4 ? "*" : fn,
    };
  });
}

export function encodeAllowedDataKeys(keys: string[]): Hex {
  return encodeCompactBytesArray(
    keys.map((k) => {
      if (!isHex(k) || size(k as Hex) < 1 || size(k as Hex) > 32) throw new UpError("BAD_ARGS", `allowed data key must be 1-32 bytes of hex, got ${k}`);
      return k.toLowerCase() as Hex;
    }),
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getDataBatch(ctx: VerbContext, chainId: number, up: Address, keys: Hex[]): Promise<Hex[]> {
  if (keys.length === 0) return [];
  const out: Hex[] = [];
  for (let i = 0; i < keys.length; i += 64) {
    const chunk = keys.slice(i, i + 64);
    out.push(...(await read<readonly Hex[]>(ctx, chainId, up, UP_ABI, "getDataBatch", [chunk])));
  }
  return out;
}

export interface ControllerData {
  address: Address;
  permissions: bigint;
  allowedCalls: Hex;
  allowedDataKeys: Hex;
}

export async function readController(ctx: VerbContext, chainId: number, up: Address, a: Address): Promise<ControllerData> {
  const [p, c, k] = await getDataBatch(ctx, chainId, up, [permissionsKey(a), allowedCallsKey(a), allowedDataKeysKey(a)]);
  return { address: getAddress(a), permissions: decodePermissions(p), allowedCalls: (c ?? "0x") as Hex, allowedDataKeys: (k ?? "0x") as Hex };
}

export interface ControllerArray {
  length: bigint;
  /** entries in index order; undefined for empty/malformed slots */
  entries: (Address | undefined)[];
}

export async function readControllerArray(ctx: VerbContext, chainId: number, up: Address): Promise<ControllerArray> {
  const [lenRaw] = await getDataBatch(ctx, chainId, up, [arrayLengthKey]);
  const length = decodeArrayLength(lenRaw);
  if (length > 10_000n) throw new UpError("INTERNAL", `AddressPermissions[] length ${length} is implausible; refusing to scan`);
  const keys = Array.from({ length: Number(length) }, (_, i) => arrayIndexKey(i));
  const vals = await getDataBatch(ctx, chainId, up, keys);
  return { length, entries: vals.map((v) => (v && size(v) === 20 ? getAddress(v) : undefined)) };
}

export function indexOfController(arr: ControllerArray, a: Address): number {
  return arr.entries.findIndex((e) => e?.toLowerCase() === a.toLowerCase());
}
