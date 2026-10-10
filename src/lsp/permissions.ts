// LSP6 permission bitmaps: names <-> bits (unknown bits preserved), presets,
// risk labels and plain-language explanations. Pure functions; erc725.js is the
// oracle in tests (test/unit/lsp/permissions.test.ts).
import type { Hex } from "viem";
import {
  ADMIN_PERMISSIONS,
  ALL_PERMISSIONS,
  CALLTYPE,
  INTERFACE_IDS,
  PERMISSION_ALIASES,
  PERMISSION_BITS,
  PERMISSION_NAMES,
  PERMISSIONS,
  URD_PERMISSIONS,
  WILDCARD_ADDRESS,
  WILDCARD_BYTES4,
  type PermissionName,
} from "./constants.ts";
import type { AllowedCall } from "./allowed.ts";

export type Risk = "low" | "medium" | "high" | "critical";

export interface PermissionInfo {
  name: PermissionName;
  bit: number;
  hex: Hex;
  risk: Risk;
  explanation: string;
}

/** Plain-language explanation + risk per permission bit. */
export const PERMISSION_INFO: Record<PermissionName, { risk: Risk; explanation: string }> = {
  CHANGEOWNER: { risk: "critical", explanation: "Can transfer or renounce ownership of the profile (replace the Key Manager). Full takeover power." },
  ADDCONTROLLER: { risk: "critical", explanation: "Can add new controllers and give them any permission, including itself through a new key." },
  EDITPERMISSIONS: { risk: "critical", explanation: "Can change or remove the permissions of existing controllers (including its own)." },
  ADDEXTENSIONS: { risk: "high", explanation: "Can register new LSP17 extension contracts that answer unknown function calls on the profile." },
  CHANGEEXTENSIONS: { risk: "high", explanation: "Can replace or remove existing LSP17 extensions." },
  ADDUNIVERSALRECEIVERDELEGATE: { risk: "high", explanation: "Can set a Universal Receiver Delegate that reacts to every token/value the profile receives." },
  CHANGEUNIVERSALRECEIVERDELEGATE: { risk: "high", explanation: "Can replace or remove the Universal Receiver Delegate(s)." },
  REENTRANCY: { risk: "medium", explanation: "Can re-enter the Key Manager during an ongoing execution (needed by URDs and some callbacks)." },
  SUPER_TRANSFERVALUE: { risk: "high", explanation: "Can send the profile's native coins to ANY address (no AllowedCalls restriction)." },
  TRANSFERVALUE: { risk: "medium", explanation: "Can send the profile's native coins, but only to addresses listed in its AllowedCalls." },
  SUPER_CALL: { risk: "high", explanation: "Can call ANY contract function as the profile (no AllowedCalls restriction): token transfers, approvals, swaps …" },
  CALL: { risk: "medium", explanation: "Can call contracts as the profile, restricted to the targets/standards/functions in its AllowedCalls." },
  SUPER_STATICCALL: { risk: "low", explanation: "Can make read-only calls to any contract through the profile." },
  STATICCALL: { risk: "low", explanation: "Can make read-only calls through the profile, restricted to its AllowedCalls." },
  SUPER_DELEGATECALL: { risk: "critical", explanation: "Can run foreign code inside the profile's storage context. Always rejected through the Key Manager (DelegateCallDisallowedViaKeyManager)." },
  DELEGATECALL: { risk: "critical", explanation: "Delegate calls restricted by AllowedCalls. Always rejected through the Key Manager (DelegateCallDisallowedViaKeyManager)." },
  DEPLOY: { risk: "medium", explanation: "Can deploy new contracts from the profile (CREATE/CREATE2); funding them needs SUPER_TRANSFERVALUE." },
  SUPER_SETDATA: { risk: "high", explanation: "Can write ANY ERC725Y data key of the profile (profile metadata, received-asset lists …) except permission/extension/URD keys." },
  SETDATA: { risk: "medium", explanation: "Can write ERC725Y data keys, restricted to its AllowedERC725YDataKeys." },
  ENCRYPT: { risk: "low", explanation: "Reserved for encryption on behalf of the profile (not enforced on-chain)." },
  DECRYPT: { risk: "low", explanation: "Reserved for decryption on behalf of the profile (not enforced on-chain)." },
  SIGN: { risk: "high", explanation: "Can sign messages that the profile validates via ERC-1271 (logins, off-chain orders, Permit2-style approvals that can move assets)." },
  EXECUTE_RELAY_CALL: { risk: "low", explanation: "Can authorise gasless relay calls (LSP25) that a relayer submits; the payload still needs its own permissions." },
  _4337_PERMISSION: { risk: "medium", explanation: "Can sign ERC-4337 UserOperations for the profile via Extension4337 (opt-in module); bounded by the EntryPoint's own permissions." },
};

const MAX256 = (1n << 256n) - 1n;

export function toBytes32(v: bigint): Hex {
  if (v < 0n || v > MAX256) throw new Error("permission value out of bytes32 range");
  return ("0x" + v.toString(16).padStart(64, "0")) as Hex;
}

/** Normalises a permission name (case-insensitive, aliases). Throws on unknown names. */
export function parsePermissionName(raw: string): PermissionName {
  const s = raw.trim().toUpperCase().replace(/[\s-]/g, "_");
  if ((PERMISSION_BITS as Record<string, number>)[s] !== undefined) return s as PermissionName;
  if (s === "_4337_PERMISSION") return "_4337_PERMISSION";
  const alias = PERMISSION_ALIASES[s] ?? PERMISSION_ALIASES[s.replace(/_/g, "")];
  if (alias) return alias;
  throw new Error(`unknown LSP6 permission "${raw}" (known: ${PERMISSION_NAMES.join(", ")})`);
}

/**
 * Encodes permission names (and optional raw base value) into a bytes32 hex.
 * "ALL_PERMISSIONS" expands to the LSP6 constant 0x7f3f7f.
 */
export function encodePermissions(names: Iterable<string>, base: bigint | Hex = 0n): Hex {
  let v = typeof base === "bigint" ? base : BigInt(base === "0x" ? 0 : base);
  for (const raw of names) {
    if (raw.trim().toUpperCase() === "ALL_PERMISSIONS") {
      v |= ALL_PERMISSIONS;
      continue;
    }
    v |= PERMISSIONS[parsePermissionName(raw)];
  }
  return toBytes32(v);
}

export interface DecodedPermissions {
  hex: Hex;
  value: bigint;
  names: PermissionName[];
  /** Bits set that LSP6 (and Extension4337) do not define — preserved, never dropped. */
  unknownBits: number[];
  /** Highest risk among the set bits. */
  risk: Risk | "none";
  isAdmin: boolean;
  /** True when the value equals the LSP6 ALL_PERMISSIONS constant exactly. */
  isAllPermissions: boolean;
}

const RISK_ORDER: Record<Risk, number> = { low: 1, medium: 2, high: 3, critical: 4 };

export function decodePermissions(value: Hex | bigint | undefined | null): DecodedPermissions {
  const v = value === undefined || value === null || value === "0x" ? 0n : typeof value === "bigint" ? value : BigInt(value);
  const names: PermissionName[] = [];
  for (const n of PERMISSION_NAMES) if (v & PERMISSIONS[n]) names.push(n);
  const unknownBits: number[] = [];
  for (let b = 24; b < 256; b++) if (v & (1n << BigInt(b))) unknownBits.push(b);
  let risk: Risk | "none" = "none";
  for (const n of names) {
    const r = PERMISSION_INFO[n].risk;
    if (risk === "none" || RISK_ORDER[r] > RISK_ORDER[risk]) risk = r;
  }
  if (unknownBits.length && (risk === "none" || RISK_ORDER[risk] < RISK_ORDER.high)) risk = "high";
  return { hex: toBytes32(v), value: v, names, unknownBits, risk, isAdmin: (v & ADMIN_PERMISSIONS) !== 0n, isAllPermissions: v === ALL_PERMISSIONS };
}

export function hasPermission(value: Hex | bigint | undefined | null, required: PermissionName | bigint): boolean {
  const v = value === undefined || value === null || value === "0x" ? 0n : typeof value === "bigint" ? value : BigInt(value);
  const r = typeof required === "bigint" ? required : PERMISSIONS[required];
  return (v & r) === r;
}

export function describePermissions(value: Hex | bigint): PermissionInfo[] {
  return decodePermissions(value).names.map((n) => ({ name: n, bit: PERMISSION_BITS[n], hex: toBytes32(PERMISSIONS[n]), ...PERMISSION_INFO[n] }));
}

/** One line per permission, plain language, for confirmation blocks and the hand-over text. */
export function explainPermissions(value: Hex | bigint): string[] {
  const d = decodePermissions(value);
  const lines = describePermissions(value).map((p) => `${p.name} [${p.risk}]: ${p.explanation}`);
  for (const b of d.unknownBits) lines.push(`bit ${b} [unknown]: not defined by LSP6 — preserved as-is`);
  return lines;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export type PresetName = "agent-owner" | "agent-operator" | "agent-reader" | "human-admin" | "entrypoint-4337" | "urd";

export interface Preset {
  name: PresetName;
  permissions: bigint;
  summary: string;
  use: string;
  /** Default AllowedCalls proposed with the preset (the human confirms or edits). */
  allowedCalls?: AllowedCall[];
  /** Default AllowedERC725YDataKeys proposed with the preset. */
  allowedDataKeys?: Hex[];
  notes: string[];
}

const P = PERMISSIONS;

/**
 * Standard-restricted AllowedCalls entries for LSP7/LSP8 tokens (any token contract, any function,
 * CALL + STATICCALL). One entry per interface id that deployed tokens report, so a scoped agent can
 * use existing tokens, not only the newest ones:
 *   LSP7 0xc52d6008 — current (LSP7MintableInit 0.17.3 / 0.19.0 report it, verified on chain)
 *   LSP7 0xb3c4928f — canonical lsp-smart-contracts 0.14.0 tokens (LSP7MintableInit 0.14.0, verified on chain)
 *   LSP7 0xdaa746b7 — 0.12.x tokens (_INTERFACEID_LSP7_V0_12_0 in LSP7Constants.sol)
 *   LSP8 0x3a271706 — current and canonical 0.14.0 tokens (LSP8MintableInit 0.14.0 / 0.17.3 / 0.19.0, verified on chain)
 *   LSP8 0xecad9f75 — _INTERFACEID_LSP8_V0_14_0 in LSP8Constants.sol (lsp8-contracts package line)
 *   LSP8 0x30dc5278 — 0.12.x tokens (_INTERFACEID_LSP8_V0_12_0 in LSP8Constants.sol)
 * Still least-privilege: only contracts that answer ERC-165 for one of these token standards.
 */
export const TOKEN_INTERFACE_IDS = {
  lsp7: [INTERFACE_IDS.LSP7DigitalAsset, INTERFACE_IDS.LSP7DigitalAsset_v0_14, INTERFACE_IDS.LSP7DigitalAsset_v0_12],
  lsp8: [INTERFACE_IDS.LSP8IdentifiableDigitalAsset, INTERFACE_IDS.LSP8IdentifiableDigitalAsset_v0_14, INTERFACE_IDS.LSP8IdentifiableDigitalAsset_v0_12],
} as const;

export const TOKEN_STANDARD_ALLOWED_CALLS: AllowedCall[] = [...TOKEN_INTERFACE_IDS.lsp7, ...TOKEN_INTERFACE_IDS.lsp8].map((standard) => ({
  callTypes: CALLTYPE.CALL | CALLTYPE.STATICCALL,
  address: WILDCARD_ADDRESS,
  standard,
  selector: WILDCARD_BYTES4,
}));

export const PRESETS: Record<PresetName, Preset> = {
  "agent-owner": {
    name: "agent-owner",
    permissions: ALL_PERMISSIONS,
    summary: "Full control (LSP6 ALL_PERMISSIONS = 0x7f3f7f): everything except REENTRANCY, DELEGATECALL and SUPER_DELEGATECALL.",
    use: "Agent-deployed profile (J1): the agent is the main controller. Add a human controller early for recovery.",
    notes: ["Includes EXECUTE_RELAY_CALL and SIGN.", "Does not include the ERC-4337 bit (opt-in module)."],
  },
  "agent-operator": {
    name: "agent-operator",
    permissions: P.CALL | P.STATICCALL | P.TRANSFERVALUE | P.SETDATA | P.SIGN | P.EXECUTE_RELAY_CALL,
    summary: "Scoped agent: CALL, STATICCALL, TRANSFERVALUE, SETDATA, SIGN, EXECUTE_RELAY_CALL — calls/value only to AllowedCalls, data only to AllowedERC725YDataKeys.",
    use: "Relayer-created or any existing profile (J2): the recommended set the agent hands to the human.",
    allowedCalls: TOKEN_STANDARD_ALLOWED_CALLS,
    allowedDataKeys: [],
    notes: [
      "Cannot add/edit controllers, change ownership, extensions or receiver delegates.",
      "Native value can only go to addresses listed in AllowedCalls (with the VALUE call type).",
      "SETDATA is effective only for the data keys listed in AllowedERC725YDataKeys (none by default).",
      "Add the ERC-4337 bit only if the user explicitly wants the opt-in 4337 module.",
    ],
  },
  "agent-reader": {
    name: "agent-reader",
    permissions: P.STATICCALL | P.SIGN,
    summary: "Read-only/quoting agent: STATICCALL (+ AllowedCalls) and SIGN.",
    use: "Agents that only read through the profile or sign off-chain messages (e.g. logins).",
    allowedCalls: TOKEN_STANDARD_ALLOWED_CALLS.map((c) => ({ ...c, callTypes: CALLTYPE.STATICCALL })),
    notes: ["SIGN still lets it sign ERC-1271 messages for the profile — drop SIGN if not needed."],
  },
  "human-admin": {
    name: "human-admin",
    permissions: ALL_PERMISSIONS,
    summary: "Full control (ALL_PERMISSIONS) for a human co-controller — the recovery path of an agent-deployed profile.",
    use: "Add the human's own address right after deployment (J1 step 6).",
    notes: ["Grants permissions to an address; no key is shared."],
  },
  "entrypoint-4337": {
    name: "entrypoint-4337",
    permissions: P.CALL | P.TRANSFERVALUE | P.STATICCALL | P.SETDATA,
    summary: "ERC-4337 EntryPoint as controller: CALL, TRANSFERVALUE, STATICCALL, SETDATA mirroring the agent's AllowedCalls/AllowedERC725YDataKeys.",
    use: "Granted to the EntryPoint address when the user explicitly enables the 4337 module.",
    notes: ["Never grant CHANGEOWNER, ADDCONTROLLER, EDITPERMISSIONS or ADDEXTENSIONS to the EntryPoint."],
  },
  urd: {
    name: "urd",
    permissions: URD_PERMISSIONS,
    summary: "Universal Receiver Delegate: SUPER_SETDATA + REENTRANCY (LUKSO default) so it can maintain LSP5/LSP10 lists.",
    use: "Set automatically for the LSP1 delegate at deployment.",
    notes: [],
  },
};

export function getPreset(name: string): Preset {
  const p = (PRESETS as Record<string, Preset>)[name];
  if (!p) throw new Error(`unknown preset "${name}" (known: ${Object.keys(PRESETS).join(", ")})`);
  return p;
}

/** Permissions that must never be granted to an ERC-4337 EntryPoint controller. */
export const FORBIDDEN_FOR_ENTRYPOINT = P.CHANGEOWNER | P.ADDCONTROLLER | P.EDITPERMISSIONS | P.ADDEXTENSIONS | P.CHANGEEXTENSIONS;

/** Warnings for a permission value about to be granted. */
export function grantWarnings(value: bigint): string[] {
  const w: string[] = [];
  if (value === 0n) w.push("no permission bit set: the address would not be a controller");
  if (value & (P.DELEGATECALL | P.SUPER_DELEGATECALL)) w.push("DELEGATECALL bits are always rejected through the Key Manager; granting them has no effect via the KM but is dangerous if ownership ever changes");
  if (value & P.REENTRANCY) w.push("REENTRANCY lets this controller re-enter during executions; normally only the Universal Receiver Delegate needs it");
  if (value & ADMIN_PERMISSIONS) w.push("this grants control over who controls the profile (CHANGEOWNER/ADDCONTROLLER/EDITPERMISSIONS)");
  if (value & (P.SUPER_CALL | P.SUPER_TRANSFERVALUE)) w.push("SUPER_CALL/SUPER_TRANSFERVALUE bypass AllowedCalls: any contract call / any value transfer");
  if (value & ~((1n << 24n) - 1n)) w.push("bits above 23 are not defined by LSP6");
  return w;
}
