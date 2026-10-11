// Builds a backup file from this machine's state: the keys the agent holds, the profile records
// (deployment manifests, joined profiles, linked addresses) and the config. Everything here is
// public data; the private keys are read later, only inside the export verb, right before they are
// encrypted.
//
// Which keys: every key the agent holds in a key store (the default key, chain keys, previous keys,
// additional keys, keys only the recovery inventory knows), in a fixed order; a key's position in
// that list is its privateKeyIndex. `--profiles` narrows the profiles, not the keys: the agent's
// keys belong to the agent, not to one profile.
import { readdir } from "node:fs/promises";
import { getAddress, isAddress, type Address } from "viem";
import { UpError } from "../core/errors.ts";
import { paths } from "../core/home.ts";
import { chainAddressesOf, readProfileRecord } from "../core/profile-record.ts";
import type { UpConfig, VerbContext } from "../core/types.ts";
import { hasCode } from "../lsp/read.ts";
import { verifyManifest, type DeploymentManifest } from "../lsp/lsp23.ts";
import { readControllers } from "../lsp/profile.ts";
import { internalBackend } from "../signer/index.ts";
import { chainControllerList, controllerFor } from "../signer/select.ts";
import { keptKeys } from "../signer/verbs.ts";
import { appIncompatibilities, backupDate, type BackupAccount, type BackupController, type BackupFile, type BackupLsp23Item, type BackupMode, type BackupNetwork } from "./lsp30-format.ts";
import { decodeDeployment, initialControllersFor } from "./lsp23-decode.ts";
import { sha256Hex } from "./store.ts";

export interface HeldKey {
  address: Address;
  backend: string;
  kind: "default" | "chain" | "previous" | "additional" | "recovered";
}

export interface ProfileState {
  /** The account address written to the file (the identity, or a chain-specific linked address). */
  address: Address;
  name: string;
  chainIds: number[];
  /** Only a manifest that re-derives; with at least one recorded deployment. */
  manifest?: DeploymentManifest;
  /** Chain → controllers found on chain (only with --refresh). */
  onChain: Record<number, Address[]>;
}

export interface LocalState {
  keys: HeldKey[];
  profiles: ProfileState[];
  warnings: string[];
}

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const REFRESH_TIMEOUT_MS = 8000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timed out")), ms);
    p.then((v) => (clearTimeout(t), resolve(v)), (e) => (clearTimeout(t), reject(e)));
  });
}

/** The keys this machine holds, in file order, checked against their key stores. Private keys are not read here. */
export async function collectHeldKeys(ctx: VerbContext, cfg: UpConfig, warnings: string[]): Promise<HeldKey[]> {
  const listed: HeldKey[] = [];
  const add = (address: string, backend: string, kind: HeldKey["kind"]) => {
    if (isAddress(address, { strict: false }) && !listed.some((k) => sameAddress(k.address, address))) listed.push({ address: getAddress(address), backend, kind });
  };
  if (cfg.controller) add(cfg.controller.address, cfg.controller.backend, "default");
  for (const k of chainControllerList(cfg)) add(k.address, k.backend, "chain");
  for (const k of await keptKeys(ctx.home, cfg)) add(k.address, k.backend, k.kind);
  const held: HeldKey[] = [];
  for (const k of listed) {
    let has = false;
    try {
      has = await internalBackend(k.backend).has(k.address);
    } catch {
      /* unknown or unavailable key store: reported below */
    }
    if (has) held.push(k);
    else warnings.push(`the key ${k.address} is listed but is not in its key store (${k.backend}); it cannot be part of the backup`);
  }
  return held;
}

function deployedChains(m: DeploymentManifest | undefined, record: Record<string, any>): number[] {
  const ids = new Set<number>();
  for (const d of Object.values(m?.deployments ?? {})) if (d && (d.status === "deployed" || d.status === "already-deployed") && Number.isInteger(d.chainId)) ids.add(d.chainId);
  for (const id of m?.chains ?? []) if (Number.isInteger(id)) ids.add(id);
  for (const c of record.joined?.chains ?? []) if (c?.deployed === true && Number.isInteger(c.chainId)) ids.add(c.chainId);
  for (const [id, c] of Object.entries<any>(record.status?.chains ?? {})) if (c?.deployed === true && /^\d+$/.test(id)) ids.add(Number(id));
  return [...ids];
}

/** Profiles recorded on this machine (plus the default profile), narrowed to `only` when given. */
export async function collectProfiles(ctx: VerbContext, cfg: UpConfig, warnings: string[], opts: { only?: Address[]; refresh?: boolean } = {}): Promise<ProfileState[]> {
  const dir = paths.profiles(ctx.home);
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => /^0x[0-9a-fA-F]{40}\.json$/.test(n));
  const identities = new Map<string, Address>();
  for (const n of names) identities.set(n.slice(0, 42).toLowerCase(), getAddress(n.slice(0, 42)));
  if (cfg.defaultProfile) identities.set(cfg.defaultProfile.toLowerCase(), getAddress(cfg.defaultProfile));
  if (opts.only) {
    for (const o of opts.only) if (!identities.has(o.toLowerCase())) throw new UpError("BAD_ARGS", `no profile ${o} is known on this machine`, { hint: "the profiles known here are listed by: up profile status" });
  }
  const out: ProfileState[] = [];
  const aliasOf = (a: Address) => Object.entries(cfg.aliases ?? {}).find(([, v]) => sameAddress(v, a))?.[0] ?? "";
  // the default profile first, then by address, so the file does not change order between runs
  const ordered = [...identities.values()].sort((a, b) => (cfg.defaultProfile && sameAddress(a, cfg.defaultProfile) ? -1 : cfg.defaultProfile && sameAddress(b, cfg.defaultProfile) ? 1 : a.localeCompare(b)));
  for (const id of ordered) {
    if (opts.only && !opts.only.some((o) => sameAddress(o, id))) continue;
    const record = await readProfileRecord(ctx.home, id);
    const linked = chainAddressesOf(record);
    let manifest: DeploymentManifest | undefined = record.deployment;
    if (manifest && (manifest.kind !== "lsp23-erc1167-up" || !verifyManifest(manifest).ok)) {
      warnings.push(`the deployment data of ${id} does not check out (it is left out of the backup)`);
      manifest = undefined;
    }
    const linkedChains = new Set(Object.keys(linked).map(Number));
    let chainIds = deployedChains(manifest, record).filter((c) => !linkedChains.has(c));
    const onChain: Record<number, Address[]> = {};
    if (opts.refresh) {
      // best effort: chains the config lists but the record says nothing about, and the controllers found on chain
      for (const c of new Set([...chainIds, ...(cfg.chains ?? [])].filter((x) => !linkedChains.has(x)))) {
        try {
          if (!(await withTimeout(hasCode(ctx, c, id), REFRESH_TIMEOUT_MS))) continue;
          if (!chainIds.includes(c)) chainIds.push(c);
          onChain[c] = (await withTimeout(readControllers(ctx, c, id), REFRESH_TIMEOUT_MS)).controllers.map((x) => x.address);
        } catch (e) {
          warnings.push(`could not refresh ${id} on chain ${c}: ${(e as Error).message}`);
        }
      }
    }
    chainIds = [...new Set(chainIds)];
    const deployed = manifest ? Object.values(manifest.deployments ?? {}).some((d) => d?.status === "deployed" || d?.status === "already-deployed") : false;
    if (chainIds.length) out.push({ address: id, name: aliasOf(id), chainIds, ...(manifest && deployed ? { manifest } : {}), onChain });
    else if (!linkedChains.size) warnings.push(`the profile ${id} is not deployed or joined anywhere yet; nothing to back up for it`);
    for (const [chain, address] of Object.entries(linked)) out.push({ address, name: aliasOf(address), chainIds: [Number(chain)], onChain: {} });
  }
  return out;
}

export async function collectState(ctx: VerbContext, opts: { only?: Address[]; refresh?: boolean } = {}): Promise<LocalState> {
  const cfg = await ctx.config();
  const warnings: string[] = [];
  const keys = await collectHeldKeys(ctx, cfg, warnings);
  const profiles = await collectProfiles(ctx, cfg, warnings, opts);
  return { keys, profiles, warnings };
}

/** Fingerprints: what a backup has to cover to be current. `profiles` ignores keys (a public backup covers only that). */
export function fingerprints(state: Pick<LocalState, "keys" | "profiles">): { full: string; profiles: string } {
  const addrs = (xs: { address: string }[]) => xs.map((x) => x.address.toLowerCase()).sort();
  const profilePart = ["profiles", ...addrs(state.profiles), "deployments", ...state.profiles.flatMap((p) => (p.manifest ? [sha256Hex(p.manifest.deployCalldata.toLowerCase())] : [])).sort()];
  return { full: sha256Hex(["keys", ...addrs(state.keys), ...profilePart].join("\n")), profiles: sha256Hex(profilePart.join("\n")) };
}

function chainName(ctx: VerbContext, id: number): string {
  try {
    return ctx.registry.chain(id).name;
  } catch {
    return "Unknown chain"; // what the app writes for a chain it does not know
  }
}

function keyName(k: HeldKey, activeHere: boolean): string {
  if (activeHere) return "AI agent key";
  if (k.kind === "previous") return "AI agent key (previous)";
  if (k.kind === "additional" || k.kind === "recovered") return "AI agent key (not yet used)";
  return "AI agent key (other network)";
}

export interface BuiltBackup {
  /** The file without its secrets block (the caller adds encrypted, plain or empty secrets). */
  file: Omit<BackupFile, "secrets">;
  /** The key list in privateKeyIndex order (empty for a public backup). */
  keys: HeldKey[];
  chains: number[];
  appIncompatible: string[];
}

/** The public part of the backup. In `public` mode no controller carries a key index. */
export function buildBackup(ctx: VerbContext, cfg: UpConfig, state: LocalState, mode: BackupMode, now = new Date()): BuiltBackup {
  const withKeys = mode !== "public";
  const indexOf = (a: string) => {
    const i = state.keys.findIndex((k) => sameAddress(k.address, a));
    return withKeys && i >= 0 ? i : undefined;
  };
  const accounts: BackupAccount[] = [];
  const lsp23: BackupLsp23Item[] = [];
  for (const p of state.profiles) {
    const dec = p.manifest ? decodeDeployment({ profileAddress: p.manifest.profile, factoryAddress: p.manifest.plan.factory, deploymentCalldata: p.manifest.deployCalldata }) : undefined;
    const networks: BackupNetwork[] = [...p.chainIds]
      .sort((a, b) => (a === 42 ? -1 : b === 42 ? 1 : a - b)) // LUKSO mainnet first, then ascending (what the app does)
      .map((chainID) => {
        const active = controllerFor(cfg, chainID)?.address;
        const controllers: BackupController[] = [];
        const push = (c: BackupController) => {
          if (!controllers.some((x) => sameAddress(x.address, c.address))) controllers.push(c);
        };
        for (const k of state.keys) push({ address: k.address, type: "App", ...(indexOf(k.address) !== undefined ? { privateKeyIndex: indexOf(k.address) } : {}), name: keyName(k, !!active && sameAddress(active, k.address)) });
        for (const c of dec?.initialControllers ?? []) {
          if (c.isUrd) push({ address: c.address, type: "UniversalReceiver", name: "Universal Receiver" });
          else push({ address: c.address, type: "Device", name: "Co-owner (key not held by the agent)" });
        }
        for (const a of p.onChain[chainID] ?? []) push({ address: a, type: "Device", name: "Controller (found on chain)" });
        return { chainID, name: chainName(ctx, chainID), controllers };
      });
    accounts.push({ type: "LSP0-ERC725Account", name: p.name, address: p.address, networks });
    if (p.manifest && dec) {
      const first = Object.values(p.manifest.deployments).filter((d) => d.status === "deployed" || d.status === "already-deployed").sort((a, b) => a.deployedAt.localeCompare(b.deployedAt))[0];
      if (!first) continue;
      lsp23.push({
        profileAddress: p.manifest.profile,
        initialChainID: first.chainId,
        factoryAddress: p.manifest.plan.factory,
        deploymentCalldata: p.manifest.deployCalldata,
        salt: p.manifest.salt,
        initialControllers: initialControllersFor(dec, indexOf),
      });
    }
  }
  const file: Omit<BackupFile, "secrets"> = { version: 2, backupDate: backupDate(now), accounts, LSP23CrossChainDeployment: lsp23 };
  const appIncompatible = appIncompatibilities({ ...file, secrets: { encrypted: false, data: [] } });
  return { file, keys: withKeys ? state.keys : [], chains: [...new Set(accounts.flatMap((a) => a.networks.map((n) => n.chainID)))].sort((a, b) => a - b), appIncompatible };
}
