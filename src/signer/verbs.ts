// Key lifecycle verbs (group "key"): init, key address, key backend,
// key rotate-plan, key backup, key new-candidate, key activate.
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
import { randomBytes } from "node:crypto";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { getAddress, isAddress } from "viem";
import { UpError } from "../core/errors.ts";
import { ensureDir, paths, readJson, writeJson } from "../core/home.ts";
import type { Address, UpConfig, VerbContext, VerbResult } from "../core/types.ts";
import { defineVerb } from "../core/verbs.ts";
import { BACKEND_IDS, chooseBackend, custodyWarnings, environment, internalBackend, plainProtection, probeAll } from "./index.ts";
import { chainControllerList, controllerFor } from "./select.ts";
import { decryptKeystoreV3, encryptKeystoreV3, STANDARD_SCRYPT } from "./keystore-v3.ts";

// ---------------------------------------------------------------------------
// Candidate keys (rotation) — public data only, <UP_HOME>/keys/candidates.json
// ---------------------------------------------------------------------------

export interface CandidateKey {
  address: Address;
  backend: string;
  createdAt: string;
}

function candidatesFile(home: string): string {
  return join(paths.keys(home), "candidates.json");
}

export async function readCandidates(home: string): Promise<CandidateKey[]> {
  const v = await readJson<unknown>(candidatesFile(home), []);
  return Array.isArray(v) ? v.filter((c): c is CandidateKey => Boolean(c && typeof c === "object" && isAddress((c as any).address, { strict: false }) && typeof (c as any).backend === "string")) : [];
}

async function writeCandidates(home: string, list: CandidateKey[]): Promise<void> {
  await writeJson(candidatesFile(home), list);
}

function sameAddress(a: string | undefined, b: string | undefined): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
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

/** Config with the key fields re-read from disk (another process may have changed them). */
async function freshConfig(ctx: VerbContext): Promise<UpConfig> {
  const c = await ctx.config();
  const disk = await readJson<UpConfig | null>(paths.config(ctx.home), null);
  if (disk && typeof disk === "object" && (!sameAddress(disk.controller?.address, c.controller?.address) || JSON.stringify(disk.chainControllers ?? {}) !== JSON.stringify(c.chainControllers ?? {}))) {
    return { ...c, controller: disk.controller, retiredControllers: disk.retiredControllers, chainControllers: disk.chainControllers };
  }
  return c;
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
    "setup; if a controller already exists nothing changes. Replacing an existing controller requires --force and a human approval.",
  risk: "secret",
  params: [
    { name: "backend", type: "string", description: "Key store to use; 'auto' picks the strongest unattended store for this machine.", default: "auto", enum: BACKEND_CHOICES },
    { name: "force", type: "boolean", description: "Replace an existing controller key (the old one stays in its store and is listed as retired). Needs --approval.", default: false },
  ],
  examples: ["up init", "up init --backend protected-file", "up init --force --approval \"<human's words>\""],
  async run(ctx: VerbContext, args: Record<string, any>): Promise<VerbResult> {
    const requested = String(args.backend ?? "auto");
    const force = args.force === true;
    const existing = (await freshConfig(ctx)).controller;

    if (existing && !force) {
      const warnings = ["a controller key already exists; nothing was changed (use --force with a human approval to replace it)"];
      if (requested !== "auto" && requested !== existing.backend) warnings.push(`--backend ${requested} ignored: the existing key lives in ${existing.backend}`);
      try {
        if (!(await internalBackend(existing.backend).has(existing.address))) warnings.push(`the key for ${existing.address} is missing from ${existing.backend}; run: up key backend`);
      } catch (e) {
        warnings.push(`could not check the key store: ${e instanceof UpError ? e.message : "error"}`);
      }
      return existingResult(ctx.home, existing, warnings);
    }

    const backend = await chooseBackend(requested);
    const protection = internalBackend(backend.id).protectionInfo();

    if (existing && force) {
      await ctx.consent({
        verb: "init",
        risk: "secret",
        summary: {
          effect: "replace the local controller key with a new one",
          currentController: existing.address,
          currentBackend: existing.backend,
          newBackend: backend.id,
          note: "the old key stays in its store and is listed in retiredControllers; on-chain permissions do NOT move — the new key controls nothing until it is added as a controller (see: up key rotate-plan)",
        },
      });
    }

    const custody = custodyWarnings(backend.id, ctx.home);
    if (ctx.flags.dryRun) {
      return {
        data: { dryRun: true, backend: backend.id, protection, wouldReplace: existing?.address ?? null, custodyWarnings: custody },
        text: [`Dry run: a new controller key would be created in ${backend.id}.`, `Key protection: ${plainProtection(protection)}`, ...custody.map((w) => `Warning: ${w}`)].join("\n"),
        ...(custody.length ? { warnings: custody } : {}),
      };
    }

    return withKeyLock(ctx.home, async () => {
      // Re-check under the lock: another process may have initialised (or replaced) meanwhile.
      const latest = await freshConfig(ctx);
      const old = latest.controller;
      if (old && !force) return existingResult(ctx.home, old, ["another process created the controller key at the same time; kept that one"]);
      if (force && !sameAddress(old?.address, existing?.address)) {
        throw new UpError("BAD_ARGS", "the controller changed while waiting for approval; nothing was replaced", { hint: "run: up key address, then decide again" });
      }

      const address = await backend.create();
      const createdAt = new Date().toISOString();
      const next: UpConfig = { ...latest, version: 1, controller: { address, backend: backend.id, createdAt } };
      if (old) {
        next.retiredControllers = [...(latest.retiredControllers ?? []).filter((r) => !sameAddress(r.address, old.address)), { address: old.address, backend: old.backend, retiredAt: createdAt }];
      }
      try {
        await ctx.saveConfig(next);
      } catch (e) {
        await backend.remove(address).catch(() => {}); // never leave an unrecorded key behind
        throw e;
      }
      ctx.log(`controller key created in ${backend.id}: ${address}`);
      const warnings = [...custody, ...(old ? [`the previous controller ${old.address} was retired locally; it still holds its on-chain permissions until removed (see: up key rotate-plan)`] : [])];
      return {
        data: { address, backend: backend.id, protection, created: true, custodyWarnings: custody, ...(old ? { replaced: old.address } : {}) },
        text: protectionText(address, backend.id, custody),
        ...(warnings.length ? { warnings } : {}),
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
  summary: "Show the agent's controller address (the default key, or with --chain the key used on that chain) and the key store that protects it; lists chains that use their own key.",
  risk: "local",
  params: [],
  async run(ctx, args) {
    const cfg = await ctx.config();
    const chainId = explicitChain(args) ? ctx.chainId(args.chain) : undefined;
    const c = chainId !== undefined ? controllerFor(cfg, chainId) : undefined;
    const def = cfg.controller;
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
      },
      text: [chainId !== undefined ? `${used.address} (${used.backend}) — the agent's ${c?.scope === "chain" ? "own key" : "default key"} on ${chainText(ctx, chainId)}` : `${used.address} (${used.backend})`, ...perChainLines(ctx, cfg)].join("\n"),
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
// key rotate-plan
// ---------------------------------------------------------------------------

export const keyRotatePlanVerb = defineVerb({
  name: "key rotate-plan",
  group: "key",
  summary: "Show the step-by-step plan to rotate the controller key without changing the profile address (the default key, or with --chain the key used on that chain).",
  description:
    "Returns the rotation drill as data and text. It does not execute anything; each step names the verb that performs it. Permissions are stored per chain, so the new key is granted, verified and the old one removed on every chain where the rotated key is used; chains with their own key are rotated separately (--chain).",
  risk: "local",
  params: [],
  async run(ctx, args) {
    const cfg = await ctx.config();
    const chainId = explicitChain(args) ? ctx.chainId(args.chain) : undefined;
    const c = chainId !== undefined ? (controllerFor(cfg, chainId) ?? requireController(cfg)) : requireController(cfg);
    const scope = chainId !== undefined && cfg.chainControllers?.[String(chainId)] ? "chain" : "default";
    const own = chainControllerList(cfg);
    const candidates = (await readCandidates(ctx.home)).filter((k) => !sameAddress(k.address, c.address));
    const next = candidates[candidates.length - 1]?.address;
    const newKey = next ?? "<new-address>";
    // where this key signs: one chain (--chain), else every configured chain without its own key
    const ownIds = new Set(own.map((k) => k.chainId));
    const chains = chainId !== undefined ? [chainId] : cfg.chains?.length ? cfg.chains.filter((id) => !ownIds.has(id)) : undefined;
    const where = chainId !== undefined ? `on ${chainText(ctx, chainId)}` : `on each chain where the profile is deployed${chains ? ` and this key is used (configured: ${chains.join(", ") || "none"})` : ""}${own.length ? `, except chains with their own key (${own.map((k) => chainText(ctx, k.chainId)).join(", ")})` : ""}`;
    const chainFlag = chainId !== undefined ? `--chain ${chainId}` : "--chain <id>";
    const steps = [
      {
        step: 1,
        title: "Create the new key",
        detail: next ? `Candidate ${next} already exists in ${c.backend}.` : `Generate a second key in the same store (${c.backend}); it stays inactive.`,
        command: next ? null : "up key new-candidate",
        done: Boolean(next),
      },
      {
        step: 2,
        title: chainId !== undefined ? "Add it as a controller with identical permissions on this chain" : "Add it as a controller with identical permissions on every chain",
        detail: `${where[0].toUpperCase()}${where.slice(1)}, read the permissions, AllowedCalls and AllowedERC725YDataKeys of ${c.address} and grant exactly the same to ${newKey}. Permissions are per chain: a grant on one chain does nothing on another. This is an admin action that needs a controller allowed to add controllers (often the human's).`,
        command: `up permissions show ${c.address} ${chainFlag}   then   up controller add ${newKey} ${chainFlag} (same permissions)`,
        done: false,
      },
      {
        step: 3,
        title: chainId !== undefined ? "Verify on this chain" : "Verify on every chain",
        detail: `Confirm ${newKey} has exactly the old controller's permissions ${chainId !== undefined ? "there" : "on each chain"} before going further (up profile status shows every chain at once).`,
        command: `up permissions show ${newKey} ${chainFlag}`,
        done: false,
      },
      {
        step: 4,
        title: "Switch the agent to the new key",
        detail: `Make the new key the agent's ${chainId !== undefined ? `key on ${chainText(ctx, chainId)}` : "default key"} and run a harmless signed action/no-op ${chainId !== undefined ? "there" : "per chain"} to prove it works. The old key is kept as retired.${chainId === undefined && own.length ? " Chains with their own key keep it." : ""}`,
        command: chainId !== undefined ? `up key activate ${newKey} --chain ${chainId}` : `up key activate ${newKey}`,
        done: false,
      },
      {
        step: 5,
        title: chainId !== undefined ? "Remove the old controller on this chain" : "Remove the old controller on every chain",
        detail: `Remove ${c.address} (all permissions) ${chainId !== undefined ? "there" : "on each chain where it was granted"}. Never remove the last controller with admin rights.`,
        command: `up controller remove ${c.address} ${chainFlag}`,
        done: false,
      },
      {
        step: 6,
        title: "Retire the old key",
        detail: `Keep the old key in ${c.backend} for 30 days as a fallback, then delete it from the key store.`,
        command: null,
        done: false,
      },
    ];
    const text = [
      `Rotation plan for ${c.address} (${c.backend})${chainId !== undefined ? `, the agent's ${scope === "chain" ? "own key" : "default key"} on ${chainText(ctx, chainId)}` : ""}. The profile address never changes.`,
      ...steps.map((s) => `${s.step}. ${s.title}${s.done ? " [done]" : ""}: ${s.detail}${s.command ? `\n   → ${s.command}` : ""}`),
      ...(chainId === undefined && own.length ? [`Chains with their own key rotate separately: ${own.map((k) => `up key rotate-plan --chain ${k.chainId}`).join("; ")}.`] : []),
      "Command names for chain steps are indicative; use the controller/permissions verbs listed by: up help.",
    ].join("\n");
    return { data: { controller: c.address, backend: c.backend, scope, chainId: chainId ?? null, candidate: next ?? null, chains: chains ?? null, chainControllers: own.map((k) => ({ chainId: k.chainId, address: k.address })), steps }, text };
  },
});

// ---------------------------------------------------------------------------
// key backup (encrypted keystore v3 only)
// ---------------------------------------------------------------------------

export const MIN_PASSPHRASE_LENGTH = 12;
const PASSPHRASE_HINT =
  "a human must run this in their own terminal (never via chat): read -rs UP_BACKUP_PASSPHRASE && export UP_BACKUP_PASSPHRASE && up key backup --encrypted --explicit-consent --path <file> --approval \"<your words>\"; unset UP_BACKUP_PASSPHRASE";

async function writeNewFileExclusive(file: string, content: string): Promise<void> {
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
  } finally {
    await rm(tmp, { force: true });
  }
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
    await writeNewFileExclusive(file, JSON.stringify(ks, null, 2) + "\n");
    ctx.log(`encrypted key backup written: ${file}`);
    return {
      data: { path: file, address: c.address, format: "keystore-v3", kdf, verified: true },
      text: `Encrypted backup of ${c.address} written to ${file} (Ethereum keystore v3). Keep the passphrase somewhere else — the file alone cannot be opened, the file plus passphrase controls the key.`,
    };
  },
});

// ---------------------------------------------------------------------------
// key new-candidate / key activate (rotation)
// ---------------------------------------------------------------------------

export const keyNewCandidateVerb = defineVerb({
  name: "key new-candidate",
  group: "key",
  summary: "Create an additional, inactive controller key in the same key store (first step of a rotation).",
  description: "Generates a new key next to the active one and returns its public address. Nothing changes on-chain and the active key stays active until `up key activate`.",
  risk: "secret",
  params: [],
  async run(ctx) {
    const c = requireController(await freshConfig(ctx));
    const backend = internalBackend(c.backend);
    await ctx.consent({
      verb: "key new-candidate",
      risk: "secret",
      summary: {
        effect: "create an additional, inactive controller key (rotation step 1)",
        activeController: c.address,
        backend: c.backend,
        note: "nothing changes on-chain and the active key stays active until: up key activate <address>",
      },
    });
    if (ctx.flags.dryRun) {
      return { data: { dryRun: true, backend: c.backend }, text: `Dry run: a new inactive key would be created in ${c.backend}.` };
    }
    const address = await withKeyLock(ctx.home, async () => {
      const a = await backend.create();
      try {
        const list = await readCandidates(ctx.home);
        list.push({ address: a, backend: c.backend, createdAt: new Date().toISOString() });
        await writeCandidates(ctx.home, list);
      } catch (e) {
        await backend.remove(a).catch(() => {}); // an unrecorded candidate would be undiscoverable
        throw e;
      }
      return a;
    });
    ctx.log(`candidate key created in ${c.backend}: ${address}`);
    return {
      data: { address, backend: c.backend, active: false, protection: backend.protectionInfo() },
      text: `New candidate key: ${address} (inactive, ${c.backend}).\nNext: give it the same permissions as ${c.address} on every chain, then run: up key activate ${address}\n(or use it on one chain only: authorise it there, then up key activate ${address} --chain <id>)`,
    };
  },
});

export const keyActivateVerb = defineVerb({
  name: "key activate",
  group: "key",
  summary: "Make another key from the key store the agent's controller key: the default key (rotation or rollback; the previous one is retired), or with --chain the key used on that chain only.",
  description:
    "Without --chain the default key changes (every chain without its own key follows). With --chain <id> only that chain switches to the key; activating the default key's address for a chain removes the chain's own key (it uses the default again). Only the local signing key changes: the key must be a controller of the profile on that chain (check with: up profile status).",
  risk: "secret",
  params: [
    { name: "address", type: "string", description: "Address of the key to activate (a candidate, a retired key, or with --chain also the default key).", required: true, positional: 0 },
    { name: "backend", type: "string", description: "Key store holding that key (default: where the candidate was created, else the active controller's store).", enum: BACKEND_IDS },
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
    const retired = cfg.retiredControllers?.find((r) => sameAddress(r.address, address));
    const own = chainControllerList(cfg);
    const chainKey = own.find((k) => sameAddress(k.address, address));
    const backendId: string | undefined = args.backend ?? cand?.backend ?? retired?.backend ?? chainKey?.backend ?? current?.backend;
    if (!backendId) throw new UpError("BAD_ARGS", "cannot tell which key store holds this key; pass --backend", { hint: "run: up key backend" });
    const backend = internalBackend(backendId);
    if (!(await backend.has(address))) {
      throw new UpError("NO_SIGNER", `no key for ${address} in ${backendId}`, { hint: "create one with: up key new-candidate" });
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

    await withKeyLock(ctx.home, async () => {
      const latest = await freshConfig(ctx);
      if (!sameAddress(latest.controller?.address, current?.address)) {
        throw new UpError("BAD_ARGS", "the active controller changed while waiting for approval; nothing was switched", { hint: "run: up key address, then decide again" });
      }
      // Prove the key is usable (and really belongs to this address) before switching.
      await backend.load(address);
      const now = new Date().toISOString();
      const retiredList = (latest.retiredControllers ?? []).filter((r) => !sameAddress(r.address, address));
      if (current) retiredList.push({ address: current.address, backend: current.backend, retiredAt: now });
      const next: UpConfig = { ...latest, version: 1, controller: { address, backend: backendId, createdAt: cand?.createdAt ?? now }, retiredControllers: retiredList };
      // a chain whose own key is now the default key simply uses the default
      if (next.chainControllers) {
        const kept = Object.fromEntries(Object.entries(next.chainControllers).filter(([, k]) => !sameAddress(k.address, address)));
        if (Object.keys(kept).length) next.chainControllers = kept;
        else delete next.chainControllers;
      }
      await ctx.saveConfig(next);
      const fresh = await readCandidates(ctx.home);
      if (fresh.some((k) => sameAddress(k.address, address))) await writeCandidates(ctx.home, fresh.filter((k) => !sameAddress(k.address, address)));
    });
    ctx.log(`active controller switched to ${address} (${backendId})`);
    const ownAfter = own.filter((k) => !sameAddress(k.address, address));
    return {
      data: { address, backend: backendId, previous: current?.address ?? null, changed: true, chainControllers: ownAfter.map((k) => ({ chainId: k.chainId, address: k.address })) },
      text: [
        protectionText(address, backendId),
        current ? `Previous controller ${current.address} is retired locally (still on-chain until removed).` : "",
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
  const retired = cfg.retiredControllers?.find((r) => sameAddress(r.address, address));
  const usedElsewhere = chainControllerList(cfg).find((k) => sameAddress(k.address, address));
  const backendId: string | undefined = args.backend ?? (toDefault ? def!.backend : undefined) ?? usedElsewhere?.backend ?? cand?.backend ?? retired?.backend ?? def?.backend;
  if (!backendId) throw new UpError("BAD_ARGS", "cannot tell which key store holds this key; pass --backend", { hint: "run: up key backend" });
  const backend = internalBackend(backendId);
  if (!(await backend.has(address))) {
    throw new UpError("NO_SIGNER", `no key for ${address} in ${backendId}`, { hint: "create one with: up key new-candidate" });
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

  await withKeyLock(ctx.home, async () => {
    const latest = await freshConfig(ctx);
    if (!sameAddress(controllerFor(latest, chainId)?.address, current?.address)) {
      throw new UpError("BAD_ARGS", `the agent's key on ${where} changed while waiting for approval; nothing was switched`, { hint: `run: up key address --chain ${chainId}, then decide again` });
    }
    await backend.load(address);
    const now = new Date().toISOString();
    const own = { ...(latest.chainControllers ?? {}) };
    const previousOwn = own[String(chainId)];
    if (toDefault) delete own[String(chainId)];
    else own[String(chainId)] = { address, backend: backendId, createdAt: cand?.createdAt ?? usedElsewhere?.createdAt ?? now };
    let retiredList = (latest.retiredControllers ?? []).filter((r) => !sameAddress(r.address, address));
    // the chain's previous own key is retired unless it is still used (as default or on another chain)
    if (previousOwn && !sameAddress(previousOwn.address, latest.controller?.address) && !Object.values(own).some((k) => sameAddress(k.address, previousOwn.address))) {
      retiredList = [...retiredList.filter((r) => !sameAddress(r.address, previousOwn.address)), { address: previousOwn.address, backend: previousOwn.backend, retiredAt: now, chainId }];
    }
    const next: UpConfig = { ...latest, version: 1, retiredControllers: retiredList.length ? retiredList : undefined };
    if (Object.keys(own).length) next.chainControllers = own;
    else delete next.chainControllers;
    if (!next.retiredControllers) delete next.retiredControllers;
    await ctx.saveConfig(next);
    const fresh = await readCandidates(ctx.home);
    if (fresh.some((k) => sameAddress(k.address, address))) await writeCandidates(ctx.home, fresh.filter((k) => !sameAddress(k.address, address)));
  });
  ctx.log(`agent key on chain ${chainId} switched to ${address} (${backendId})`);
  return {
    data: { address, backend: backendId, chainId, scope: toDefault ? "default" : "chain", previous: current?.address ?? null, changed: true },
    text: [
      toDefault ? `On ${where} the agent uses its default key ${address} again.` : `On ${where} the agent now signs with ${address} (${backendId}); every other chain keeps its key.`,
      current ? `Previous key there: ${current.address} (still on-chain until removed).` : "",
      `Check that it is a controller of your profile on ${where}: up profile status --chain ${chainId}`,
    ].filter(Boolean).join("\n"),
  };
}

export const keyVerbs = [initVerb, keyAddressVerb, keyBackendVerb, keyRotatePlanVerb, keyBackupVerb, keyNewCandidateVerb, keyActivateVerb];
