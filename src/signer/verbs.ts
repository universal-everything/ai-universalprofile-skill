// Key lifecycle verbs (group "key"): init, key address, key backend,
// key backup, key new-candidate, key activate.
//
// Keys are permanent. The agent's key is the private key of a blockchain account: it is never
// replaced or deleted. No verb removes a key from its store; switching which key the agent
// signs with keeps the previous one in its store and listed (config.previousControllers).
//
// One profile, many chains: the agent normally signs with ONE default key on every
// chain (config.controller). A chain may get its own key (config.chainControllers,
// set with `key activate <address> --chain <id>`); chain-agnostic verbs report the
// default key plus these per-chain keys.
//
// Results and texts contain public data only (addresses, backend ids,
// protection descriptions). The private key never leaves the backend except
// in-process for signing and for the passphrase-encrypted keystore backup.
import { chmod, link, lstat, open, rm, stat, writeFile } from "node:fs/promises";
import { registerSecret } from "../core/secret-guard.ts";
import { randomBytes } from "node:crypto";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { getAddress, isAddress } from "viem";
import { UpError } from "../core/errors.ts";
import { existsSync } from "node:fs";
import { ensureDir, paths, readJsonStrict, writeJsonWithBackup } from "../core/home.ts";
import type { Address, Hex, SignerBackend, UpConfig, VerbContext, VerbResult } from "../core/types.ts";
import { defineVerb } from "../core/verbs.ts";
import { readConfigFile } from "../core/context.ts";
import { inventoryFile, readInventory, recordKey } from "./inventory.ts";
import { missingKeyHint } from "./base.ts";
import { BACKEND_IDS, chooseBackend, custodyWarnings, environment, internalBackend, plainProtection, probeAll } from "./index.ts";
import { chainControllerList, controllerFor } from "./select.ts";
import { decryptKeystoreV3, encryptKeystoreV3, STANDARD_SCRYPT } from "./keystore-v3.ts";

// ---------------------------------------------------------------------------
// Additional keys not in use yet — public data only, <UP_HOME>/keys/candidates.json
// ---------------------------------------------------------------------------

export interface CandidateKey {
  address: Address;
  backend: string;
  createdAt: string;
}

function candidatesFile(home: string): string {
  return join(paths.keys(home), "candidates.json");
}

/** The raw candidates list. Missing file = empty; an unreadable or damaged file throws (it is never overwritten). */
async function readCandidatesRaw(home: string): Promise<unknown[]> {
  const f = candidatesFile(home);
  const v = await readJsonStrict<unknown>(f, []);
  if (!Array.isArray(v)) throw new UpError("INTERNAL", `${f} is damaged (it does not hold a list); nothing was changed and it will not be overwritten`, { hint: `repair it or restore it (a previous copy may be at ${f}.bak); never delete it: it lists the agent's keys` });
  return v;
}

function isCandidate(c: unknown): c is CandidateKey {
  return Boolean(c && typeof c === "object" && isAddress((c as any).address, { strict: false }) && typeof (c as any).backend === "string");
}

export async function readCandidates(home: string): Promise<CandidateKey[]> {
  return (await readCandidatesRaw(home)).filter(isCandidate);
}

/** Read-modify-write of candidates.json (call under withKeyLock). Unknown entries are kept as they are; the old file is kept as .bak. */
export async function updateCandidates(home: string, fn: (list: unknown[]) => unknown[]): Promise<void> {
  await writeJsonWithBackup(candidatesFile(home), fn(await readCandidatesRaw(home)), Array.isArray);
}

/** An activated key is no longer "not used yet": take it off the candidates list (it is listed in the config now). */
async function dropCandidate(home: string, address: string): Promise<void> {
  const raw = await readCandidatesRaw(home);
  if (raw.some((k) => isCandidate(k) && sameAddress(k.address, address))) await updateCandidates(home, (list) => list.filter((k) => !(isCandidate(k) && sameAddress(k.address, address))));
}

function sameAddress(a: string | undefined, b: string | undefined): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

/** Like sameAddress, but "no key" equals "no key" (for the changed-while-waiting guards). */
function sameKey(a: string | undefined, b: string | undefined): boolean {
  return (!a && !b) || sameAddress(a, b);
}

/**
 * Stores a key through `store`, recording it in the append-only recovery inventory
 * (keys/inventory.jsonl) BEFORE it is stored: the key's public record is appended, then it is
 * stored. If the record cannot be written, nothing is stored; if storing fails, a follow-up line
 * marks the record "not stored". So a stored key is always listed.
 */
async function storeRecorded(home: string, backendId: string, store: (beforeStore: (address: Address) => Promise<void>) => Promise<Address>, note?: string): Promise<Address> {
  let recorded: Address | undefined;
  try {
    return await store(async (address) => {
      try {
        await recordKey(home, { address, backend: backendId, ...(note ? { note } : {}) });
      } catch (e) {
        throw new UpError("INTERNAL", `could not record the new key in ${inventoryFile(home)} (${(e as Error).message}); no key was created`, { hint: "fix the state directory (keys/), then retry" });
      }
      recorded = address;
    });
  } catch (e) {
    if (recorded) {
      const d = (e as UpError)?.details as { kept?: boolean; problem?: string } | undefined;
      const why = d?.kept ? `kept after ${d.problem ?? "a failed check"}` : "creation failed; not stored";
      await recordKey(home, { address: recorded, backend: backendId, note: why, ...(d?.kept ? {} : { notStored: true }) }).catch(() => {});
    }
    throw e;
  }
}

/** Creates a key in `backend` and records it in the recovery inventory before it is stored (see storeRecorded). */
async function createRecorded(home: string, backend: { id: string; create(beforeStore?: (address: Address) => Promise<void>): Promise<Address> }): Promise<Address> {
  return storeRecorded(home, backend.id, (before) => backend.create(before));
}

/** Stores an existing key (from a backup file) in `backend`, recorded in the recovery inventory first, with a note. */
export async function importRecorded(home: string, backend: { id: string; importKey?: SignerBackend["importKey"] }, privateKey: Hex, note: string): Promise<Address> {
  const importKey = backend.importKey;
  if (!importKey) throw new UpError("NOT_SUPPORTED", `the ${backend.id} key store cannot import a key`, { hint: "choose another key store with --backend (up key backend lists them)" });
  return storeRecorded(home, backend.id, (before) => importKey.call(backend, privateKey, before), note);
}

function requireController(cfg: UpConfig): NonNullable<UpConfig["controller"]> {
  if (!cfg.controller) throw new UpError("NO_SIGNER", "no controller key is configured", { hint: "run: up init" });
  return cfg.controller;
}

function addressArg(v: unknown, name: string): Address {
  if (typeof v !== "string" || !isAddress(v, { strict: false })) throw new UpError("BAD_ARGS", `--${name} must be a 20-byte 0x address`);
  return getAddress(v);
}

function protectionText(address: Address, backendId: string, custody: string[] = []): string {
  return [`Controller address: ${address}`, `Key protection: ${plainProtection(internalBackend(backendId).protectionInfo())}`, ...custody.map((w) => `Warning: ${w}`)].join("\n");
}

const BACKEND_CHOICES = ["auto", ...BACKEND_IDS] as const;

const NOT_IN_STORE_HINT = "check the address with: up key address (it lists every key of the agent); an additional key is created with: up key new-candidate";

const LOCK_WAIT_MS = 15_000;
const LOCK_STALE_MS = 120_000;

/**
 * Serialises key lifecycle mutations (init, new-candidate, activate) across
 * processes with an O_EXCL lock file in the keys directory, so two concurrent
 * runs can never both create a controller or lose candidate metadata.
 */
export async function withKeyLock<T>(home: string, fn: () => Promise<T>): Promise<T> {
  const dir = paths.keys(home);
  await ensureDir(dir, 0o700);
  const lock = join(dir, ".lifecycle.lock");
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const fh = await open(lock, "wx", 0o600);
      await fh.writeFile(`${process.pid} ${new Date().toISOString()}\n`);
      await fh.close();
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const st = await stat(lock).catch(() => null);
      if (st && Date.now() - st.mtimeMs > LOCK_STALE_MS) {
        await rm(lock, { force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw new UpError("INTERNAL", "another key operation is in progress", { hint: `retry in a moment; if no other 'up' process is running, delete ${lock}` });
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(lock, { force: true });
  }
}

/**
 * Config with the whole key inventory (default key, per-chain keys, previous keys) always
 * re-read from config.json: another process may have changed it, even if the active key is
 * the same address again.
 */
async function freshConfig(ctx: VerbContext): Promise<UpConfig> {
  const c = await ctx.config();
  if (!existsSync(paths.config(ctx.home))) return c;
  const d = await readConfigFile(ctx.home);
  return { ...c, controller: d.controller, previousControllers: d.previousControllers, chainControllers: d.chainControllers };
}

/** True when the verb got an explicit --chain (key verbs never fall back to the default chain). */
function explicitChain(args: Record<string, any>): boolean {
  return args.chain !== undefined && args.chain !== "";
}

/** "Base (8453)" when the registry knows the chain, else "chain 8453". */
function chainText(ctx: VerbContext, chainId: number): string {
  try {
    return `${ctx.registry.chain(chainId).name} (${chainId})`;
  } catch {
    return `chain ${chainId}`;
  }
}

function perChainLines(ctx: VerbContext, cfg: UpConfig): string[] {
  const own = chainControllerList(cfg);
  return own.length ? [`Own key per chain (used there instead of the default): ${own.map((c) => `${chainText(ctx, c.chainId)} → ${c.address} (${c.backend})`).join("; ")}`] : [];
}

export type KeptKind = "additional" | "previous" | "recovered";
export type KeptKey = { address: Address; backend: string; kind: KeptKind; chainId?: number; note?: string };

/**
 * Keys the agent keeps besides the ones in use: previous keys, additional keys not used yet, and
 * keys only the recovery inventory knows (created, but their bookkeeping failed). Public data only.
 */
export async function keptKeys(home: string, cfg: UpConfig): Promise<KeptKey[]> {
  const inUse = [cfg.controller?.address, ...chainControllerList(cfg).map((k) => k.address)];
  const out: KeptKey[] = [];
  const add = (k: { address: string; backend: string; chainId?: number; note?: string }, kind: KeptKind) => {
    if (!isAddress(k.address, { strict: false }) || inUse.some((a) => sameAddress(a, k.address)) || out.some((o) => sameAddress(o.address, k.address))) return;
    out.push({ address: getAddress(k.address), backend: k.backend, kind, ...(k.chainId !== undefined ? { chainId: k.chainId } : {}), ...(kind === "recovered" && k.note ? { note: k.note } : {}) });
  };
  for (const k of cfg.previousControllers ?? []) add(k, "previous");
  for (const k of await readCandidates(home)) add(k, "additional");
  for (const k of await readInventory(home)) {
    // a record marked "not stored" is listed only if the key does exist in its store after all
    if (k.notStored && !(await Promise.resolve().then(() => internalBackend(k.backend).has(k.address)).catch(() => false))) continue;
    add(k, "recovered");
  }
  return out;
}

const KIND_TEXT: Record<KeptKind, string> = { additional: "not used yet", previous: "used before", recovered: "created, not recorded in the config" };

function existingResult(home: string, c: NonNullable<UpConfig["controller"]>, warnings: string[]): VerbResult {
  const custody = custodyWarnings(c.backend, home);
  return {
    data: { address: c.address, backend: c.backend, protection: internalBackend(c.backend).protectionInfo(), created: false, custodyWarnings: custody },
    text: protectionText(c.address, c.backend, custody),
    warnings: [...custody, ...warnings],
  };
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

export const initVerb = defineVerb({
  name: "init",
  group: "key",
  summary: "Create the agent's controller key inside a protected key store and show its public address.",
  description:
    "Generates a new secp256k1 controller key inside the strongest available key store for this machine " +
    "(macOS login keychain, systemd-creds, desktop keyring, Windows DPAPI, or a private key file inside a cloud agent VM) " +
    "and records only its public address in config. The private key is never shown. Safe to run unattended for first-time " +
    "setup. The key is permanent: if one already exists it is kept and nothing changes (it is never replaced); " +
    "if it is missing from its store, init says so and points to its backup.",
  risk: "secret",
  params: [
    { name: "backend", type: "string", description: "Key store to use; 'auto' picks the strongest unattended store for this machine.", default: "auto", enum: BACKEND_CHOICES },
  ],
  examples: ["up init", "up init --backend protected-file"],
  async run(ctx: VerbContext, args: Record<string, any>): Promise<VerbResult> {
    const requested = String(args.backend ?? "auto");
    const existing = (await freshConfig(ctx)).controller;

    if (existing) {
      const warnings = ["a controller key already exists; it is permanent and is kept, nothing was changed"];
      if (requested !== "auto" && requested !== existing.backend) warnings.push(`--backend ${requested} ignored: the existing key lives in ${existing.backend}`);
      try {
        if (!(await internalBackend(existing.backend).has(existing.address))) warnings.push(`${existing.address}: ${missingKeyHint(existing.backend)}`);
      } catch (e) {
        warnings.push(`could not check the key store: ${e instanceof UpError ? e.message : "error"}`);
      }
      return existingResult(ctx.home, existing, warnings);
    }

    const backend = await chooseBackend(requested);
    const protection = internalBackend(backend.id).protectionInfo();
    const custody = custodyWarnings(backend.id, ctx.home);
    if (ctx.flags.dryRun) {
      return {
        data: { dryRun: true, backend: backend.id, protection, custodyWarnings: custody },
        text: [`Dry run: a new controller key would be created in ${backend.id}.`, `Key protection: ${plainProtection(protection)}`, ...custody.map((w) => `Warning: ${w}`)].join("\n"),
        ...(custody.length ? { warnings: custody } : {}),
      };
    }

    return withKeyLock(ctx.home, async () => {
      // Re-check under the lock: another process may have initialised meanwhile.
      const latest = await freshConfig(ctx);
      if (latest.controller) return existingResult(ctx.home, latest.controller, ["another process created the controller key at the same time; kept that one"]);

      // Recorded in keys/inventory.jsonl at creation, so it stays listed whatever happens next.
      const address = await createRecorded(ctx.home, backend);
      const createdAt = new Date().toISOString();
      try {
        await ctx.updateConfig((cur) => {
          if (cur.controller && !sameAddress(cur.controller.address, address)) {
            throw new UpError("BAD_ARGS", `another process set the agent's key ${cur.controller.address} meanwhile; it was kept`);
          }
          return { ...cur, version: 1, controller: { address, backend: backend.id, createdAt } };
        });
      } catch (e) {
        // Keys are never deleted: the new key stays in its store and in the recovery inventory.
        throw new UpError("INTERNAL", `the new key ${address} was created in ${backend.id} but the config could not be saved (${(e as Error).message})`, {
          hint: `the key stays in its store and is listed by: up key address; record it with: up key activate ${address} --backend ${backend.id}`,
        });
      }
      ctx.log(`controller key created in ${backend.id}: ${address}`);
      return {
        data: { address, backend: backend.id, protection, created: true, custodyWarnings: custody },
        text: protectionText(address, backend.id, custody),
        ...(custody.length ? { warnings: custody } : {}),
      };
    });
  },
});

// ---------------------------------------------------------------------------
// key address / key backend
// ---------------------------------------------------------------------------

export const keyAddressVerb = defineVerb({
  name: "key address",
  group: "key",
  summary: "Show the agent's controller address (the default key, or with --chain the key used on that chain) and the key store that protects it; lists chains that use their own key and every other key the agent keeps.",
  risk: "local",
  params: [],
  async run(ctx, args) {
    const cfg = await ctx.config();
    const otherKeys = await keptKeys(ctx.home, cfg);
    const chainId = explicitChain(args) ? ctx.chainId(args.chain) : undefined;
    const c = chainId !== undefined ? controllerFor(cfg, chainId) : undefined;
    const def = cfg.controller;
    if (!c && !def && otherKeys.length) {
      // no key in use, but keys exist (e.g. created while saving the config failed): list them, never hide them
      throw new UpError("NO_SIGNER", `no default key is configured, but the agent keeps these keys: ${otherKeys.map((k) => `${k.address} (${k.backend}, ${KIND_TEXT[k.kind]})`).join("; ")}`, {
        hint: `use one of them with: up key activate <address>`,
        details: { otherKeys },
      });
    }
    const used = c ?? requireController(cfg);
    const protection = internalBackend(used.backend).protectionInfo();
    const chainControllers = chainControllerList(cfg).map((k) => ({ chainId: k.chainId, address: k.address, backend: k.backend }));
    return {
      data: {
        address: used.address,
        backend: used.backend,
        createdAt: used.createdAt,
        level: protection.level,
        ...(chainId !== undefined ? { chainId, scope: c?.scope ?? "default" } : {}),
        default: def ? { address: def.address, backend: def.backend } : null,
        chainControllers,
        otherKeys,
      },
      text: [
        chainId !== undefined ? `${used.address} (${used.backend}) — the agent's ${c?.scope === "chain" ? "own key" : "default key"} on ${chainText(ctx, chainId)}` : `${used.address} (${used.backend})`,
        ...perChainLines(ctx, cfg),
        ...(otherKeys.length ? [`Other keys of the agent (kept in their store, never deleted): ${otherKeys.map((k) => `${k.address} (${k.backend}, ${KIND_TEXT[k.kind]}${k.kind === "previous" && k.chainId !== undefined ? ` on ${chainText(ctx, k.chainId)}` : ""}${k.note ? `; ${k.note}` : ""})`).join("; ")}`] : []),
      ].join("\n"),
    };
  },
});

export const keyBackendVerb = defineVerb({
  name: "key backend",
  group: "key",
  summary: "Check every key store on this machine and show which one protects the controller key.",
  risk: "local",
  params: [],
  async run(ctx) {
    const cfg = await ctx.config();
    const [probes, env] = await Promise.all([probeAll(), environment()]);
    const activeId = cfg.controller?.backend;
    const custody = activeId ? custodyWarnings(activeId, ctx.home) : [];
    const active = activeId ? { address: cfg.controller!.address, backend: activeId, protection: internalBackend(activeId).protectionInfo(), custodyWarnings: custody } : null;
    const perChain = chainControllerList(cfg).map((k) => ({ chainId: k.chainId, address: k.address, backend: k.backend }));
    const chainCustody = perChain.flatMap((k) => custodyWarnings(k.backend, ctx.home)).filter((w, i, all) => !custody.includes(w) && all.indexOf(w) === i);
    const relevant = probes.filter((p) => p.available || p.id === activeId || !["memory", "remote-signer"].includes(p.id));
    const lines: string[] = [];
    lines.push(active ? `Active: ${active.backend} — ${plainProtection(active.protection)}` : "Active: none (run: up init)");
    lines.push(...perChainLines(ctx, cfg));
    for (const p of relevant) lines.push(`${p.id === activeId ? "*" : " "} ${p.id.padEnd(21)} ${(p.available ? "available" : "unavailable").padEnd(11)} ${p.level.padEnd(17)} ${p.reason}`);
    const warnings: string[] = [];
    const ap = activeId ? probes.find((p) => p.id === activeId) : undefined;
    if (ap && !ap.available) warnings.push(`the active key store ${ap.id} is not available right now: ${ap.reason}`);
    for (const k of perChain) {
      const p = probes.find((x) => x.id === k.backend);
      if (k.backend !== activeId && p && !p.available) warnings.push(`the key store ${p.id} of the key for ${chainText(ctx, k.chainId)} is not available right now: ${p.reason}`);
    }
    warnings.push(...custody, ...chainCustody);
    for (const w of warnings) lines.push(`Warning: ${w}`);
    return {
      data: {
        active,
        chainControllers: perChain,
        backends: probes,
        environment: { platform: env.platform, wsl: env.wsl, container: env.container, vm: env.vm, agentHost: env.agentHost, headless: env.headless, ssh: env.ssh, systemdVersion: env.systemdVersion, declaredAgentVm: env.isolated, unattendedHost: env.unattendedHost, hints: env.hints },
      },
      text: lines.join("\n"),
      ...(warnings.length ? { warnings } : {}),
    };
  },
});

// ---------------------------------------------------------------------------
// key backup (encrypted keystore v3 only)
// ---------------------------------------------------------------------------

export const MIN_PASSPHRASE_LENGTH = 12;
const PASSPHRASE_HINT =
  "a human must run this in their own terminal (never via chat): read -rs UP_BACKUP_PASSPHRASE && export UP_BACKUP_PASSPHRASE && up key backup --encrypted --explicit-consent --path <file> --approval \"<your words>\"; unset UP_BACKUP_PASSPHRASE";

/**
 * Writes a new file (0600), never over an existing one. Returns a warning when the file was published but the
 * temporary file could not be removed: the file is complete and usable, so that is not an error (callers that hand
 * out a password for it must still hand it out).
 */
export async function writeNewFileExclusive(file: string, content: string): Promise<{ warning?: string }> {
  const dir = dirname(file);
  const tmp = join(dir, `.${basename(file)}.${randomBytes(6).toString("hex")}.tmp`);
  await writeFile(tmp, content, { mode: 0o600, flag: "wx" });
  try {
    if (process.platform !== "win32") await chmod(tmp, 0o600);
    try {
      await link(tmp, file); // fails with EEXIST instead of overwriting
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "EEXIST") throw new UpError("BAD_ARGS", `${file} already exists; refusing to overwrite it`);
      // Filesystems without hard links (FAT/exFAT): exclusive create (O_EXCL) — never clobbers, may leave a partial file on a crash.
      try {
        await writeFile(file, content, { mode: 0o600, flag: "wx" });
      } catch (e2) {
        if ((e2 as NodeJS.ErrnoException).code === "EEXIST") throw new UpError("BAD_ARGS", `${file} already exists; refusing to overwrite it`);
        throw e2;
      }
      if (process.platform !== "win32") await chmod(file, 0o600).catch(() => {});
    }
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {}); // nothing was published: the original error is the one to report
    throw e;
  }
  // published from here on
  try {
    await rm(tmp, { force: true });
  } catch (e) {
    return { warning: `the file was written, but the temporary copy ${tmp} could not be removed (${(e as NodeJS.ErrnoException).code ?? "error"}); it holds the same content and can be deleted by hand` };
  }
  return {};
}

export const keyBackupVerb = defineVerb({
  name: "key backup",
  group: "key",
  summary: "Write a passphrase-encrypted backup (Ethereum keystore v3) of the controller key (default key; with --chain the key used on that chain) — human-run only.",
  description:
    "Only encrypted backups exist; the raw key is never exported. Requires --encrypted, --explicit-consent, a human approval, " +
    `and a passphrase (>= ${MIN_PASSPHRASE_LENGTH} characters) in the UP_BACKUP_PASSPHRASE environment variable, set by the human in their own terminal ` +
    "(never passed as an argument, never typed into chat). The preferred recovery path is a second (human) controller on the profile, not a key export.",
  risk: "secret",
  params: [
    { name: "path", type: "string", description: "Where to write the keystore JSON (must not exist; parent directory must exist).", required: true, positional: 0 },
    { name: "encrypted", type: "boolean", description: "Required: confirms an encrypted keystore v3 backup.", default: false },
    { name: "explicit-consent", type: "boolean", description: "Required: the human explicitly wants a copy of the key to exist outside the key store.", default: false },
  ],
  async run(ctx, args) {
    if (args.encrypted !== true) throw new UpError("BAD_ARGS", "only encrypted backups are supported (--encrypted); the raw key is never exported");
    if (args["explicit-consent"] !== true) throw new UpError("BAD_ARGS", "a key backup needs --explicit-consent from the human", { hint: PASSPHRASE_HINT });
    // the default key, or with --chain the key the agent uses on that chain
    const cfgNow = await ctx.config();
    const c = explicitChain(args) ? (controllerFor(cfgNow, ctx.chainId(args.chain)) ?? requireController(cfgNow)) : requireController(cfgNow);
    const raw = typeof args.path === "string" ? args.path.trim() : "";
    if (!raw) throw new UpError("BAD_ARGS", "--path is required");
    const file = isAbsolute(raw) ? raw : resolve(raw);
    const parent = await stat(dirname(file)).catch(() => null);
    if (!parent?.isDirectory()) throw new UpError("BAD_ARGS", `directory ${dirname(file)} does not exist`);
    if (await lstat(file).then(() => true, () => false)) throw new UpError("BAD_ARGS", `${file} already exists; refusing to overwrite it`);

    const passphrase = process.env.UP_BACKUP_PASSPHRASE;
    registerSecret(passphrase);
    if (!passphrase) throw new UpError("BAD_ARGS", "no backup passphrase: UP_BACKUP_PASSPHRASE is not set", { hint: PASSPHRASE_HINT });
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) throw new UpError("BAD_ARGS", `the backup passphrase must have at least ${MIN_PASSPHRASE_LENGTH} characters`, { hint: PASSPHRASE_HINT });

    const backend = internalBackend(c.backend);
    if (!backend.exportPrivateKey) throw new UpError("NOT_SUPPORTED", `the ${c.backend} backend cannot produce a backup`);
    const kdf = { name: "scrypt", ...STANDARD_SCRYPT };

    await ctx.consent({
      verb: "key backup",
      risk: "secret",
      summary: {
        effect: "write an encrypted copy of the controller key to a file",
        controller: c.address,
        backend: c.backend,
        path: file,
        format: `Ethereum keystore v3 (scrypt n=${kdf.n} r=${kdf.r} p=${kdf.p}, aes-128-ctr)`,
        note: "anyone with this file AND the passphrase controls the key; prefer a second human controller for recovery",
      },
    });
    if (ctx.flags.dryRun) {
      return { data: { dryRun: true, path: file, address: c.address, format: "keystore-v3", kdf }, text: `Dry run: an encrypted keystore for ${c.address} would be written to ${file}.` };
    }

    delete process.env.UP_BACKUP_PASSPHRASE; // never inherited by anything spawned later
    const key = await backend.exportPrivateKey(c.address);
    const ks = await encryptKeystoreV3(key, passphrase);
    // Prove the backup restores before writing it.
    const check = await decryptKeystoreV3(ks, passphrase);
    if (check !== key) throw new UpError("INTERNAL", "backup verification failed; nothing was written");
    const written = await writeNewFileExclusive(file, JSON.stringify(ks, null, 2) + "\n");
    ctx.log(`encrypted key backup written: ${file}`);
    return {
      data: { path: file, address: c.address, format: "keystore-v3", kdf, verified: true },
      text: `Encrypted backup of ${c.address} written to ${file} (Ethereum keystore v3). Keep the passphrase somewhere else — the file alone cannot be opened, the file plus passphrase controls the key.`,
      ...(written.warning ? { warnings: [written.warning] } : {}),
    };
  },
});

// ---------------------------------------------------------------------------
// key new-candidate / key activate (additional keys; switching never deletes a key)
// ---------------------------------------------------------------------------

export const keyNewCandidateVerb = defineVerb({
  name: "key new-candidate",
  group: "key",
  summary: "Create an additional key in the same key store (e.g. a separate key for one network, or a replacement when a key was lost); the agent's current key stays as it is.",
  description:
    "Generates a new key next to the agent's current key and returns its public address. Nothing changes on-chain and the agent keeps signing with its current key until `up key activate`. " +
    "Keys are permanent: no key is ever deleted; the current key stays in its store and stays listed.",
  risk: "secret",
  params: [],
  async run(ctx) {
    const c = requireController(await freshConfig(ctx));
    const backend = internalBackend(c.backend);
    await ctx.consent({
      verb: "key new-candidate",
      risk: "secret",
      summary: {
        effect: "create an additional controller key (not used until activated)",
        activeController: c.address,
        backend: c.backend,
        note: "nothing changes on-chain and the active key stays active until: up key activate <address>",
      },
    });
    if (ctx.flags.dryRun) {
      return { data: { dryRun: true, backend: c.backend }, text: `Dry run: a new inactive key would be created in ${c.backend}.` };
    }
    const address = await withKeyLock(ctx.home, async () => {
      await readCandidatesRaw(ctx.home); // a damaged candidates list stops here, before any key is created
      // Recorded in keys/inventory.jsonl at creation, so it stays listed whatever happens next.
      const a = await createRecorded(ctx.home, backend);
      try {
        await updateCandidates(ctx.home, (list) => [...list, { address: a, backend: c.backend, createdAt: new Date().toISOString() }]);
      } catch (e) {
        // Keys are never deleted: the new key stays in its store and in the recovery inventory.
        throw new UpError("INTERNAL", `the additional key ${a} was created in ${c.backend} but could not be added to the candidates list (${(e as Error).message})`, {
          hint: `the key stays in its store and is listed by: up key address; use it with: up key activate ${a} --backend ${c.backend} (add --chain <id> for one network)`,
        });
      }
      return a;
    });
    ctx.log(`additional key created in ${c.backend}: ${address}`);
    return {
      data: { address, backend: c.backend, active: false, protection: backend.protectionInfo() },
      text: `New additional key: ${address} (${c.backend}, not used yet). The current key ${c.address} stays as it is.\nNext: a co-owner or admin wallet adds it as a controller of the profile on the network(s) where it will be used; then: up key activate ${address} --chain <id> (one network) or up key activate ${address} (default key).`,
    };
  },
});

export const keyActivateVerb = defineVerb({
  name: "key activate",
  group: "key",
  summary: "Choose which of the agent's keys it signs with: the default key, or with --chain the key used on that chain only. The previous key is kept in its store and stays listed; no key is ever deleted.",
  description:
    "Without --chain the default key changes (every chain without its own key follows). With --chain <id> only that chain switches to the key; activating the default key's address for a chain makes that chain use the default key again. " +
    "Only the local signing key changes: the key must be a controller of the profile on that chain (check with: up profile status). Keys are permanent: the previous key is never deleted and can be activated again.",
  risk: "secret",
  params: [
    { name: "address", type: "string", description: "Address of the key to use (an additional key, a previous key, or with --chain also the default key); up key address lists them all.", required: true, positional: 0 },
    { name: "backend", type: "string", description: "Key store holding that key (default: where it was created, else the current key's store).", enum: BACKEND_IDS },
  ],
  async run(ctx, args) {
    const address = addressArg(args.address, "address");
    if (explicitChain(args)) return activateForChain(ctx, args, address, ctx.chainId(args.chain));
    const cfg = await freshConfig(ctx);
    const current = cfg.controller;
    if (current && sameAddress(current.address, address)) {
      return { data: { address: current.address, backend: current.backend, changed: false }, text: `${current.address} is already the active controller.` };
    }
    const candidates = await readCandidates(ctx.home);
    const cand = candidates.find((k) => sameAddress(k.address, address));
    const previous = cfg.previousControllers?.find((r) => sameAddress(r.address, address));
    const own = chainControllerList(cfg);
    const chainKey = own.find((k) => sameAddress(k.address, address));
    const recorded = (await readInventory(ctx.home)).find((k) => sameAddress(k.address, address));
    const backendId: string | undefined = args.backend ?? cand?.backend ?? previous?.backend ?? chainKey?.backend ?? recorded?.backend ?? current?.backend;
    if (!backendId) throw new UpError("BAD_ARGS", "cannot tell which key store holds this key; pass --backend", { hint: "run: up key backend" });
    const backend = internalBackend(backendId);
    if (!(await backend.has(address))) {
      throw new UpError("NO_SIGNER", `no key for ${address} in ${backendId}`, { hint: NOT_IN_STORE_HINT });
    }

    await ctx.consent({
      verb: "key activate",
      risk: "secret",
      summary: {
        effect: "switch the agent's active (default) controller key",
        from: current?.address ?? null,
        to: address,
        backend: backendId,
        note: "only the local signing key changes; on-chain permissions of both keys stay as they are",
        ...(own.length ? { chainsWithOwnKey: own.map((k) => ({ chainId: k.chainId, address: k.address })) } : {}),
      },
    });
    if (ctx.flags.dryRun) {
      return { data: { dryRun: true, address, backend: backendId, previous: current?.address ?? null }, text: `Dry run: ${address} (${backendId}) would become the active controller.` };
    }

    const changed = () => new UpError("BAD_ARGS", "the active controller changed while waiting for approval; nothing was switched", { hint: "run: up key address, then decide again" });
    await withKeyLock(ctx.home, async () => {
      const latest = await freshConfig(ctx);
      if (!sameKey(latest.controller?.address, current?.address)) throw changed();
      // Prove the key is usable (and really belongs to this address) before switching.
      await backend.load(address);
      const now = new Date().toISOString();
      await ctx.updateConfig((cur) => {
        if (!sameKey(cur.controller?.address, current?.address)) throw changed();
        // the previous default key is kept: it stays in its store and stays listed
        const previousList = (cur.previousControllers ?? []).filter((r) => !sameAddress(r.address, address) && !sameAddress(r.address, cur.controller?.address));
        if (cur.controller) previousList.push({ address: cur.controller.address, backend: cur.controller.backend, switchedAt: now });
        const next: UpConfig = { ...cur, version: 1, controller: { address, backend: backendId, createdAt: cand?.createdAt ?? recorded?.createdAt ?? now }, previousControllers: previousList };
        // a chain whose own key is now the default key simply uses the default
        if (next.chainControllers) {
          const kept = Object.fromEntries(Object.entries(next.chainControllers).filter(([, k]) => !sameAddress(k.address, address)));
          if (Object.keys(kept).length) next.chainControllers = kept;
          else delete next.chainControllers;
        }
        return next;
      });
      await dropCandidate(ctx.home, address);
    });
    ctx.log(`active controller switched to ${address} (${backendId})`);
    const ownAfter = own.filter((k) => !sameAddress(k.address, address));
    return {
      data: { address, backend: backendId, previous: current?.address ?? null, changed: true, chainControllers: ownAfter.map((k) => ({ chainId: k.chainId, address: k.address })) },
      text: [
        protectionText(address, backendId),
        current ? `Previous key ${current.address} is kept in ${current.backend} and stays listed (up key address); its on-chain permissions stay as they are.` : "",
        ownAfter.length ? `Chains with their own key keep it: ${ownAfter.map((k) => `${chainText(ctx, k.chainId)} → ${k.address}`).join("; ")}.` : "",
      ].filter(Boolean).join("\n"),
    };
  },
});

/** key activate <address> --chain <id>: the key the agent uses on one chain only. */
async function activateForChain(ctx: VerbContext, args: Record<string, any>, address: Address, chainId: number): Promise<VerbResult> {
  const where = chainText(ctx, chainId);
  const cfg = await freshConfig(ctx);
  const def = cfg.controller;
  const current = controllerFor(cfg, chainId);
  if (current && sameAddress(current.address, address)) {
    return { data: { address: current.address, backend: current.backend, chainId, scope: current.scope, changed: false }, text: `${current.address} already is the agent's key on ${where}.` };
  }
  const toDefault = Boolean(def && sameAddress(def.address, address));
  const candidates = await readCandidates(ctx.home);
  const cand = candidates.find((k) => sameAddress(k.address, address));
  const previous = cfg.previousControllers?.find((r) => sameAddress(r.address, address));
  const usedElsewhere = chainControllerList(cfg).find((k) => sameAddress(k.address, address));
  const recorded = (await readInventory(ctx.home)).find((k) => sameAddress(k.address, address));
  const backendId: string | undefined = args.backend ?? (toDefault ? def!.backend : undefined) ?? usedElsewhere?.backend ?? cand?.backend ?? previous?.backend ?? recorded?.backend ?? def?.backend;
  if (!backendId) throw new UpError("BAD_ARGS", "cannot tell which key store holds this key; pass --backend", { hint: "run: up key backend" });
  const backend = internalBackend(backendId);
  if (!(await backend.has(address))) {
    throw new UpError("NO_SIGNER", `no key for ${address} in ${backendId}`, { hint: NOT_IN_STORE_HINT });
  }

  await ctx.consent({
    verb: "key activate",
    risk: "secret",
    chainId,
    summary: {
      effect: toDefault ? `use the default key again on ${where}` : `use ${address} as the agent's key on ${where} only`,
      chain: where,
      from: current?.address ?? null,
      to: address,
      backend: backendId,
      note: "only the local signing key for this chain changes; other chains keep their key, and on-chain permissions stay as they are — the key must be a controller of the profile on this chain",
    },
  });
  if (ctx.flags.dryRun) {
    return { data: { dryRun: true, address, backend: backendId, chainId, previous: current?.address ?? null }, text: `Dry run: ${address} (${backendId}) would become the agent's key on ${where}.` };
  }

  const changed = () => new UpError("BAD_ARGS", `the agent's key on ${where} changed while waiting for approval; nothing was switched`, { hint: `run: up key address --chain ${chainId}, then decide again` });
  await withKeyLock(ctx.home, async () => {
    const latest = await freshConfig(ctx);
    if (!sameKey(controllerFor(latest, chainId)?.address, current?.address)) throw changed();
    await backend.load(address);
    const now = new Date().toISOString();
    await ctx.updateConfig((cur) => {
      if (!sameKey(controllerFor(cur, chainId)?.address, current?.address)) throw changed();
      const own = { ...(cur.chainControllers ?? {}) };
      const previousOwn = own[String(chainId)];
      if (toDefault) delete own[String(chainId)];
      else own[String(chainId)] = { address, backend: backendId, createdAt: cand?.createdAt ?? usedElsewhere?.createdAt ?? recorded?.createdAt ?? now };
      let previousList = (cur.previousControllers ?? []).filter((r) => !sameAddress(r.address, address));
      // the chain's previous own key is kept and listed (unless it is still in use as default or on another chain)
      if (previousOwn && !sameAddress(previousOwn.address, cur.controller?.address) && !Object.values(own).some((k) => sameAddress(k.address, previousOwn.address))) {
        previousList = [...previousList.filter((r) => !sameAddress(r.address, previousOwn.address)), { address: previousOwn.address, backend: previousOwn.backend, switchedAt: now, chainId }];
      }
      const next: UpConfig = { ...cur, version: 1, previousControllers: previousList.length ? previousList : undefined };
      if (Object.keys(own).length) next.chainControllers = own;
      else delete next.chainControllers;
      if (!next.previousControllers) delete next.previousControllers;
      return next;
    });
    await dropCandidate(ctx.home, address);
  });
  ctx.log(`agent key on chain ${chainId} switched to ${address} (${backendId})`);
  return {
    data: { address, backend: backendId, chainId, scope: toDefault ? "default" : "chain", previous: current?.address ?? null, changed: true },
    text: [
      toDefault ? `On ${where} the agent uses its default key ${address} again.` : `On ${where} the agent now signs with ${address} (${backendId}); every other chain keeps its key.`,
      current ? `Previous key there: ${current.address} (kept in its store and listed; its on-chain permissions stay as they are).` : "",
      `Check that it is a controller of your profile on ${where}: up profile status --chain ${chainId}`,
    ].filter(Boolean).join("\n"),
  };
}

export const keyVerbs = [initVerb, keyAddressVerb, keyBackendVerb, keyBackupVerb, keyNewCandidateVerb, keyActivateVerb];
