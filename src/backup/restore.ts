// Opening a backup file and restoring from it: password and keys, which profiles may be restored
// (the app's anti-impersonation rules), and the writes to the key store, key records and profile
// records. Keys are permanent: nothing here deletes, replaces or overwrites a key, a manifest or
// an earlier record, and a key is recorded in keys/inventory.jsonl before it is stored.
import { basename } from "node:path";
import { getAddress, isAddress, type Address } from "viem";
import { UpError } from "../core/errors.ts";
import { updateProfileRecord } from "../core/profile-record.ts";
import { assertNoKeyMaterial, textHoldsKey } from "../core/public-record.ts";
import { containsSecret } from "../core/secret-guard.ts";
import { KEY_WITHHELD, safeFileText } from "../core/safe-text.ts";
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
import { decodeDeployment, hasDefinedPermission, manifestFromBackup, permissionMismatch, type DecodedDeployment } from "./lsp23-decode.ts";

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
  const scrubbed = scrubPublicText(backup);
  if (scrubbed) all.push({ level: "warn", code: "key-material-in-metadata", message: `${scrubbed} name${scrubbed === 1 ? "" : "s"} or label${scrubbed === 1 ? "" : "s"} in the file held a private key (or looked like one) and ${scrubbed === 1 ? "was" : "were"} replaced` });
  const referenced = new Set<number>();
  for (const a of backup.accounts) for (const n of a.networks) for (const c of n.controllers) if (c.privateKeyIndex !== undefined) referenced.add(c.privateKeyIndex);
  for (const l of backup.lsp23) for (const c of l.initialControllers) if (c.privateKeyIndex !== undefined) referenced.add(c.privateKeyIndex);
  for (const i of referenced) if (!byIndex.has(i)) all.push({ level: "warn", code: "unresolved-key-index", message: `a controller points at key number ${i}, which the file does not hold` });
  for (const k of keys) if (k.claimedAddress) all.push({ level: "warn", code: "address-mismatch", message: `key number ${k.index} is stored with an address that is not its own; the real address is used` });
  if (seedPhraseEntries) all.push({ level: "warn", code: "seed-phrase", message: `${seedPhraseEntries} seed phrase entr${seedPhraseEntries === 1 ? "y" : "ies"} found; seed phrases are not supported and were skipped` });
  return { parsed: backup, issues: all, keys, seedPhraseEntries, decryption };
}

/** True when `text` holds a private key this process has loaded (also spread over separators) or is key-shaped. */
export const holdsKey = textHoldsKey;

/**
 * Every free-text field of the file is public data that is shown, audited and stored. After the keys are
 * open (and registered), any such field that holds one of them is replaced; returns how many were.
 * Key-shaped text is already withheld when the file is parsed; this covers what only the opened keys reveal.
 */
export function scrubPublicText(backup: ParsedBackup): number {
  let n = 0;
  const clean = (v: string | undefined): string | undefined => {
    if (v === undefined || !holdsKey(v)) return v;
    n++;
    return KEY_WITHHELD;
  };
  for (const a of backup.accounts) {
    if (a.name !== undefined) a.name = clean(a.name);
    if (a.type !== undefined) a.type = clean(a.type);
    for (const net of a.networks) {
      net.name = clean(net.name) ?? "";
      for (const c of net.controllers) {
        if (c.name !== undefined) c.name = clean(c.name);
        if (c.type !== undefined) c.type = clean(c.type);
      }
    }
  }
  const sec = backup.secrets;
  if (sec.kind === "encrypted") {
    if (sec.hint !== undefined) sec.hint = clean(sec.hint);
    if (sec.encryptionType !== undefined) sec.encryptionType = clean(sec.encryptionType);
  }
  backup.backupDate = clean(backup.backupDate) ?? "unknown";
  return n;
}

/** Refuses to go on when a text that is about to be stored or audited holds a loaded private key. */
export function assertNoKeyIn(what: string, ...texts: (string | undefined)[]): void {
  for (const t of texts) if (t && (containsSecret(t) || containsSecret(t.replace(/[^0-9a-z]/gi, "")))) throw new UpError("BAD_ARGS", `${what} holds private key material; nothing was changed`, { hint: "rename or replace it" });
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
  /** Addresses listed as controllers (networks and initial controllers) whose key is in the file or on this machine, over all networks. */
  heldControllers: Address[];
  /** The same per network: only the controllers the file lists FOR that network (its entry, and the deployment data for its initial network). A key listed on one network says nothing about another. */
  heldByChain: Map<number, Address[]>;
  /** File keys that belong to this profile: referenced by index or by address. */
  fileKeys: OpenedKey[];
  /** The calldata proves a held key is a genuine initial controller of this profile (it re-derives the address and gives that key permissions). */
  proof: boolean;
  /** Deployment data in the file that does NOT create this profile (a forgery, or damage). */
  forged: boolean;
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
    const heldByChain = new Map<number, Address[]>();
    const fileKeys = opened.keys.filter((k) => indices.has(k.index) || listed.has(k.address.toLowerCase()));
    const proof = items.some((it) => it.decoded.rederives && it.decoded.initialControllers.some((c) => !c.isUrd && c.hasPermissions && held.has(c.address.toLowerCase())));
    const forged = items.some((i) => i.decoded.supported && !i.decoded.rederives);
    const chains = [...new Set([...account.networks.map((n) => n.chainID), ...(account.networks.length ? [] : items.map((i) => i.item.initialChainID))])];
    for (const chainId of chains) {
      const here = new Set<string>();
      for (const n of account.networks) if (n.chainID === chainId) for (const c of n.controllers) here.add(c.address.toLowerCase());
      for (const it of items) if (it.item.initialChainID === chainId) for (const c of it.item.initialControllers) here.add(c.address.toLowerCase());
      heldByChain.set(chainId, [...here].filter((a) => held.has(a)).map((a) => getAddress(a)));
    }
    return { account, chains, items, heldControllers, heldByChain, fileKeys, proof, forged };
  });
}

/**
 * Everything of a profile that an import would store (account, controllers, deployment data, the manifest rebuilt from it)
 * is checked as a whole for key material before anything is written; the profile is refused, with no echo, when it holds some.
 */
export function assertProfileRecordClean(x: AccountAnalysis): void {
  assertNoKeyMaterial(`the backup's data for the profile ${x.account.address}`, { account: x.account, items: x.items.map((i) => ({ item: i.item, manifest: i.manifest })) });
}

export type ChainStatus = "controls" | "restorable-with-warning" | "unverified" | "unknown-network" | "not-deployed" | "no-controlling-key" | "impersonation-blocked";

export interface ChainDecision {
  chainId: number;
  status: ChainStatus;
  note?: string;
}

/**
 * One chain, the app's RestoreEligibilityService rules: a held key that still controls → restorable; calldata proof → restorable with a warning.
 * The checks that need no network come first: no held controller key → no-controlling-key; deployment data in the file that
 * does not create the profile (and no proof from another item) → whatever the network says, it can only confirm control,
 * never make the file trusted. Only a held key that is plausibly a controller is given the benefit of an unreachable or unknown network.
 */
export async function decideChain(ctx: VerbContext, a: AccountAnalysis, chainId: number): Promise<ChainDecision> {
  const candidates = a.heldByChain.get(chainId) ?? [];
  if (!candidates.length) return { chainId, status: "no-controlling-key" };
  const forged = a.forged && !a.proof;
  const open = (status: "unverified" | "unknown-network", note: string): ChainDecision =>
    forged ? { chainId, status: "impersonation-blocked", note: "the deployment data in the file does not create this profile and the network cannot confirm that a backup key controls it" } : { chainId, status, note };
  try {
    ctx.registry.chain(chainId);
  } catch {
    return open("unknown-network", "this network is not in the registry");
  }
  try {
    if (!(await hasCode(ctx, chainId, a.account.address))) return { chainId, status: "not-deployed" };
  } catch {
    return open("unverified", "the network could not be reached");
  }
  let inconclusive = false;
  for (const key of candidates) {
    try {
      const info = await readControllerPermissions(ctx, chainId, a.account.address, key);
      if (hasDefinedPermission(info.permissions.value)) return { chainId, status: "controls" };
    } catch {
      inconclusive = true;
    }
  }
  if (inconclusive) return open("unverified", "the permissions could not be read");
  if (a.proof) return { chainId, status: "restorable-with-warning", note: "controller-permissions-revoked: the key no longer has permissions on this network, but the file proves it created the profile" };
  return { chainId, status: "impersonation-blocked" };
}

export type ProfileVerdict = "restorable" | "restorable-with-warning" | "unverified" | "not-deployed" | "no-controlling-key" | "impersonation-blocked";

export interface ProfileDecision {
  address: Address;
  verdict: ProfileVerdict;
  restorable: boolean;
  chains: ChainDecision[];
}

/**
 * Combines the chains of one profile: any chain that works is enough, a blocked known chain outweighs networks
 * that could not be checked at all (unknown to the registry). `online: false` trusts the file after the calldata checks.
 */
export async function decideProfile(ctx: VerbContext, a: AccountAnalysis, online: boolean): Promise<ProfileDecision> {
  const address = a.account.address;
  if (!online) {
    // per network: a network with no held controller listed for it never counts; the rest is trusted after the calldata checks
    const chains: ChainDecision[] = a.chains.map((chainId) => ({
      chainId,
      status: (a.heldByChain.get(chainId)?.length ? (a.forged && !a.proof ? "impersonation-blocked" : "unverified") : "no-controlling-key") as ChainStatus,
      note: "not checked on the network",
    }));
    const verdict: ProfileVerdict = chains.some((c) => c.status === "unverified") ? "unverified" : chains.some((c) => c.status === "impersonation-blocked") ? "impersonation-blocked" : "no-controlling-key";
    return { address, verdict, restorable: verdict === "unverified", chains };
  }
  const chains: ChainDecision[] = [];
  for (const c of a.chains) chains.push(await decideChain(ctx, a, c));
  const has = (s: ChainStatus) => chains.some((c) => c.status === s);
  const verdict: ProfileVerdict = has("controls") ? "restorable" : has("restorable-with-warning") ? "restorable-with-warning" : has("unverified") ? "unverified" : has("impersonation-blocked") ? "impersonation-blocked" : has("unknown-network") ? "unverified" : has("no-controlling-key") ? "no-controlling-key" : "not-deployed";
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

export interface ProfileWrite {
  address: Address;
  manifest: "restored" | "kept-existing" | "conflict" | "none";
  chains: number[];
}

/** How a network of an imported profile is known. */
export const IMPORTED_VERIFIED = "verified";
export const IMPORTED_UNVERIFIED = "imported, unverified";

interface ImportedChain {
  chainId: number;
  provenance: typeof IMPORTED_VERIFIED | typeof IMPORTED_UNVERIFIED;
  controllers: Address[];
}

/** The networks of one profile as the file states them, with the controllers it lists there; `decision` says which were seen on the network. */
function importedChains(analysis: AccountAnalysis, decision: ProfileDecision | undefined): ImportedChain[] {
  // a network where the profile was seen not to exist, or not to belong to a backup key, is not recorded as one of its networks
  const known = (chainId: number) => !["not-deployed", "impersonation-blocked", "no-controlling-key"].includes(decision?.chains.find((c) => c.chainId === chainId)?.status ?? "");
  return analysis.chains.filter(known).map((chainId) => {
    const listed = new Set<string>();
    const out: Address[] = [];
    const add = (a: string) => !listed.has(a.toLowerCase()) && (listed.add(a.toLowerCase()), out.push(getAddress(a)));
    for (const n of analysis.account.networks) if (n.chainID === chainId) for (const c of n.controllers) add(c.address);
    for (const it of analysis.items) if (it.item.initialChainID === chainId) for (const c of it.item.initialControllers) add(c.address);
    const status = decision?.chains.find((c) => c.chainId === chainId)?.status;
    return { chainId, provenance: status === "controls" || status === "restorable-with-warning" ? IMPORTED_VERIFIED : IMPORTED_UNVERIFIED, controllers: out.slice(0, 64) };
  });
}

/** Earlier knowledge wins where it is better: a network once verified stays verified, controllers only accumulate. */
function mergeChains(before: unknown, now: ImportedChain[]): ImportedChain[] {
  const byId = new Map<number, ImportedChain>();
  for (const c of Array.isArray(before) ? before : []) {
    if (Number.isInteger(c?.chainId) && Array.isArray(c?.controllers)) byId.set(c.chainId, { chainId: c.chainId, provenance: c.provenance === IMPORTED_VERIFIED ? IMPORTED_VERIFIED : IMPORTED_UNVERIFIED, controllers: c.controllers.filter((a: unknown) => typeof a === "string" && isAddress(a, { strict: false })).map(getAddress) });
  }
  for (const c of now) {
    const old = byId.get(c.chainId);
    const controllers = [...new Map([...(old?.controllers ?? []), ...c.controllers].map((a) => [a.toLowerCase(), a])).values()];
    byId.set(c.chainId, { chainId: c.chainId, provenance: old?.provenance === IMPORTED_VERIFIED || c.provenance === IMPORTED_VERIFIED ? IMPORTED_VERIFIED : IMPORTED_UNVERIFIED, controllers });
  }
  return [...byId.values()].sort((a, b) => a.chainId - b.chainId);
}

/**
 * Creates or merges the profile record: the rebuilt manifest (never over a different existing one), an `imported`
 * note and the imported networks with their provenance and listed controllers, so that the profile (joined or
 * deployed) can be exported again at once. No transaction history is invented: the manifest keeps no deployment records.
 */
export async function writeProfileRecords(
  ctx: VerbContext,
  profiles: { analysis: AccountAnalysis; manifest?: DeploymentManifest; decision?: ProfileDecision }[],
  info: { file: string; sha256: string; backupDate: string; restoredKeys: Address[]; skippedKeys: Address[] },
): Promise<ProfileWrite[]> {
  const out: ProfileWrite[] = [];
  for (const { analysis, manifest, decision } of profiles) {
    let status: ProfileWrite["manifest"] = "none";
    const name = analysis.account.name && analysis.account.name !== KEY_WITHHELD ? safeFileText(analysis.account.name) : "";
    assertNoKeyIn("the backup", basename(info.file), info.backupDate, name);
    await updateProfileRecord(ctx.home, analysis.account.address, (latest) => {
      const patch: Record<string, unknown> = {
        imported: {
          file: safeFileText(basename(info.file), 120),
          sha256: info.sha256,
          backupDate: info.backupDate,
          at: new Date().toISOString(),
          ...(name ? { name } : {}),
          ...(analysis.items[0] ? { initialChainID: analysis.items[0].item.initialChainID } : {}),
          chains: mergeChains(latest.imported?.chains, importedChains(analysis, decision)),
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
      // the whole public record, as it is about to be stored (lsp3, calldata, data values, names, every field)
      assertNoKeyMaterial(`the record of the profile ${analysis.account.address}`, patch);
      return patch;
    });
    out.push({ address: analysis.account.address, manifest: status, chains: analysis.chains });
  }
  return out;
}

/** Config changes of an import: default profile if none, chains the registry knows, the active key only if none is configured. */
export async function applyImportConfig(ctx: VerbContext, change: { defaultProfile?: Address; chains: number[]; active?: { address: Address; backend: string } }): Promise<{ chainsAdded: number[]; unknownChains: number[]; activeSet: boolean; defaultProfileSet: boolean }> {
  assertNoKeyMaterial("the configuration change", change);
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
