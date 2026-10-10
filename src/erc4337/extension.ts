// Extension4337 lifecycle on a Universal Profile (erc4337-plan §4):
//  - deterministic deployment of Extension4337(entryPoint) through Nick's factory
//    with the documented salt (same address on every chain for the same EntryPoint);
//  - status: EntryPoint present, extension deployed + linked, EntryPoint controller
//    permissions, signer bit 23, deposit;
//  - enable/disable as one setDataBatch on the profile (routed through
//    executeAsProfile, default via the Key Manager), with idempotent steps.
import { encodeFunctionData, getAddress, keccak256, size, type Address, type Hex } from "viem";
import type { Signer, VerbContext } from "../core/types.ts";
import { UpError } from "../core/errors.ts";
import { loadPolicy, policyAllows } from "../core/policy.ts";
import { executeAsProfile, OPERATION, type ExecOutcome, type ExecPath, type ExecRequest } from "../exec/transport.ts";
import { sendTx, type TxOutcome } from "../chain/tx.ts";
import {
  ENTRYPOINT_ALLOWED_PERMISSIONS,
  ENTRYPOINT_FORBIDDEN_PERMISSIONS,
  DUMMY_SIGNATURE,
  ENTRYPOINT_V06,
  EXTENSION_4337_KEY,
  KM_ABI,
  P,
  PERMISSION_4337,
  UP_ABI,
  entryPoint06Abi,
  extension4337Abi,
  type PermissionName,
} from "./constants.ts";
import { extensionAddressFor, extensionAsset, extensionInitCode, extensionRuntimeHashFor } from "./bytecode.ts";
import { deployEntryPoint, deployViaNick, depositOf, depositToCalldata, entryPointStatus, getNonce, nickFactoryGap, nickFactoryStatus, nonceKeyFor, withdrawToCalldata, type DeployResult, type EntryPointStatus, type FactoryStatus } from "./entrypoint.ts";
import {
  allowedCallsKey,
  allowedDataKeysKey,
  arrayIndexKey,
  arrayLengthKey,
  decodeAllowedCalls,
  decodeCompactBytesArray,
  encodeAllowedCalls,
  encodeAllowedDataKeys,
  encodeArrayLength,
  encodePermissions,
  getDataBatch,
  indexOfController,
  permissionNames,
  permissionsFromNames,
  permissionsKey,
  readController,
  readControllerArray,
  type AllowedCallInput,
  type ControllerArray,
  type ControllerData,
} from "./lsp6.ts";
import { getCode, read, tryCall } from "./rpc.ts";
import { simulateValidation, type UserOperationV06 } from "./userop.ts";
import { explainAA } from "./aa-errors.ts";

// ---------------------------------------------------------------------------
// Profile resolution
// ---------------------------------------------------------------------------

export interface ProfileInfo {
  profile: Address;
  owner: Address;
  keyManager: Address;
}

/** The profile must exist on the chain and be owned by an LSP6 Key Manager whose target() is the profile. */
export async function resolveProfile(ctx: VerbContext, chainId: number, profile: Address): Promise<ProfileInfo> {
  const code = await getCode(ctx, chainId, profile);
  if (code === "0x") throw new UpError("NOT_DEPLOYED", `no Universal Profile at ${profile} on chain ${chainId}`, { hint: "check --profile/--chain; deploy the profile on this chain first" });
  let owner: Address;
  try {
    owner = getAddress(await read<Address>(ctx, chainId, profile, UP_ABI, "owner"));
  } catch (e) {
    throw new UpError("NOT_SUPPORTED", `${profile} on chain ${chainId} does not look like a Universal Profile (owner() failed)`, { cause: e });
  }
  const target = await tryCall(ctx, chainId, { to: owner, data: encodeFunctionData({ abi: KM_ABI, functionName: "target" }) });
  if (!target.ok || size(target.data) < 32 || getAddress(`0x${target.data.slice(-40)}`) !== getAddress(profile)) {
    throw new UpError("NOT_SUPPORTED", `the owner of ${profile} (${owner}) is not an LSP6 Key Manager for this profile; Extension4337 validates through the owner's lsp20VerifyCall`, {
      hint: "ERC-4337 via Extension4337 needs a profile owned by its LSP6 Key Manager",
    });
  }
  return { profile: getAddress(profile), owner, keyManager: owner };
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export interface ExtensionStatus {
  /** deterministic address of the bundled Extension4337 for this EntryPoint */
  expected: Address;
  deployed: boolean;
  /** linked under LSP17Extension:0x3a871cdd (null = not set) */
  linked: Address | null;
  linkedHasCode: boolean;
  linkedEntryPoint: Address | null;
  /** the linked extension serves this EntryPoint */
  linkedMatches: boolean;
  /** the linked extension's runtime equals the bundled build */
  linkedIsBundled: boolean;
}

export interface Status4337 {
  chainId: number;
  profile: Address;
  keyManager: Address;
  entryPoint: EntryPointStatus;
  nickFactory: FactoryStatus;
  extension: ExtensionStatus;
  entryPointController: {
    address: Address;
    permissions: Hex;
    permissionNames: PermissionName[];
    isController: boolean;
    inArray: boolean;
    arrayIndex: number;
    allowedCalls: ReturnType<typeof decodeAllowedCalls>;
    allowedDataKeys: Hex[];
    forbidden: PermissionName[];
  };
  signer: { address: Address; permissions: Hex; permissionNames: PermissionName[]; has4337: boolean };
  deposit: bigint;
  enabled: boolean;
  missing: string[];
  /** raw reads reused by enable/disable */
  raw: { signer: ControllerData; entryPoint: ControllerData; array: ControllerArray };
}

export async function status4337(ctx: VerbContext, chainId: number, profile: Address, signerAddress: Address, entryPoint: Address = ENTRYPOINT_V06): Promise<Status4337> {
  const prof = await resolveProfile(ctx, chainId, profile);
  const [ep, nick] = await Promise.all([entryPointStatus(ctx, chainId, entryPoint), nickFactoryStatus(ctx, chainId)]);
  const expected = extensionAddressFor(entryPoint);
  const [expectedCode, [linkedRaw], signerData, epData, array] = await Promise.all([
    getCode(ctx, chainId, expected),
    getDataBatch(ctx, chainId, prof.profile, [EXTENSION_4337_KEY]),
    readController(ctx, chainId, prof.profile, signerAddress),
    readController(ctx, chainId, prof.profile, entryPoint),
    readControllerArray(ctx, chainId, prof.profile),
  ]);
  const linked = linkedRaw && size(linkedRaw) >= 20 ? getAddress(linkedRaw.slice(0, 42)) : null;
  let linkedHasCode = false;
  let linkedEntryPoint: Address | null = null;
  let linkedIsBundled = false;
  if (linked) {
    const code = await getCode(ctx, chainId, linked);
    linkedHasCode = code !== "0x";
    if (linkedHasCode) {
      const r = await tryCall(ctx, chainId, { to: linked, data: encodeFunctionData({ abi: extension4337Abi(), functionName: "entryPoint" }) });
      if (r.ok && size(r.data) >= 32) linkedEntryPoint = getAddress(`0x${r.data.slice(-40)}`);
      const want = extensionRuntimeHashFor(entryPoint);
      linkedIsBundled = want !== undefined && keccak256(code) === want;
    }
  }
  const linkedMatches = linkedHasCode && linkedEntryPoint?.toLowerCase() === entryPoint.toLowerCase();
  const idx = indexOfController(array, entryPoint);
  const epNames = permissionNames(epData.permissions);
  const forbidden = epNames.filter((n) => ENTRYPOINT_FORBIDDEN_PERMISSIONS.includes(n));
  const has4337 = (signerData.permissions & PERMISSION_4337) !== 0n;
  const deposit = ep.deployed ? await depositOf(ctx, chainId, prof.profile, entryPoint) : 0n;

  const missing: string[] = [];
  if (!ep.deployed) missing.push("entrypoint-deployment");
  else if (!ep.canonical) missing.push("entrypoint-not-canonical");
  if (!linked) missing.push(expectedCode === "0x" ? "extension-deployment" : "extension-link");
  else if (!linkedMatches) missing.push("extension-link");
  if (epData.permissions === 0n) missing.push("entrypoint-permissions");
  if (!has4337) missing.push("signer-4337-permission");
  const enabled = missing.length === 0;
  if (enabled && deposit === 0n) missing.push("deposit");

  return {
    chainId,
    profile: prof.profile,
    keyManager: prof.keyManager,
    entryPoint: ep,
    nickFactory: nick,
    extension: { expected, deployed: expectedCode !== "0x", linked, linkedHasCode, linkedEntryPoint, linkedMatches, linkedIsBundled },
    entryPointController: {
      address: getAddress(entryPoint),
      permissions: encodePermissions(epData.permissions),
      permissionNames: epNames,
      isController: epData.permissions !== 0n,
      inArray: idx >= 0,
      arrayIndex: idx,
      allowedCalls: safe(() => decodeAllowedCalls(epData.allowedCalls), []),
      allowedDataKeys: safe(() => decodeCompactBytesArray(epData.allowedDataKeys), []),
      forbidden,
    },
    signer: { address: getAddress(signerAddress), permissions: encodePermissions(signerData.permissions), permissionNames: permissionNames(signerData.permissions), has4337 },
    deposit,
    enabled,
    missing,
    raw: { signer: signerData, entryPoint: epData, array },
  };
}

function safe<T>(f: () => T, fallback: T): T {
  try {
    return f();
  } catch {
    return fallback;
  }
}

/** One-line next step for the first missing item. */
export function hintForMissing(s: Pick<Status4337, "missing" | "chainId">): string {
  const m = s.missing[0];
  const c = s.chainId;
  switch (m) {
    case "entrypoint-deployment":
      return `EntryPoint v0.6 is missing on chain ${c}; on explicit user request run: up account 4337 enable --chain ${c} (deploys it via Nick's factory)`;
    case "entrypoint-not-canonical":
      return `the code at the EntryPoint v0.6 address on chain ${c} is not canonical; ERC-4337 cannot be used there`;
    case "extension-deployment":
    case "extension-link":
    case "entrypoint-permissions":
    case "signer-4337-permission":
      return `ERC-4337 is opt-in and not enabled for this profile on chain ${c} (${s.missing.join(", ")}); only if the user explicitly wants it: up account 4337 enable --chain ${c}`;
    case "deposit":
      return `fund the profile's EntryPoint deposit: up account 4337 deposit --chain ${c} --amount <value>`;
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// EntryPoint controller scope (preset "entrypoint-4337")
// ---------------------------------------------------------------------------

export type EpScopeMode = "mirror" | "super" | "custom";

export interface EpScopeOptions {
  /** undefined: keep an existing EntryPoint controller as is, else "mirror" */
  scope?: EpScopeMode;
  permissions?: string[];
  allowedCalls?: AllowedCallInput[];
  allowedDataKeys?: string[];
}

export interface EpScope {
  mode: EpScopeMode | "keep";
  permissions: bigint;
  allowedCalls: Hex;
  allowedDataKeys: Hex;
  warnings: string[];
}

const PAIRS: [PermissionName, PermissionName, "calls" | "keys"][] = [
  ["CALL", "SUPER_CALL", "calls"],
  ["TRANSFERVALUE", "SUPER_TRANSFERVALUE", "calls"],
  ["STATICCALL", "SUPER_STATICCALL", "calls"],
  ["SETDATA", "SUPER_SETDATA", "keys"],
];

const SUPER_SCOPE = P.SUPER_CALL | P.SUPER_TRANSFERVALUE | P.SUPER_STATICCALL | P.SUPER_SETDATA;

function scopeOptionsHint(): string {
  return "choose explicitly: --ep-scope super (EntryPoint gets SUPER_CALL, SUPER_TRANSFERVALUE, SUPER_STATICCALL, SUPER_SETDATA; every 4337 signer stays bounded by its own permissions) or --ep-scope custom --ep-permissions CALL,TRANSFERVALUE --ep-allowed-calls '[{\"callTypes\":[\"CALL\",\"VALUE\"],\"address\":\"0x…\"}]'";
}

/**
 * Computes the EntryPoint controller permissions. Default "mirror": CALL/TRANSFERVALUE/STATICCALL/SETDATA where the
 * signer holds the plain or SUPER variant, restricted by the signer's own AllowedCalls/AllowedERC725YDataKeys
 * (SUPER_* is never mirrored implicitly). Never grants CHANGEOWNER/ADDCONTROLLER/EDITPERMISSIONS/extensions/URD/DELEGATECALL/REENTRANCY.
 */
export function computeEntryPointScope(opts: EpScopeOptions, signer: ControllerData, current: ControllerData): EpScope {
  const warnings: string[] = [];
  if (!opts.scope && current.permissions !== 0n) {
    const forbidden = permissionNames(current.permissions).filter((n) => ENTRYPOINT_FORBIDDEN_PERMISSIONS.includes(n));
    if (forbidden.length) warnings.push(`the EntryPoint controller currently holds ${forbidden.join(", ")}, which the skill never grants to it; reset with --ep-scope mirror|super|custom`);
    return { mode: "keep", permissions: current.permissions, allowedCalls: current.allowedCalls, allowedDataKeys: current.allowedDataKeys, warnings };
  }
  const mode = opts.scope ?? "mirror";
  if (mode === "super") {
    warnings.push("EntryPoint receives SUPER_CALL, SUPER_TRANSFERVALUE, SUPER_STATICCALL and SUPER_SETDATA (explicit request); every 4337 signer remains bounded by its own LSP6 permissions");
    return { mode, permissions: SUPER_SCOPE, allowedCalls: "0x", allowedDataKeys: "0x", warnings };
  }
  if (mode === "custom") {
    if (!opts.permissions?.length) throw new UpError("BAD_ARGS", "--ep-scope custom needs --ep-permissions (e.g. CALL,TRANSFERVALUE,STATICCALL,SETDATA)");
    const bits = permissionsFromNames(opts.permissions);
    const bad = permissionNames(bits).filter((n) => !ENTRYPOINT_ALLOWED_PERMISSIONS.includes(n));
    if (bad.length) throw new UpError("BAD_ARGS", `the EntryPoint controller may never hold ${bad.join(", ")}`, { hint: `allowed: ${ENTRYPOINT_ALLOWED_PERMISSIONS.join(", ")}` });
    const allowedCalls = opts.allowedCalls?.length ? encodeAllowedCalls(opts.allowedCalls) : "0x";
    const allowedDataKeys = opts.allowedDataKeys?.length ? encodeAllowedDataKeys(opts.allowedDataKeys) : "0x";
    for (const [plain, sup, list] of PAIRS) {
      if (bits & P[plain] && !(bits & P[sup]) && (list === "calls" ? allowedCalls : allowedDataKeys) === "0x") {
        throw new UpError("BAD_ARGS", `${plain} without ${list === "calls" ? "--ep-allowed-calls" : "--ep-allowed-keys"} allows nothing (LSP6 requires an allow-list for non-SUPER permissions)`);
      }
    }
    return { mode, permissions: bits, allowedCalls, allowedDataKeys, warnings };
  }
  // mirror
  let bits = 0n;
  const dropped: string[] = [];
  const unmirrored: string[] = [];
  for (const [plain, sup, list] of PAIRS) {
    const has = (signer.permissions & (P[plain] | P[sup])) !== 0n;
    if (!has) continue;
    if (signer.permissions & P[sup]) unmirrored.push(sup);
    const listVal = list === "calls" ? signer.allowedCalls : signer.allowedDataKeys;
    if (!listVal || listVal === "0x") dropped.push(plain);
    else bits |= P[plain];
  }
  if (bits === 0n) {
    throw new UpError("BAD_ARGS", `cannot mirror the signer's scope onto the EntryPoint: the signer ${signer.address} ${unmirrored.length ? `uses unrestricted ${unmirrored.join(", ")} (never mirrored implicitly)` : "has no CALL/TRANSFERVALUE/STATICCALL/SETDATA permission"} and no AllowedCalls/AllowedERC725YDataKeys to copy`, {
      hint: scopeOptionsHint(),
    });
  }
  if (dropped.length) warnings.push(`not granted to the EntryPoint (the signer has no allow-list to mirror): ${dropped.join(", ")}`);
  if (unmirrored.length) warnings.push(`the signer's ${unmirrored.join(", ")} was mirrored as the restricted variant with its allow-lists`);
  return {
    mode: "mirror",
    permissions: bits,
    allowedCalls: bits & (P.CALL | P.TRANSFERVALUE | P.STATICCALL) ? signer.allowedCalls : "0x",
    allowedDataKeys: bits & P.SETDATA ? signer.allowedDataKeys : "0x",
    warnings,
  };
}

// ---------------------------------------------------------------------------
// setDataBatch plans
// ---------------------------------------------------------------------------

export interface DataChange {
  key: Hex;
  label: string;
  from: Hex;
  to: Hex;
  /** LSP6 permission the executing controller needs for this key */
  requires: string;
}

export interface SetDataPlan {
  changes: DataChange[];
  keys: Hex[];
  values: Hex[];
  /** UP.setDataBatch calldata (also usable by a human from their own wallet/controller) */
  payload?: Hex;
}

function finalize(changes: DataChange[]): SetDataPlan {
  const real = changes.filter((c) => c.from.toLowerCase() !== c.to.toLowerCase());
  const keys = real.map((c) => c.key);
  const values = real.map((c) => c.to);
  return { changes: real, keys, values, payload: real.length ? encodeFunctionData({ abi: UP_ABI, functionName: "setDataBatch", args: [keys, values] }) : undefined };
}

export function buildEnablePlan(s: Status4337, scope: EpScope, extension: Address): SetDataPlan {
  const ep = s.entryPointController.address;
  const changes: DataChange[] = [];
  const curExt = s.extension.linked ? (s.extension.linked.toLowerCase() as Hex) : "0x";
  if (!s.extension.linkedMatches) {
    changes.push({ key: EXTENSION_4337_KEY, label: "LSP17Extension:validateUserOp(0x3a871cdd)", from: curExt, to: extension.toLowerCase() as Hex, requires: s.extension.linked ? "CHANGEEXTENSIONS" : "ADDEXTENSIONS" });
  }
  const epNew = s.raw.entryPoint.permissions === 0n;
  changes.push({ key: permissionsKey(ep), label: `AddressPermissions:Permissions:<EntryPoint>`, from: s.raw.entryPoint.permissions === 0n ? "0x" : encodePermissions(s.raw.entryPoint.permissions), to: encodePermissions(scope.permissions), requires: epNew ? "ADDCONTROLLER" : "EDITPERMISSIONS" });
  changes.push({ key: allowedCallsKey(ep), label: "AddressPermissions:AllowedCalls:<EntryPoint>", from: s.raw.entryPoint.allowedCalls, to: scope.allowedCalls, requires: s.raw.entryPoint.allowedCalls === "0x" ? "ADDCONTROLLER" : "EDITPERMISSIONS" });
  changes.push({ key: allowedDataKeysKey(ep), label: "AddressPermissions:AllowedERC725YDataKeys:<EntryPoint>", from: s.raw.entryPoint.allowedDataKeys, to: scope.allowedDataKeys, requires: s.raw.entryPoint.allowedDataKeys === "0x" ? "ADDCONTROLLER" : "EDITPERMISSIONS" });
  if (!s.entryPointController.inArray) {
    const n = s.raw.array.length;
    changes.push({ key: arrayIndexKey(n), label: `AddressPermissions[${n}]`, from: "0x", to: ep.toLowerCase() as Hex, requires: "ADDCONTROLLER" });
    changes.push({ key: arrayLengthKey, label: "AddressPermissions[] length", from: n === 0n ? "0x" : encodeArrayLength(n), to: encodeArrayLength(n + 1n), requires: "ADDCONTROLLER" });
  }
  const sp = s.raw.signer.permissions;
  if ((sp & PERMISSION_4337) === 0n) {
    if (sp === 0n) throw new UpError("NOT_AUTHORISED", `${s.signer.address} is not a controller of ${s.profile} on chain ${s.chainId}; the 4337 permission can only be added to an existing controller`);
    changes.push({ key: permissionsKey(s.signer.address), label: "AddressPermissions:Permissions:<signer> (+ bit 23 _4337_PERMISSION)", from: encodePermissions(sp), to: encodePermissions(sp | PERMISSION_4337), requires: "EDITPERMISSIONS" });
  }
  return finalize(changes);
}

export function buildDisablePlan(s: Status4337, opts: { keepSignerPermission?: boolean } = {}): SetDataPlan & { warnings: string[] } {
  const ep = s.entryPointController.address;
  const changes: DataChange[] = [];
  const warnings: string[] = [];
  if (s.extension.linked) changes.push({ key: EXTENSION_4337_KEY, label: "LSP17Extension:validateUserOp(0x3a871cdd)", from: s.extension.linked.toLowerCase() as Hex, to: "0x", requires: "CHANGEEXTENSIONS" });
  if (s.raw.entryPoint.permissions !== 0n) changes.push({ key: permissionsKey(ep), label: "AddressPermissions:Permissions:<EntryPoint>", from: encodePermissions(s.raw.entryPoint.permissions), to: "0x", requires: "EDITPERMISSIONS" });
  if (s.raw.entryPoint.allowedCalls !== "0x") changes.push({ key: allowedCallsKey(ep), label: "AddressPermissions:AllowedCalls:<EntryPoint>", from: s.raw.entryPoint.allowedCalls, to: "0x", requires: "EDITPERMISSIONS" });
  if (s.raw.entryPoint.allowedDataKeys !== "0x") changes.push({ key: allowedDataKeysKey(ep), label: "AddressPermissions:AllowedERC725YDataKeys:<EntryPoint>", from: s.raw.entryPoint.allowedDataKeys, to: "0x", requires: "EDITPERMISSIONS" });
  const idx = s.entryPointController.arrayIndex;
  if (idx >= 0) {
    const n = Number(s.raw.array.length);
    const last = n - 1;
    if (idx !== last) {
      const moved = s.raw.array.entries[last];
      if (!moved) warnings.push(`AddressPermissions[${last}] is malformed; the EntryPoint slot ${idx} is cleared instead of swapped`);
      changes.push({ key: arrayIndexKey(idx), label: `AddressPermissions[${idx}] (swap with last)`, from: ep.toLowerCase() as Hex, to: moved ? (moved.toLowerCase() as Hex) : "0x", requires: "EDITPERMISSIONS" });
    }
    changes.push({ key: arrayIndexKey(last), label: `AddressPermissions[${last}]`, from: (s.raw.array.entries[last]?.toLowerCase() ?? "0x") as Hex, to: "0x", requires: "EDITPERMISSIONS" });
    changes.push({ key: arrayLengthKey, label: "AddressPermissions[] length", from: encodeArrayLength(BigInt(n)), to: encodeArrayLength(BigInt(n - 1)), requires: "EDITPERMISSIONS" });
  }
  if (!opts.keepSignerPermission && (s.raw.signer.permissions & PERMISSION_4337) !== 0n) {
    changes.push({ key: permissionsKey(s.signer.address), label: "AddressPermissions:Permissions:<signer> (- bit 23 _4337_PERMISSION)", from: encodePermissions(s.raw.signer.permissions), to: encodePermissions(s.raw.signer.permissions & ~PERMISSION_4337), requires: "EDITPERMISSIONS" });
  }
  return { ...finalize(changes), warnings };
}

/** eth_call KM.execute(payload) from the signer: proves the signer may apply the plan before anything is sent. */
export async function simulateProfilePayload(ctx: VerbContext, chainId: number, keyManager: Address, from: Address, payload: Hex, value = 0n) {
  return tryCall(ctx, chainId, { from, to: keyManager, data: encodeFunctionData({ abi: KM_ABI, functionName: "execute", args: [payload] }), value });
}

// ---------------------------------------------------------------------------
// Deployment of the extension
// ---------------------------------------------------------------------------

export async function deployExtension(ctx: VerbContext, signer: Signer, chainId: number, entryPoint: Address = ENTRYPOINT_V06): Promise<DeployResult> {
  const a = extensionAsset();
  return deployViaNick(ctx, signer, { chainId, name: "Extension4337", salt: a.deployment.salt, initCode: extensionInitCode(entryPoint, a), expectedRuntimeHash: extensionRuntimeHashFor(entryPoint) });
}

// ---------------------------------------------------------------------------
// Enable / disable / deposit / withdraw flows
// ---------------------------------------------------------------------------

export interface FlowStep {
  step: string;
  status: "done" | "skipped" | "dry-run" | "todo";
  detail?: unknown;
}

export interface EnableOptions extends EpScopeOptions {
  chainId: number;
  profile: Address;
  /** optional deposit amount (wei) after enabling */
  deposit?: bigint;
  depositFrom?: "profile" | "controller";
  via?: ExecPath;
  /** verb name for the consent block */
  verb?: string;
}

export interface EnableResult {
  chainId: number;
  profile: Address;
  entryPoint: Address;
  extension: Address;
  steps: FlowStep[];
  plan: SetDataPlan;
  scope: { mode: string; permissions: Hex; permissionNames: PermissionName[]; allowedCalls: unknown; allowedDataKeys: Hex[] };
  verification?: { ok: boolean; detail: string };
  status?: Status4337;
  warnings: string[];
}

const TRUST_MODEL =
  "The EntryPoint becomes a controller of the profile: anyone who can get a valid UserOperation through this EntryPoint for this profile is bounded by the EntryPoint's permissions AND by the signer's permissions (the signer additionally needs the 4337 permission, bit 23). The EntryPoint never receives CHANGEOWNER, ADDCONTROLLER, EDITPERMISSIONS or extension permissions.";

export async function enable4337(ctx: VerbContext, signer: Signer, o: EnableOptions): Promise<EnableResult> {
  const chainId = o.chainId;
  const entryPoint = ENTRYPOINT_V06;
  const warnings: string[] = [];
  const s = await status4337(ctx, chainId, o.profile, signer.address, entryPoint);
  if (s.entryPoint.deployed && !s.entryPoint.canonical) throw new UpError("NOT_SUPPORTED", `the code at ${entryPoint} on chain ${chainId} is not the canonical EntryPoint v0.6; refusing to enable`, { details: s.entryPoint });
  const needsFactory = !s.entryPoint.deployed || (!s.extension.linkedMatches && !s.extension.deployed);
  if (needsFactory && !s.nickFactory.matches) throw nickFactoryGap(chainId, s.nickFactory);
  const extension = s.extension.linkedMatches && s.extension.linked ? s.extension.linked : s.extension.expected;
  if (s.extension.linkedMatches && !s.extension.linkedIsBundled) warnings.push(`the profile already links a working Extension4337 at ${s.extension.linked} that is not the bundled build; it is kept`);
  if (s.extension.linked && !s.extension.linkedMatches) warnings.push(`the profile links ${s.extension.linked} for validateUserOp, which does not serve EntryPoint v0.6; it will be replaced by ${s.extension.expected}`);
  const scope = computeEntryPointScope(o, s.raw.signer, s.raw.entryPoint);
  warnings.push(...scope.warnings);
  const plan = buildEnablePlan(s, scope, extension);

  // Prove the signer may apply the plan before deploying anything.
  if (plan.payload) {
    const sim = await simulateProfilePayload(ctx, chainId, s.keyManager, signer.address, plan.payload);
    if (!sim.ok) {
      throw new UpError("NOT_AUTHORISED", `the controller ${signer.address} cannot apply the 4337 permission changes on ${s.profile}: ${sim.revert.message}`, {
        hint: "ask the human to apply this exact setDataBatch from a controller with ADDCONTROLLER, EDITPERMISSIONS and ADDEXTENSIONS/CHANGEEXTENSIONS (details.plan), or to grant those permissions to the agent",
        details: { plan: planView(plan), revert: sim.revert },
      });
    }
  }

  const steps: FlowStep[] = [
    { step: "deploy-entrypoint", status: s.entryPoint.deployed ? "skipped" : "todo", detail: { address: entryPoint } },
    { step: "deploy-extension", status: s.extension.linkedMatches || s.extension.deployed ? "skipped" : "todo", detail: { address: extension } },
    { step: "set-data (link extension, EntryPoint controller, signer bit 23)", status: plan.payload ? "todo" : "skipped", detail: planView(plan) },
    { step: "deposit", status: o.deposit && o.deposit > 0n ? "todo" : "skipped", detail: o.deposit ? { amount: o.deposit, from: o.depositFrom ?? "profile" } : undefined },
  ];
  const scopeView = {
    mode: scope.mode,
    permissions: encodePermissions(scope.permissions),
    permissionNames: permissionNames(scope.permissions),
    allowedCalls: safe(() => decodeAllowedCalls(scope.allowedCalls), scope.allowedCalls as unknown),
    allowedDataKeys: safe(() => decodeCompactBytesArray(scope.allowedDataKeys), []),
  };

  await ctx.consent({
    verb: o.verb ?? "account 4337 enable",
    risk: "admin",
    chainId,
    target: s.profile,
    value: o.deposit,
    summary: {
      profile: s.profile,
      trustModel: TRUST_MODEL,
      steps: steps.filter((x) => x.status === "todo").map((x) => x.step),
      entryPoint,
      extension,
      entryPointPermissions: scopeView,
      signer4337: signer.address,
      dataChanges: plan.changes.map((c) => ({ label: c.label, key: c.key, to: c.to, requires: c.requires })),
      gasPayer: `controller EOA ${signer.address} (deployments) / ${o.via ?? "km"} path (profile changes)`,
    },
  });

  const dry = ctx.flags.dryRun;
  // A profile-funded deposit is a separate "write" action of the transport; when acting under the delegated
  // policy (no human approval text) check it now, so the flow cannot stop half-way on POLICY_DENIED.
  if (steps[3].status === "todo" && (o.depositFrom ?? "profile") === "profile" && ctx.flags.yes && !ctx.flags.approval && !dry) {
    const verdict = policyAllows(await loadPolicy(ctx.home), { verb: "account 4337 deposit", risk: "write", chainId, summary: {}, target: entryPoint, selector: depositToCalldata(s.profile).slice(0, 10) as Hex, value: o.deposit });
    if (!verdict.ok) throw new UpError("POLICY_DENIED", `the requested deposit is outside the delegated policy: ${verdict.reason}`, { hint: "pass the human's approval with --approval, or enable without --deposit and deposit separately" });
  }
  const run = async (i: number, f: () => Promise<any>) => {
    try {
      const r = await f();
      steps[i] = { ...steps[i], status: dry || r?.status === "dry-run" ? "dry-run" : "done", detail: r };
    } catch (e) {
      const done = steps.filter((x) => x.status === "done").map((x) => x.step);
      if (e instanceof UpError && done.length) {
        throw new UpError(e.code, `${e.message} (4337 enable stopped at "${steps[i].step}"; completed: ${done.join(", ")})`, { hint: `fix the cause, then re-run the same enable command: completed steps are skipped. ${e.hint ?? ""}`.trim(), details: { steps, cause: e.details }, cause: e });
      }
      throw e;
    }
  };
  if (steps[0].status === "todo") await run(0, () => deployEntryPoint(ctx, signer, chainId));
  if (steps[1].status === "todo") await run(1, () => deployExtension(ctx, signer, chainId, entryPoint));
  if (steps[2].status === "todo") {
    await run(2, async () => {
      const out = await executeAsProfile(ctx, profileReq({ chainId, profile: s.profile, payload: plan.payload, description: "enable ERC-4337: link Extension4337, add EntryPoint controller, grant bit 23" }, o.verb ?? "account 4337 enable", "admin"), { via: o.via ?? "km" });
      return { ...planView(plan), outcome: execView(out), status: out.status };
    });
  }
  if (steps[3].status === "todo") {
    if (dry && !s.entryPoint.deployed) steps[3] = { ...steps[3], status: "dry-run", detail: { note: "not simulated: the EntryPoint is deployed by an earlier step" } };
    else await run(3, () => deposit4337(ctx, signer, { chainId, profile: s.profile, amount: o.deposit!, from: o.depositFrom ?? "profile", via: o.via, skipConsent: true }));
  }

  let verification: EnableResult["verification"];
  let after: Status4337 | undefined;
  if (!dry) {
    after = await status4337(ctx, chainId, s.profile, signer.address, entryPoint);
    if (!after.enabled) throw new UpError("TX_FAILED", `4337 enable finished but the profile is still missing: ${after.missing.join(", ")}`, { details: { steps } });
    verification = await verify4337(ctx, signer, chainId, s.profile, entryPoint);
    if (after.deposit === 0n) warnings.push(hintForMissing({ missing: ["deposit"], chainId }));
  }
  return { chainId, profile: s.profile, entryPoint, extension, steps, plan, scope: scopeView, verification, status: after, warnings };
}

/**
 * Wiring check through the real EntryPoint WITHOUT signing anything: simulateValidation of a probe op that carries
 * the dummy signature. A ValidationResult (sigFailed expected) proves EntryPoint → profile → LSP17 → Extension4337
 * bound to this EntryPoint; "AA23 reverted: Only EntryPoint…" or any other FailedOp means it is not wired.
 * Bit 23 and the EntryPoint controller are verified from storage by status4337.
 */
export async function verify4337(ctx: VerbContext, _signer: Signer, chainId: number, profile: Address, entryPoint: Address = ENTRYPOINT_V06): Promise<{ ok: boolean; detail: string }> {
  const callData = encodeFunctionData({
    abi: UP_ABI,
    functionName: "execute",
    args: [BigInt(OPERATION.STATICCALL), entryPoint, 0n, encodeFunctionData({ abi: entryPoint06Abi, functionName: "balanceOf", args: [profile] })],
  });
  const op: UserOperationV06 = {
    sender: profile,
    nonce: await getNonce(ctx, chainId, profile, nonceKeyFor(_signer.address), entryPoint),
    initCode: "0x",
    callData,
    callGasLimit: 100_000n,
    verificationGasLimit: 1_000_000n,
    preVerificationGas: 50_000n,
    maxFeePerGas: 0n,
    maxPriorityFeePerGas: 0n,
    paymasterAndData: "0x",
    signature: DUMMY_SIGNATURE,
  };
  const sim = await simulateValidation(ctx, chainId, entryPoint, op);
  if (sim.kind === "validation") return { ok: true, detail: "simulateValidation reached Extension4337 through the profile (probe op with a dummy signature; nothing was signed)" };
  if (sim.kind === "failed-op") return { ok: false, detail: `${sim.reason} — ${explainAA(sim.reason).up ?? ""}`.trim() };
  return { ok: false, detail: sim.kind === "revert" ? sim.revert.message : "unexpected simulation outcome" };
}

export interface DisableOptions {
  chainId: number;
  profile: Address;
  withdraw?: boolean;
  withdrawTo?: Address;
  keepSignerPermission?: boolean;
  via?: ExecPath;
  verb?: string;
}

export async function disable4337(ctx: VerbContext, signer: Signer, o: DisableOptions) {
  const chainId = o.chainId;
  const entryPoint = ENTRYPOINT_V06;
  const s = await status4337(ctx, chainId, o.profile, signer.address, entryPoint);
  const plan = buildDisablePlan(s, { keepSignerPermission: o.keepSignerPermission });
  const withdrawAmount = o.withdraw && s.deposit > 0n ? s.deposit : 0n;
  if (plan.payload) {
    const sim = await simulateProfilePayload(ctx, chainId, s.keyManager, signer.address, plan.payload);
    if (!sim.ok) {
      throw new UpError("NOT_AUTHORISED", `the controller ${signer.address} cannot apply the 4337 removal on ${s.profile}: ${sim.revert.message}`, {
        hint: "ask the human to apply this exact setDataBatch from a controller with EDITPERMISSIONS and CHANGEEXTENSIONS (details.plan)",
        details: { plan: planView(plan), revert: sim.revert },
      });
    }
  }
  const steps: FlowStep[] = [
    { step: "withdraw-deposit", status: withdrawAmount > 0n ? "todo" : "skipped", detail: { amount: withdrawAmount, to: o.withdrawTo ?? s.profile } },
    { step: "set-data (unlink extension, remove EntryPoint controller, remove signer bit 23)", status: plan.payload ? "todo" : "skipped", detail: planView(plan) },
  ];
  if (steps.every((x) => x.status === "skipped")) return { chainId, profile: s.profile, steps, plan, warnings: [...plan.warnings, "ERC-4337 is not enabled on this profile; nothing to do"] };
  await ctx.consent({
    verb: o.verb ?? "account 4337 disable",
    risk: "admin",
    chainId,
    target: o.withdrawTo && withdrawAmount > 0n ? o.withdrawTo : s.profile,
    value: o.withdrawTo && withdrawAmount > 0n && o.withdrawTo.toLowerCase() !== s.profile.toLowerCase() ? withdrawAmount : undefined,
    summary: {
      profile: s.profile,
      steps: steps.filter((x) => x.status === "todo").map((x) => x.step),
      dataChanges: plan.changes.map((c) => ({ label: c.label, key: c.key, to: c.to, requires: c.requires })),
      withdraw: withdrawAmount > 0n ? { amount: withdrawAmount.toString(), to: o.withdrawTo ?? s.profile } : undefined,
    },
  });
  if (steps[0].status === "todo") {
    const r = await withdraw4337(ctx, signer, { chainId, profile: s.profile, amount: withdrawAmount, to: o.withdrawTo, via: o.via });
    steps[0] = { ...steps[0], status: ctx.flags.dryRun ? "dry-run" : "done", detail: r };
  }
  if (steps[1].status === "todo") {
    const out = await executeAsProfile(ctx, profileReq({ chainId, profile: s.profile, payload: plan.payload, description: "disable ERC-4337: unlink Extension4337, remove EntryPoint controller, remove bit 23" }, o.verb ?? "account 4337 disable", "admin"), { via: o.via ?? "km" });
    steps[1] = { ...steps[1], status: out.status === "dry-run" ? "dry-run" : "done", detail: { ...planView(plan), outcome: execView(out) } };
  }
  const after = ctx.flags.dryRun ? undefined : await status4337(ctx, chainId, s.profile, signer.address, entryPoint);
  return { chainId, profile: s.profile, steps, plan, status: after, warnings: plan.warnings };
}

export interface DepositOptions {
  chainId: number;
  profile: Address;
  amount: bigint;
  /** profile: UP.execute(CALL, EntryPoint, amount, depositTo(UP)) from the profile balance; controller: plain tx from the controller EOA */
  from: "profile" | "controller";
  via?: ExecPath;
  skipConsent?: boolean;
}

export async function deposit4337(ctx: VerbContext, signer: Signer, o: DepositOptions): Promise<{ from: string; amount: bigint; entryPoint: Address; outcome: unknown; depositAfter?: bigint }> {
  const entryPoint = ENTRYPOINT_V06;
  if (o.amount <= 0n) throw new UpError("BAD_ARGS", "deposit amount must be > 0");
  const data = depositToCalldata(o.profile);
  let outcome: unknown;
  if (o.from === "controller") {
    if (!o.skipConsent) {
      await ctx.consent({ verb: "account 4337 deposit", risk: "write", chainId: o.chainId, target: entryPoint, selector: data.slice(0, 10) as Hex, value: o.amount, summary: { from: `controller EOA ${signer.address} (its own funds, credited to the profile's EntryPoint deposit)`, profile: o.profile, amount: o.amount.toString() } });
    }
    const tx: TxOutcome = await sendTx(ctx, signer, { chainId: o.chainId, to: entryPoint, data, value: o.amount });
    outcome = { ...tx, receipt: undefined };
  } else {
    const out = await executeAsProfile(ctx, profileReq({ chainId: o.chainId, profile: o.profile, calls: [{ operation: OPERATION.CALL, to: entryPoint, value: o.amount, data }], description: `EntryPoint.depositTo(${o.profile}) with ${o.amount} wei from the profile` }, "account 4337 deposit", "write"), { via: o.via ?? "km" });
    outcome = execView(out);
  }
  const depositAfter = ctx.flags.dryRun ? undefined : await depositOf(ctx, o.chainId, o.profile, entryPoint);
  return { from: o.from, amount: o.amount, entryPoint, outcome, depositAfter };
}

export interface WithdrawOptions {
  chainId: number;
  profile: Address;
  /** wei; undefined = whole deposit */
  amount?: bigint;
  to?: Address;
  via?: ExecPath;
}

export async function withdraw4337(ctx: VerbContext, _signer: Signer, o: WithdrawOptions) {
  const entryPoint = ENTRYPOINT_V06;
  const current = await depositOf(ctx, o.chainId, o.profile, entryPoint);
  const amount = o.amount ?? current;
  if (amount <= 0n) throw new UpError("BAD_ARGS", `nothing to withdraw: the profile's EntryPoint deposit is ${current} wei`);
  if (amount > current) throw new UpError("BAD_ARGS", `withdraw amount ${amount} exceeds the deposit (${current} wei)`);
  const to = o.to ?? o.profile;
  // Withdrawing to anyone but the profile moves the profile's money out: value-moving to the recipient, so the
  // delegated policy's native-value cap applies (default cap 0 ⇒ a human approval is needed).
  if (to.toLowerCase() !== o.profile.toLowerCase()) {
    await ctx.consent({
      verb: "account 4337 withdraw",
      risk: "write",
      chainId: o.chainId,
      target: to,
      value: amount,
      selector: withdrawToCalldata(to, amount).slice(0, 10) as Hex,
      summary: { action: "withdraw the profile's EntryPoint deposit to another address", profile: o.profile, recipient: to, amount: amount.toString(), entryPoint },
    });
  }
  const out = await executeAsProfile(ctx, profileReq({ chainId: o.chainId, profile: o.profile, calls: [{ operation: OPERATION.CALL, to: entryPoint, value: 0n, data: withdrawToCalldata(to, amount) }], description: `EntryPoint.withdrawTo(${to}, ${amount})` }, "account 4337 withdraw", "write"), { via: o.via ?? "km" });
  const depositAfter = ctx.flags.dryRun ? undefined : await depositOf(ctx, o.chainId, o.profile, entryPoint);
  return { amount, to, entryPoint, outcome: execView(out), depositAfter };
}

/** ExecRequest plus the optional audit fields the account-core transports understand (verb, risk). */
function profileReq(req: ExecRequest, verb: string, risk: "write" | "admin"): ExecRequest {
  return Object.assign(req, { verb, risk });
}

function planView(p: SetDataPlan) {
  return { changes: p.changes, setDataBatch: p.payload ? { keys: p.keys, values: p.values, calldata: p.payload } : null };
}

function execView(o: ExecOutcome) {
  return { path: o.path, status: o.status, txHash: o.txHash, userOpHash: o.userOpHash, relayTaskId: o.relayTaskId, blockNumber: o.blockNumber, gasPayer: o.gasPayer, explorerUrl: o.explorerUrl };
}
