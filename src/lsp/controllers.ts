// Controller lifecycle as pure ERC725Y write sets (account-execution-plan §4):
//   add    → AddressPermissions[] length+1, AddressPermissions[n] = addr, Permissions:<addr>, optional AllowedCalls/Keys
//   edit   → Permissions:<addr> and/or AllowedCalls/AllowedERC725YDataKeys (replace)
//   remove → clear Permissions/AllowedCalls/AllowedKeys, swap-with-last + shrink AddressPermissions[]
// plus the "last admin" guard and the hand-over recommendation for J2/any existing profile.
import { encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { UpError } from "../core/errors.ts";
import { UP_ABI } from "./abis.ts";
import { ADMIN_PERMISSIONS, DATA_KEYS, PERMISSIONS, allowedCallsKey, allowedDataKeysKey, permissionsArrayIndexKey, permissionsKey, uint128Hex } from "./constants.ts";
import { decodePermissions, explainPermissions, getPreset, grantWarnings, toBytes32, type PresetName } from "./permissions.ts";
import { describeAllowedCall, encodeAllowedCalls, encodeAllowedDataKeys, normaliseAllowedCall, validateAllowedCall, type AllowedCall, type AllowedCallInput } from "./allowed.ts";
import type { ControllerInfo } from "./profile.ts";

export interface ControllerState {
  length: bigint;
  controllers: ControllerInfo[];
  /** raw AddressPermissions[i] values that are not addresses */
  invalidEntries?: { index: number; value: Hex }[];
  truncated?: boolean;
}

export interface ControllerSpec {
  permissions?: bigint;
  /** undefined = leave unchanged, [] = clear */
  allowedCalls?: (AllowedCall | AllowedCallInput)[];
  /** undefined = leave unchanged, [] = clear */
  allowedDataKeys?: string[];
}

export interface WriteSet {
  keys: Hex[];
  values: Hex[];
  payload: Hex;
  summary: Record<string, unknown>;
  warnings: string[];
}

export function setDataPayload(keys: Hex[], values: Hex[]): Hex {
  if (keys.length !== values.length || keys.length === 0) throw new UpError("BAD_ARGS", "setData needs matching, non-empty keys and values");
  return keys.length === 1
    ? encodeFunctionData({ abi: UP_ABI, functionName: "setData", args: [keys[0], values[0]] })
    : encodeFunctionData({ abi: UP_ABI, functionName: "setDataBatch", args: [keys, values] });
}

function find(state: ControllerState, address: Address): ControllerInfo | undefined {
  const a = getAddress(address);
  return state.controllers.find((c) => c.address === a);
}

function allowedWrites(address: Address, spec: ControllerSpec, keys: Hex[], values: Hex[], warnings: string[], summary: Record<string, unknown>) {
  if (spec.allowedCalls !== undefined) {
    const entries = spec.allowedCalls.map((e) => normaliseAllowedCall(e));
    for (const e of entries) warnings.push(...validateAllowedCall(e).warnings.map((w) => `AllowedCalls ${describeAllowedCall(e)}: ${w}`));
    keys.push(allowedCallsKey(address));
    values.push(encodeAllowedCalls(entries));
    summary.allowedCalls = entries.length ? entries.map(describeAllowedCall) : "cleared (no calls allowed unless SUPER_CALL/SUPER_TRANSFERVALUE/SUPER_STATICCALL)";
  }
  if (spec.allowedDataKeys !== undefined) {
    keys.push(allowedDataKeysKey(address));
    values.push(encodeAllowedDataKeys(spec.allowedDataKeys));
    summary.allowedDataKeys = spec.allowedDataKeys.length ? spec.allowedDataKeys : "cleared (no data keys unless SUPER_SETDATA)";
  }
}

function finish(keys: Hex[], values: Hex[], summary: Record<string, unknown>, warnings: string[]): WriteSet {
  return { keys, values, payload: setDataPayload(keys, values), summary: { ...summary, dataKeys: keys, dataValues: values }, warnings };
}

export function buildAddController(state: ControllerState, address: Address, spec: ControllerSpec & { permissions: bigint }): WriteSet {
  const addr = getAddress(address);
  const existing = find(state, addr);
  if (existing && existing.permissions.value !== 0n) throw new UpError("BAD_ARGS", `${addr} is already a controller (${existing.permissions.names.join(", ")})`, { hint: "use: up controller edit" });
  if (spec.permissions === 0n) throw new UpError("BAD_ARGS", "refusing to add a controller with no permissions");
  const warnings = grantWarnings(spec.permissions);
  const keys: Hex[] = [];
  const values: Hex[] = [];
  const summary: Record<string, unknown> = { action: "add controller", controller: addr };
  if (!existing) {
    keys.push(DATA_KEYS["AddressPermissions[]"]);
    values.push(uint128Hex(state.length + 1n));
    keys.push(permissionsArrayIndexKey(state.length));
    values.push(addr.toLowerCase() as Hex);
    summary.arrayIndex = state.length.toString();
    summary.newArrayLength = (state.length + 1n).toString();
  } else {
    warnings.push(`${addr} is listed in AddressPermissions[] (index ${existing.index}) but has no permissions; only its permissions are set`);
  }
  keys.push(permissionsKey(addr));
  values.push(toBytes32(spec.permissions));
  const d = decodePermissions(spec.permissions);
  summary.permissions = { hex: d.hex, names: d.names, risk: d.risk };
  summary.explanation = explainPermissions(spec.permissions);
  allowedWrites(addr, spec, keys, values, warnings, summary);
  if ((spec.permissions & (PERMISSIONS.CALL | PERMISSIONS.TRANSFERVALUE | PERMISSIONS.STATICCALL)) !== 0n && !(spec.permissions & (PERMISSIONS.SUPER_CALL | PERMISSIONS.SUPER_TRANSFERVALUE | PERMISSIONS.SUPER_STATICCALL)) && !spec.allowedCalls?.length) {
    warnings.push("CALL/TRANSFERVALUE/STATICCALL without AllowedCalls entries: every call will revert with NoCallsAllowed");
  }
  if ((spec.permissions & PERMISSIONS.SETDATA) !== 0n && !(spec.permissions & PERMISSIONS.SUPER_SETDATA) && !spec.allowedDataKeys?.length) {
    warnings.push("SETDATA without AllowedERC725YDataKeys: every data write will revert with NoERC725YDataKeysAllowed");
  }
  return finish(keys, values, summary, warnings);
}

export function buildEditController(state: ControllerState, address: Address, spec: ControllerSpec): WriteSet {
  const addr = getAddress(address);
  const existing = find(state, addr);
  const current = existing?.permissions.value ?? 0n;
  if (current === 0n) throw new UpError("BAD_ARGS", `${addr} is not a controller on this chain`, { hint: "use: up controller add" });
  if (spec.permissions === undefined && spec.allowedCalls === undefined && spec.allowedDataKeys === undefined) throw new UpError("BAD_ARGS", "nothing to change: pass --preset/--permissions/--add/--remove, --allowed-calls or --allowed-keys");
  const keys: Hex[] = [];
  const values: Hex[] = [];
  const warnings: string[] = [];
  const summary: Record<string, unknown> = { action: "edit controller", controller: addr, before: { hex: existing!.permissions.hex, names: existing!.permissions.names } };
  if (spec.permissions !== undefined) {
    if (spec.permissions === 0n) throw new UpError("BAD_ARGS", "setting permissions to zero removes the controller only half-way", { hint: "use: up controller remove" });
    warnings.push(...grantWarnings(spec.permissions & ~current));
    keys.push(permissionsKey(addr));
    values.push(toBytes32(spec.permissions));
    const d = decodePermissions(spec.permissions);
    summary.after = { hex: d.hex, names: d.names, risk: d.risk };
    summary.added = decodePermissions(spec.permissions & ~current).names;
    summary.removed = decodePermissions(current & ~spec.permissions).names;
    summary.explanation = explainPermissions(spec.permissions);
  }
  allowedWrites(addr, spec, keys, values, warnings, summary);
  return finish(keys, values, summary, warnings);
}

export function buildRemoveController(state: ControllerState, address: Address): WriteSet {
  const addr = getAddress(address);
  const existing = find(state, addr);
  if (!existing || (existing.permissions.value === 0n && existing.index === undefined)) throw new UpError("BAD_ARGS", `${addr} is not a controller on this chain`);
  if (state.truncated) throw new UpError("NOT_SUPPORTED", "the controller list is too long to rewrite safely in one step");
  const keys: Hex[] = [];
  const values: Hex[] = [];
  const warnings: string[] = [];
  const summary: Record<string, unknown> = { action: "remove controller", controller: addr, before: { hex: existing.permissions.hex, names: existing.permissions.names } };
  if (existing.index !== undefined) {
    const last = Number(state.length) - 1;
    if (existing.index !== last) {
      const lastEntry = state.controllers.find((c) => c.index === last);
      const lastRaw = lastEntry ? (lastEntry.address.toLowerCase() as Hex) : state.invalidEntries?.find((e) => e.index === last)?.value;
      if (lastRaw === undefined) throw new UpError("INTERNAL", `cannot read AddressPermissions[${last}]`);
      keys.push(permissionsArrayIndexKey(existing.index));
      values.push(lastRaw);
      summary.moved = { from: last, to: existing.index, value: lastRaw };
    }
    keys.push(permissionsArrayIndexKey(last));
    values.push("0x");
    keys.push(DATA_KEYS["AddressPermissions[]"]);
    values.push(uint128Hex(BigInt(last)));
    summary.newArrayLength = String(last);
  } else warnings.push(`${addr} has permissions but is not listed in AddressPermissions[]; only its permission keys are cleared`);
  keys.push(permissionsKey(addr), allowedCallsKey(addr), allowedDataKeysKey(addr));
  values.push("0x", "0x", "0x");
  return finish(keys, values, summary, warnings);
}

/** Admin = can change control (CHANGEOWNER / ADDCONTROLLER / EDITPERMISSIONS). */
export function adminControllers(state: ControllerState, override?: { address: Address; permissions: bigint | null }): Address[] {
  const out: Address[] = [];
  for (const c of state.controllers) {
    const p = override && c.address === getAddress(override.address) ? override.permissions : c.permissions.value;
    if (p !== null && (p & ADMIN_PERMISSIONS) !== 0n) out.push(c.address);
  }
  return out;
}

/** True when the change leaves no controller that can change control while one existed before. */
export function wouldLockProfile(state: ControllerState, change: { address: Address; permissions: bigint | null }): boolean {
  const before = adminControllers(state);
  if (before.length === 0) return false;
  return adminControllers(state, change).length === 0;
}

export function requireLockApproval(approval: string | undefined): void {
  if (!approval || !/last admin|lock/i.test(approval)) {
    throw new UpError("CONSENT_REQUIRED", "this change removes the LAST controller that can change permissions or ownership: nobody could ever add, edit or recover controllers again", {
      hint: 'only proceed if the human explicitly accepts this; pass their words with --approval and they must say so explicitly, e.g. --approval "I understand this removes the last admin controller and locks the profile"',
    });
  }
}

// ---------------------------------------------------------------------------
// Recommendation (J2 / any existing profile)
// ---------------------------------------------------------------------------

export interface RecommendationOptions {
  preset?: PresetName | string;
  /** explicit AllowedCalls (replaces the preset default) */
  allowedCalls?: (AllowedCall | AllowedCallInput)[];
  /** extra AllowedCalls appended to the preset default */
  allowTargets?: { address: string; callTypes?: string | number | string[]; selector?: string }[];
  allowedDataKeys?: string[];
  with4337?: boolean;
  extraPermissions?: bigint;
}

export interface Recommendation {
  controller: Address;
  preset: string;
  permissions: { hex: Hex; names: string[]; risk: string };
  explanation: string[];
  notAllowed: string[];
  allowedCalls: { encoded: Hex; entries: AllowedCall[]; described: string[] };
  allowedDataKeys: { encoded: Hex; keys: string[] };
  dataKeys: { permissions: Hex; allowedCalls: Hex; allowedDataKeys: Hex };
  notes: string[];
  text: string;
}

export function recommend(controller: Address, profile: Address | undefined, opts: RecommendationOptions = {}): Recommendation {
  const preset = getPreset(opts.preset ?? "agent-operator");
  let perms = preset.permissions | (opts.extraPermissions ?? 0n);
  if (opts.with4337) perms |= PERMISSIONS._4337_PERMISSION;
  const entries = (opts.allowedCalls ?? [...(preset.allowedCalls ?? []), ...(opts.allowTargets ?? []).map((t) => ({ callTypes: t.callTypes ?? ["CALL", "VALUE"], address: t.address, selector: t.selector }))]).map((e) => normaliseAllowedCall(e));
  const keys = opts.allowedDataKeys ?? (preset.allowedDataKeys ?? []);
  const d = decodePermissions(perms);
  const all = ["CHANGEOWNER", "ADDCONTROLLER", "EDITPERMISSIONS", "ADDEXTENSIONS", "CHANGEEXTENSIONS", "ADDUNIVERSALRECEIVERDELEGATE", "CHANGEUNIVERSALRECEIVERDELEGATE", "SUPER_CALL", "SUPER_TRANSFERVALUE", "SUPER_SETDATA", "DEPLOY", "REENTRANCY", "DELEGATECALL"];
  const notAllowed = all.filter((n) => !d.names.includes(n as any));
  const ctl = getAddress(controller);
  const encodedCalls = encodeAllowedCalls(entries);
  const encodedKeys = encodeAllowedDataKeys(keys);
  const lines = [
    `Please authorise the agent's controller address ${ctl}${profile ? ` on Universal Profile ${getAddress(profile)}` : ""} on every network you want it to act on.`,
    `Recommended permissions (${preset.name}): ${d.names.join(", ")}`,
    `Permission value (bytes32): ${d.hex}`,
    "What the agent CAN do:",
    ...explainPermissions(perms).map((l) => `  - ${l}`),
    `What it can NOT do: ${notAllowed.join(", ")}`,
    "Allowed calls (targets the agent may call / send value to):",
    ...(entries.length ? entries.map((e) => `  - ${describeAllowedCall(e)}`) : ["  - none"]),
    "Allowed data keys:",
    ...(keys.length ? keys.map((k) => `  - ${k}`) : ["  - none (the agent cannot write profile data)"]),
    "Enter these in the relayer dashboard or your wallet/extension (Universal Profile → controllers → add controller). Afterwards the agent verifies on-chain.",
  ];
  return {
    controller: ctl,
    preset: preset.name,
    permissions: { hex: d.hex, names: d.names, risk: d.risk },
    explanation: explainPermissions(perms),
    notAllowed,
    allowedCalls: { encoded: encodedCalls, entries, described: entries.map(describeAllowedCall) },
    allowedDataKeys: { encoded: encodedKeys, keys },
    dataKeys: { permissions: permissionsKey(ctl), allowedCalls: allowedCallsKey(ctl), allowedDataKeys: allowedDataKeysKey(ctl) },
    notes: [...preset.notes, "These limits are enforced on-chain by the LSP6 Key Manager. Spending caps and time limits are NOT enforceable by LSP6; the skill enforces them client-side (policy.json).", "Your own controller keeps its rights; the agent never removes other controllers."],
    text: lines.join("\n"),
  };
}
