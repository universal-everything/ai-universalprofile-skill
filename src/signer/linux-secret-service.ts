// L2 — freedesktop Secret Service (GNOME Keyring / KWallet) via `secret-tool`,
// desktop sessions only.
//
// secret-tool itself pops an unlock dialog when the collection is locked, so
// every operation first checks — without triggering any prompt and without
// D-Bus-activating a keyring daemon — that
//   1. org.freedesktop.secrets already has an owner on the session bus, and
//   2. the default collection's `Locked` property is false.
// If not, we fail closed (SIGNER_LOCKED) instead of calling secret-tool.
//   store:  hex on stdin → secret-tool store --label=… service <svc> account <addr>
//   lookup: secret-tool lookup service <svc> account <addr> → secret on stdout
//   clear:  secret-tool clear service <svc> account <addr>
// (`secret-tool search` is never used: it prints secrets.)
// Known residual race: the collection could lock between the check and the
// secret-tool call; secret-tool would then show an unlock prompt and we time
// out (SIGNER_LOCKED). Talking D-Bus directly via busctl would avoid that but
// would put the secret into argv (CreateItem), which is worse.
// Helpers are resolved from system directories only (never $PATH).
import { UpError } from "../core/errors.ts";
import type { BackendProbe, Hex, ProtectionInfo } from "../core/types.ts";
import { KeyBackend, probeResult } from "./base.ts";
import { keystoreService, resolveSystemBinary, runProcess, stderrSummary, type RunFn, type RunOptions, type RunResult, type WhichFn } from "./proc.ts";

export const SECRET_TOOL_BIN = "secret-tool";
export const SECRET_LABEL = "Universal Profile controller key";
const DEFAULT_COLLECTION = "/org/freedesktop/secrets/aliases/default";

export type CollectionState = "unlocked" | "locked" | "no-service" | "no-collection" | "unknown";

export interface SecretServiceOptions {
  run?: RunFn;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /** Binary resolver (default: system directories only, never $PATH). */
  which?: WhichFn;
}

/** Parses `busctl … NameHasOwner` ("b true") or gdbus ("(true,)"). */
export function parseBool(out: string): boolean | null {
  const t = out.trim();
  if (/^b\s+true$/.test(t) || /^\(\s*<?true>?\s*,?\s*\)$/.test(t)) return true;
  if (/^b\s+false$/.test(t) || /^\(\s*<?false>?\s*,?\s*\)$/.test(t)) return false;
  return null;
}

export class LinuxSecretServiceBackend extends KeyBackend {
  readonly id = "linux-secret-service";
  readonly label = "desktop keyring (Secret Service)";
  private readonly run: RunFn;
  private readonly platform: NodeJS.Platform;
  private readonly env: NodeJS.ProcessEnv;
  private readonly timeoutMs: number;
  private readonly which: WhichFn;

  constructor(opts: SecretServiceOptions = {}) {
    super();
    this.which = opts.which ?? ((n) => resolveSystemBinary(n));
    this.run = opts.run ?? runProcess;
    this.platform = opts.platform ?? process.platform;
    this.env = opts.env ?? process.env;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
  }

  protectionInfo(): ProtectionInfo {
    return {
      backend: this.id,
      level: "os-keyring",
      unattended: true,
      encryptedAtRest: true,
      notes: [
        "stored in your desktop keyring (Secret Service), encrypted with your login password",
        "usable only while your desktop session's keyring is unlocked; after a reboot it needs your normal login first",
        "programs running in your session can read it while it is unlocked — keep the controller's on-chain permissions minimal",
      ],
    };
  }

  /** Runs a helper resolved from the system directories; reports ENOENT when it is not installed there. */
  private async tool(name: string, args: string[], opts: RunOptions): Promise<RunResult> {
    const bin = this.which(name);
    if (!bin) return { code: null, stdout: Buffer.alloc(0), stderr: "", error: { code: "ENOENT", message: `${name} not found in the system directories` } };
    return this.run(bin, args, opts);
  }

  /** Non-prompting lock check (never activates a keyring daemon, never shows a dialog). */
  async collectionState(): Promise<CollectionState> {
    if (!this.env.DBUS_SESSION_BUS_ADDRESS && !this.env.XDG_RUNTIME_DIR) return "no-service";
    // busctl (systemd) first, gdbus (glib) as fallback.
    const owner = await this.tool("busctl", ["--user", "call", "org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "NameHasOwner", "s", "org.freedesktop.secrets"], { timeoutMs: 5_000 });
    let viaBusctl = !owner.error && owner.code === 0;
    let hasOwner = viaBusctl ? parseBool(owner.stdout.toString("utf8")) : null;
    if (hasOwner === null) {
      viaBusctl = false;
      const g = await this.tool("gdbus", ["call", "--session", "--dest", "org.freedesktop.DBus", "--object-path", "/org/freedesktop/DBus", "--method", "org.freedesktop.DBus.NameHasOwner", "org.freedesktop.secrets"], { timeoutMs: 5_000 });
      if (g.error || g.code !== 0) return "unknown";
      hasOwner = parseBool(g.stdout.toString("utf8"));
    }
    if (hasOwner === null) return "unknown";
    if (!hasOwner) return "no-service";
    const prop = viaBusctl
      ? await this.tool("busctl", ["--user", "--auto-start=no", "get-property", "org.freedesktop.secrets", DEFAULT_COLLECTION, "org.freedesktop.Secret.Collection", "Locked"], { timeoutMs: 5_000 })
      : await this.tool("gdbus", ["call", "--session", "--dest", "org.freedesktop.secrets", "--object-path", DEFAULT_COLLECTION, "--method", "org.freedesktop.DBus.Properties.Get", "org.freedesktop.Secret.Collection", "Locked"], { timeoutMs: 5_000 });
    if (prop.error) return "unknown";
    if (prop.code !== 0) return /UnknownObject|No such object|NoSuchObject|not found/i.test(prop.stderr) ? "no-collection" : "unknown";
    const locked = parseBool(prop.stdout.toString("utf8"));
    return locked === null ? "unknown" : locked ? "locked" : "unlocked";
  }

  async probe(): Promise<BackendProbe> {
    const level = "os-keyring" as const;
    if (this.platform !== "linux") return probeResult(this, level, false, "only available on Linux desktops");
    if (!this.which(SECRET_TOOL_BIN)) return probeResult(this, level, false, "secret-tool not installed (package libsecret-tools)");
    const state = await this.collectionState();
    switch (state) {
      case "unlocked":
        return probeResult(this, level, true, "desktop keyring is running and unlocked");
      case "locked":
        return probeResult(this, level, false, "desktop keyring is locked (it unlocks when you log in with your password); not prompting");
      case "no-service":
        return probeResult(this, level, false, "no Secret Service on the session bus (headless or no desktop keyring running)");
      case "no-collection":
        return probeResult(this, level, false, "the desktop keyring has no default collection yet");
      default:
        return probeResult(this, level, false, "could not verify the keyring lock state without prompting (busctl/gdbus unavailable)");
    }
  }

  protected async storeSecret(id: string, privateKey: Hex): Promise<void> {
    await this.requireUnlocked();
    if (await this.lookupRaw(id)) throw new UpError("INTERNAL", `a keyring item for ${id} already exists; refusing to overwrite it`);
    const r = await this.tool(SECRET_TOOL_BIN, ["store", `--label=${SECRET_LABEL}`, "service", keystoreService(), "account", id], { input: privateKey, timeoutMs: this.timeoutMs });
    if (r.error || r.code !== 0) throw this.mapError(r, "store the key in", [privateKey]);
  }

  protected async readSecret(id: string): Promise<string> {
    await this.requireUnlocked();
    const v = await this.lookupRaw(id);
    if (!v) throw new UpError("NO_SIGNER", `no keyring item for ${id} (service "${keystoreService()}")`, { hint: "the controller key is missing from the desktop keyring; create a new one with: up init --force (then rotate on-chain)" });
    return v;
  }

  protected async deleteSecret(id: string): Promise<void> {
    await this.requireUnlocked();
    const r = await this.tool(SECRET_TOOL_BIN, ["clear", "service", keystoreService(), "account", id], { timeoutMs: this.timeoutMs });
    if (r.error || (r.code !== 0 && r.code !== 1)) throw this.mapError(r, "delete the key from");
  }

  protected async hasSecret(id: string): Promise<boolean> {
    await this.requireUnlocked();
    return (await this.lookupRaw(id)) !== null;
  }

  /** Secret value or null when absent (secret-tool exits 1 with empty output). */
  private async lookupRaw(id: string): Promise<string | null> {
    const r = await this.tool(SECRET_TOOL_BIN, ["lookup", "service", keystoreService(), "account", id], { timeoutMs: this.timeoutMs });
    if (r.error) throw this.mapError(r, "read the key from");
    const v = r.stdout.toString("utf8").trim();
    if (r.code === 0 && v) return v;
    if (r.code === 0 || (r.code === 1 && !r.stderr.trim())) return null;
    throw this.mapError(r, "read the key from");
  }

  private async requireUnlocked(): Promise<void> {
    if (this.platform !== "linux") throw new UpError("SIGNER_BACKEND_UNAVAILABLE", "the linux-secret-service backend only works on Linux", { hint: "run: up key backend" });
    const state = await this.collectionState();
    if (state === "unlocked") return;
    if (state === "locked") {
      throw new UpError("SIGNER_LOCKED", "the desktop keyring is locked", { hint: "log in to the desktop session with your password once so the keyring unlocks; the skill never prompts or stores your password" });
    }
    throw new UpError("SIGNER_LOCKED", `the desktop keyring is not reachable without prompting (${state})`, { hint: "run inside your logged-in desktop session; run: up key backend" });
  }

  private mapError(r: RunResult, action: string, secrets: string[] = []): UpError {
    if (r.error?.code === "ENOENT") return new UpError("SIGNER_BACKEND_UNAVAILABLE", "secret-tool not found (package libsecret-tools)", { hint: "run: up key backend" });
    if (r.error?.code === "TIMEOUT") return new UpError("SIGNER_LOCKED", `the desktop keyring did not answer when trying to ${action} it (an unlock dialog may be waiting)`, { hint: "unlock the keyring in your desktop session" });
    const detail = stderrSummary(r, secrets) || `exit ${r.code}`;
    if (/locked|cancel|dismiss/i.test(r.stderr)) return new UpError("SIGNER_LOCKED", `the desktop keyring refused to ${action} it (${detail})`, { hint: "unlock the keyring in your desktop session" });
    return new UpError("SIGNER_LOCKED", `could not ${action} the desktop keyring (${detail})`, { hint: "run: up key backend" });
  }
}
