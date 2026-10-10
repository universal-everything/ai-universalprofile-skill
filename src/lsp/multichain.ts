// One Universal Profile, many chains.
//
// The profile is ONE account (identity). It can be deployed on many EVM chains, normally
// at the same address. On each chain it has its own deployment status, balances and assets,
// controllers and permissions, nonces and relayer quota, and the agent may even sign with a
// chain-specific key. Nothing moves between chains except through an explicit bridge.
//
// This module answers "what is the state of my profile on chain X?" (read-only, per chain,
// never failing as a whole) and runs the preflight every write path uses before it builds an
// action on a chain, so failures are explained in profile language with the exact fix:
// deploy there (same address), authorise this agent's key there, or fund gas there.
import { formatEther, getAddress, isAddress, type Address, type Hex } from "viem";
import type { UpConfig, VerbContext } from "../core/types.ts";
import { UpError } from "../core/errors.ts";
import { profileAddressOn, readProfileRecord, updateProfileRecord } from "../core/profile-record.ts";
import { controllerFor } from "../signer/select.ts";
import { selectRelayer } from "../relayer/registry.ts";
import { ADMIN_PERMISSIONS, ALL_PERMISSIONS, INTERFACE_IDS, PERMISSIONS } from "./constants.ts";
import { hasPermission } from "./permissions.ts";
import { recommend } from "./controllers.ts";
import { readControllerPermissions, resolveKeyManager, supportsInterface, type ControllerInfo } from "./profile.ts";
import { getBalance, hasCode, tryRead } from "./read.ts";
import { UP_ABI } from "./abis.ts";

/** Rough gas budget for one direct profile action; below gasPrice × this the agent's key counts as "low on gas". */
export const DIRECT_ACTION_GAS = 300_000n;

export interface ChainLabel {
  chainId: number;
  name: string;
  /** What to pass to --chain in suggested commands (slug when known, else the id). */
  arg: string;
  nativeSymbol: string;
  /** Registry data: are the canonical LSP contracts deployed there? undefined = unknown chain. */
  lspDeployed?: boolean;
}

export function chainLabel(ctx: Pick<VerbContext, "registry">, chainId: number): ChainLabel {
  try {
    const c = ctx.registry.chain(chainId);
    return { chainId, name: c.name, arg: c.slug || String(chainId), nativeSymbol: c.nativeSymbol, lspDeployed: c.lsp?.deployed };
  } catch {
    return { chainId, name: `chain ${chainId}`, arg: String(chainId), nativeSymbol: "native coin" };
  }
}

/** "Base (8453)" */
export function onChain(l: Pick<ChainLabel, "name" | "chainId">): string {
  return l.name === `chain ${l.chainId}` ? l.name : `${l.name} (${l.chainId})`;
}

// ---------------------------------------------------------------------------
// Per-chain status (read-only)
// ---------------------------------------------------------------------------

export interface ChainControllerStatus {
  address: Address;
  /** "chain": the agent's chain-specific key; "default": its default key. */
  scope: "chain" | "default";
  isController: boolean;
  permissions: string[];
  permissionsHex?: Hex;
  admin: boolean;
  canRelay: boolean;
  canSign: boolean;
  /** CALL/TRANSFERVALUE/STATICCALL without the SUPER_ variant: calls are limited to AllowedCalls. */
  restrictedCalls: boolean;
  allowedCalls: number;
  /** SETDATA without SUPER_SETDATA: data writes are limited to AllowedERC725YDataKeys. */
  restrictedDataKeys: boolean;
  allowedDataKeys: number;
  /** Native balance of the key (pays gas on direct paths and deployments), wei. */
  balance?: string;
  balanceFormatted?: string;
  lowGas?: boolean;
}

export interface ChainProfileStatus {
  chainId: number;
  chain: string;
  chainArg: string;
  nativeSymbol: string;
  /** The profile's address on this chain (a linked address when it differs from the identity). */
  profile: Address;
  linked: boolean;
  lspContracts?: boolean;
  deployed: boolean;
  isUniversalProfile?: boolean;
  version?: string;
  owner?: Address;
  ownerKind?: string;
  keyManager?: Address;
  profileBalance?: string;
  profileBalanceFormatted?: string;
  controller?: ChainControllerStatus;
  /** Another local key of this agent that IS a controller here (when the chain's key is not). */
  otherLocalController?: { address: Address; permissions: string[] };
  relayer?: { name: string; baseUrl: string } | null;
  /** A relayer covers the chain and the key has EXECUTE_RELAY_CALL (quota is not checked: that needs a signature). */
  relayUsable: boolean;
  /** A local deployment manifest exists, so `account deploy` can replay the profile here at the same address. */
  manifest: boolean;
  ready: boolean;
  nextSteps: string[];
  error?: string;
  errorCode?: string;
}

/** Human-readable amount, at most 6 decimals (exact wei stays in the data). */
export function formatAmount(wei: bigint, sym: string): string {
  const [int, dec = ""] = formatEther(wei).split(".");
  const d = dec.slice(0, 6).replace(/0+$/, "");
  if (wei > 0n && int === "0" && !d) return `< 0.000001 ${sym}`;
  return `${int}${d ? `.${d}` : ""} ${sym}`;
}

const fmt = formatAmount;

function controllerStatus(key: { address: Address; scope: "chain" | "default" }, c: ControllerInfo | undefined): ChainControllerStatus {
  const v = c?.permissions.value ?? 0n;
  const P = PERMISSIONS;
  const limited = (plain: bigint, sup: bigint) => (v & plain) !== 0n && (v & sup) === 0n;
  return {
    address: key.address,
    scope: key.scope,
    isController: v !== 0n,
    permissions: c?.permissions.names ?? [],
    permissionsHex: c?.permissions.hex,
    admin: (v & ADMIN_PERMISSIONS) !== 0n,
    canRelay: hasPermission(v, "EXECUTE_RELAY_CALL"),
    canSign: hasPermission(v, "SIGN"),
    restrictedCalls: limited(P.CALL, P.SUPER_CALL) || limited(P.TRANSFERVALUE, P.SUPER_TRANSFERVALUE) || limited(P.STATICCALL, P.SUPER_STATICCALL),
    allowedCalls: c?.allowedCalls.length ?? 0,
    restrictedDataKeys: limited(P.SETDATA, P.SUPER_SETDATA),
    allowedDataKeys: c?.allowedDataKeys.length ?? 0,
  };
}

/**
 * Reads the profile's state on one chain. Never throws: an unreachable RPC or any other
 * failure is reported in `error` so the other chains of the overview stay usable.
 */
export async function readChainStatus(ctx: VerbContext, identity: Address, chainId: number, opts: { manifest?: boolean; cfg?: UpConfig } = {}): Promise<ChainProfileStatus> {
  const l = chainLabel(ctx, chainId);
  const cfg = opts.cfg ?? (await ctx.config());
  const s: ChainProfileStatus = {
    chainId,
    chain: l.name,
    chainArg: l.arg,
    nativeSymbol: l.nativeSymbol,
    profile: getAddress(identity),
    linked: false,
    lspContracts: l.lspDeployed,
    deployed: false,
    relayUsable: false,
    manifest: opts.manifest ?? false,
    ready: false,
    nextSteps: [],
  };
  try {
    s.profile = await profileAddressOn(ctx.home, identity, chainId);
    s.linked = s.profile !== getAddress(identity);
    let key: { address: Address; scope: "chain" | "default" } | undefined;
    try {
      const k = controllerFor(cfg, chainId);
      if (k) key = { address: k.address, scope: k.scope };
    } catch {}
    // which key applies here is known even when the chain cannot be reached
    if (key) s.controller = controllerStatus(key, undefined);
    s.relayer = await selectRelayer(ctx, chainId).then((r) => (r ? { name: r.name, baseUrl: r.baseUrl } : null), () => null);
    const [deployed, keyBalance, gasPrice] = await Promise.all([
      hasCode(ctx, chainId, s.profile),
      key ? getBalance(ctx, chainId, key.address) : Promise.resolve(undefined),
      key ? ctx.rpc.request<Hex>(chainId, "eth_gasPrice", []).then((x) => BigInt(x), () => undefined) : Promise.resolve(undefined),
    ]);
    s.deployed = deployed;
    let perms: ControllerInfo | undefined;
    if (deployed) {
      const [lsp0, balance] = await Promise.all([supportsInterface(ctx, chainId, s.profile, INTERFACE_IDS.LSP0ERC725Account), getBalance(ctx, chainId, s.profile)]);
      s.isUniversalProfile = lsp0;
      s.profileBalance = balance.toString();
      s.profileBalanceFormatted = fmt(balance, l.nativeSymbol);
      // some other contract at this address: report it, do not probe it as a profile
      if (lsp0) {
        const [km, version] = await Promise.all([resolveKeyManager(ctx, chainId, s.profile), tryRead<string>(ctx, chainId, s.profile, UP_ABI, "VERSION")]);
        s.version = version;
        s.owner = km.owner;
        s.ownerKind = km.ownerKind;
        s.keyManager = km.keyManager;
        if (key && km.keyManager) perms = await readControllerPermissions(ctx, chainId, s.profile, key.address);
      }
    }
    if (key) {
      s.controller = controllerStatus(key, perms);
      if (keyBalance !== undefined) {
        s.controller.balance = keyBalance.toString();
        s.controller.balanceFormatted = fmt(keyBalance, l.nativeSymbol);
        s.controller.lowGas = gasPrice !== undefined ? keyBalance < gasPrice * DIRECT_ACTION_GAS : keyBalance === 0n;
      }
      s.relayUsable = !!s.relayer && s.controller.canRelay;
      if (deployed && s.keyManager && !s.controller.isController) s.otherLocalController = await otherLocalController(ctx, cfg, chainId, s.profile, key.address);
    }
  } catch (e) {
    s.error = (e as Error).message;
    s.errorCode = e instanceof UpError ? e.code : undefined;
  }
  s.ready = !s.error && s.deployed && s.isUniversalProfile !== false && !!s.keyManager && !!s.controller?.isController && (s.relayUsable || !s.controller.lowGas);
  s.nextSteps = nextStepsFor(s);
  return s;
}

/** Another local key (default, chain-specific or a previous key the agent keeps) that is a controller of `profile` on `chainId`. */
async function otherLocalController(ctx: VerbContext, cfg: UpConfig, chainId: number, profile: Address, except: Address): Promise<{ address: Address; permissions: string[] } | undefined> {
  const candidates = new Set<Address>();
  if (cfg.controller?.address) candidates.add(getAddress(cfg.controller.address));
  for (const c of Object.values(cfg.chainControllers ?? {})) if (c?.address) candidates.add(getAddress(c.address));
  // e.g. the key that created the profile: on networks deployed later only the first owners have access
  for (const c of cfg.previousControllers ?? []) if (c?.address && isAddress(c.address, { strict: false })) candidates.add(getAddress(c.address));
  candidates.delete(getAddress(except));
  for (const a of candidates) {
    const p = await readControllerPermissions(ctx, chainId, profile, a).catch(() => undefined);
    if (p && p.permissions.value !== 0n) return { address: a, permissions: p.permissions.names };
  }
  return undefined;
}

/** The concrete next step(s) for one chain, in profile language. Pure (tested with plain objects). */
export function nextStepsFor(s: ChainProfileStatus): string[] {
  const where = onChain({ name: s.chain, chainId: s.chainId });
  const arg = s.chainArg;
  if (s.error) return [`could not read ${where} (${s.error}); retry later or find a working RPC: up chains rpc find ${s.chainId}`];
  const keep = `do not send assets to ${s.profile} on ${s.chain} until your profile is deployed there`;
  if (!s.deployed) {
    if (s.lspContracts === false) return [`the LSP contracts are not deployed on ${where}, so your profile cannot be deployed there by this skill (check: up chains verify ${arg})`, keep];
    if (s.manifest) {
      const gas = s.controller?.lowGas ? `; first fund the agent's key ${s.controller.address} on ${s.chain} for gas: up display address ${s.controller.address} --chain ${arg}` : "";
      return [`deploy your profile on ${where} at the same address: up account deploy --chain ${arg} --dry-run, then with the human's approval (replays the saved deployment manifest; the agent's key pays the gas)${gas}`, keep];
    }
    return [
      `your profile is not deployed on ${where} yet and this agent has no deployment manifest to replay: ask the human to deploy it there with the same inputs (same address, e.g. with the app or relayer that created it), or, if it exists there at another address, link that address: up profile link <address> --chain ${arg}`,
      keep,
    ];
  }
  if (s.isUniversalProfile === false || !s.keyManager) {
    return [`the contract at ${s.profile} on ${where} is not a Universal Profile owned by a Key Manager, so the agent cannot act as your profile there; if your profile lives at another address on ${s.chain}, link it: up profile link <address> --chain ${arg}`];
  }
  if (!s.controller) return ["create the agent's key first: up init"];
  const c = s.controller;
  if (!c.isController) {
    const steps = [`ask the human to authorise this agent's key ${c.address} on ${where} (permissions are per chain; a grant on another chain does not count here): up permissions recommend --chain ${arg} prints the recommended set to hand over`];
    if (s.otherLocalController) steps.push(`or use the agent's key ${s.otherLocalController.address}, which already is a controller on ${s.chain}: up key activate ${s.otherLocalController.address} --chain ${arg} (needs the human's approval)`);
    return steps;
  }
  const steps: string[] = [];
  if (c.lowGas && !s.relayUsable) {
    steps.push(`fund the agent's key ${c.address} on ${where} for gas (it holds ${c.balanceFormatted ?? "nothing"}): up display address ${c.address} --chain ${arg} shows the QR code`);
    if (s.relayer && !c.canRelay) steps.push(`or let it use the relayer ${s.relayer.name} gaslessly: the human adds EXECUTE_RELAY_CALL for ${c.address} on ${s.chain} (up controller edit ${c.address} --add EXECUTE_RELAY_CALL --chain ${arg})`);
    return steps;
  }
  steps.push(s.relayUsable ? `ready: the agent can act as your profile on ${s.chain} gaslessly through the relayer ${s.relayer!.name} (check quota: up relayer quota --chain ${arg}) or directly` : `ready: the agent can act as your profile on ${s.chain} directly (its key pays gas)`);
  return steps;
}

function permissionSummary(c: ChainControllerStatus): string {
  const v = c.permissionsHex ? BigInt(c.permissionsHex) : 0n;
  const names = v === ALL_PERMISSIONS ? "all permissions" : c.permissions.join(", ");
  const limits = [c.restrictedCalls ? (c.allowedCalls ? `calls limited to ${c.allowedCalls} AllowedCalls entr${c.allowedCalls === 1 ? "y" : "ies"}` : "no AllowedCalls, so no calls") : "", c.restrictedDataKeys ? (c.allowedDataKeys ? `data writes limited to ${c.allowedDataKeys} allowed key${c.allowedDataKeys === 1 ? "" : "s"}` : "no allowed data keys") : ""].filter(Boolean);
  return `${names}${limits.length ? ` (${limits.join("; ")})` : ""}`;
}

/** One line for a chain, e.g. "Base (8453): not deployed yet". */
export function describeChainStatus(s: ChainProfileStatus): string {
  const where = onChain({ name: s.chain, chainId: s.chainId });
  const at = s.linked ? ` at its linked address ${s.profile}` : "";
  if (s.error) return `${where}: could not be checked (${s.error})`;
  if (!s.deployed) return `${where}: not deployed yet${at}`;
  if (s.isUniversalProfile === false || !s.keyManager) return `${where}: ${s.profile} is not a Universal Profile with a Key Manager`;
  const parts = [`deployed${at}${s.version ? ` (UP ${s.version})` : ""}`];
  const c = s.controller;
  if (!c) parts.push("the agent has no key yet");
  else if (!c.isController) parts.push(`this agent's key ${c.address} is not a controller here yet`);
  else parts.push(`the agent${c.scope === "chain" ? ` (chain key ${c.address})` : ""} can act with ${permissionSummary(c)}`);
  if (s.profileBalanceFormatted) parts.push(`profile balance ${s.profileBalanceFormatted}`);
  if (c?.balanceFormatted) parts.push(`agent key gas ${c.balanceFormatted}${c.lowGas ? " (low)" : ""}`);
  if (s.relayer) parts.push(`relayer ${s.relayer.name}${c?.isController && !c.canRelay ? " (needs EXECUTE_RELAY_CALL)" : ""}`);
  return `${where}: ${parts.join("; ")}`;
}

/** The whole cross-chain overview as text for the human. */
export function formatProfileStatus(identity: Address, statuses: ChainProfileStatus[], defaultKey?: Address): string {
  const ready = statuses.filter((s) => s.ready).map((s) => s.chain);
  const lines = [
    `Your Universal Profile ${identity} — one account on ${statuses.length} chain${statuses.length === 1 ? "" : "s"}; each chain has its own deployment, controllers, permissions and balances${defaultKey ? ` (agent key ${defaultKey}${statuses.some((s) => s.controller?.scope === "chain") ? ", own keys on some chains" : ""})` : ""}:`,
  ];
  for (const s of statuses) {
    lines.push(`- ${describeChainStatus(s)}`);
    for (const n of s.nextSteps) lines.push(`  → ${n}`);
  }
  lines.push(ready.length ? `Ready on: ${ready.join(", ")}.` : "Not ready on any chain yet.");
  return lines.join("\n");
}

/**
 * Compact per-chain snapshot stored in the profile record. Touches only the record's `status`
 * key, merged under the record lock with the LATEST on-disk record: other chains' entries and
 * every other key (manifest, links, joined state) written meanwhile are kept.
 */
export async function saveStatusSnapshot(home: string, identity: Address, statuses: ChainProfileStatus[]): Promise<void> {
  const checkedAt = new Date().toISOString();
  const fresh: Record<string, unknown> = {};
  for (const s of statuses) {
    fresh[String(s.chainId)] = {
      checkedAt,
      chain: s.chain,
      profile: s.profile,
      linked: s.linked || undefined,
      deployed: s.error ? undefined : s.deployed,
      keyManager: s.keyManager,
      controller: s.controller?.address,
      controllerScope: s.controller?.scope,
      isController: s.error ? undefined : s.controller?.isController,
      permissions: s.error ? undefined : s.controller?.permissions,
      ready: s.ready,
      error: s.error,
    };
  }
  await updateProfileRecord(home, identity, (latest) => ({ status: { checkedAt, chains: { ...(latest.status?.chains ?? {}), ...fresh } } }));
}

// ---------------------------------------------------------------------------
// Preflight for write paths
// ---------------------------------------------------------------------------

/**
 * Checks, before any action is built on `chainId`, that the profile is deployed there, owned
 * by a Key Manager and that `signer` (the agent's key for that chain) is a controller.
 * Throws NOT_DEPLOYED / NOT_SUPPORTED / NOT_AUTHORISED with the per-chain fix in the hint.
 */
export async function preflightProfileOnChain(ctx: VerbContext, chainId: number, profile: Address, signer: Address): Promise<{ keyManager: Address; controller: ControllerInfo }> {
  const l = chainLabel(ctx, chainId);
  const where = onChain(l);
  if (!(await hasCode(ctx, chainId, profile))) throw await notDeployedError(ctx, l, profile, signer);
  const km = await resolveKeyManager(ctx, chainId, profile);
  if (!km.keyManager) {
    const why = km.ownerKind === "none" ? "it has no owner (ownership was renounced)" : km.ownerKind === "eoa" ? `its owner ${km.owner} is an EOA, not a Key Manager` : `its owner ${km.owner} is not an LSP6 Key Manager linked to it`;
    throw new UpError("NOT_SUPPORTED", `cannot act as ${profile} on ${where}: ${why}`, {
      hint: `only profiles owned by an LSP6 Key Manager can be controlled by the agent's key; if your profile lives at another address on ${l.name}, link it: up profile link <address> --chain ${l.arg}`,
      details: { chainId, profile, owner: km.owner, ownerKind: km.ownerKind },
    });
  }
  const c = await readControllerPermissions(ctx, chainId, profile, signer);
  if (c.permissions.value === 0n) throw await notControllerError(ctx, l, profile, signer);
  return { keyManager: km.keyManager, controller: c };
}

async function notDeployedError(ctx: VerbContext, l: ChainLabel, profile: Address, signer: Address): Promise<UpError> {
  const where = onChain(l);
  const record = await readProfileRecord(ctx.home, profile).catch(() => ({}) as Record<string, any>);
  const manifest = !!record.deployment;
  const s = { chainId: l.chainId, chain: l.name, chainArg: l.arg, nativeSymbol: l.nativeSymbol, profile, linked: false, lspContracts: l.lspDeployed, deployed: false, relayUsable: false, manifest, ready: false, nextSteps: [] } as ChainProfileStatus;
  const next = nextStepsFor(s);
  return new UpError("NOT_DEPLOYED", `your Universal Profile ${profile} is not deployed on ${where} yet (it is one account across chains, but each chain needs its own deployment)`, {
    hint: next.join("; "),
    details: { chainId: l.chainId, chain: l.name, profile, deployed: false, manifest, controller: signer, next },
  });
}

async function notControllerError(ctx: VerbContext, l: ChainLabel, profile: Address, signer: Address): Promise<UpError> {
  const where = onChain(l);
  const cfg = await ctx.config();
  const other = await otherLocalController(ctx, cfg, l.chainId, profile, signer).catch(() => undefined);
  const rec = recommend(signer, profile, { preset: "agent-operator" });
  const hint = [
    `ask the human to authorise this agent's key ${signer} on ${l.name} (permissions are per chain; recommended set ${rec.preset}: ${rec.permissions.names.join(", ")} — the full text: up permissions recommend --chain ${l.arg})`,
    other ? `or use the agent's key ${other.address}, which already is a controller on ${l.name}: up key activate ${other.address} --chain ${l.arg} (needs the human's approval)` : "",
  ].filter(Boolean);
  return new UpError("NOT_AUTHORISED", `on ${where} this agent's key ${signer} is not a controller of your Universal Profile ${profile}`, {
    hint: hint.join("; "),
    details: { errorName: "NoPermissionsSet", chainId: l.chainId, chain: l.name, profile, controller: signer, otherLocalController: other, recommendation: { preset: rec.preset, permissions: rec.permissions, allowedCalls: rec.allowedCalls.described } },
  });
}

const PERMISSION_ERRORS = new Set(["NotAuthorised", "NoPermissionsSet", "NotAllowedCall", "NoCallsAllowed", "NotAllowedERC725YDataKey", "NoERC725YDataKeysAllowed"]);

/**
 * Adds the chain and profile to permission and gas errors raised while executing on a chain
 * (code, message and details unchanged; the hint gains the precise per-chain fix).
 */
export function withChainContext(ctx: Pick<VerbContext, "registry">, e: unknown, chainId: number, profile: Address, signer: Address): unknown {
  if (!(e instanceof UpError)) return e;
  const l = chainLabel(ctx, chainId);
  const d = (e.details ?? {}) as any;
  const name: string | undefined = d.errorName ?? d.revert?.errorName;
  let extra: string | undefined;
  // decoded LSP6 reverts: the per-chain hint replaces the generic one; ERC-4337 errors keep their own explanation too
  let keepHint = !!d.revert;
  if (name && PERMISSION_ERRORS.has(name) && !d.chain) {
    const args: unknown[] = d.args ?? d.revert?.args ?? [];
    if (name === "NotAuthorised" && typeof args[1] === "string") extra = `on ${l.name} the agent's key ${signer} lacks ${args[1]} on your profile ${profile}: ask the human to grant exactly that there (up controller edit ${signer} --add ${args[1]} --chain ${l.arg}); permissions on other chains are unaffected`;
    else if (name === "NoPermissionsSet") extra = `on ${l.name} the agent's key ${signer} is not a controller of your profile ${profile}: ask the human to authorise it there (up permissions recommend --chain ${l.arg})`;
    else if (name === "NotAllowedCall" || name === "NoCallsAllowed") extra = `on ${l.name} this target/function is outside the AllowedCalls of the agent's key ${signer}: ask the human to add an entry there (up allowed-calls show --chain ${l.arg})`;
    else extra = `on ${l.name} this data key is outside the allowed data keys of the agent's key ${signer}: ask the human to add it there (up allowed-keys show --chain ${l.arg})`;
  } else if (e.code === "TX_FAILED" && /insufficient native balance/.test(e.message)) {
    extra = `ask the human to fund the agent's key ${signer} on ${onChain(l)} with ${l.nativeSymbol} for gas: up display address ${signer} --chain ${l.arg} (QR code); or use a relayer if one covers ${l.name} (up relayer list)`;
    keepHint = false;
  }
  if (!extra) return e;
  return new UpError(e.code, e.message, { hint: keepHint && e.hint ? `${extra}; ${e.hint}` : extra, details: e.details, cause: e });
}
