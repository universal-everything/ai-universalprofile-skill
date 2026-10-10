import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { coerceArgs } from "../../../src/core/verbs.ts";
import type { VerbDef } from "../../../src/core/types.ts";
import { PROTECTED_FILE_WARNING, custodyWarnings, internalBackend } from "../../../src/signer/index.ts";
import { decryptKeystoreV3 } from "../../../src/signer/keystore-v3.ts";
import { addressOf } from "../../../src/signer/local-signer.ts";
import { resetMemoryBackend } from "../../../src/signer/memory.ts";
import {
  initVerb,
  keyActivateVerb,
  keyAddressVerb,
  keyBackendVerb,
  keyBackupVerb,
  keyNewCandidateVerb,
  readCandidates,
} from "../../../src/signer/verbs.ts";
import { assertNoSecret, catchErr, errorText, fakeContext, tempHome } from "./helpers.ts";

const run = (v: VerbDef, ctx: any, raw: Record<string, unknown> = {}) => v.run(ctx, coerceArgs(v, raw));
const secretOf = (backend: string, address: string) => internalBackend(backend).exportPrivateKey!(address as any);

let home: Awaited<ReturnType<typeof tempHome>>;
const saved = { home: process.env.UP_HOME, eph: process.env.UP_TEST_EPHEMERAL_KEY, pass: process.env.UP_BACKUP_PASSPHRASE };

beforeEach(async () => {
  home = await tempHome();
  process.env.UP_HOME = home.dir;
  process.env.UP_TEST_EPHEMERAL_KEY = "1";
  delete process.env.UP_BACKUP_PASSPHRASE;
  resetMemoryBackend();
});
afterEach(async () => {
  for (const [k, v] of [["UP_HOME", saved.home], ["UP_TEST_EPHEMERAL_KEY", saved.eph], ["UP_BACKUP_PASSPHRASE", saved.pass]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await home.cleanup();
});

describe("init", () => {
  it("creates the first key unattended (no consent), shows only address + one protection line", async () => {
    const { ctx, consents, getConfig } = fakeContext(home.dir);
    const r = await run(initVerb, ctx, { backend: "memory" });
    const data = r.data as any;
    expect(consents).toEqual([]);
    expect(data.created).toBe(true);
    expect(data.backend).toBe("memory");
    expect(data.protection.level).toBe("ephemeral");
    const lines = r.text!.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(`Controller address: ${data.address}`);
    expect(lines[1]).toMatch(/^Key protection: /);
    expect(getConfig().controller).toMatchObject({ address: data.address, backend: "memory" });
    assertNoSecret(r, await secretOf("memory", data.address));
  });

  it("is idempotent: a second init keeps the existing key", async () => {
    const { ctx, getConfig } = fakeContext(home.dir);
    const first = (await run(initVerb, ctx, { backend: "memory" })).data as any;
    const again = await run(initVerb, ctx, { backend: "protected-file" });
    expect((again.data as any).created).toBe(false);
    expect((again.data as any).address).toBe(first.address);
    expect(again.warnings!.join(" ")).toMatch(/already exists/);
    expect(again.warnings!.join(" ")).toMatch(/--backend protected-file ignored/);
    expect(getConfig().controller!.address).toBe(first.address);
  });

  it("has no --force: the agent's key is permanent and is never replaced", async () => {
    const { ctx, getConfig } = fakeContext(home.dir, { approval: "yes, replace the agent key" });
    const first = (await run(initVerb, ctx, { backend: "memory" })).data as any;
    expect(initVerb.params.map((p) => p.name)).not.toContain("force");
    expect(() => coerceArgs(initVerb, { backend: "memory", force: true })).toThrow(/unknown option --force/);
    const again = await run(initVerb, ctx, { backend: "memory" });
    expect((again.data as any).created).toBe(false);
    expect(getConfig().controller!.address).toBe(first.address);
    expect(getConfig().previousControllers).toBeUndefined();
  });

  it("a key missing from its store is reported plainly; init never offers to replace it", async () => {
    const { ctx, getConfig } = fakeContext(home.dir);
    const first = (await run(initVerb, ctx, { backend: "memory" })).data as any;
    resetMemoryBackend(); // the key is gone from the (in-memory) store
    const r = await run(initVerb, ctx, { backend: "memory" });
    const w = r.warnings!.join(" ");
    expect((r.data as any).created).toBe(false);
    expect(w).toContain(`${first.address}: the agent's key is missing from memory`);
    expect(w).toMatch(/up key backup/);
    expect(w).toMatch(/co-owner or admin wallet adds a new additional key/);
    expect(w).not.toMatch(/--force|replace it|rotat|delete/i);
    expect(getConfig().controller!.address).toBe(first.address);
  });

  it("--dry-run creates nothing", async () => {
    const { ctx, getConfig } = fakeContext(home.dir, { dryRun: true });
    const r = await run(initVerb, ctx, { backend: "protected-file" });
    expect((r.data as any).dryRun).toBe(true);
    expect(getConfig().controller).toBeUndefined();
    expect(existsSync(join(home.dir, "keys"))).toBe(false);
  });

  it("--backend protected-file writes a 0600 key file and warns (warnings + text) that it is not encrypted", async () => {
    const { ctx, consents } = fakeContext(home.dir);
    const r = await run(initVerb, ctx, { backend: "protected-file" });
    expect(consents).toEqual([]); // still unattended
    const a = (r.data as any).address as string;
    const f = join(home.dir, "keys", `${a.toLowerCase()}.key`);
    if (process.platform !== "win32") expect((await stat(f)).mode & 0o777).toBe(0o600);
    expect(r.text).toMatch(/not encrypted/);
    expect(r.warnings).toContain(PROTECTED_FILE_WARNING);
    expect(r.text).toContain(`Warning: ${PROTECTED_FILE_WARNING}`);
    expect((r.data as any).custodyWarnings).toContain(PROTECTED_FILE_WARNING);
    // The temp UP_HOME is detected as ephemeral.
    expect(r.warnings!.some((w) => /looks ephemeral/.test(w))).toBe(true);
    assertNoSecret(r, (await readFile(f, "utf8")).trim());
    // key backend shows the same warnings
    const kb = await run(keyBackendVerb, ctx);
    expect(kb.warnings).toContain(PROTECTED_FILE_WARNING);
    expect(kb.text).toContain(`Warning: ${PROTECTED_FILE_WARNING}`);
    expect((kb.data as any).active.custodyWarnings).toContain(PROTECTED_FILE_WARNING);
    // a repeated init keeps warning
    expect((await run(initVerb, ctx)).warnings).toContain(PROTECTED_FILE_WARNING);
  });

  it("vm-protected-file (explicit) does not lecture about encryption, but still flags an ephemeral home", async () => {
    const savedHost = process.env.UP_AGENT_HOST;
    try {
      const { ctx } = fakeContext(home.dir);
      const r = await run(initVerb, ctx, { backend: "vm-protected-file" });
      expect(r.warnings ?? []).not.toContain(PROTECTED_FILE_WARNING);
      expect(r.text).not.toMatch(/NOT encrypted/);
      expect((r.warnings ?? []).some((w) => /looks ephemeral/.test(w))).toBe(true);
    } finally {
      if (savedHost === undefined) delete process.env.UP_AGENT_HOST;
      else process.env.UP_AGENT_HOST = savedHost;
    }
  });

  it("custodyWarnings: none for a persistent home with an OS store or vm file; ephemeral only for home-stored backends", () => {
    expect(custodyWarnings("vm-protected-file", "/home/agent/.universal-profile")).toEqual([]);
    expect(custodyWarnings("macos-keychain", "/tmp/x")).toEqual([]);
    expect(custodyWarnings("linux-systemd-creds", join(tmpdir(), "x")).join(" ")).toMatch(/looks ephemeral/);
    expect(custodyWarnings("protected-file", "/home/agent/.universal-profile")).toEqual([PROTECTED_FILE_WARNING]);
  });

  it("rejects unknown backends at argument validation", () => {
    expect(() => coerceArgs(initVerb, { backend: "plaintext" })).toThrow(/must be one of/);
  });
});

describe("concurrency", () => {
  it("two concurrent inits sharing one UP_HOME end with exactly one controller and no orphaned key", async () => {
    const { writeFile: wf } = await import("node:fs/promises");
    // Real-context-like contexts: config persisted to <home>/config.json and re-read from disk under the lock.
    const mk = () => {
      const f = fakeContext(home.dir);
      const update = f.ctx.updateConfig;
      f.ctx.updateConfig = async (fn) => {
        const c = await update(fn);
        await wf(join(home.dir, "config.json"), JSON.stringify(c));
        return c;
      };
      return f;
    };
    const a = mk();
    const b = mk();
    const [ra, rb] = await Promise.all([run(initVerb, a.ctx, { backend: "protected-file" }), run(initVerb, b.ctx, { backend: "protected-file" })]);
    const addrA = (ra.data as any).address;
    const addrB = (rb.data as any).address;
    expect(addrA).toBe(addrB);
    expect([(ra.data as any).created, (rb.data as any).created].sort()).toEqual([false, true]);
    const { readdir } = await import("node:fs/promises");
    const keyFiles = (await readdir(join(home.dir, "keys"))).filter((f) => f.endsWith(".key"));
    expect(keyFiles).toEqual([`${addrA.toLowerCase()}.key`]);
    expect(existsSync(join(home.dir, "keys", ".lifecycle.lock"))).toBe(false);
  });

  it("concurrent new-candidate runs keep every candidate recorded", async () => {
    const { ctx } = fakeContext(home.dir, { approval: "add keys" });
    await run(initVerb, ctx, { backend: "memory" });
    const results = await Promise.all([1, 2, 3, 4].map(() => run(keyNewCandidateVerb, ctx)));
    const addrs = results.map((r) => (r.data as any).address).sort();
    expect((await readCandidates(home.dir)).map((c) => c.address).sort()).toEqual(addrs);
  });

  it("activate refuses when the controller changed while waiting for approval", async () => {
    const { ctx, getConfig } = fakeContext(home.dir, { approval: "ok" });
    const first = ((await run(initVerb, ctx, { backend: "memory" })).data as any).address;
    const cand = ((await run(keyNewCandidateVerb, ctx)).data as any).address;
    // Simulate another process switching the controller on disk after our read.
    const { writeFile: wf } = await import("node:fs/promises");
    const consent = ctx.consent;
    ctx.consent = async (req) => {
      await consent(req);
      await wf(join(home.dir, "config.json"), JSON.stringify({ ...getConfig(), controller: { address: cand, backend: "memory", createdAt: "x" } }));
    };
    const e = await catchErr(run(keyActivateVerb, ctx, { address: cand }));
    expect(e.code).toBe("BAD_ARGS");
    expect(e.message).toMatch(/changed while waiting/);
    expect(getConfig().controller!.address).toBe(first);
  });
});

describe("key address / key backend", () => {
  it("key address: NO_SIGNER before init, address after", async () => {
    const { ctx } = fakeContext(home.dir);
    expect((await catchErr(run(keyAddressVerb, ctx))).hint).toBe("run: up init");
    const { address } = (await run(initVerb, ctx, { backend: "memory" })).data as any;
    const r = await run(keyAddressVerb, ctx);
    expect(r.data).toMatchObject({ address, backend: "memory", level: "ephemeral" });
  });

  it("key backend: probes every backend and marks the active one", async () => {
    const { ctx } = fakeContext(home.dir);
    await run(initVerb, ctx, { backend: "memory" });
    const r = await run(keyBackendVerb, ctx);
    const d = r.data as any;
    expect(d.backends).toHaveLength(9);
    expect(d.active.backend).toBe("memory");
    expect(d.environment.platform).toBe(process.platform);
    expect(r.text).toMatch(/^Active: memory/);
    expect(r.text).toMatch(/\* memory/);
  });

  it("key address lists every other key the agent keeps (additional and previous keys)", async () => {
    const { ctx, getConfig } = fakeContext(home.dir, { approval: "ok" });
    const { address: first } = (await run(initVerb, ctx, { backend: "memory" })).data as any;
    const cand = ((await run(keyNewCandidateVerb, ctx)).data as any).address;
    let r = await run(keyAddressVerb, ctx);
    expect((r.data as any).otherKeys).toEqual([{ address: cand, backend: "memory", kind: "additional" }]);
    await run(keyActivateVerb, ctx, { address: cand });
    expect(getConfig().controller!.address).toBe(cand);
    r = await run(keyAddressVerb, ctx);
    expect((r.data as any).otherKeys).toEqual([{ address: first, backend: "memory", kind: "previous" }]);
    expect(r.text).toContain(`Other keys of the agent (kept in their store, never deleted): ${first}`);
  });
});

describe("key new-candidate / key activate", () => {
  it("new-candidate needs consent (secret) and creates nothing without it", async () => {
    const { ctx, consents } = fakeContext(home.dir);
    await run(initVerb, ctx, { backend: "protected-file" });
    const e = await catchErr(run(keyNewCandidateVerb, ctx));
    expect(e.code).toBe("CONSENT_REQUIRED");
    expect(consents.at(-1)).toMatchObject({ verb: "key new-candidate", risk: "secret" });
    const { readdir } = await import("node:fs/promises");
    expect((await readdir(join(home.dir, "keys"))).filter((f) => f.endsWith(".key"))).toHaveLength(1);
    expect(await readCandidates(home.dir)).toEqual([]);
  });

  it("creates an additional key, activation needs consent, then switches and keeps the previous key", async () => {
    const plain = fakeContext(home.dir);
    const { address: first } = (await run(initVerb, plain.ctx, { backend: "memory" })).data as any;
    const cand = (await run(keyNewCandidateVerb, fakeContext(home.dir, { approval: "add a key" }, plain.getConfig()).ctx)).data as any;
    expect(cand.active).toBe(false);
    expect(plain.getConfig().controller!.address).toBe(first);
    expect((await readCandidates(home.dir)).map((c) => c.address)).toEqual([cand.address]);

    const denied = await catchErr(run(keyActivateVerb, plain.ctx, { address: cand.address }));
    expect(denied.code).toBe("CONSENT_REQUIRED");
    expect(plain.getConfig().controller!.address).toBe(first);

    const approved = fakeContext(home.dir, { approval: "switch to the new key" }, plain.getConfig());
    const r = await run(keyActivateVerb, approved.ctx, { address: cand.address.toLowerCase() });
    expect((r.data as any).changed).toBe(true);
    const cfg = approved.getConfig();
    expect(cfg.controller).toMatchObject({ address: cand.address, backend: "memory" });
    expect(cfg.previousControllers).toEqual([{ address: first, backend: "memory", switchedAt: expect.any(String) }]);
    expect(await readCandidates(home.dir)).toEqual([]);
    expect(r.text).toContain(`Previous key ${first} is kept in memory and stays listed`);
    // never deleted: both keys stay in the store
    expect(await internalBackend("memory").has(first)).toBe(true);

    // Switch back to the previous key: the other one is kept in turn.
    await run(keyActivateVerb, approved.ctx, { address: first });
    const cfg2 = approved.getConfig();
    expect(cfg2.controller!.address).toBe(first);
    expect(cfg2.previousControllers!.map((x) => x.address)).toEqual([cand.address]);
    expect(await internalBackend("memory").has(cand.address)).toBe(true);

    // Already active → no-op without consent.
    const noop = await run(keyActivateVerb, plain.ctx, { address: plain.getConfig().controller!.address });
    expect((noop.data as any).changed).toBe(false);
  });

  it("refuses keys that are not in the store", async () => {
    const { ctx } = fakeContext(home.dir, { approval: "ok" });
    await run(initVerb, ctx, { backend: "memory" });
    const e = await catchErr(run(keyActivateVerb, ctx, { address: "0x0000000000000000000000000000000000000bad" }));
    expect(e.code).toBe("NO_SIGNER");
    expect((await catchErr(run(keyActivateVerb, ctx, { address: "nope" }))).code).toBe("BAD_ARGS");
  });

  it("new-candidate needs an existing controller", async () => {
    const { ctx } = fakeContext(home.dir);
    expect((await catchErr(run(keyNewCandidateVerb, ctx))).code).toBe("NO_SIGNER");
  });
});

describe("key backup", () => {
  const PASS = "a long human passphrase 42";

  async function withController(flags = {}) {
    const f = fakeContext(home.dir, flags);
    const { address } = (await run(initVerb, f.ctx, { backend: "protected-file" })).data as any;
    return { ...f, address: address as string };
  }

  it("requires --encrypted, --explicit-consent and the env passphrase (never argv)", async () => {
    const { ctx } = await withController({ approval: "back it up" });
    const path = join(home.dir, "backup.json");
    expect((await catchErr(run(keyBackupVerb, ctx, { path }))).message).toMatch(/only encrypted/);
    expect((await catchErr(run(keyBackupVerb, ctx, { path, encrypted: true }))).message).toMatch(/explicit-consent/);
    const noPass = await catchErr(run(keyBackupVerb, ctx, { path, encrypted: true, "explicit-consent": true }));
    expect(noPass.code).toBe("BAD_ARGS");
    expect(noPass.hint).toMatch(/own terminal/);
    expect(noPass.hint).toMatch(/read -rs UP_BACKUP_PASSPHRASE/);
    process.env.UP_BACKUP_PASSPHRASE = "short";
    const short = await catchErr(run(keyBackupVerb, ctx, { path, encrypted: true, "explicit-consent": true }));
    expect(short.message).toMatch(/at least 12/);
    expect(errorText(short)).not.toContain("short\"");
    expect(() => coerceArgs(keyBackupVerb, { path, encrypted: true, "explicit-consent": true, passphrase: "x" })).toThrow(/unknown option/);
    expect(existsSync(path)).toBe(false);
  });

  it("needs consent; with approval writes a verified 0600 keystore v3 and consumes the env var", async () => {
    const denied = await withController();
    const path = join(home.dir, "backup.json");
    process.env.UP_BACKUP_PASSPHRASE = PASS;
    const e = await catchErr(run(keyBackupVerb, denied.ctx, { path, encrypted: true, "explicit-consent": true }));
    expect(e.code).toBe("CONSENT_REQUIRED");
    expect(existsSync(path)).toBe(false);

    const ok = fakeContext(home.dir, { approval: "yes, write an encrypted backup" }, denied.getConfig());
    const r = await run(keyBackupVerb, ok.ctx, { path, encrypted: true, "explicit-consent": true });
    expect(ok.consents[0]).toMatchObject({ verb: "key backup", risk: "secret" });
    expect(process.env.UP_BACKUP_PASSPHRASE).toBeUndefined();
    expect((r.data as any).verified).toBe(true);
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
    const json = await readFile(path, "utf8");
    const key = await decryptKeystoreV3(json, PASS);
    expect(addressOf(key)).toBe(denied.address);
    assertNoSecret(r, key);
    assertNoSecret(json, key);
    expect(JSON.stringify(r)).not.toContain(PASS);
    expect(JSON.parse(json).crypto.kdfparams).toMatchObject({ n: 262144, r: 8, p: 1 });

    // never overwrites
    process.env.UP_BACKUP_PASSPHRASE = PASS;
    expect((await catchErr(run(keyBackupVerb, ok.ctx, { path, encrypted: true, "explicit-consent": true }))).message).toMatch(/already exists/);
  });

  it("dry-run writes nothing", async () => {
    const base = await withController();
    const { ctx } = fakeContext(home.dir, { dryRun: true }, base.getConfig());
    process.env.UP_BACKUP_PASSPHRASE = PASS;
    const path = join(home.dir, "dry.json");
    const r = await run(keyBackupVerb, ctx, { path, encrypted: true, "explicit-consent": true });
    expect((r.data as any).dryRun).toBe(true);
    expect(existsSync(path)).toBe(false);
  });
});
