// Opening a backup file and restoring from it: password and keys, which profiles may be restored
// (the app's anti-impersonation rules), and the writes to the key store, key records and profile
// records. Keys are permanent: nothing here deletes, replaces or overwrites a key, a manifest or
// an earlier record, and a key is recorded in keys/inventory.jsonl before it is stored.
import { basename } from "node:path";
import { getAddress, type Address } from "viem";
import { UpError } from "../core/errors.ts";
import { updateProfileRecord } from "../core/profile-record.ts";
import type { SignerBackend, UpConfig, VerbContext } from "../core/types.ts";
import { verifyManifest, type DeploymentManifest } from "../lsp/lsp23.ts";
import { readControllerPermissions } from "../lsp/profile.ts";
import { hasCode } from "../lsp/read.ts";
import { internalBackend } from "../signer/index.ts";
import { readCandidates, importRecorded, updateCandidates, withKeyLock } from "../signer/verbs.ts";
import { readInventory } from "../signer/inventory.ts";
import { chainControllerList } from "../signer/select.ts";
import { decryptSecrets, openKey, type OpenedKey } from "./lsp30-crypto.ts";
import { parseBackup, type BackupAccount, type BackupLsp23Item, type Issue, type ParsedBackup } from "./lsp30-format.ts";
import { decodeDeployment, manifestFromBackup, permissionMismatch, type DecodedDeployment } from "./lsp23-decode.ts";

// ---------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------

export interface OpenedBackup {
  parsed: ParsedBackup;
  issues: Issue[];
  /** Keys from the file (empty for a public file). Their addresses are derived, never read from the file. */
  keys: OpenedKey[];
  seedPhraseEntries: number;
  decryption?: { iterations: number; passwordForm: string; shape: string };
}

export function issueSummary(issues: Issue[]): string {
  return issues.filter((i) => i.level === "error").map((i) => `${i.code}: ${i.message}`).join("; ");
}

/** Parses the file and, when it holds keys, opens them (decrypting with `password` for an encrypted file). */
export async function openBackup(text: string, password: string | undefined): Promise<OpenedBackup> {
  const { backup, issues } = parseBackup(text);
  if (!backup) throw new UpError("BAD_ARGS", `the backup file is not valid: ${issueSummary(issues) || "unreadable"}`, { details: { issues }, hint: "check it with: up backup inspect <file>" });
  const s = backup.secrets;
  let keys: OpenedKey[] = [];
  let seedPhraseEntries = 0;
  let decryption: OpenedBackup["decryption"];
  if (s.kind === "encrypted") {
    if (!password) throw new UpError("BAD_ARGS", "this backup is password protected: its password is needed", { hint: "ask the human for the password and pass it with --password (or --password-env / --password-stdin)", details: { passwordHint: s.hint ?? null } });
    const opened = await decryptSecrets(s.data, password);
    keys = opened.keys;
    seedPhraseEntries = opened.seedPhraseEntries;
    decryption = { iterations: opened.iterations, passwordForm: opened.passwordForm, shape: opened.shape };
  } else if (s.kind === "plain") {
    keys = s.entries.map((e) => openKey(e.secret, e.index, e.address));
    seedPhraseEntries = s.skippedSeedEntries;
  }
  const byIndex = new Map(keys.map((k) => [k.index, k]));
  const all = [...issues];
  const referenced = new Set<number>();
  for (const a of backup.accounts) for (const n of a.networks) for (const c of n.controllers) if (c.privateKeyIndex !== undefined) referenced.add(c.privateKeyIndex);
  for (const l of backup.lsp23) for (const c of l.initialControllers) if (c.privateKeyIndex !== undefined) referenced.add(c.privateKeyIndex);
  for (const i of referenced) if (!byIndex.has(i)) all.push({ level: "warn", code: "unresolved-key-index", message: `a controller points at key number ${i}, which the file does not hold` });
  for (const k of keys) if (k.claimedAddress) all.push({ level: "warn", code: "address-mismatch", message: `key number ${k.index} is stored with an address that is not its own; the real address is used` });
  if (seedPhraseEntries) all.push({ level: "warn", code: "seed-phrase", message: `${seedPhraseEntries} seed phrase entr${seedPhraseEntries === 1 ? "y" : "ies"} found; seed phrases are not supported and were skipped` });
  return { parsed: backup, issues: all, keys, seedPhraseEntries, decryption };
}

// ---------------------------------------------------------------------------
// Which profiles may be restored
// ---------------------------------------------------------------------------

export interface ItemAnalysis {
  item: BackupLsp23Item;
  decoded: DecodedDeployment;
  manifest?: DeploymentManifest;
  /** Why no manifest can be built from this item (the item is then kept as inert data). */
  reason?: string;
  permissionNotes: string[];
}

export interface AccountAnalysis {
  account: BackupAccount;
  chains: number[];
  items: ItemAnalysis[];
  /** Addresses listed as controllers (networks and initial controllers) whose key is in the file or on this machine. */
  heldControllers: Address[];
  /** File keys that belong to this profile: referenced by index or by address. */
  fileKeys: OpenedKey[];
  /** The calldata proves a held key is a genuine initial controller of this profile. */
  proof: boolean;
}

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** `localKeys`: addresses of keys this machine already holds; they count as held keys next to the file's. */
export function analyseAccounts(opened: OpenedBackup, localKeys: ReadonlySet<string>): AccountAnalysis[] {
  const fileByAddress = new Map(opened.keys.map((k) => [k.address.toLowerCase(), k]));
  const held = new Set([...fileByAddress.keys(), ...localKeys]);
  return opened.parsed.accounts.map((account) => {
    const items = opened.parsed.lsp23.filter((l) => sameAddress(l.profileAddress, account.address)).map((item): ItemAnalysis => {
      const decoded = decodeDeployment(item);
      const { manifest, reason } = manifestFromBackup(item, decoded, held);
      return { item, decoded, manifest, reason, permissionNotes: item.initialControllers.flatMap((c) => permissionMismatch(c.addressPermissions).map((n) => `${n} for ${c.address}`)) };
    });
    const listed = new Set<string>();
    const indices = new Set<number>();
    for (const n of account.networks) for (const c of n.controllers) (listed.add(c.address.toLowerCase()), c.privateKeyIndex !== undefined && indices.add(c.privateKeyIndex));
    for (const it of items) for (const c of it.item.initialControllers) (listed.add(c.address.toLowerCase()), c.privateKeyIndex !== undefined && indices.add(c.privateKeyIndex));
    const heldControllers = [...listed].filter((a) => held.has(a)).map((a) => getAddress(a));
    const fileKeys = opened.keys.filter((k) => indices.has(k.index) || listed.has(k.address.toLowerCase()));
    const proof = items.some((it) => it.decoded.rederives && it.decoded.initialControllers.some((c) => !c.isUrd && held.has(c.address.toLowerCase())));
    const chains = [...new Set([...account.networks.map((n) => n.chainID), ...(account.networks.length ? [] : items.map((i) => i.item.initialChainID))])];
    return { account, chains, items, heldControllers, fileKeys, proof };
  });
}

export type ChainStatus = "controls" | "restorable-with-warning" | "unverified" | "not-deployed" | "no-controlling-key" | "impersonation-blocked";

export interface ChainDecision {
  chainId: number;
  status: ChainStatus;
  note?: string;
}

/** One chain, the app's RestoreEligibilityService rules: a held key that still controls → restorable; calldata proof → restorable with a warning. */
export async function decideChain(ctx: VerbContext, a: AccountAnalysis, chainId: number): Promise<ChainDecision> {
  try {
    ctx.registry.chain(chainId);
  } catch {
    return { chainId, status: "unverified", note: "this network is not in the registry" };
  }
  try {
    if (!(await hasCode(ctx, chainId, a.account.address))) return { chainId, status: "not-deployed" };
  } catch {
    return { chainId, status: "unverified", note: "the network could not be reached" };
  }
  let inconclusive = false;
  for (const key of a.heldControllers) {
    try {
      const info = await readControllerPermissions(ctx, chainId, a.account.address, key);
      if (info.permissions.value !== 0n) return { chainId, status: "controls" };
    } catch {
      inconclusive = true;
    }
  }
  if (inconclusive) return { chainId, status: "unverified", note: "the permissions could not be read" };
  if (a.proof) return { chainId, status: "restorable-with-warning", note: "controller-permissions-revoked: the key no longer has permissions on this network, but the file proves it created the profile" };
  return { chainId, status: a.heldControllers.length ? "impersonation-blocked" : "no-controlling-key" };
}

export type ProfileVerdict = "restorable" | "restorable-with-warning" | "unverified" | "not-deployed" | "no-controlling-key" | "impersonation-blocked";

export interface ProfileDecision {
  address: Address;
  verdict: ProfileVerdict;
  restorable: boolean;
  chains: ChainDecision[];
}

/** Combines the chains of one profile: any chain that works is enough. `online: false` trusts the file after the calldata checks. */
export async function decideProfile(ctx: VerbContext, a: AccountAnalysis, online: boolean): Promise<ProfileDecision> {
  const address = a.account.address;
  if (!online) {
    const forged = a.items.some((i) => !i.decoded.rederives && i.decoded.supported);
    const verdict: ProfileVerdict = !a.heldControllers.length ? "no-controlling-key" : forged && !a.proof ? "impersonation-blocked" : "unverified";
    return { address, verdict, restorable: verdict === "unverified", chains: a.chains.map((chainId) => ({ chainId, status: "unverified", note: "not checked on the network" })) };
  }
  const chains: ChainDecision[] = [];
  for (const c of a.chains) chains.push(await decideChain(ctx, a, c));
  const has = (s: ChainStatus) => chains.some((c) => c.status === s);
  const verdict: ProfileVerdict = has("controls") ? "restorable" : has("restorable-with-warning") ? "restorable-with-warning" : has("unverified") ? "unverified" : has("impersonation-blocked") ? "impersonation-blocked" : has("no-controlling-key") ? "no-controlling-key" : "not-deployed";
  return { address, verdict, restorable: verdict === "restorable" || verdict === "restorable-with-warning" || verdict === "unverified", chains };
}

// ---------------------------------------------------------------------------
// Keys already on this machine
// ---------------------------------------------------------------------------

/** Every key address this machine knows (config, candidates, inventory) with the key store that holds it, if it really holds it. */
export async function localKeyStores(ctx: VerbContext, cfg: UpConfig): Promise<Map<string, string>> {
  const known: { address: Address; backend: string }[] = [];
  if (cfg.controller) known.push(cfg.controller);
  known.push(...chainControllerList(cfg), ...(cfg.previousControllers ?? []), ...(await readCandidates(ctx.home)), ...(await readInventory(ctx.home)));
  const out = new Map<string, string>();
  for (const k of known) {
    const id = k.address.toLowerCase();
    if (out.has(id)) continue;
    try {
      if (await internalBackend(k.backend).has(k.address)) out.set(id, k.backend);
    } catch {
      /* unavailable key store */
    }
  }
  return out;
}

/** Whether a key is already in any key store this machine uses (the target store included). */
export async function existingStore(address: Address, known: ReadonlyMap<string, string>, target: { id: string; has(a: Address): Promise<boolean> } | undefined): Promise<string | undefined> {
  const hit = known.get(address.toLowerCase());
  if (hit || !target) return hit;
  try {
    return (await target.has(address)) ? target.id : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface KeyResult {
  address: Address;
  status: "restored" | "exists" | "failed";
  backend?: string;
}

/**
 * Restores keys one at a time under the key lock. A key that any known key store already holds is
 * skipped (`exists`); otherwise it is recorded in keys/inventory.jsonl, stored and read back by the
 * key store, and listed in keys/candidates.json (except `activeAddress`, which the caller makes the
 * active key because none is configured).
 * A failure stops the loop; keys stored before it stay, and are returned with the error.
 */
export async function restoreKeys(ctx: VerbContext, keys: OpenedKey[], backend: SignerBackend | undefined, backupDate: string, known: ReadonlyMap<string, string>, activeAddress?: Address): Promise<KeyResult[]> {
  const results: KeyResult[] = [];
  await withKeyLock(ctx.home, async () => {
    for (const k of keys) {
      const where = await existingStore(k.address, known, backend);
      if (where) {
        results.push({ address: k.address, status: "exists", backend: where });
        continue;
      }
      try {
        if (!backend) throw new UpError("INTERNAL", "no key store was chosen for the new keys");
        await importRecorded(ctx.home, backend, k.privateKey, `restored from LSP-30 backup ${backupDate}`);
        results.push({ address: k.address, status: "restored", backend: backend.id });
        // the key that becomes the active key is not "an additional key"; every other restored key is listed as one
        if (!activeAddress || !sameAddress(activeAddress, k.address)) await updateCandidates(ctx.home, (list) => [...list, { address: k.address, backend: backend.id, createdAt: new Date().toISOString() }]);
      } catch (e) {
        results.push({ address: k.address, status: "failed", ...(backend ? { backend: backend.id } : {}) });
        const err = e instanceof UpError ? e : new UpError("INTERNAL", (e as Error).message);
        throw new UpError(err.code, `${err.message} (${results.filter((r) => r.status === "restored").length} key(s) were restored before this; they stay in the key store and are listed)`, { hint: err.hint, details: { keys: results } });
      }
    }
  });
  return results;
}

/** A label from a file is untrusted text: control characters out, length capped. */
function cleanLabel(s: string): string {
  const t = s.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return t.length > 80 ? `${t.slice(0, 80)}…` : t;
}

export interface ProfileWrite {
  address: Address;
  manifest: "restored" | "kept-existing" | "conflict" | "none";
  chains: number[];
}

/** Creates or merges the profile record: the rebuilt manifest (never over a different existing one) and an `imported` note. */
export async function writeProfileRecords(
  ctx: VerbContext,
  profiles: { analysis: AccountAnalysis; manifest?: DeploymentManifest }[],
  info: { file: string; sha256: string; backupDate: string; restoredKeys: Address[]; skippedKeys: Address[] },
): Promise<ProfileWrite[]> {
  const out: ProfileWrite[] = [];
  for (const { analysis, manifest } of profiles) {
    let status: ProfileWrite["manifest"] = "none";
    await updateProfileRecord(ctx.home, analysis.account.address, (latest) => {
      const patch: Record<string, unknown> = {
        imported: {
          file: basename(info.file),
          sha256: info.sha256,
          backupDate: info.backupDate,
          at: new Date().toISOString(),
          ...(analysis.account.name ? { name: cleanLabel(analysis.account.name) } : {}),
          ...(analysis.items[0] ? { initialChainID: analysis.items[0].item.initialChainID } : {}),
          restoredKeys: info.restoredKeys,
          skippedKeys: info.skippedKeys,
        },
      };
      const cur = latest.deployment as DeploymentManifest | undefined;
      if (manifest && !cur) {
        const v = verifyManifest(manifest);
        if (v.ok) {
          patch.deployment = manifest;
          status = "restored";
        }
      } else if (manifest && cur) status = cur.deployCalldata?.toLowerCase() === manifest.deployCalldata.toLowerCase() ? "kept-existing" : "conflict";
      return patch;
    });
    out.push({ address: analysis.account.address, manifest: status, chains: analysis.chains });
  }
  return out;
}

/** Config changes of an import: default profile if none, chains the registry knows, the active key only if none is configured. */
export async function applyImportConfig(ctx: VerbContext, change: { defaultProfile?: Address; chains: number[]; active?: { address: Address; backend: string } }): Promise<{ chainsAdded: number[]; unknownChains: number[]; activeSet: boolean; defaultProfileSet: boolean }> {
  const known: number[] = [];
  const unknownChains: number[] = [];
  for (const c of change.chains) {
    try {
      ctx.registry.chain(c);
      known.push(c);
    } catch {
      unknownChains.push(c);
    }
  }
  const result = { chainsAdded: [] as number[], unknownChains, activeSet: false, defaultProfileSet: false };
  await ctx.updateConfig((cur) => {
    const next: UpConfig = { ...cur, version: 1 };
    result.chainsAdded = known.filter((c) => !(cur.chains ?? []).includes(c));
    if (result.chainsAdded.length) next.chains = [...(cur.chains ?? []), ...result.chainsAdded];
    if (!cur.defaultProfile && change.defaultProfile) {
      next.defaultProfile = change.defaultProfile;
      result.defaultProfileSet = true;
    }
    if (!cur.controller && change.active) {
      next.controller = { address: change.active.address, backend: change.active.backend, createdAt: new Date().toISOString() };
      result.activeSet = true;
    }
    return next;
  });
  return result;
}
