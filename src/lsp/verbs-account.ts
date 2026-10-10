// Account verbs: account precompute / deploy / info / data get|set / manifest show|export /
// extensions add|remove / urd set, and profile join (J2 / any existing profile).
import type { MediaFile } from "../core/types.ts";
import { randomBytes } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import "../exec/index.ts";
import { defineVerb } from "../core/verbs.ts";
import { UpError } from "../core/errors.ts";
import { writeFileAtomic } from "../core/home.ts";
import { toJson } from "../core/json.ts";
import type { UpConfig, VerbContext } from "../core/types.ts";
import { executeAuto } from "../exec/auto.ts";
import { outcomeText, type ExecRequestExt } from "../exec/common.ts";
import { PATH_PARAMS, chainAndProfile, controllerAddress, execOptions } from "../exec/verbs.ts";
import { DATA_KEYS, extensionKey, parseArrayLength } from "./constants.ts";
import { decodePermissions, encodePermissions, getPreset, toBytes32 } from "./permissions.ts";
import { candidateSalts, computeOnChain, deployFromManifest, loadManifest, manifestFromPlan, planDeployment, readProfileRecord, verifyManifest, writeProfileRecord, DEFAULT_IMPL_VERSION, type Lsp23Inputs } from "./lsp23.ts";
import { getData, getDataBatch, readControllerPermissions, readControllers, readProfileInfo, resolveKeyManager, type ControllerInfo } from "./profile.ts";
import { allowedKeyFor, classifyDataKey, decodeDataValue, encodeDataValue, resolveDataKey } from "./schemas.ts";
import { recommend, setDataPayload, buildAddController, requireLockApproval, type RecommendationOptions } from "./controllers.ts";
import { ADMIN_PERMISSIONS } from "./constants.ts";
import { hasCode } from "./read.ts";

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

export function addressArg(v: unknown, name: string): Address {
  if (typeof v !== "string" || !isAddress(v, { strict: false })) throw new UpError("BAD_ARGS", `--${name} must be an address`);
  return getAddress(v);
}

/** Permission value from --bits (hex/decimal), --permissions (names) or --preset. */
export function permissionValueFrom(a: Record<string, any>, required = true): { value?: bigint; preset?: string } {
  if (a.bits !== undefined) {
    try {
      return { value: BigInt(a.bits) };
    } catch {
      throw new UpError("BAD_ARGS", "--bits must be a hex or decimal permission value");
    }
  }
  if (a.permissions?.length) {
    try {
      return { value: BigInt(encodePermissions(a.permissions)) };
    } catch (e) {
      throw new UpError("BAD_ARGS", (e as Error).message);
    }
  }
  if (a.preset) {
    try {
      return { value: getPreset(a.preset).permissions, preset: a.preset };
    } catch (e) {
      throw new UpError("BAD_ARGS", (e as Error).message);
    }
  }
  if (required) throw new UpError("BAD_ARGS", "pass --preset, --permissions <names> or --bits <hex>", { hint: "see: up permissions presets" });
  return {};
}

function lsp23InputsFrom(a: Record<string, any>, controller: Address, salt: Hex): Lsp23Inputs {
  const p = permissionValueFrom({ ...a, preset: a.preset ?? (a.permissions || a.bits !== undefined ? undefined : "agent-owner") });
  if (a.lsp3 !== undefined && !/^0x([0-9a-fA-F]{2})*$/.test(a.lsp3)) throw new UpError("BAD_ARGS", "--lsp3 must be the encoded VerifiableURI hex value");
  return { salt, controller, permissions: toBytes32(p.value!), preset: p.preset, lsp3: a.lsp3, implementationVersion: a["implementation-version"] ?? DEFAULT_IMPL_VERSION };
}

const LSP23_PARAMS = [
  { name: "controller", type: "string" as const, description: "Initial controller (default: this agent's controller address). Part of the address derivation." },
  { name: "preset", type: "string" as const, description: "Permission preset for the initial controller (default agent-owner = ALL_PERMISSIONS).", enum: ["agent-owner", "agent-operator", "agent-reader", "human-admin"] },
  { name: "permissions", type: "string[]" as const, description: "Explicit permission names instead of a preset." },
  { name: "bits", type: "string" as const, description: "Explicit bytes32 permission value instead of a preset." },
  { name: "lsp3", type: "string" as const, description: "Optional encoded LSP3Profile VerifiableURI value set at deployment (changes the address)." },
  { name: "implementation-version", type: "string" as const, description: "UP/KM/URD implementation version.", default: DEFAULT_IMPL_VERSION },
];

// ---------------------------------------------------------------------------
// account precompute / deploy / manifest
// ---------------------------------------------------------------------------

defineVerb({
  name: "account precompute",
  group: "account",
  summary: "Compute candidate Universal Profile addresses (LSP23, same address on every chain for identical inputs) — nothing is sent.",
  description:
    "Candidates differ only by salt: salt_i = keccak256(abi.encodePacked(seed, i)). Keep the seed to reproduce the list. Show each candidate to the human with: up identicon <address> (and up qr <address>). Then deploy the chosen one with: up account deploy --seed <seed> --candidate <i> --chain <id>.",
  risk: "read",
  params: [
    { name: "count", type: "integer", description: "Number of candidates (1..100).", default: 5 },
    { name: "seed", type: "string", description: "32-byte hex seed (default: random, printed for reproduction)." },
    { name: "salt", type: "string", description: "Compute a single address for this exact 32-byte salt." },
    ...LSP23_PARAMS,
  ],
  async run(ctx, a) {
    const cfg = await ctx.config();
    const controller = a.controller ? addressArg(a.controller, "controller") : await controllerAddress(ctx);
    const seed = (a.seed ?? ("0x" + randomBytes(32).toString("hex"))) as Hex;
    const salts = a.salt ? [a.salt as Hex] : candidateSalts(seed, a.count);
    const candidates = salts.map((salt, index) => {
      const plan = planDeployment(lsp23InputsFrom(a, controller, salt));
      return { index, salt, profile: plan.profile, keyManager: plan.keyManager };
    });
    const firstInputs = lsp23InputsFrom(a, controller, salts[0]);
    const first = planDeployment(firstInputs);
    const warnings: string[] = [];
    if ((BigInt(firstInputs.permissions) & ADMIN_PERMISSIONS) === 0n) warnings.push("the initial controller would have no CHANGEOWNER/ADDCONTROLLER/EDITPERMISSIONS: nobody could ever change permissions or ownership of this profile");
    let onChain: unknown;
    const chainArg = a.chain ?? (cfg.defaultChain ? String(cfg.defaultChain) : undefined);
    if (chainArg) {
      try {
        const chainId = ctx.chainId(chainArg);
        const r = await computeOnChain(ctx, chainId, first);
        onChain = { chainId, ...r, matches: r.profile === first.profile && r.keyManager === first.keyManager };
        if (!(onChain as any).matches) warnings.push(`the LSP23 factory on chain ${chainId} computes a different address — do not deploy there`);
      } catch (e) {
        warnings.push(`not cross-checked with the on-chain factory: ${(e as Error).message}`);
      }
    }
    const d = decodePermissions(firstInputs.permissions);
    // Identicons (blockies, the algorithm LUKSO apps use) so the human can pick visually.
    const media: MediaFile[] = [];
    try {
      const { blockiePng, blockieText } = await import("../display/blockies.ts");
      const { writeMedia } = await import("../display/media.ts");
      for (const c of candidates.slice(0, 10)) {
        media.push(await writeMedia(ctx.home, `candidate-${c.index}-${c.profile.slice(2, 10)}`, blockiePng(c.profile), `identicon of candidate [${c.index}] ${c.profile}`));
        (c as any).identiconText = blockieText(c.profile);
      }
    } catch (e) {
      warnings.push(`identicons not rendered: ${(e as Error).message}`);
    }
    return {
      media,
      data: {
        seed: a.salt ? undefined : seed,
        controller,
        preset: a.preset ?? (a.permissions || a.bits ? undefined : "agent-owner"),
        permissions: { hex: d.hex, names: d.names },
        implementations: first.implementations,
        factory: first.factory,
        postDeploymentModule: first.postDeploymentModule,
        candidates,
        onChainCrossCheck: onChain,
        reproduce: a.salt ? undefined : `up account precompute --seed ${seed} --count ${a.count} --controller ${controller}${a.preset ? ` --preset ${a.preset}` : ""}`,
        next: ["show each candidate: up identicon <address>  (and up qr <address>)", `deploy the chosen one: up account deploy --seed ${seed} --candidate <index> --chain <id>   (or --salt <salt>)`],
      },
      text: [
        `${candidates.length} candidate profile address(es) for controller ${controller} (same on every chain with these inputs):`,
        ...candidates.map((c) => `  [${c.index}] ${c.profile}   salt ${c.salt}`),
        a.salt ? "" : `seed (keep it to reproduce): ${seed}`,
        "Show them with: up identicon <address>",
      ].filter(Boolean).join("\n"),
      warnings,
    };
  },
});

async function manifestFor(ctx: VerbContext, a: Record<string, any>) {
  let salt: Hex | undefined = a.salt;
  let seed: Hex | undefined;
  let candidateIndex: number | undefined;
  if (!salt && a.seed) {
    if (a.candidate === undefined) throw new UpError("BAD_ARGS", "--seed needs --candidate <index>");
    seed = a.seed;
    candidateIndex = a.candidate;
    salt = candidateSalts(a.seed, 1, a.candidate)[0];
  }
  if (salt) {
    const controller = a.controller ? addressArg(a.controller, "controller") : (await ctx.signer()).address;
    const inputs = lsp23InputsFrom(a, controller, salt);
    const plan = planDeployment(inputs);
    const existing = await loadManifest(ctx.home, plan.profile);
    if (existing && verifyManifest(existing).ok) return existing;
    return manifestFromPlan(inputs, plan, { seed, candidateIndex });
  }
  const profile = await ctx.profile(a.profile);
  const m = await loadManifest(ctx.home, profile);
  if (!m) throw new UpError("BAD_ARGS", `no deployment manifest for ${profile}`, { hint: "deploy a new profile with --salt or --seed/--candidate (see up account precompute), or copy the manifest file of that profile into profiles/" });
  return m;
}

defineVerb({
  name: "account deploy",
  group: "account",
  summary: "Deploy the agent's Universal Profile via LSP23 (UP + Key Manager + URD in one transaction), or replay a saved manifest on another chain (same address).",
  description:
    "J1: the agent's controller becomes the main controller with agent-owner permissions (ALL_PERMISSIONS). Verifies that the deployed addresses equal the precomputed ones and runs smoke reads (owner = KM, KM.target() = UP, permissions, URD). The controller EOA pays gas. Afterwards, recommend adding a human controller: up controller add <human> --preset human-admin.",
  risk: "write",
  params: [
    { name: "salt", type: "string", description: "32-byte salt of the chosen candidate." },
    { name: "seed", type: "string", description: "Seed from up account precompute (with --candidate)." },
    { name: "candidate", type: "integer", description: "Candidate index for --seed." },
    ...LSP23_PARAMS,
  ],
  async run(ctx, a) {
    await ctx.config();
    const chainId = ctx.chainId(a.chain);
    const m = await manifestFor(ctx, a);
    if ((BigInt(m.permissions) & ADMIN_PERMISSIONS) === 0n && !(m.extraControllers ?? []).some((c) => (BigInt(c.permissions) & ADMIN_PERMISSIONS) !== 0n) && !ctx.flags.dryRun) {
      // nobody could ever add/edit controllers or change ownership of such a profile
      requireLockApproval(ctx.flags.approval);
    }
    const signer = await ctx.signer();
    const out = await deployFromManifest(ctx, signer, m, chainId);
    const warnings: string[] = [];
    if (out.status !== "dry-run") {
      const cfg: UpConfig = { ...(await ctx.config()) };
      if (!cfg.defaultProfile) {
        cfg.defaultProfile = m.profile;
        await ctx.saveConfig(cfg);
      }
      if (getAddress(m.controller) === signer.address) warnings.push("the agent's key is the only admin controller: if it is lost, control is lost. Recommended now: up controller add <human address> --preset human-admin (shares no key, the address stays the same)");
    }
    return {
      data: { ...out, manifestSaved: out.status !== "dry-run" },
      text: [`${out.status === "dry-run" ? "DRY RUN — " : ""}profile ${m.profile} (${out.status}) on chain ${chainId}`, `key manager ${m.keyManager}`, out.txHash ? `tx ${out.txHash}` : "", out.verified ? `checks: ${Object.entries(out.verified).map(([k, v]) => `${k}=${v ? "ok" : "FAIL"}`).join(", ")}` : ""].filter(Boolean).join("\n"),
      warnings,
    };
  },
});

defineVerb({
  name: "account manifest show",
  group: "account",
  summary: "Show the deployment manifest of a profile (factory, implementations, salt, init data, controller, permissions, chains, tx hashes).",
  risk: "local",
  params: [],
  async run(ctx, a) {
    const profile = await ctx.profile(a.profile);
    const m = await loadManifest(ctx.home, profile);
    if (!m) throw new UpError("BAD_ARGS", `no deployment manifest stored for ${profile}`, { hint: "only profiles deployed (or precomputed + deployed) by this skill have one" });
    const v = verifyManifest(m);
    return { data: { manifest: m, consistent: v.ok }, text: `profile ${m.profile}, key manager ${m.keyManager}, controller ${m.controller} (${m.permissionNames.join(", ")}), deployed on chain(s): ${m.chains.join(", ") || "none yet"}; manifest ${v.ok ? "consistent" : "INCONSISTENT"}` };
  },
});

defineVerb({
  name: "account manifest export",
  group: "account",
  summary: "Export the deployment manifest as portable JSON (to stdout or a file) so the same profile can be reproduced on other chains or machines.",
  risk: "local",
  params: [{ name: "out", type: "string", description: "File path to write (0600). Default: return the JSON." }],
  async run(ctx, a) {
    const profile = await ctx.profile(a.profile);
    const m = await loadManifest(ctx.home, profile);
    if (!m) throw new UpError("BAD_ARGS", `no deployment manifest stored for ${profile}`);
    if (a.out) {
      const file = isAbsolute(a.out) ? a.out : resolve(process.cwd(), a.out);
      await writeFileAtomic(file, toJson(m) + "\n");
      return { data: { file, profile }, text: `manifest written to ${file}` };
    }
    return { data: m };
  },
});

// ---------------------------------------------------------------------------
// account info / data
// ---------------------------------------------------------------------------

defineVerb({
  name: "account info",
  group: "account",
  summary: "Profile status on a chain: version, owner/Key Manager link, interfaces, controllers and decoded permissions, URD, extensions, LSP3 metadata, received/issued asset counts.",
  risk: "read",
  params: [
    { name: "extensions", type: "string[]", description: "Function selectors to check for LSP17 extensions (default: well-known ones)." },
    { name: "fetch-metadata", type: "boolean", description: "Fetch the LSP3 JSON (ipfs/https) and verify its hash. The content is untrusted data." },
    { name: "controller-limit", type: "integer", description: "Max controllers to read.", default: 100 },
  ],
  async run(ctx, a) {
    const { chainId, profile } = await chainAndProfile(ctx, a);
    const info = await readProfileInfo(ctx, chainId, profile, { extensions: a.extensions, fetchMetadata: a["fetch-metadata"], controllerLimit: a["controller-limit"] });
    let me: Address | undefined;
    try {
      me = await controllerAddress(ctx);
    } catch {}
    const mine = me ? info.controllers?.find((c) => c.address === me) : undefined;
    const thisAgent = me ? { controller: me, isController: !!mine && mine.permissions.value !== 0n, permissions: mine?.permissions.names ?? [] } : undefined;
    const lines = info.deployed
      ? [
          `profile ${profile} on chain ${chainId} (UP ${info.version ?? "?"})`,
          `owner ${info.km?.owner} (${info.km?.ownerKind}${info.km?.keyManagerVersion ? ` v${info.km.keyManagerVersion}` : ""})`,
          `controllers (${info.controllersLength}): ${(info.controllers ?? []).map((c) => `${c.address} [${c.permissions.names.join(",") || "none"}]`).join("; ")}`,
          `URD ${info.universalReceiverDelegate ?? "none"}; extensions: ${(info.extensions ?? []).map((e) => `${e.selector}→${e.address}`).join(", ") || "none"}`,
          thisAgent ? `this agent (${me}): ${thisAgent.isController ? `controller with ${thisAgent.permissions.join(", ")}` : "NOT a controller"}` : "",
        ]
      : [`no profile at ${profile} on chain ${chainId}`];
    return { data: { ...info, thisAgent }, text: lines.filter(Boolean).join("\n"), warnings: info.warnings };
  },
});

defineVerb({
  name: "account data get",
  group: "account",
  summary: "Read an ERC725Y data key of the profile by LSP2 name (LSP3Profile, AddressPermissions[], LSP5ReceivedAssets[3], AddressPermissions:Permissions:0x…) or raw 32-byte key; decodes with the bundled schemas.",
  risk: "read",
  params: [
    { name: "key", type: "string", description: "Key name or 32-byte hex key.", positional: 0, required: true },
    { name: "parts", type: "string[]", description: "Dynamic key parts for names with <placeholders>." },
    { name: "limit", type: "integer", description: "Max elements when reading a whole LSP2 array (Name[]).", default: 50 },
  ],
  async run(ctx, a) {
    const { chainId, profile } = await chainAndProfile(ctx, a);
    let r;
    try {
      r = resolveDataKey(a.key, a.parts);
    } catch (e) {
      throw new UpError("BAD_ARGS", (e as Error).message);
    }
    const raw = await getData(ctx, chainId, profile, r.key);
    const out: Record<string, unknown> = { chainId, profile, key: r.key, name: r.name, raw, value: decodeDataValue(r, raw), routing: classifyDataKey(r.key) };
    if (r.isArrayLength) {
      const len = parseArrayLength(raw);
      const n = Number(len < BigInt(a.limit) ? len : BigInt(a.limit));
      const keys = Array.from({ length: n }, (_, i) => (r.key.slice(0, 34) + BigInt(i).toString(16).padStart(32, "0")) as Hex);
      out.length = len.toString();
      out.elements = await getDataBatch(ctx, chainId, profile, keys);
      out.truncated = BigInt(n) < len;
    }
    return { data: out, text: `${r.name ?? r.key} = ${typeof out.value === "string" ? out.value : JSON.stringify(out.value)}` };
  },
});

defineVerb({
  name: "account data set",
  group: "account",
  summary: "Write ERC725Y data on the profile (by LSP2 name or raw key); shows which LSP6 permission each key needs, simulates, then sends setData/setDataBatch.",
  description: "Permission routing (LSP6SetDataModule): AddressPermissions* keys → ADDCONTROLLER/EDITPERMISSIONS; LSP1UniversalReceiverDelegate* → ADD/CHANGE URD; LSP17Extension:* → ADD/CHANGEEXTENSIONS (SUPER_SETDATA does not bypass); any other key → SETDATA + AllowedERC725YDataKeys, or SUPER_SETDATA. Keys of the first three classes are admin actions.",
  risk: "write",
  params: [
    { name: "key", type: "string", description: "Key name or 32-byte hex key.", positional: 0 },
    { name: "value", type: "json", description: "Value: JSON for schema-encoded keys (e.g. an address, an array, a VerifiableURI object) or raw hex bytes. Use 0x to delete.", positional: 1 },
    { name: "parts", type: "string[]", description: "Dynamic key parts for names with <placeholders>." },
    { name: "pairs", type: "json", description: 'Several writes at once: [{"key":"…","value":…,"parts":[…]}].' },
    ...PATH_PARAMS,
  ],
  async run(ctx, a) {
    const { chainId, profile } = await chainAndProfile(ctx, a);
    const items: { key: string; value: unknown; parts?: string[] }[] = a.pairs ? (Array.isArray(a.pairs) ? a.pairs : []) : a.key !== undefined ? [{ key: a.key, value: a.value, parts: a.parts }] : [];
    if (!items.length) throw new UpError("BAD_ARGS", "pass <key> <value> or --pairs");
    const keys: Hex[] = [];
    const values: Hex[] = [];
    const routing = [];
    for (const it of items) {
      if (it.value === undefined) throw new UpError("BAD_ARGS", `missing value for ${it.key}`);
      let r;
      let v: Hex;
      try {
        r = resolveDataKey(String(it.key), it.parts);
        v = it.value === "0x" ? "0x" : encodeDataValue(r, it.value);
      } catch (e) {
        throw new UpError("BAD_ARGS", (e as Error).message);
      }
      keys.push(r.key);
      values.push(v);
      routing.push({ name: r.name, ...classifyDataKey(r.key) });
    }
    const req: ExecRequestExt = { chainId, profile, payload: setDataPayload(keys, values), verb: "account data set", summaryExtra: { dataWrites: routing.map((x, i) => ({ ...x, value: values[i] })) } };
    const out = await executeAuto(ctx, req, execOptions(a));
    return { data: out, text: outcomeText(out), warnings: out.warnings };
  },
});

// ---------------------------------------------------------------------------
// extensions / URD (admin)
// ---------------------------------------------------------------------------

async function sendPayload(ctx: VerbContext, a: Record<string, any>, verb: string, keys: Hex[], values: Hex[], summaryExtra: Record<string, unknown>) {
  const { chainId, profile } = await chainAndProfile(ctx, a);
  const out = await executeAuto(ctx, { chainId, profile, payload: setDataPayload(keys, values), verb, summaryExtra } as ExecRequestExt, execOptions(a));
  return { data: out, text: outcomeText(out), warnings: out.warnings };
}

defineVerb({
  name: "account extensions add",
  group: "account",
  summary: "Register an LSP17 extension contract for a function selector on the profile (admin: ADDEXTENSIONS/CHANGEEXTENSIONS).",
  risk: "admin",
  params: [
    { name: "selector", type: "string", description: "bytes4 function selector.", positional: 0, required: true },
    { name: "address", type: "string", description: "Extension contract.", positional: 1, required: true },
    { name: "forward-value", type: "boolean", description: "Append 0x01 so the profile forwards msg.value to the extension." },
    ...PATH_PARAMS,
  ],
  async run(ctx, a) {
    const ext = addressArg(a.address, "address");
    const { chainId } = await chainAndProfile(ctx, a);
    if (!(await hasCode(ctx, chainId, ext))) throw new UpError("BAD_ARGS", `${ext} has no code on chain ${chainId}`);
    let key: Hex;
    try {
      key = extensionKey(a.selector);
    } catch (e) {
      throw new UpError("BAD_ARGS", (e as Error).message);
    }
    const value = (ext.toLowerCase() + (a["forward-value"] ? "01" : "")) as Hex;
    return sendPayload(ctx, a, "account extensions add", [key], [value], { extension: { selector: a.selector, address: ext, forwardsValue: !!a["forward-value"], note: "the extension answers calls to this selector on the profile; it is called with CALL (not delegatecall) and cannot change the profile's storage" } });
  },
});

defineVerb({
  name: "account extensions remove",
  group: "account",
  summary: "Remove the LSP17 extension registered for a selector (admin: CHANGEEXTENSIONS).",
  risk: "admin",
  params: [{ name: "selector", type: "string", description: "bytes4 function selector.", positional: 0, required: true }, ...PATH_PARAMS],
  async run(ctx, a) {
    let key: Hex;
    try {
      key = extensionKey(a.selector);
    } catch (e) {
      throw new UpError("BAD_ARGS", (e as Error).message);
    }
    return sendPayload(ctx, a, "account extensions remove", [key], ["0x"], { extension: { selector: a.selector, removed: true } });
  },
});

defineVerb({
  name: "account urd set",
  group: "account",
  summary: "Set the profile's LSP1 Universal Receiver Delegate (admin: ADD/CHANGEUNIVERSALRECEIVERDELEGATE) and grant it SUPER_SETDATA + REENTRANCY as a controller.",
  risk: "admin",
  params: [
    { name: "address", type: "string", description: "URD contract (e.g. the canonical LSP1UniversalReceiverDelegateUP).", positional: 0, required: true },
    { name: "grant", type: "boolean", description: "Also add the URD as a controller with SUPER_SETDATA + REENTRANCY (needed to maintain LSP5/LSP10).", default: true },
    ...PATH_PARAMS,
  ],
  async run(ctx, a) {
    const urd = addressArg(a.address, "address");
    const { chainId, profile } = await chainAndProfile(ctx, a);
    if (!(await hasCode(ctx, chainId, urd))) throw new UpError("BAD_ARGS", `${urd} has no code on chain ${chainId}`);
    const keys: Hex[] = [DATA_KEYS.LSP1UniversalReceiverDelegate];
    const values: Hex[] = [urd.toLowerCase() as Hex];
    const warnings: string[] = [];
    if (a.grant) {
      const state = await readControllers(ctx, chainId, profile);
      const cur = state.controllers.find((c) => c.address === urd);
      if (!cur || cur.permissions.value === 0n) {
        const ws = buildAddController(state, urd, { permissions: getPreset("urd").permissions });
        keys.push(...ws.keys);
        values.push(...ws.values);
      }
    }
    const old = await getData(ctx, chainId, profile, DATA_KEYS.LSP1UniversalReceiverDelegate);
    if (old && old.length === 42 && getAddress(old) !== urd) warnings.push(`the previous URD ${getAddress(old)} keeps its controller permissions; remove them with: up controller remove ${getAddress(old)}`);
    const r = await sendPayload(ctx, a, "account urd set", keys, values, { universalReceiverDelegate: urd, grantedPermissions: a.grant ? "SUPER_SETDATA, REENTRANCY" : "none" });
    return { ...r, warnings: [...(r.warnings ?? []), ...warnings] };
  },
});

// ---------------------------------------------------------------------------
// profile join (J2 / any existing profile) + permissions recommend
// ---------------------------------------------------------------------------

export const RECOMMEND_PARAMS = [
  { name: "preset", type: "string" as const, description: "Preset to recommend (default agent-operator).", enum: ["agent-operator", "agent-reader", "agent-owner", "human-admin"] },
  { name: "allowed-calls", type: "json" as const, description: 'Explicit AllowedCalls entries (replace the preset default): [{"callTypes":["CALL","VALUE"],"address":"0x…","standard":"*","selector":"*"}].' },
  { name: "allow-targets", type: "json" as const, description: 'Extra targets appended to the preset default: [{"address":"0x…","callTypes":["CALL","VALUE"],"selector":"0x…"}].' },
  { name: "allowed-keys", type: "string[]" as const, description: "Data keys the agent may write (names like LSP3Profile or hex keys/prefixes)." },
  { name: "with-4337", type: "boolean" as const, description: "Include the ERC-4337 permission bit (only if the user explicitly wants the opt-in 4337 module)." },
];

export function recommendationOptions(a: Record<string, any>): RecommendationOptions {
  let allowedKeys: string[] | undefined;
  if (a["allowed-keys"]) {
    try {
      allowedKeys = (a["allowed-keys"] as string[]).map((k) => allowedKeyFor(k));
    } catch (e) {
      throw new UpError("BAD_ARGS", (e as Error).message);
    }
  }
  if (a["allowed-calls"] !== undefined && !Array.isArray(a["allowed-calls"])) throw new UpError("BAD_ARGS", "--allowed-calls must be a JSON array");
  if (a["allow-targets"] !== undefined && !Array.isArray(a["allow-targets"])) throw new UpError("BAD_ARGS", "--allow-targets must be a JSON array");
  return { preset: a.preset ?? "agent-operator", allowedCalls: a["allowed-calls"], allowTargets: a["allow-targets"], allowedDataKeys: allowedKeys, with4337: a["with-4337"] === true };
}

interface ChainJoinStatus {
  chainId: number;
  deployed: boolean;
  keyManager?: Address;
  ownerKind?: string;
  authorised: boolean;
  permissions?: string[];
  hasRecommended?: boolean;
  missing?: string[];
  otherControllers?: { address: Address; permissions: string[] }[];
  error?: string;
}

async function joinStatus(ctx: VerbContext, chainId: number, profile: Address, me: Address, recommendedBits: bigint): Promise<ChainJoinStatus> {
  try {
    if (!(await hasCode(ctx, chainId, profile))) return { chainId, deployed: false, authorised: false };
    const km = await resolveKeyManager(ctx, chainId, profile);
    const ctl = await readControllers(ctx, chainId, profile);
    const mine: ControllerInfo | undefined = ctl.controllers.find((c) => c.address === me) ?? (await readControllerPermissions(ctx, chainId, profile, me));
    const value = mine?.permissions.value ?? 0n;
    const missing = decodePermissions(recommendedBits & ~value).names;
    return {
      chainId,
      deployed: true,
      keyManager: km.keyManager,
      ownerKind: km.ownerKind,
      authorised: value !== 0n && !!km.keyManager,
      permissions: mine?.permissions.names ?? [],
      hasRecommended: missing.length === 0,
      missing,
      otherControllers: ctl.controllers.filter((c) => c.address !== me).map((c) => ({ address: c.address, permissions: c.permissions.names })),
    };
  } catch (e) {
    return { chainId, deployed: false, authorised: false, error: (e as Error).message };
  }
}

defineVerb({
  name: "profile join",
  group: "account",
  summary: "Join ANY existing Universal Profile (relayer-created or the human's own): checks per chain whether this agent's controller is authorised, and prints the recommended permission set to hand to the human.",
  description:
    "Resolves the Key Manager on each chain, lists who controls the profile, checks this agent's controller permissions, and outputs the recommended permissions (agent-operator by default) as plain text + JSON for the relayer dashboard or the human's wallet. Sets the profile as default. Re-run after the human granted permissions to verify on-chain.",
  risk: "read",
  params: [
    { name: "address", type: "string", description: "Universal Profile address.", positional: 0, required: true },
    { name: "chains", type: "string[]", description: "Chains to check (default: configured chains, else the default chain)." },
    { name: "alias", type: "string", description: "Optional alias for the profile." },
    { name: "set-default", type: "boolean", description: "Make it the default profile.", default: true },
    ...RECOMMEND_PARAMS,
  ],
  async run(ctx, a) {
    const cfg: UpConfig = { ...(await ctx.config()) };
    const profile = addressArg(a.address, "address");
    const me = await controllerAddress(ctx);
    const chainIds: number[] = a.chains?.length ? (a.chains as string[]).map((c) => ctx.registry.chain(c).chainId) : a.chain ? [ctx.chainId(a.chain)] : cfg.chains?.length ? cfg.chains : cfg.defaultChain ? [cfg.defaultChain] : [];
    if (!chainIds.length) throw new UpError("BAD_ARGS", "no chain selected", { hint: "pass --chains 42,8453 or set: up config set chains 42" });
    const rec = recommend(me, profile, recommendationOptions(a));
    const statuses: ChainJoinStatus[] = [];
    for (const c of chainIds) statuses.push(await joinStatus(ctx, c, profile, me, BigInt(rec.permissions.hex)));
    if (a["set-default"]) cfg.defaultProfile = profile;
    if (a.alias) {
      if (isAddress(a.alias, { strict: false })) throw new UpError("BAD_ARGS", "alias must not look like an address");
      cfg.aliases = { ...(cfg.aliases ?? {}), [a.alias]: profile };
    }
    await ctx.saveConfig(cfg);
    const prev = await readProfileRecord(ctx.home, profile);
    await writeProfileRecord(ctx.home, profile, { joined: { at: prev.joined?.at ?? new Date().toISOString(), checkedAt: new Date().toISOString(), controller: me, chains: statuses.map((s) => ({ chainId: s.chainId, authorised: s.authorised, deployed: s.deployed })) } });
    const pending = statuses.filter((s) => s.deployed && !s.authorised);
    const lines = [
      `profile ${profile} — this agent's controller: ${me}`,
      ...statuses.map((s) => `  chain ${s.chainId}: ${!s.deployed ? `not deployed${s.error ? ` (${s.error})` : ""}` : s.authorised ? `AUTHORISED (${s.permissions!.join(", ")})${s.missing!.length ? `; missing recommended: ${s.missing!.join(", ")}` : ""}` : "NOT AUTHORISED yet"}${s.deployed && s.otherControllers?.length ? `; other controllers: ${s.otherControllers.length}` : ""}`),
      ...(pending.length ? ["", "Hand this to the human:", rec.text] : []),
    ];
    return { data: { profile, controller: me, chains: statuses, recommendation: rec, defaultProfile: a["set-default"] ? profile : cfg.defaultProfile }, text: lines.join("\n") };
  },
});

defineVerb({
  name: "permissions recommend",
  group: "permissions",
  summary: "Recommended permission set for this agent's controller (agent-operator by default) as plain text + JSON, without joining a profile.",
  risk: "local",
  params: [{ name: "controller", type: "string", description: "Controller address (default: this agent's)." }, ...RECOMMEND_PARAMS],
  async run(ctx, a) {
    const me = a.controller ? addressArg(a.controller, "controller") : await controllerAddress(ctx);
    let profile: Address | undefined;
    try {
      profile = await ctx.profile(a.profile);
    } catch {}
    const rec = recommend(me, profile, recommendationOptions(a));
    return { data: rec, text: rec.text };
  },
});
