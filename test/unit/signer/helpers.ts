// Shared helpers for signer unit tests: a recording fake for child processes,
// a minimal VerbContext and an environment factory.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunFn, RunOptions, RunResult } from "../../../src/signer/proc.ts";
import type { SignerEnvironment } from "../../../src/signer/env.ts";
import { UpError } from "../../../src/core/errors.ts";
import type { ConsentRequest, Flags, UpConfig, VerbContext } from "../../../src/core/types.ts";

export interface Call {
  cmd: string;
  args: string[];
  input: string;
}

export type Handler = (cmd: string, args: string[], input: string, opts: RunOptions) => Partial<RunResult> | Promise<Partial<RunResult>>;

export function fakeRun(handler: Handler): RunFn & { calls: Call[] } {
  const calls: Call[] = [];
  const fn = (async (cmd: string, args: readonly string[], opts: RunOptions = {}) => {
    const input = opts.input === undefined ? "" : typeof opts.input === "string" ? opts.input : Buffer.from(opts.input).toString("utf8");
    calls.push({ cmd, args: [...args], input });
    const r = await handler(cmd, [...args], input, opts);
    return { code: r.code === undefined ? 0 : r.code, stdout: r.stdout ?? Buffer.alloc(0), stderr: r.stderr ?? "", error: r.error };
  }) as RunFn & { calls: Call[] };
  fn.calls = calls;
  return fn;
}

export const out = (s: string) => Buffer.from(s, "utf8");
export const enoent = (cmd: string): Partial<RunResult> => ({ code: null, error: { code: "ENOENT", message: `cannot start ${cmd}` } });

export function env(over: Partial<SignerEnvironment> = {}): SignerEnvironment {
  const base = { platform: "linux" as NodeJS.Platform, wsl: false, container: null, vm: null, agentHost: null, headless: false, ssh: false, systemdVersion: null, isolated: false, hints: [], ...over };
  return { ...base, unattendedHost: over.unattendedHost ?? (base.headless || base.container !== null) };
}

export async function tempHome(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "up-signer-test-"));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** Minimal VerbContext: in-memory config; consent passes only with flags.approval (mirrors policy for secret verbs). */
export function fakeContext(home: string, flags: Partial<Flags> = {}, initial: UpConfig = { version: 1 }) {
  let cfg: UpConfig = structuredClone(initial);
  const consents: ConsentRequest[] = [];
  const logs: string[] = [];
  const f: Flags = { json: true, dryRun: false, yes: false, ...flags };
  const ctx = {
    home,
    flags: f,
    registry: undefined as any,
    rpc: undefined as any,
    config: async () => structuredClone(cfg),
    saveConfig: async (c: UpConfig) => {
      cfg = structuredClone(c);
    },
    signer: async () => {
      throw new Error("not used");
    },
    consent: async (req: ConsentRequest) => {
      consents.push(req);
      if (f.dryRun) return;
      if (!f.approval) throw new UpError("CONSENT_REQUIRED", `"${req.verb}" needs a human approval`, { details: { confirmation: req.summary } });
    },
    chainId: () => 42,
    profile: async () => {
      throw new Error("not used");
    },
    identity: async () => {
      throw new Error("not used");
    },
    resolveAddress: async () => {
      throw new Error("not used");
    },
    log: (m: string) => {
      logs.push(m);
    },
  } satisfies VerbContext;
  return { ctx, consents, logs, getConfig: () => structuredClone(cfg) };
}

/** Asserts that `secret` (with or without 0x, any case) appears nowhere in `value`. */
export function assertNoSecret(value: unknown, secret: string): void {
  const bare = secret.replace(/^0x/, "").toLowerCase();
  const text = (typeof value === "string" ? value : JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) ?? "").toLowerCase();
  if (text.includes(bare)) throw new Error("secret leaked into output");
}

export function errorText(e: unknown): string {
  if (e instanceof UpError) return JSON.stringify({ ...e.toJSON(), stack: e.stack, cause: String((e as any).cause ?? "") });
  if (e instanceof Error) return `${e.message}\n${e.stack}`;
  return String(e);
}

export async function catchErr(p: Promise<unknown>): Promise<UpError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof UpError) return e;
    throw e;
  }
  throw new Error("expected an error");
}
