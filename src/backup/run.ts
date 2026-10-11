// The code behind the backup verbs (declared in verbs.ts; loaded when one of them runs).
// See verbs.ts for the rules these keep.
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import type { Address } from "viem";
import { UpError } from "../core/errors.ts";
import { paths } from "../core/home.ts";
import { releaseKeys } from "../core/json.ts";
import { safeFileText } from "../core/safe-text.ts";
import type { VerbContext, VerbResult } from "../core/types.ts";
import { chooseBackend, internalBackend } from "../signer/index.ts";
import { buildBackup, collectState, fingerprints, type BuiltBackup } from "./build.ts";
import { ENCRYPTION_TYPE, KDF_DESCRIPTION, encryptSecrets, type SecretKey } from "./lsp30-crypto.ts";
import { MAX_BACKUP_BYTES, parseBackup, serializeBackup, type BackupFile, type BackupMode, type BackupSecrets } from "./lsp30-format.ts";
import { checkHint, choosePassword } from "./password.ts";
import {
  analyseAccounts,
  applyImportConfig,
  assertNoKeyIn,
  decideProfile,
  localKeyStores,
  openBackup,
  restoreKeys,
  writeProfileRecords,
  type AccountAnalysis,
  type KeyResult,
  type ProfileDecision,
} from "./restore.ts";
import { appendIndex, readBackupFile, readIndex, resolveDestination, sha256Hex, writeBackup } from "./store.ts";

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function chainName(ctx: VerbContext, id: number): string {
  try {
    return ctx.registry.chain(id).name;
  } catch {
    return `chain ${id}`;
  }
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function hasPasswordArgs(a: Record<string, any>): boolean {
  return a.password !== undefined || a["password-env"] !== undefined || a["password-stdin"] === true || a["generate-password"] === true;
}

const DELIVERY = "Attach the file at data.path to your reply with your chat's attachment mechanism (OpenClaw: the message tool, action send, media = that path). Never read, print, cat, open, copy or upload the file's contents yourself.";

const VERDICT_TEXT: Record<string, string> = {
  restorable: "a key from the backup still controls it",
  "restorable-with-warning": "the file proves a key created it, but that key no longer has permissions on the network",
  unverified: "not confirmed on the network",
  "not-deployed": "it is not deployed on any network I could check",
  "no-controlling-key": "the backup has no key that controls it",
  "impersonation-blocked": "none of the backup's keys controls it on the network, and the file does not prove it created it: not restored",
};

function decisionData(d: ProfileDecision, x: AccountAnalysis) {
  return {
    address: d.address,
    verdict: d.verdict,
    restorable: d.restorable,
    why: VERDICT_TEXT[d.verdict],
    chains: d.chains,
    deployment: x.items.map((i) => ({ rederivesProfile: i.decoded.rederives, canRebuildLocalManifest: Boolean(i.manifest), ...(i.reason ? { reason: i.reason } : {}) })),
  };
}

/** Opens the file again with the importer's own code path and compares it with what was meant to be written. Nothing is written on a mismatch. */
async function verifyRoundTrip(text: string, built: BuiltBackup, keys: SecretKey[], password: string | undefined): Promise<void> {
  const fail = () => new UpError("INTERNAL", "backup verification failed: the file does not read back as intended; nothing was written");
  const opened = await openBackup(text, password).catch(() => {
    throw fail();
  });
  if (opened.keys.length !== keys.length || opened.keys.some((k, i) => k.index !== i || !sameAddress(k.address, keys[i].address) || k.privateKey !== keys[i].privateKey.toLowerCase() || k.claimedAddress)) throw fail();
  if (opened.parsed.accounts.length !== built.file.accounts.length || opened.parsed.lsp23.length !== built.file.LSP23CrossChainDeployment.length) throw fail();
  if (opened.parsed.secrets.kind === "encrypted" && opened.decryption?.iterations !== 10_000) throw fail();
}

export async function runExport(ctx: VerbContext, a: Record<string, any>): Promise<VerbResult> {
  const mode = a.mode as BackupMode;
  if (mode !== "encrypted" && (hasPasswordArgs(a) || a.hint)) throw new UpError("BAD_ARGS", `a password or hint only applies to an encrypted backup (this one is ${mode})`);
  if (mode === "unencrypted" && a["explicit-consent"] !== true) {
    throw new UpError("BAD_ARGS", "an unencrypted backup needs --explicit-consent: it puts the keys in a file anyone can use", { hint: "recommend the encrypted backup; only if the human insists, add --explicit-consent and their --approval" });
  }
  const cfg = await ctx.config();
  const only = a.profiles?.length ? await Promise.all((a.profiles as string[]).map((p) => ctx.resolveAddress(p))) : undefined;
  const state = await collectState(ctx, { only, refresh: a.refresh === true });
  if (!state.profiles.length && !state.keys.length) throw new UpError("BAD_ARGS", "there is nothing to back up yet: no profile and no key on this machine", { hint: "set up the profile first (up start)" });
  if (mode !== "public" && !state.keys.length) throw new UpError("NO_SIGNER", "none of the agent's keys is in a key store here, so there are no keys to back up", { hint: "a backup without keys is --mode public" });
  const built = buildBackup(ctx, cfg, state, mode);
  const dest = await resolveDestination(ctx.home, a.path);
  const profiles = state.profiles.map((p) => p.address);
  const warnings = [...state.warnings];
  if (!state.profiles.length) warnings.push("the agent has no deployed profile yet: the file holds only its keys");
  if (mode !== "public" && built.appIncompatible.length) warnings.push(...built.appIncompatible.map((w) => `the app may reject this file: ${w}`));
  if (mode === "public" && built.file.LSP23CrossChainDeployment.length) warnings.push("the Universal Profile app cannot import a public file that has deployment data (it needs a key)");
  if (mode === "unencrypted") warnings.push("UNENCRYPTED: this file holds the private keys in plain text. Anyone with a copy controls those keys and what they control. Delete it after use; if it was ever sent through a chat or e-mail, treat the keys as exposed and move the funds");

  if (mode !== "public") {
    await ctx.consent({
      verb: "backup export",
      risk: "secret",
      summary: {
        effect: mode === "encrypted" ? "write a backup file with the agent's keys locked by a password" : "write a backup file with the agent's keys in PLAIN TEXT",
        destination: dest,
        profiles,
        chains: built.chains.map((c) => `${chainName(ctx, c)} (${c})`),
        keyAddresses: built.keys.map((k) => k.address),
        keyCount: built.keys.length,
        format: mode === "encrypted" ? `LSP-30 version 2 (${KDF_DESCRIPTION})` : "LSP-30 version 2, keys not encrypted",
        password: mode === "encrypted" ? (hasPasswordArgs(a) && a["generate-password"] !== true ? "chosen by the human" : "generated (returned to the agent to tell the human)") : "none",
        note: mode === "encrypted" ? "anyone with the file AND the password controls these keys" : "anyone with the file controls these keys",
        warnings,
      },
    });
  }
  if (ctx.flags.dryRun) {
    return { data: { dryRun: true, mode, path: dest, profiles, keys: built.keys.map((k) => k.address), chains: built.chains, appCompatible: built.appIncompatible.length === 0 }, text: `Dry run: a ${mode} backup of ${plural(profiles.length, "profile", "profiles")} and ${plural(built.keys.length, "key", "keys")} would be written to ${dest}.`, warnings };
  }

  const choice = mode === "encrypted" ? await choosePassword(a, true) : undefined;
  const hint = choice ? checkHint(a.hint, choice.password) : undefined;
  warnings.push(...(choice?.warnings ?? []));

  // the keys are read only now, inside this process; exportPrivateKey registers each with the output guard
  const secretKeys: SecretKey[] = [];
  for (const k of built.keys) {
    const backend = internalBackend(k.backend);
    if (!backend.exportPrivateKey) throw new UpError("NOT_SUPPORTED", `the ${k.backend} key store cannot export keys for a backup`);
    secretKeys.push({ address: k.address, privateKey: await backend.exportPrivateKey(k.address) });
  }
  const secrets: BackupSecrets =
    mode === "encrypted"
      ? { encrypted: true, ...(hint ? { passwordHint: hint } : {}), encryptionType: ENCRYPTION_TYPE, data: await encryptSecrets(secretKeys, choice!.password) }
      : { encrypted: false, data: mode === "unencrypted" ? secretKeys.map((k, index) => ({ type: "privateKey" as const, index, address: k.address, secret: k.privateKey })) : [] };
  const file: BackupFile = { ...built.file, secrets };
  const text = serializeBackup(file);
  await verifyRoundTrip(text, built, secretKeys, choice?.password);

  // the path is reserved in the index BEFORE the file exists, so the file is guarded from other readers from its first
  // byte on (also a custom path) and a full or unwritable index stops the export while nothing is stranded yet
  await appendIndex(ctx.home, { at: new Date().toISOString(), event: "reserved", file: dest }).catch(() => {
    throw new UpError("INTERNAL", "the backups index cannot be written, so no backup was made; nothing was written", { hint: `check that ${paths.backups(ctx.home)} is writable and not full` });
  });
  const written = await writeBackup(dest, text);
  ctx.log(`${mode} backup written: ${dest}`);
  const fp = fingerprints(state);
  // from here on the file exists (and for an encrypted one the password may exist only in this result): a failure to
  // index it is reported as a warning, never thrown
  let indexed = true;
  await appendIndex(ctx.home, {
    at: new Date().toISOString(),
    file: dest,
    sha256: written.sha256,
    mode,
    encrypted: mode === "encrypted",
    profiles,
    keys: built.keys.map((k) => k.address),
    chains: built.chains,
    fingerprint: fp.full,
    profilesFingerprint: fp.profiles,
    hintPresent: Boolean(hint),
    appCompatible: built.appIncompatible.length === 0,
  }).catch(() => {
    indexed = false;
    warnings.push("the backup was written, but it could not be added to the backups index, so `up backup list` will not show it. The file is kept and still protected from other readers; use it as normal");
  });

  const what = profiles.length === 1 ? "my account" : profiles.length > 1 ? `my ${profiles.length} accounts` : "my keys";
  const say =
    mode === "encrypted" && choice?.generated
      ? `Here is the backup of ${what}. Its password is: ${choice.password}\nKeep the file and the password in different safe places (a password manager is ideal). You can restore it in the Universal Profile app or with me.`
      : mode === "encrypted"
        ? `Here is the backup of ${what}. It is locked with the password you chose; without it the file cannot be opened. Keep the file and the password in different places. You can restore it in the Universal Profile app or with me.`
        : mode === "unencrypted"
          ? `Here is the backup of ${what}, WITHOUT a password. Anyone who gets this file controls my keys and what they control: treat it like a recovery phrase, don't forward it, and delete it after use.`
          : `Here is a copy of the details of ${what}: no keys and no password are in it, so nobody can take control with it. It helps me set ${what === "my keys" ? "up" : "it up"} again, but it cannot restore control on its own${built.appIncompatible.length ? " and the Universal Profile app can't open it" : ""}.`;
  const data: Record<string, unknown> = {
    mode,
    path: dest,
    sha256: written.sha256,
    size: written.size,
    encrypted: mode === "encrypted",
    profiles,
    keys: built.keys.map((k) => k.address),
    keyCount: built.keys.length,
    chains: built.chains,
    appCompatible: built.appIncompatible.length === 0,
    ...(mode === "encrypted" ? { kdf: KDF_DESCRIPTION } : {}),
    hintPresent: Boolean(hint),
    indexed,
    ...(choice?.generated ? { password: choice.password, passwordGenerated: true } : {}),
    say,
    next: [
      DELIVERY,
      mode === "encrypted" && choice?.generated ? "Tell the human data.say (it has the password) with the attachment, and do not repeat the password elsewhere." : "Tell the human data.say with the attachment.",
      "Do not delete or read backup files. The human decides what to keep.",
      ...(mode === "unencrypted" ? ["Deliver the file only because the human explicitly asked, after hearing the warning in data.say."] : []),
    ],
  };
  if (choice?.generated) releaseKeys(data, "password");
  return {
    data,
    text: [say, "", `File: ${dest}`, `sha256: ${written.sha256}`, `Contents: ${plural(profiles.length, "profile", "profiles")}, ${plural(built.keys.length, "key", "keys")}${mode === "encrypted" ? `; ${KDF_DESCRIPTION}` : ""}`].join("\n"),
    warnings,
  };
}

export async function runList(ctx: VerbContext, a: Record<string, any>): Promise<VerbResult> {
  const state = await collectState(ctx);
  const fp = fingerprints(state);
  const { backups, events } = await readIndex(ctx.home);
  const rows = await Promise.all(
    backups.map(async (b) => {
      const st = await stat(b.file).catch(() => null);
      const exists = Boolean(st?.isFile());
      // a file over the size limit is not hashed and cannot be opened by inspect, verify or import: never "unchanged", never current
      const oversized = exists && st!.size > MAX_BACKUP_BYTES;
      let changed = oversized;
      if (exists && !oversized) changed = sha256Hex(await readFile(b.file)) !== b.sha256;
      return { file: b.file, at: b.at, mode: b.mode, encrypted: b.encrypted, profiles: b.profiles, keys: b.keys, chains: b.chains, appCompatible: b.appCompatible, exists, changed, oversized, covers: { keys: b.mode !== "public" && b.fingerprint === fp.full, profiles: b.profilesFingerprint === fp.profiles } };
    }),
  );
  const usable = (r: (typeof rows)[number]) => r.exists && !r.changed;
  const newestWithKeys = [...rows].reverse().find((r) => r.mode !== "public" && usable(r));
  const current = Boolean(newestWithKeys?.covers.keys);
  const publicCurrent = rows.some((r) => usable(r) && r.covers.profiles);
  const anything = state.keys.length > 0 || state.profiles.length > 0;
  const alreadyAsked = events.some((e) => e.event === "asked" && e.fingerprint === fp.full);
  let ask: { reason: string; kind: "keys"; say: string } | null = null;
  if (anything && state.keys.length > 0 && !current && !alreadyAsked) {
    const reason = newestWithKeys ? "changed" : "no-backup";
    ask = {
      reason,
      kind: "keys",
      say: newestWithKeys
        ? "My account or my keys have changed since the last backup. Do you want a fresh backup? I'd give you a file and a password; keep them in different safe places and you can restore it in the Universal Profile app, or with me."
        : "Do you want a backup of my account? I'd give you a file and a password; keep them in different safe places and you can restore it in the Universal Profile app, or with me.",
    };
  }
  if (a["mark-asked"] === true) await appendIndex(ctx.home, { at: new Date().toISOString(), event: "asked", fingerprint: fp.full, kind: ask?.kind ?? "keys" });
  const plaintext = rows.filter((r) => r.mode === "unencrypted" && r.exists).map((r) => r.file);
  const warnings = [
    ...state.warnings,
    ...plaintext.map((f) => `a plain-text backup still exists at ${f}: it holds the keys unprotected. Tell the human to delete it once it is no longer needed (backups are never deleted by the skill)`),
    ...rows.filter((r) => !r.exists).map((r) => `the backup ${r.file} no longer exists`),
    ...rows.filter((r) => r.exists && r.changed && !r.oversized).map((r) => `the backup ${r.file} was changed after it was made`),
    ...rows.filter((r) => r.oversized).map((r) => `the backup ${r.file} is larger than ${MAX_BACKUP_BYTES / 1024 / 1024} MiB: it cannot be opened, so it does not count as a backup. Make a new one (up backup export)`),
  ];
  const text = rows.length
    ? [`${plural(rows.length, "backup", "backups")} made here. ${current ? "The newest backup with keys covers the current keys and profiles." : newestWithKeys ? "The keys or profiles changed since the newest backup with keys." : "No backup with keys yet."}`, ...rows.map((r) => `- ${r.at.slice(0, 10)} ${r.mode}${r.exists ? "" : " (file gone)"}: ${r.file}`)].join("\n")
    : "No backup has been made on this machine yet.";
  return { data: { backups: rows, current, publicCurrent, keys: state.keys.map((k) => k.address), profiles: state.profiles.map((p) => p.address), plaintextBackups: plaintext, ask, ...(ask ? { next: ["Ask the human once, in your own words, using data.ask.say. If they agree: up backup export --approval \"<their words>\". If they decline: run up backup list --mark-asked and do not ask again until this returns a new data.ask."] } : {}) }, text, warnings };
}

export async function runInspect(ctx: VerbContext, a: Record<string, any>): Promise<VerbResult> {
  const f = await readBackupFile(a.path);
  const { backup, issues } = parseBackup(f.text);
  const base = { file: f.file, size: f.size, sha256: f.sha256 };
  if (!backup) return { data: { ...base, valid: false, issues }, text: `This is not a usable backup file:\n${issues.map((i) => `- ${i.message}`).join("\n")}`, warnings: [] };
  // plain keys are opened (and so registered with the output guard) before anything is shown
  let opened: Awaited<ReturnType<typeof openBackup>> | undefined;
  if (backup.secrets.kind === "plain") {
    try {
      opened = await openBackup(f.text, undefined);
    } catch (e) {
      issues.push({ level: "error", code: "bad-key", message: e instanceof UpError ? e.message : "a key in the file is not valid" });
    }
  }
  const keyedBy = (idx: number | undefined) => idx !== undefined;
  const analyses = analyseAccounts(opened ?? { parsed: backup, issues, keys: [], seedPhraseEntries: 0 }, new Set());
  const lsp23 = analyses.flatMap((x) => x.items);
  const allIssues = [...issues];
  // items are compared by what they are (profile + calldata), not by object identity: openBackup parses the file again
  const itemId = (i: { profileAddress: string; deploymentCalldata: string }) => `${i.profileAddress.toLowerCase()}:${sha256Hex(i.deploymentCalldata.toLowerCase())}`;
  const placed = new Set(lsp23.map((x) => itemId(x.item)));
  for (const it of backup.lsp23) if (!placed.has(itemId(it))) allIssues.push({ level: "warn", code: "orphan-deployment", message: `the deployment data for ${it.profileAddress} belongs to no account in the file` });
  for (const it of lsp23) {
    if (!it.decoded.supported) allIssues.push({ level: "warn", code: "unsupported-deployment", message: `deployment data for ${it.item.profileAddress}: ${it.decoded.reason}` });
    else {
      if (!it.decoded.rederives) allIssues.push({ level: "error", code: "profile-mismatch", message: `the deployment data for ${it.item.profileAddress} derives a different profile address (${it.decoded.derivedProfile}): the file may be forged` });
      if (!it.decoded.canonicalFactory) allIssues.push({ level: "warn", code: "non-canonical-factory", message: `deployment data for ${it.item.profileAddress} uses a factory that is not the canonical LSP23 factory` });
    }
    for (const n of it.permissionNotes) allIssues.push({ level: "warn", code: "decoded-permissions", message: `decodedPermissions disagrees with the permissions value: ${n}` });
  }
  const s = backup.secrets;
  const keyMaterial =
    s.kind === "encrypted"
      ? { kind: "encrypted", encryptionType: s.encryptionType ?? null, hintPresent: Boolean(s.hint), ...(s.hint ? { hint: safeFileText(s.hint, 255) } : {}), sizes: { secretBytes: Buffer.from(s.data.secret, "base64").length, ivBytes: Buffer.from(s.data.iv, "base64").length, saltBytes: Buffer.from(s.data.salt, "base64").length } }
      : s.kind === "plain"
        ? { kind: "plain-text keys", keyCount: opened?.keys.length ?? 0, keyAddresses: opened?.keys.map((k) => k.address) ?? [] }
        : { kind: "public (no keys)" };
  const warnings: string[] = [];
  if (s.kind === "plain") warnings.push("this file holds private keys in plain text: if it was ever sent through a chat, e-mail or any tool an AI can read, treat those keys as exposed and move the funds to new keys");
  const accounts = backup.accounts.map((acc) => ({
    address: acc.address,
    name: safeFileText(acc.name),
    networks: acc.networks.map((n) => ({ chainId: n.chainID, network: chainName(ctx, n.chainID), controllers: n.controllers.map((c) => ({ address: c.address, name: safeFileText(c.name), type: safeFileText(c.type, 40), hasKey: keyedBy(c.privateKeyIndex) })) })),
  }));
  const deployments = lsp23.map((it) => ({
    profile: it.item.profileAddress,
    initialChainId: it.item.initialChainID,
    factory: it.item.factoryAddress,
    supported: it.decoded.supported,
    ...(it.decoded.reason ? { reason: it.decoded.reason } : {}),
    rederivesProfile: it.decoded.rederives,
    canonicalFactory: it.decoded.canonicalFactory,
    initialControllers: it.decoded.initialControllers.map((c) => ({ address: c.address, isUniversalReceiver: c.isUrd, permissions: c.permissions, hasKey: it.item.initialControllers.some((x) => sameAddress(x.address, c.address) && keyedBy(x.privateKeyIndex)) })),
    canRebuildLocalManifest: Boolean(it.manifest),
  }));
  const text = [
    `Backup of ${plural(accounts.length, "profile", "profiles")} (version 2, made ${backup.backupDate || "at an unknown time"}); ${keyMaterial.kind === "encrypted" ? "keys are password protected" : keyMaterial.kind === "plain-text keys" ? "KEYS ARE IN PLAIN TEXT" : "no keys in it"}.`,
    ...accounts.map((x) => `- ${x.address}${x.name ? ` "${x.name}"` : ""}: ${x.networks.map((n) => n.network).join(", ") || "no networks"}`),
    ...allIssues.map((i) => `${i.level === "error" ? "Problem" : "Note"}: ${i.message}`),
  ].join("\n");
  return { data: { ...base, valid: !allIssues.some((i) => i.level === "error"), version: 2, backupDate: backup.backupDate, keyMaterial, accounts, deployments, issues: allIssues }, text, warnings };
}

export async function runVerify(ctx: VerbContext, a: Record<string, any>): Promise<VerbResult> {
  const f = await readBackupFile(a.path);
  const pw = await choosePassword(a, false);
  const opened = await openBackup(f.text, pw?.password);
  const cfg = await ctx.config();
  const known = await localKeyStores(ctx, cfg);
  const analyses = analyseAccounts(opened, new Set(known.keys()));
  const keys = opened.keys.map((k) => ({ index: k.index, address: k.address, status: known.has(k.address.toLowerCase()) ? "exists" : "new" }));
  const profiles = [];
  for (const x of analyses) {
    const d = a.online === true ? await decideProfile(ctx, x, true) : undefined;
    profiles.push({
      address: x.account.address,
      chains: x.chains,
      keys: x.fileKeys.map((k) => k.address),
      deployment: x.items.map((i) => ({ rederivesProfile: i.decoded.rederives, canRebuildLocalManifest: Boolean(i.manifest), ...(i.reason ? { reason: i.reason } : {}) })),
      proofFromFile: x.proof,
      ...(d ? { decision: decisionData(d, x) } : {}),
    });
  }
  const bad = opened.issues.filter((i) => i.level === "error");
  return {
    data: { file: f.file, sha256: f.sha256, valid: bad.length === 0, keys, profiles, decryption: opened.decryption ?? null, issues: opened.issues, online: a.online === true },
    text: [
      `The backup opens${opened.decryption ? " with that password" : ""}: ${plural(keys.length, "key", "keys")} (${keys.filter((k) => k.status === "new").length} not on this machine yet), ${plural(profiles.length, "profile", "profiles")}.`,
      ...profiles.map((p) => `- ${p.address}: ${p.decision ? `${p.decision.verdict} (${p.decision.why})` : "not checked on the network (add --online)"}`),
      ...opened.issues.map((i) => `${i.level === "error" ? "Problem" : "Note"}: ${i.message}`),
    ].join("\n"),
    warnings: opened.issues.filter((i) => i.level === "warn").map((i) => i.message),
  };
}

export async function runImport(ctx: VerbContext, a: Record<string, any>): Promise<VerbResult> {
  const offline = a.offline === true;
  if (offline && !/offline/i.test(ctx.flags.approval ?? "")) throw new UpError("BAD_ARGS", "--offline skips the check that the profile really belongs to the backup's keys; it needs the human's approval to say so", { hint: "ask the human, and pass their words containing 'offline' as --approval" });
  const f = await readBackupFile(a.path);
  const pw = await choosePassword(a, false);
  const opened = await openBackup(f.text, pw?.password);
  // everything that is shown, audited or stored must be free of the keys that were just opened
  assertNoKeyIn("the file path", f.file);
  assertNoKeyIn("the backup", opened.parsed.backupDate, ...opened.parsed.accounts.flatMap((x) => [x.name, ...x.networks.flatMap((n) => n.controllers.map((c) => c.name))]));
  const cfg = await ctx.config();
  const known = await localKeyStores(ctx, cfg);
  let analyses = analyseAccounts(opened, new Set(known.keys()));
  if (a.profiles?.length) {
    const wanted = await Promise.all((a.profiles as string[]).map((p) => ctx.resolveAddress(p)));
    for (const w of wanted) if (!analyses.some((x) => sameAddress(x.account.address, w))) throw new UpError("BAD_ARGS", `the backup has no profile ${w}`, { hint: "list them with: up backup inspect <file>" });
    analyses = analyses.filter((x) => wanted.some((w) => sameAddress(w, x.account.address)));
  }
  const decisions: ProfileDecision[] = [];
  for (const x of analyses) decisions.push(await decideProfile(ctx, x, !offline));
  const chosen = analyses.filter((_, i) => decisions[i].restorable);
  const skipped = analyses.map((x, i) => ({ x, d: decisions[i] })).filter((p) => !p.d.restorable);

  // keys: those of the profiles being restored, or all of the file's with --all-keys (one entry per address)
  const wanted = new Map<string, (typeof opened.keys)[number]>();
  for (const k of opened.keys) if (a["all-keys"] === true || chosen.some((x) => x.fileKeys.some((y) => sameAddress(y.address, k.address)))) wanted.set(k.address.toLowerCase(), k);
  const keysToRestore = [...wanted.values()];
  const needStore = keysToRestore.some((k) => !known.has(k.address.toLowerCase()));
  const backend = needStore ? await chooseBackend(a.backend) : undefined;
  const keyPlan = await Promise.all(keysToRestore.map(async (k) => ({ address: k.address, status: known.has(k.address.toLowerCase()) || (backend && (await backend.has(k.address).catch(() => false))) ? "exists" : "new" })));

  // the active key: only when none is configured: the initial controller of the first rebuilt manifest, else the first key
  let activeAddress: Address | undefined;
  if (!cfg.controller && keysToRestore.length) {
    const fromManifest = chosen.flatMap((x) => x.items).find((i) => i.manifest && wanted.has(i.manifest.controller.toLowerCase()))?.manifest?.controller;
    activeAddress = fromManifest ?? keysToRestore[0].address;
  }
  const profileRows = analyses.map((x, i) => decisionData(decisions[i], x));
  const plan = {
    file: safeFileText(basename(f.file), 120),
    sha256: f.sha256,
    backupDate: opened.parsed.backupDate,
    profiles: profileRows.map((p) => ({ address: p.address, verdict: p.verdict, restoring: p.restorable, why: p.why })),
    keys: keyPlan,
    keyStore: backend?.id ?? null,
    activeKey: activeAddress ?? null,
    checkedOnNetwork: !offline,
  };
  if (!chosen.length && a["all-keys"] !== true) {
    const why = skipped.map((p) => `${short(p.x.account.address)}: ${VERDICT_TEXT[p.d.verdict]}`).join("; ");
    return {
      data: { ...plan, restored: false, say: `I could not restore anything from this backup${why ? ` (${why})` : ""}.`, next: ["Tell the human what data.say says. Nothing was changed."] },
      text: `Nothing was restored${why ? `: ${why}` : ""}.`,
      warnings: opened.issues.filter((i) => i.level === "warn").map((i) => i.message),
    };
  }

  await ctx.consent({
    verb: "backup import",
    risk: "secret",
    summary: {
      effect: "restore profiles and keys from a backup file into this agent's key store and records",
      ...plan,
      keyStoreNote: "keys are only ever added; none is overwritten or deleted. A key already here is skipped",
      ...(offline ? { warning: "the check on the networks is skipped: whether the backup's keys control the profiles is not confirmed" } : {}),
    },
  });
  if (ctx.flags.dryRun) return { data: { dryRun: true, ...plan }, text: `Dry run: ${plural(chosen.length, "profile", "profiles")} and ${plural(keysToRestore.length, "key", "keys")} would be restored from ${plan.file}.` };

  const keyResults: KeyResult[] = keysToRestore.length ? await restoreKeys(ctx, keysToRestore, backend, opened.parsed.backupDate, known, activeAddress) : [];
  const restoredKeys = keyResults.filter((r) => r.status === "restored").map((r) => r.address);
  const notRestored = opened.keys.filter((k) => !keyResults.some((r) => sameAddress(r.address, k.address))).map((k) => k.address);
  const manifests = chosen.map((x) => ({ analysis: x, manifest: x.items.find((i) => i.manifest)?.manifest, decision: decisions.find((d) => sameAddress(d.address, x.account.address)) }));
  const records = await writeProfileRecords(ctx, manifests, { file: f.file, sha256: f.sha256, backupDate: opened.parsed.backupDate, restoredKeys, skippedKeys: notRestored });
  const activeResult = activeAddress ? keyResults.find((r) => sameAddress(r.address, activeAddress!)) : undefined;
  const configResult = await applyImportConfig(ctx, {
    defaultProfile: chosen[0]?.account.address,
    chains: [...new Set(chosen.flatMap((x) => x.chains))],
    ...(activeResult && activeResult.backend ? { active: { address: activeResult.address, backend: activeResult.backend } } : {}),
  });
  await appendIndex(ctx.home, { at: new Date().toISOString(), event: "import", file: f.file, sha256: f.sha256, profiles: chosen.map((x) => x.account.address), keys: keyResults.map((r) => r.address) });
  ctx.log(`backup imported: ${chosen.length} profile(s), ${restoredKeys.length} key(s)`);

  const warnings = [
    ...opened.issues.filter((i) => i.level === "warn").map((i) => i.message),
    ...decisions.filter((d) => d.verdict === "restorable-with-warning" || d.verdict === "unverified").map((d) => `${d.address}: ${VERDICT_TEXT[d.verdict]}`),
    ...skipped.map((p) => `${p.x.account.address} was not restored: ${VERDICT_TEXT[p.d.verdict]}`),
    ...records.filter((r) => r.manifest === "conflict").map((r) => `${r.address}: this machine already has deployment data for the profile that differs from the backup's; it was kept`),
    ...(a["all-keys"] !== true && notRestored.length ? [`${notRestored.length} other key${notRestored.length === 1 ? "" : "s"} in the file belong${notRestored.length === 1 ? "s" : ""} to none of the restored profiles and ${notRestored.length === 1 ? "was" : "were"} not restored (add --all-keys to restore ${notRestored.length === 1 ? "it" : "them"} too)`] : []),
    ...configResult.unknownChains.map((c) => `chain ${c} is not in the registry and was not added (up chains add ${c})`),
  ];
  const notDeployed = chosen.flatMap((x) => x.chains.map((c) => ({ x, c })));
  const say =
    `I restored ${plural(chosen.length, "account", "accounts")} and ${plural(restoredKeys.length, "key", "keys")} from your backup${keyResults.length > restoredKeys.length ? ` (${keyResults.length - restoredKeys.length} ${keyResults.length - restoredKeys.length === 1 ? "was" : "were"} already here)` : ""}.` +
    (skipped.length ? ` ${plural(skipped.length, "account", "accounts")} in the file could not be restored, because nothing shows the backup's keys control ${skipped.length === 1 ? "it" : "them"}.` : "") +
    (restoredKeys.length && !configResult.activeSet ? " The restored keys are kept safe but I keep signing with my current key until you tell me to switch." : "");
  const data = {
    ...plan,
    restored: true,
    keysResult: keyResults,
    profilesResult: records.map((r) => ({ address: r.address, status: "imported", manifest: r.manifest, chains: r.chains })),
    skippedProfiles: skipped.map((p) => ({ address: p.x.account.address, verdict: p.d.verdict })),
    config: configResult,
    say,
    next: [
      "Tell the human data.say.",
      "Check where each restored profile stands: up profile status",
      ...(notDeployed.length ? ["For a network where the profile is not deployed yet: up account deploy --chain <id> (replays the restored deployment at the same address)"] : []),
      ...(restoredKeys.length && !configResult.activeSet ? ["To sign with a restored key: up key address lists them; up key activate <address> (needs the human's approval)"] : []),
    ],
  };
  return {
    data,
    text: [say, ...keyResults.map((r) => `key ${r.address}: ${r.status}`), ...records.map((r) => `profile ${r.address}: imported${r.manifest === "restored" ? " (deployment data restored)" : ""}`)].join("\n"),
    warnings,
  };
}
