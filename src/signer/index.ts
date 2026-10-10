// Signer backend registry, automatic backend selection and config loading.
//
// Automatic ranking ("auto"), strongest first; a backend is eligible only when
// its probe reports available && unattended:
//   macOS:        macos-keychain
//   Linux:        linux-systemd-creds → linux-secret-service
//   WSL2:         wsl-dpapi → linux-systemd-creds → linux-secret-service
//   Windows:      windows-dpapi
//   then (all):   vm-protected-file  only if a cloud agent VM is DECLARED (UP_AGENT_HOST=dots|muse|vm)
//                 protected-file     otherwise, if the host is headless or a container
//                                    (init then warns: not encrypted at rest, lost with the machine)
// Otherwise (a desktop without a working store) auto fails and the user must
// opt in with --backend protected-file. A merely detected container/cloud VM
// never gets the owner-approved vm-protected-file label.
// remote-signer and memory are never selected automatically. An existing key
// is always loaded from the backend recorded in config — never a fallback.
import { realpathSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { getAddress, isAddress } from "viem";
import { upHome } from "../core/home.ts";
import { UpError } from "../core/errors.ts";
import type { BackendProbe, ProtectionInfo, Signer, SignerBackend, UpConfig } from "../core/types.ts";
import type { InternalBackend } from "./base.ts";
import { checkEphemeralHome, environment, type SignerEnvironment } from "./env.ts";
import { LinuxSecretServiceBackend } from "./linux-secret-service.ts";
import { LinuxSystemdCredsBackend } from "./linux-systemd-creds.ts";
import { MacosKeychainBackend } from "./macos-keychain.ts";
import { MemoryBackend, memoryEnabled } from "./memory.ts";
import { PROTECTED_FILE_WARNING, ProtectedFileBackend } from "./protected-file.ts";
import { RemoteSignerBackend } from "./remote-signer.ts";
import { WindowsDpapiBackend } from "./windows-dpapi.ts";
import { controllerFor, localControllers } from "./select.ts";

export type { SignerEnvironment } from "./env.ts";
export { controllerFor, chainControllerList, localControllers, type SelectedController } from "./select.ts";
export { environment, detectEnvironment } from "./env.ts";
export { createLocalSigner, intendedValidatorDigest } from "./local-signer.ts";
export { PROTECTED_FILE_WARNING } from "./protected-file.ts";

export const BACKEND_IDS = [
  "macos-keychain",
  "linux-systemd-creds",
  "linux-secret-service",
  "windows-dpapi",
  "wsl-dpapi",
  "protected-file",
  "vm-protected-file",
  "remote-signer",
  "memory",
] as const;
export type BackendId = (typeof BACKEND_IDS)[number];

function createDefaultBackends(): InternalBackend[] {
  return [
    new MacosKeychainBackend(),
    new LinuxSystemdCredsBackend(),
    new LinuxSecretServiceBackend(),
    new WindowsDpapiBackend("windows"),
    new WindowsDpapiBackend("wsl"),
    new ProtectedFileBackend("protected-file"),
    new ProtectedFileBackend("vm-protected-file"),
    new RemoteSignerBackend(),
    new MemoryBackend(),
  ];
}

let registry: InternalBackend[] = createDefaultBackends();

/** Tests only: replace the registry (pass nothing to restore the defaults). */
export function setBackendsForTests(backends?: InternalBackend[]): void {
  registry = backends ?? createDefaultBackends();
}

export function listBackends(): SignerBackend[] {
  return [...registry];
}

/** Internal view including protectionInfo()/exportPrivateKey() — for signer verbs only. */
export function internalBackend(id: string): InternalBackend {
  const b = registry.find((x) => x.id === id);
  if (!b) {
    throw new UpError("SIGNER_BACKEND_UNAVAILABLE", `unknown signer backend "${String(id).slice(0, 40)}"`, { hint: `use one of: auto, ${BACKEND_IDS.join(", ")}` });
  }
  return b;
}

export function getBackend(id: string): SignerBackend {
  return internalBackend(id);
}

export function protectionOf(id: string): ProtectionInfo {
  return internalBackend(id).protectionInfo();
}

async function safeProbe(b: SignerBackend): Promise<BackendProbe> {
  try {
    return await b.probe();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { id: b.id, available: false, unattended: false, level: protectionLevelGuess(b), reason: `probe failed: ${msg.slice(0, 200)}` };
  }
}

function protectionLevelGuess(b: SignerBackend): ProtectionInfo["level"] {
  try {
    return (b as InternalBackend).protectionInfo().level;
  } catch {
    return "protected-file";
  }
}

export async function probeAll(): Promise<BackendProbe[]> {
  return Promise.all(registry.map((b) => safeProbe(b)));
}

/** Platform-specific order of OS-backed stores (strongest first). */
export function osRanking(env: Pick<SignerEnvironment, "platform" | "wsl">): BackendId[] {
  switch (env.platform) {
    case "darwin":
      return ["macos-keychain"];
    case "win32":
      return ["windows-dpapi"];
    case "linux":
      return env.wsl ? ["wsl-dpapi", "linux-systemd-creds", "linux-secret-service"] : ["linux-systemd-creds", "linux-secret-service"];
    default:
      return [];
  }
}

/** Full automatic candidate order for this environment (file fallbacks included only where allowed). */
export function autoRanking(env: SignerEnvironment): BackendId[] {
  const order = osRanking(env);
  if (env.isolated) order.push("vm-protected-file");
  else if (env.unattendedHost) order.push("protected-file");
  return order;
}

/** Pure selection: first backend in autoRanking whose probe is available and unattended. */
export function selectAutoBackend(env: SignerEnvironment, probes: BackendProbe[]): BackendId | undefined {
  const byId = new Map(probes.map((p) => [p.id, p]));
  return autoRanking(env).find((id) => {
    const p = byId.get(id);
    return p !== undefined && p.available && p.unattended;
  });
}

export async function chooseBackend(preferred?: string, envOverride?: SignerEnvironment): Promise<SignerBackend> {
  const want = (preferred ?? "auto").trim() || "auto";
  if (want !== "auto") {
    const b = internalBackend(want);
    if (b.id === "remote-signer") throw new UpError("NOT_SUPPORTED", "the remote-signer backend is not available in this version", { hint: "use --backend auto" });
    const p = await safeProbe(b);
    if (!p.available) {
      throw new UpError("SIGNER_BACKEND_UNAVAILABLE", `signer backend "${b.id}" is not available here: ${p.reason}`, { hint: "run: up key backend   (or use --backend auto)" });
    }
    return b;
  }
  // Test mode (UP_TEST_EPHEMERAL_KEY set) never writes into a real OS key store: "auto" means memory.
  if (memoryEnabled()) return internalBackend("memory");
  const env = envOverride ?? (await environment());
  const probes = await probeAll();
  const id = selectAutoBackend(env, probes);
  if (id) return internalBackend(id);
  const considered = osRanking(env)
    .map((x) => probes.find((p) => p.id === x))
    .filter((p): p is BackendProbe => Boolean(p))
    .map((p) => `${p.id}: ${p.reason}`);
  const detail = considered.length ? considered.join("; ") : `no OS key store is supported on ${env.platform}`;
  throw new UpError("SIGNER_BACKEND_UNAVAILABLE", `no protected key store is available on this machine (${detail})`, {
    hint: "fix the key store above, or explicitly accept a 0600 key file that is not encrypted at rest: up init --backend protected-file",
    details: { probes, environment: { platform: env.platform, wsl: env.wsl, container: env.container, vm: env.vm, headless: env.headless } },
  });
}

/**
 * Loads the controller used on `chainId` (its chain-specific key, else the default key; the
 * default key without a chain) from its recorded backend. Never falls back to another backend
 * or to another chain's key.
 */
export async function loadSignerFromConfig(cfg: UpConfig, chainId?: number): Promise<Signer> {
  const d = cfg.controller;
  if (d?.address && !isAddress(d.address, { strict: false })) throw new UpError("NO_SIGNER", "config.controller.address is not a valid address", { hint: "run: up init --force" });
  const c = controllerFor({ ...cfg, controller: d?.address ? d : undefined }, chainId);
  if (!c) throw new UpError("NO_SIGNER", "no controller key is configured", { hint: "run: up init" });
  const backend = getBackend(c.backend);
  return backend.load(getAddress(c.address));
}

/** Backends whose key material (plain or encrypted) lives in files under UP_HOME. */
export const HOME_STORED_BACKENDS = new Set(["protected-file", "vm-protected-file", "linux-systemd-creds", "windows-dpapi", "wsl-dpapi"]);

/**
 * Custody warnings for a key in `backendId` (public text, safe to show):
 *  - plain protected file: not encrypted at rest, lost with the machine
 *  - any backend storing files under UP_HOME: UP_HOME looks ephemeral
 */
export function custodyWarnings(backendId: string, home: string = upHome()): string[] {
  const out: string[] = [];
  if (backendId === "protected-file") out.push(PROTECTED_FILE_WARNING);
  if (HOME_STORED_BACKENDS.has(backendId)) {
    const abs = resolve(home);
    let real = abs;
    try {
      real = realpathSync(abs);
    } catch {}
    let procMounts: string | null = null;
    if (process.platform === "linux") {
      try {
        procMounts = readFileSync("/proc/mounts", "utf8");
      } catch {}
    }
    let tmp: string | undefined;
    try {
      tmp = realpathSync(tmpdir());
    } catch {
      tmp = tmpdir();
    }
    const check = [abs, real].map((p) => checkEphemeralHome(p, { tmpdir: tmp, procMounts })).find((c) => c.ephemeral);
    if (check) {
      out.push(`the key store directory ${abs} looks ephemeral (${check.reason}); if it is wiped the key is lost — set UP_HOME to persistent storage before funding, and add a human controller as recovery`);
    }
  }
  return out;
}

/** Warnings for the configured controller keys, default and chain-specific (for `up doctor`). Empty when none is configured. */
export function controllerCustodyWarnings(cfg: UpConfig, home?: string): string[] {
  const out: string[] = [];
  for (const k of localControllers(cfg)) for (const w of custodyWarnings(k.backend, home)) if (!out.includes(w)) out.push(w);
  return out;
}

/** One line, plain words, no jargon — shown by `up init` and `up key backend`. */
export function plainProtection(p: ProtectionInfo): string {
  switch (p.backend) {
    case "macos-keychain":
      return "Protected by your Mac's login keychain (encrypted; usable while you are logged in).";
    case "linux-systemd-creds":
      return "Encrypted by systemd and tied to this user account and this machine.";
    case "linux-secret-service":
      return "Protected by your desktop keyring (encrypted; usable while your session is unlocked).";
    case "windows-dpapi":
      return "Encrypted by Windows for your user account on this computer.";
    case "wsl-dpapi":
      return "Encrypted by Windows for your user account (used from WSL).";
    case "vm-protected-file":
      return "Stored in a private file inside this agent's VM, readable only by the agent's user.";
    case "protected-file":
      return "Stored in a private file only your user account can read (not encrypted).";
    case "memory":
      return "Test mode: held in memory only and lost when the process ends.";
    case "remote-signer":
      return "Kept by a remote signer service you control.";
    default:
      return `Stored by the ${p.backend} backend (${p.level}).`;
  }
}
