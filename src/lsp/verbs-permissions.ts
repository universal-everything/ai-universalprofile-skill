// Permission verbs: permissions list/show/encode/decode/presets, controller add/edit/remove,
// allowed-calls set/show, allowed-keys set/show, ownership transfer/accept/renounce.
import { encodeFunctionData, getAddress, keccak256, toBytes, zeroAddress, type Address, type Hex } from "viem";
import "../exec/index.ts";
import { defineVerb } from "../core/verbs.ts";
import { UpError } from "../core/errors.ts";
import type { VerbContext } from "../core/types.ts";
import { sendTx, simulate } from "../chain/tx.ts";
import { executeAuto } from "../exec/auto.ts";
import { outcomeText, type ExecRequestExt } from "../exec/common.ts";
import { PATH_PARAMS, chainAndProfile, controllerAddress, execOptions } from "../exec/verbs.ts";
import { KM_ABI, UP_ABI } from "./abis.ts";
import { LSP14_RENOUNCE_DELAY, LSP14_RENOUNCE_PERIOD } from "./constants.ts";
import { PRESETS, decodePermissions, encodePermissions, explainPermissions, getPreset, PERMISSION_INFO } from "./permissions.ts";
import { describeAllowedCall, encodeAllowedCalls, type AllowedCallInput } from "./allowed.ts";
import { allowedKeyFor } from "./schemas.ts";
import { buildAddController, buildEditController, buildRemoveController, requireLockApproval, wouldLockProfile, type ControllerSpec, type WriteSet } from "./controllers.ts";
import { readControllerPermissions, readControllers, resolveKeyManager, type ControllerInfo } from "./profile.ts";
import { hasCode, latestBlock, tryRead } from "./read.ts";
import { addressArg, permissionValueFrom } from "./verbs-account.ts";

const PERMISSION_INPUT_PARAMS = [
  { name: "preset", type: "string" as const, description: "Permission preset (see up permissions presets).", enum: Object.keys(PRESETS) },
  { name: "permissions", type: "string[]" as const, description: "Permission names, e.g. CALL,TRANSFERVALUE,SIGN (replaces the current set)." },
  { name: "bits", type: "string" as const, description: "Raw bytes32 permission value (hex)." },
  { name: "allowed-calls", type: "json" as const, description: 'AllowedCalls entries: [{"callTypes":["CALL","VALUE"],"address":"0x…","standard":"*","selector":"*"}]; [] clears.' },
  { name: "allowed-keys", type: "string[]" as const, description: "AllowedERC725YDataKeys: names (LSP3Profile, LSP12IssuedAssets[]) or hex keys/prefixes." },
];

function controllerView(c: ControllerInfo) {
  return {
    address: c.address,
    index: c.index,
    permissions: c.permissions.hex,
    names: c.permissions.names,
    unknownBits: c.permissions.unknownBits.length ? c.permissions.unknownBits : undefined,
    risk: c.permissions.risk,
    admin: c.permissions.isAdmin,
    allowedCalls: c.allowedCallsDescribed,
    allowedDataKeys: c.allowedDataKeys,
    problems: c.problems,
  };
}

function allowedKeysArg(v: unknown): string[] | undefined {
  if (v === undefined) return undefined;
  const arr = Array.isArray(v) ? v : [v];
  try {
    return arr.filter((x) => String(x).trim() !== "").map((k) => allowedKeyFor(String(k)));
  } catch (e) {
    throw new UpError("BAD_ARGS", (e as Error).message);
  }
}

function allowedCallsArg(v: unknown): AllowedCallInput[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) throw new UpError("BAD_ARGS", "--allowed-calls must be a JSON array");
  try {
    encodeAllowedCalls(v as AllowedCallInput[]); // validate early (wildcards, call types)
  } catch (e) {
    throw new UpError("BAD_ARGS", (e as Error).message);
  }
  return v as AllowedCallInput[];
}

async function applyWriteSet(ctx: VerbContext, a: Record<string, any>, verb: string, chainId: number, profile: Address, ws: WriteSet) {
  const req: ExecRequestExt = { chainId, profile, payload: ws.payload, verb, risk: "admin", summaryExtra: { change: ws.summary, changeWarnings: ws.warnings.length ? ws.warnings : undefined } };
  const out = await executeAuto(ctx, req, execOptions(a));
  return out;
}

// ---------------------------------------------------------------------------
// permissions (read + local)
// ---------------------------------------------------------------------------

defineVerb({
  name: "permissions list",
  group: "permissions",
  summary: "List every controller of the profile on a chain with decoded permissions, risk, AllowedCalls and AllowedERC725YDataKeys.",
  risk: "read",
  params: [{ name: "limit", type: "integer", description: "Max controllers to read.", default: 100 }],
  async run(ctx, a) {
    const { chainId, profile } = await chainAndProfile(ctx, a);
    const km = await resolveKeyManager(ctx, chainId, profile);
    const r = await readControllers(ctx, chainId, profile, { limit: a.limit });
    const rows = r.controllers.map(controllerView);
    return {
      data: { chainId, profile, keyManager: km.keyManager, owner: km.owner, length: r.length.toString(), truncated: r.truncated, invalidEntries: r.invalidEntries, controllers: rows },
      text: [`${rows.length} controller(s) on chain ${chainId}:`, ...rows.map((c) => `  [${c.index}] ${c.address} ${c.risk} — ${c.names.join(", ") || "no permissions"}${c.allowedCalls.length ? `; calls: ${c.allowedCalls.join(" | ")}` : ""}`)].join("\n"),
    };
  },
});

defineVerb({
  name: "permissions show",
  group: "permissions",
  summary: "Show one controller's permissions on a chain (default: this agent's controller) with plain-language explanations — use it to verify a grant.",
  risk: "read",
  params: [{ name: "controller", type: "string", description: "Controller address (default: this agent's).", positional: 0 }],
  async run(ctx, a) {
    const { chainId, profile } = await chainAndProfile(ctx, a);
    const controller = a.controller ? addressArg(a.controller, "controller") : await controllerAddress(ctx, chainId);
    const km = await resolveKeyManager(ctx, chainId, profile);
    const c = await readControllerPermissions(ctx, chainId, profile, controller);
    const authorised = c.permissions.value !== 0n && !!km.keyManager;
    return {
      data: { chainId, profile, keyManager: km.keyManager, authorised, ...controllerView(c), explanation: explainPermissions(c.permissions.value) },
      text: authorised ? [`${controller} is a controller on chain ${chainId}:`, ...explainPermissions(c.permissions.value).map((l) => `  - ${l}`), ...(c.allowedCallsDescribed.length ? ["  allowed calls:", ...c.allowedCallsDescribed.map((d) => `    ${d}`)] : []), ...(c.allowedDataKeys.length ? [`  allowed data keys: ${c.allowedDataKeys.join(", ")}`] : [])].join("\n") : `${controller} is NOT a controller of ${profile} on chain ${chainId}`,
    };
  },
});

defineVerb({
  name: "permissions encode",
  group: "permissions",
  summary: "Encode LSP6 permission names into the bytes32 value (e.g. CALL TRANSFERVALUE SIGN → 0x…).",
  risk: "local",
  params: [{ name: "names", type: "string[]", description: "Permission names (or ALL_PERMISSIONS).", positional: 0, required: true }],
  async run(_ctx, a) {
    let hex: Hex;
    try {
      hex = encodePermissions(a.names);
    } catch (e) {
      throw new UpError("BAD_ARGS", (e as Error).message);
    }
    const d = decodePermissions(hex);
    return { data: { hex, names: d.names, risk: d.risk, explanation: explainPermissions(hex) }, text: hex };
  },
});

defineVerb({
  name: "permissions decode",
  group: "permissions",
  summary: "Decode a bytes32 LSP6 permission value into names, risk labels and explanations (unknown bits are reported, never dropped).",
  risk: "local",
  params: [{ name: "value", type: "string", description: "bytes32 permission value (hex).", positional: 0, required: true }],
  async run(_ctx, a) {
    let d;
    try {
      d = decodePermissions(a.value as Hex);
    } catch {
      throw new UpError("BAD_ARGS", "value must be hex");
    }
    return { data: { hex: d.hex, names: d.names, unknownBits: d.unknownBits, risk: d.risk, isAdmin: d.isAdmin, isAllPermissions: d.isAllPermissions, explanation: explainPermissions(d.value) }, text: explainPermissions(d.value).join("\n") || "no permissions" };
  },
});

defineVerb({
  name: "permissions presets",
  group: "permissions",
  summary: "List the permission presets (agent-owner, agent-operator, agent-reader, human-admin, entrypoint-4337, urd) with bits, risk and use.",
  risk: "local",
  params: [],
  async run() {
    const rows = Object.values(PRESETS).map((p) => {
      const d = decodePermissions(p.permissions);
      return { name: p.name, hex: d.hex, names: d.names, risk: d.risk, summary: p.summary, use: p.use, defaultAllowedCalls: (p.allowedCalls ?? []).map(describeAllowedCall), notes: p.notes };
    });
    return { data: { presets: rows, bits: Object.fromEntries(Object.entries(PERMISSION_INFO).map(([n, i]) => [n, i])) }, text: rows.map((r) => `${r.name.padEnd(16)} ${r.risk.padEnd(9)} ${r.names.join(", ")}\n  ${r.use}`).join("\n") };
  },
});

// ---------------------------------------------------------------------------
// controllers (admin)
// ---------------------------------------------------------------------------

async function readBack(ctx: VerbContext, chainId: number, profile: Address, controller: Address, expect: { permissions?: bigint; removed?: boolean }) {
  const c = await readControllerPermissions(ctx, chainId, profile, controller);
  if (expect.removed) return { ok: c.permissions.value === 0n, now: c.permissions.names };
  return { ok: expect.permissions === undefined || c.permissions.value === expect.permissions, now: c.permissions.names, allowedCalls: c.allowedCallsDescribed, allowedDataKeys: c.allowedDataKeys };
}

defineVerb({
  name: "controller add",
  group: "permissions",
  summary: "Add a controller to the profile with a preset or explicit permissions (+ AllowedCalls/AllowedERC725YDataKeys). Admin action: needs ADDCONTROLLER and human approval.",
  risk: "admin",
  params: [{ name: "address", type: "string", description: "Address to authorise (EOA or contract).", positional: 0, required: true }, ...PERMISSION_INPUT_PARAMS, ...PATH_PARAMS],
  async run(ctx, a) {
    const { chainId, profile } = await chainAndProfile(ctx, a);
    const address = addressArg(a.address, "address");
    const p = permissionValueFrom(a);
    const preset = p.preset ? getPreset(p.preset) : undefined;
    const spec: ControllerSpec & { permissions: bigint } = {
      permissions: p.value!,
      allowedCalls: allowedCallsArg(a["allowed-calls"]) ?? (preset?.allowedCalls?.length ? preset.allowedCalls : undefined),
      allowedDataKeys: allowedKeysArg(a["allowed-keys"]) ?? (preset?.allowedDataKeys?.length ? preset.allowedDataKeys : undefined),
    };
    const state = await readControllers(ctx, chainId, profile);
    const ws = buildAddController(state, address, spec);
    const out = await applyWriteSet(ctx, a, "controller add", chainId, profile, ws);
    const verified = out.status === "success" ? await readBack(ctx, chainId, profile, address, { permissions: spec.permissions }) : undefined;
    return { data: { ...out, change: ws.summary, verified }, text: `${outcomeText(out)}\n${address}: ${decodePermissions(spec.permissions).names.join(", ")}`, warnings: [...ws.warnings, ...(out.warnings ?? [])] };
  },
});

defineVerb({
  name: "controller edit",
  group: "permissions",
  summary: "Change a controller's permissions (--preset/--permissions/--bits replace; --add/--remove adjust) and/or its AllowedCalls/AllowedERC725YDataKeys. Admin action.",
  risk: "admin",
  params: [
    { name: "address", type: "string", description: "Controller address.", positional: 0, required: true },
    ...PERMISSION_INPUT_PARAMS,
    { name: "add", type: "string[]", description: "Permission names to add (e.g. EXECUTE_RELAY_CALL, 4337)." },
    { name: "remove", type: "string[]", description: "Permission names to remove." },
    ...PATH_PARAMS,
  ],
  async run(ctx, a) {
    const { chainId, profile } = await chainAndProfile(ctx, a);
    const address = addressArg(a.address, "address");
    const state = await readControllers(ctx, chainId, profile);
    const cur = state.controllers.find((c) => c.address === address)?.permissions.value ?? (await readControllerPermissions(ctx, chainId, profile, address)).permissions.value;
    let next = permissionValueFrom(a, false).value;
    try {
      if (a.add?.length) next = BigInt(encodePermissions(a.add, next ?? cur));
      if (a.remove?.length) next = (next ?? cur) & ~BigInt(encodePermissions(a.remove));
    } catch (e) {
      throw new UpError("BAD_ARGS", (e as Error).message);
    }
    if (next !== undefined && wouldLockProfile(state, { address, permissions: next })) requireLockApproval(ctx.flags.approval);
    const ws = buildEditController(state, address, { permissions: next, allowedCalls: allowedCallsArg(a["allowed-calls"]), allowedDataKeys: allowedKeysArg(a["allowed-keys"]) });
    const out = await applyWriteSet(ctx, a, "controller edit", chainId, profile, ws);
    const verified = out.status === "success" ? await readBack(ctx, chainId, profile, address, { permissions: next }) : undefined;
    return { data: { ...out, change: ws.summary, verified }, text: outcomeText(out), warnings: [...ws.warnings, ...(out.warnings ?? [])] };
  },
});

defineVerb({
  name: "controller remove",
  group: "permissions",
  summary: "Remove a controller (clears its permissions/allowed lists, swap-and-pop in AddressPermissions[]). Refuses to remove the last admin controller unless the human's approval says so explicitly.",
  risk: "admin",
  params: [{ name: "address", type: "string", description: "Controller address.", positional: 0, required: true }, ...PATH_PARAMS],
  async run(ctx, a) {
    const { chainId, profile } = await chainAndProfile(ctx, a);
    const address = addressArg(a.address, "address");
    const state = await readControllers(ctx, chainId, profile);
    if (wouldLockProfile(state, { address, permissions: null })) requireLockApproval(ctx.flags.approval);
    const ws = buildRemoveController(state, address);
    const out = await applyWriteSet(ctx, a, "controller remove", chainId, profile, ws);
    const verified = out.status === "success" ? await readBack(ctx, chainId, profile, address, { removed: true }) : undefined;
    return { data: { ...out, change: ws.summary, verified }, text: outcomeText(out), warnings: [...ws.warnings, ...(out.warnings ?? [])] };
  },
});

defineVerb({
  name: "allowed-calls show",
  group: "permissions",
  summary: "Show a controller's AllowedCalls (decoded: call types, address, standard, function).",
  risk: "read",
  params: [{ name: "controller", type: "string", description: "Controller (default: this agent's).", positional: 0 }],
  async run(ctx, a) {
    const { chainId, profile } = await chainAndProfile(ctx, a);
    const controller = a.controller ? addressArg(a.controller, "controller") : await controllerAddress(ctx, chainId);
    const c = await readControllerPermissions(ctx, chainId, profile, controller);
    return { data: { chainId, profile, controller, raw: c.raw.allowedCalls, entries: c.allowedCalls, described: c.allowedCallsDescribed, problems: c.problems }, text: c.allowedCallsDescribed.join("\n") || "no AllowedCalls (only SUPER_* permissions can call anything)" };
  },
});

defineVerb({
  name: "allowed-calls set",
  group: "permissions",
  summary: "Replace a controller's AllowedCalls (admin: EDITPERMISSIONS). Entries: callTypes (VALUE/CALL/STATICCALL), address, standard (interface id), selector; '*' = any.",
  risk: "admin",
  params: [
    { name: "controller", type: "string", description: "Controller address.", positional: 0, required: true },
    { name: "calls", type: "json", description: 'JSON array: [{"callTypes":["CALL","VALUE"],"address":"0x…","standard":"*","selector":"0xa9059cbb"}]; [] clears.', required: true },
    ...PATH_PARAMS,
  ],
  async run(ctx, a) {
    const { chainId, profile } = await chainAndProfile(ctx, a);
    const controller = addressArg(a.controller, "controller");
    const state = await readControllers(ctx, chainId, profile);
    const ws = buildEditController(state, controller, { allowedCalls: allowedCallsArg(a.calls) ?? [] });
    const out = await applyWriteSet(ctx, a, "allowed-calls set", chainId, profile, ws);
    const verified = out.status === "success" ? await readBack(ctx, chainId, profile, controller, {}) : undefined;
    return { data: { ...out, change: ws.summary, verified }, text: outcomeText(out), warnings: [...ws.warnings, ...(out.warnings ?? [])] };
  },
});

defineVerb({
  name: "allowed-keys show",
  group: "permissions",
  summary: "Show a controller's AllowedERC725YDataKeys (full keys or prefixes).",
  risk: "read",
  params: [{ name: "controller", type: "string", description: "Controller (default: this agent's).", positional: 0 }],
  async run(ctx, a) {
    const { chainId, profile } = await chainAndProfile(ctx, a);
    const controller = a.controller ? addressArg(a.controller, "controller") : await controllerAddress(ctx, chainId);
    const c = await readControllerPermissions(ctx, chainId, profile, controller);
    return { data: { chainId, profile, controller, raw: c.raw.allowedDataKeys, keys: c.allowedDataKeys, problems: c.problems }, text: c.allowedDataKeys.join("\n") || "no AllowedERC725YDataKeys" };
  },
});

defineVerb({
  name: "allowed-keys set",
  group: "permissions",
  summary: "Replace a controller's AllowedERC725YDataKeys (admin: EDITPERMISSIONS). Accepts names (LSP3Profile, LSP12IssuedAssets[]) or hex keys/prefixes.",
  risk: "admin",
  params: [
    { name: "controller", type: "string", description: "Controller address.", positional: 0, required: true },
    { name: "keys", type: "string[]", description: "Keys, names or prefixes; empty clears.", required: true },
    ...PATH_PARAMS,
  ],
  async run(ctx, a) {
    const { chainId, profile } = await chainAndProfile(ctx, a);
    const controller = addressArg(a.controller, "controller");
    const state = await readControllers(ctx, chainId, profile);
    const ws = buildEditController(state, controller, { allowedDataKeys: allowedKeysArg(a.keys) ?? [] });
    const out = await applyWriteSet(ctx, a, "allowed-keys set", chainId, profile, ws);
    const verified = out.status === "success" ? await readBack(ctx, chainId, profile, controller, {}) : undefined;
    return { data: { ...out, change: ws.summary, verified }, text: outcomeText(out), warnings: [...ws.warnings, ...(out.warnings ?? [])] };
  },
});

// ---------------------------------------------------------------------------
// ownership (LSP14, admin)
// ---------------------------------------------------------------------------

defineVerb({
  name: "ownership transfer",
  group: "permissions",
  summary: "Start an LSP14 two-step ownership transfer of the profile (e.g. to a new Key Manager). The new owner must accept. Admin action (CHANGEOWNER).",
  risk: "admin",
  params: [{ name: "new-owner", type: "string", description: "New owner (normally a new LSP6 Key Manager whose target() is this profile).", positional: 0, required: true }, ...PATH_PARAMS],
  async run(ctx, a) {
    const { chainId, profile } = await chainAndProfile(ctx, a);
    const newOwner = addressArg(a["new-owner"], "new-owner");
    if (newOwner === profile) throw new UpError("BAD_ARGS", "a profile cannot own itself (LSP14CannotTransferOwnershipToSelf)");
    const warnings: string[] = [];
    let kind = "eoa";
    if (await hasCode(ctx, chainId, newOwner)) {
      const t = await tryRead<Address>(ctx, chainId, newOwner, KM_ABI, "target");
      if (t && getAddress(t) === profile) kind = "key-manager";
      else {
        kind = "contract";
        warnings.push(`${newOwner} is a contract but not a Key Manager linked to this profile (target() ${t ?? "missing"}): after acceptance the controllers' permissions would no longer apply`);
      }
    } else warnings.push(`${newOwner} is an EOA: after acceptance it alone controls the profile directly and all LSP6 controllers (including this agent) stop working`);
    const payload = encodeFunctionData({ abi: UP_ABI, functionName: "transferOwnership", args: [newOwner] });
    const out = await executeAuto(ctx, { chainId, profile, payload, verb: "ownership transfer", risk: "admin", summaryExtra: { ownership: { newOwner, newOwnerKind: kind, step: "1/2 transferOwnership (pending until the new owner accepts)" } } } as ExecRequestExt, execOptions(a));
    return { data: { ...out, newOwner, newOwnerKind: kind, next: `the new owner accepts with: up ownership accept --profile ${profile}${kind === "key-manager" ? " (sent through the new Key Manager)" : ""}` }, text: outcomeText(out), warnings: [...warnings, ...(out.warnings ?? [])] };
  },
});

defineVerb({
  name: "ownership accept",
  group: "permissions",
  summary: "Accept a pending LSP14 ownership transfer: directly if this agent's controller is the pending owner, or through the pending (new) Key Manager. Admin action.",
  risk: "admin",
  params: [],
  async run(ctx, a) {
    const { chainId, profile } = await chainAndProfile(ctx, a);
    const pending = getAddress(await tryRead<Address>(ctx, chainId, profile, UP_ABI, "pendingOwner") ?? zeroAddress);
    if (pending === zeroAddress) throw new UpError("BAD_ARGS", `no pending ownership transfer on ${profile} (chain ${chainId})`);
    const signer = await ctx.signer(chainId);
    const accept = encodeFunctionData({ abi: UP_ABI, functionName: "acceptOwnership" });
    let to: Address;
    let data: Hex;
    let route: string;
    if (pending === signer.address) {
      to = profile;
      data = accept;
      route = "controller EOA is the pending owner → UP.acceptOwnership()";
    } else {
      const t = (await hasCode(ctx, chainId, pending)) ? await tryRead<Address>(ctx, chainId, pending, KM_ABI, "target") : undefined;
      if (!t || getAddress(t) !== profile) throw new UpError("NOT_SUPPORTED", `the pending owner ${pending} must accept itself (it is neither this agent's controller nor a Key Manager of this profile)`);
      to = pending;
      data = encodeFunctionData({ abi: KM_ABI, functionName: "execute", args: [accept] });
      route = `new Key Manager ${pending}.execute(acceptOwnership()) — needs CHANGEOWNER for ${signer.address}`;
    }
    const confirmation = { actor: profile, chainId, action: "accept ownership (LSP14 step 2/2)", pendingOwner: pending, route, gasPayer: `controller EOA ${signer.address}`, entry: { to, calldata: data } };
    await simulate(ctx, { chainId, from: signer.address, to, data });
    await ctx.consent({ verb: "ownership accept", risk: "admin", chainId, summary: confirmation, value: 0n, target: to, selector: data.slice(0, 10) as Hex });
    const tx = await sendTx(ctx, signer, { chainId, to, data });
    const owner = tx.status === "success" ? getAddress(await tryRead<Address>(ctx, chainId, profile, UP_ABI, "owner") ?? zeroAddress) : undefined;
    return { data: { status: tx.status, txHash: tx.hash, chainId, profile, newOwner: owner, confirmation }, text: tx.status === "dry-run" ? `DRY RUN: ${route}` : `ownership accepted: owner is now ${owner} (tx ${tx.hash})` };
  },
});

const RENOUNCE_STARTED_TOPIC = keccak256(toBytes("RenounceOwnershipStarted()"));

defineVerb({
  name: "ownership renounce",
  group: "permissions",
  summary: "Renounce ownership (LSP14 two calls: start, then confirm 200–400 blocks later). After confirmation NOBODY can ever control the profile. Each call needs a human approval that mentions 'renounce'.",
  risk: "admin",
  params: [...PATH_PARAMS],
  async run(ctx, a) {
    const { chainId, profile } = await chainAndProfile(ctx, a);
    if (!ctx.flags.dryRun && !/renounce/i.test(ctx.flags.approval ?? "")) {
      throw new UpError("CONSENT_REQUIRED", "renouncing ownership makes the profile permanently uncontrollable (no owner, no controllers, no recovery)", { hint: 'only with the human\'s explicit words for THIS step, e.g. --approval "I want to renounce ownership of <profile>"; it is asked again for the confirmation call' });
    }
    const delay = (await tryRead<bigint>(ctx, chainId, profile, UP_ABI, "RENOUNCE_OWNERSHIP_CONFIRMATION_DELAY")) ?? LSP14_RENOUNCE_DELAY;
    const period = (await tryRead<bigint>(ctx, chainId, profile, UP_ABI, "RENOUNCE_OWNERSHIP_CONFIRMATION_PERIOD")) ?? LSP14_RENOUNCE_PERIOD;
    const head = (await latestBlock(ctx, chainId)).number;
    const from = head > delay + period ? head - delay - period : 0n;
    const logs = await ctx.rpc.request<any[]>(chainId, "eth_getLogs", [{ address: profile, fromBlock: "0x" + from.toString(16), toBlock: "latest", topics: [RENOUNCE_STARTED_TOPIC] }]);
    const started = logs.length ? BigInt(logs[logs.length - 1].blockNumber) : undefined;
    const next = head + 1n;
    let step: "start" | "confirm";
    if (started === undefined || next > started + delay + period) step = "start";
    else if (next < started + delay) {
      throw new UpError("BAD_ARGS", `renounce was started at block ${started}; it can be confirmed between blocks ${started + delay} and ${started + delay + period} (now ${head})`, { hint: "wait, then run up ownership renounce again with a fresh approval" });
    } else step = "confirm";
    const payload = encodeFunctionData({ abi: UP_ABI, functionName: "renounceOwnership" });
    const out = await executeAuto(ctx, { chainId, profile, payload, verb: `ownership renounce (${step})`, risk: "admin", summaryExtra: { ownership: { action: "renounceOwnership", step: step === "start" ? "1/2 start (no effect yet; confirm within the window)" : "2/2 CONFIRM — the profile will have NO owner", startedAtBlock: started?.toString(), window: started !== undefined ? [String(started + delay), String(started + delay + period)] : undefined } } } as ExecRequestExt, execOptions(a));
    const window = step === "start" && out.blockNumber ? { confirmFrom: (BigInt(out.blockNumber) + delay).toString(), confirmUntil: (BigInt(out.blockNumber) + delay + period).toString() } : undefined;
    return {
      data: { ...out, step, window },
      text: step === "start" ? `${outcomeText(out)}\nrenounce STARTED${window ? `: confirm between blocks ${window.confirmFrom} and ${window.confirmUntil}` : ""} — nothing changed yet` : `${outcomeText(out)}\nownership RENOUNCED: the profile has no owner`,
      warnings: out.warnings,
    };
  },
});
