// ERC725Y key names <-> keys via the bundled erc725.js LSP2 schemas, value
// encode/decode, and the LSP6 routing rule "which permission does writing this
// key need" (LSP6SetDataModule._getPermissionRequiredToSetDataKey).
import { ERC725, encodeArrayKey, type ERC725JSONSchema } from "@erc725/erc725.js";
import { LSP1Schema, LSP3Schema, LSP4Schema, LSP5Schema, LSP6Schema, LSP8Schema, LSP9Schema, LSP10Schema, LSP12Schema, LSP17Schema } from "@erc725/erc725.js/schemas";
import type { Hex } from "viem";
import { DATA_KEYS } from "./constants.ts";

export type Schema = ERC725JSONSchema;

/** Bundled LSP2 schemas (erc725.js): LSP1/3/4/5/6/8/9/10/12/17. */
export const SCHEMAS: Schema[] = [...LSP1Schema, ...LSP3Schema, ...LSP4Schema, ...LSP5Schema, ...LSP6Schema, ...LSP8Schema, ...LSP9Schema, ...LSP10Schema, ...LSP12Schema, ...LSP17Schema];

const strip = (h: string) => h.toLowerCase().replace(/^0x/, "");
const isKeyHex = (s: string) => /^0x[0-9a-fA-F]{64}$/.test(s);

const PLACEHOLDER_RE: Record<string, string> = {
  address: "(0x[0-9a-fA-F]{40})",
  bytes4: "(0x[0-9a-fA-F]{8})",
  bytes32: "(0x[0-9a-fA-F]{64})",
};

export interface ResolvedKey {
  key: Hex;
  name?: string;
  schema?: Schema;
  dynamicKeyParts?: string[];
  /** For "Name[]" with an index, e.g. AddressPermissions[3]. */
  arrayIndex?: number;
  /** True when the key is the length key of an LSP2 Array. */
  isArrayLength?: boolean;
}

/**
 * Resolves a key name, a dynamic name with values filled in
 * ("AddressPermissions:Permissions:0xabc…"), "Name[<n>]" array elements, a
 * name with placeholders + parts, or a raw 32-byte hex key.
 */
export function resolveDataKey(input: string, parts?: string[]): ResolvedKey {
  const s = input.trim();
  if (isKeyHex(s)) {
    const key = s.toLowerCase() as Hex;
    const schema = SCHEMAS.find((x) => x.key.toLowerCase() === key);
    return { key, name: schema?.name, schema, isArrayLength: schema?.keyType === "Array" };
  }
  // Array element: Name[3]
  const arr = /^(.+)\[(\d+)\]$/.exec(s);
  if (arr) {
    const schema = SCHEMAS.find((x) => x.name === `${arr[1]}[]`);
    if (!schema) throw new Error(`unknown array key name "${arr[1]}[]"`);
    const key = encodeArrayKey(schema.key, Number(arr[2])) as Hex;
    return { key: key.toLowerCase() as Hex, name: s, schema, arrayIndex: Number(arr[2]) };
  }
  // Exact (static or with placeholders + explicit parts)
  const exact = SCHEMAS.find((x) => x.name === s);
  if (exact) {
    if (/<[^>]+>/.test(exact.name)) {
      if (!parts?.length) throw new Error(`key "${s}" needs dynamic parts (--parts) for ${exact.name.match(/<[^>]+>/g)!.join(", ")}`);
      const key = ERC725.encodeKeyName(exact.name, parts.length === 1 ? parts[0] : parts) as Hex;
      return { key: key.toLowerCase() as Hex, name: exact.name, schema: exact, dynamicKeyParts: parts };
    }
    return { key: exact.key.toLowerCase() as Hex, name: exact.name, schema: exact, isArrayLength: exact.keyType === "Array" };
  }
  // Dynamic name with parts filled in.
  for (const schema of SCHEMAS) {
    if (!/<[^>]+>/.test(schema.name)) continue;
    const pattern = schema.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\?<([a-zA-Z0-9]+)\\?>/g, (_m: string, t: string) => PLACEHOLDER_RE[t] ?? "([^:]+)");
    const m = new RegExp(`^${pattern}$`).exec(s);
    if (m) {
      const dyn = m.slice(1);
      const key = ERC725.encodeKeyName(schema.name, dyn.length === 1 ? dyn[0] : dyn) as Hex;
      return { key: key.toLowerCase() as Hex, name: schema.name, schema, dynamicKeyParts: dyn };
    }
  }
  throw new Error(`unknown ERC725Y key "${s}" — pass a 32-byte hex key or a name from the LSP schemas (e.g. LSP3Profile, AddressPermissions:Permissions:<address>)`);
}

/** Encodes a value for a resolved key with its schema; raw hex passes through for unknown keys. */
export function encodeDataValue(r: ResolvedKey, value: unknown): Hex {
  if (r.arrayIndex !== undefined) {
    // array elements are encoded with the element valueType (e.g. address)
    if (typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value)) return value.toLowerCase() as Hex;
    throw new Error("array element values must be hex (e.g. an address)");
  }
  if (!r.schema) {
    if (typeof value === "string" && /^0x([0-9a-fA-F]{2})*$/.test(value)) return value as Hex;
    throw new Error("unknown key: value must be raw hex bytes");
  }
  if (r.schema.keyType === "Array" && typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value)) return value as Hex; // raw length
  if (typeof value === "string" && /^0x([0-9a-fA-F]{2})*$/.test(value) && r.schema.valueContent !== "Address" && r.schema.valueType !== "address") {
    // already encoded bytes (e.g. a VerifiableURI produced elsewhere)
    return value as Hex;
  }
  const enc = ERC725.encodeData([{ keyName: r.schema.name, dynamicKeyParts: r.dynamicKeyParts?.length === 1 ? r.dynamicKeyParts[0] : r.dynamicKeyParts, value: value as any }], [r.schema]);
  return enc.values[0] as Hex;
}

export function decodeDataValue(r: ResolvedKey, raw: Hex): unknown {
  if (!raw || raw === "0x") return null;
  if (!r.schema || r.arrayIndex !== undefined) return raw;
  try {
    if (r.schema.keyType === "Array") return BigInt(raw).toString();
    const d = ERC725.decodeData([{ keyName: r.schema.name, dynamicKeyParts: r.dynamicKeyParts?.length === 1 ? r.dynamicKeyParts[0] : r.dynamicKeyParts, value: raw }], [r.schema]);
    return d[0]?.value ?? raw;
  } catch {
    return raw;
  }
}

// ---------------------------------------------------------------------------
// Permission routing for setData (LSP6SetDataModule)
// ---------------------------------------------------------------------------

export type KeyClass = "permissions-array" | "controller-permissions" | "allowed-calls" | "allowed-data-keys" | "lsp6-unknown" | "urd" | "extension" | "data";

export interface KeyRouting {
  key: Hex;
  class: KeyClass;
  /** Permission(s) the KM will require; "or" lists alternatives (e.g. ADDCONTROLLER for new, EDITPERMISSIONS for existing). */
  requires: string;
  admin: boolean;
}

export function classifyDataKey(key: Hex): KeyRouting {
  const k = strip(key);
  if (k.startsWith(strip(DATA_KEYS.AddressPermissionsIndexPrefix))) {
    return { key, class: "permissions-array", requires: "ADDCONTROLLER (new entry / longer array) or EDITPERMISSIONS (existing entry / shorter array)", admin: true };
  }
  if (k.startsWith(strip(DATA_KEYS.AddressPermissionsPrefix))) {
    if (k.startsWith(strip(DATA_KEYS.AddressPermissionsPermissionsPrefix))) return { key, class: "controller-permissions", requires: "ADDCONTROLLER (new controller) or EDITPERMISSIONS (existing controller)", admin: true };
    if (k.startsWith(strip(DATA_KEYS.AddressPermissionsAllowedCallsPrefix))) return { key, class: "allowed-calls", requires: "ADDCONTROLLER (new controller) or EDITPERMISSIONS (existing controller)", admin: true };
    if (k.startsWith(strip(DATA_KEYS.AddressPermissionsAllowedERC725YDataKeysPrefix))) return { key, class: "allowed-data-keys", requires: "ADDCONTROLLER (new controller) or EDITPERMISSIONS (existing controller)", admin: true };
    return { key, class: "lsp6-unknown", requires: "reverts NotRecognisedPermissionKey", admin: true };
  }
  if (k === strip(DATA_KEYS.LSP1UniversalReceiverDelegate) || k.startsWith(strip(DATA_KEYS.LSP1UniversalReceiverDelegatePrefix))) {
    return { key, class: "urd", requires: "ADDUNIVERSALRECEIVERDELEGATE (not set yet) or CHANGEUNIVERSALRECEIVERDELEGATE (already set)", admin: true };
  }
  if (k.startsWith(strip(DATA_KEYS.LSP17ExtensionPrefix))) {
    return { key, class: "extension", requires: "ADDEXTENSIONS (not set yet) or CHANGEEXTENSIONS (already set); SUPER_SETDATA does not bypass", admin: true };
  }
  return { key, class: "data", requires: "SETDATA with a matching AllowedERC725YDataKeys entry, or SUPER_SETDATA", admin: false };
}

/**
 * Turns a user-supplied allowed-data-key entry into the bytes stored in
 * AllowedERC725YDataKeys: raw hex (1..32 bytes) passes through; "Name[]" becomes
 * the 16-byte array prefix (covers the length key and every element);
 * a dynamic name without parts becomes its static prefix; anything else the full key.
 */
export function allowedKeyFor(input: string): Hex {
  const s = input.trim();
  if (/^0x([0-9a-fA-F]{2}){1,32}$/.test(s)) return s.toLowerCase() as Hex;
  const schema = SCHEMAS.find((x) => x.name === s);
  if (schema && schema.keyType === "Array") return schema.key.slice(0, 34).toLowerCase() as Hex;
  if (schema && schema.key.includes("<")) {
    const prefix = schema.key.slice(0, schema.key.indexOf("<")).toLowerCase();
    if (prefix.length < 4) throw new Error(`cannot derive a prefix for ${s}`);
    return prefix as Hex;
  }
  return resolveDataKey(s).key;
}
