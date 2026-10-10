// Keys are permanent: the agent's key is the private key of a blockchain account. It is never
// rotated away, replaced or deleted, and no verb text suggests otherwise. Older configs that
// listed earlier keys under the legacy field still load, and those keys stay listed and usable.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import "../../../src/verbs/index.ts";
import { configKeys, createContext, preserveKeyInventory, upgradeConfig } from "../../../src/core/context.ts";
import { UpError } from "../../../src/core/errors.ts";
import type { VerbContext } from "../../../src/core/types.ts";
import { allVerbs, coerceArgs, getVerb, mcpToolName } from "../../../src/core/verbs.ts";
import { paths } from "../../../src/core/home.ts";
import { internalBackend, setBackendsForTests } from "../../../src/signer/index.ts";
import { MemoryBackend, resetMemoryBackend } from "../../../src/signer/memory.ts";
import { inventoryFile, readInventory } from "../../../src/signer/inventory.ts";
import { tempHome } from "./helpers.ts";

describe("no key rotation or key deletion in the verb registry", () => {
  it("no registered verb name contains 'rotate'", () => {
    const names = allVerbs().map((v) => v.name);
    expect(names.length).toBeGreaterThan(50);
    expect(names.filter((n) => /rotate/i.test(n))).toEqual([]);
    expect(getVerb("key rotate-plan")).toBeUndefined();
    expect(allVerbs().map((v) => mcpToolName(v.name))).not.toContain("up_key_rotate_plan");
  });

  it("no verb summary, description, parameter text or example mentions rotation or deleting a key from the key store", () => {
    const offenders: string[] = [];
    for (const v of allVerbs()) {
      const texts = [v.summary, v.description ?? "", ...v.params.map((p) => p.description), ...(v.examples ?? [])];
      for (const t of texts) if (/rotat|delete it from the key store|30 days/i.test(t)) offenders.push(`${v.name}: ${t}`);
    }
    expect(offenders).toEqual([]);
  });

  it("init has no --force (the agent's key is never replaced)", () => {
    const init = getVerb("init")!;
    expect(init.params.map((p) => p.name)).toEqual(["backend"]);
    expect(() => coerceArgs(init, { force: true })).toThrow(/unknown option --force/);
  });

  it("no code outside the key store implementations deletes a key (no backend .remove() or deleteSecret() call)", () => {
    const src = join(import.meta.dirname, "..", "..", "..", "src");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts")) files.push(p);
      }
    };
    walk(src);
    const offenders = files.filter((f) => /\.remove\(/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
    // deleteSecret() is called in exactly one place: the backend's own remove() (kept for tests only)
    const calls = files.flatMap((f) => (readFileSync(f, "utf8").match(/[\w.]*deleteSecret\(/g) ?? []).filter((m) => m !== "deleteSecret(").map((m) => `${f}: ${m}`));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/signer[\\/]base\.ts: this\.deleteSecret\($/);
    const base = readFileSync(join(src, "signer", "base.ts"), "utf8");
    expect(base).toMatch(/async remove\(address: Address\): Promise<void> \{\s*await this\.deleteSecret\(storageId\(address\)\);\s*\}/);
  });
});

describe("older configs with the legacy list of earlier keys", () => {
  let home: Awaited<ReturnType<typeof tempHome>>;
  const saved = { home: process.env.UP_HOME, eph: process.env.UP_TEST_EPHEMERAL_KEY };
  beforeEach(async () => {
    home = await tempHome();
    process.env.UP_HOME = home.dir;
    process.env.UP_TEST_EPHEMERAL_KEY = "1";
    resetMemoryBackend();
  });
  afterEach(async () => {
    for (const [k, v] of [["UP_HOME", saved.home], ["UP_TEST_EPHEMERAL_KEY", saved.eph]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await home.cleanup();
  });

  it("upgradeConfig moves the legacy entries to previousControllers without dropping any", () => {
    const a = "0x00000000000000000000000000000000000000a1";
    const b = "0x00000000000000000000000000000000000000b2";
    const up = upgradeConfig({ version: 1, retiredControllers: [{ address: a, backend: "memory", retiredAt: "t1" }, { address: b, backend: "memory", retiredAt: "t2", chainId: 42 }] } as any) as any;
    expect(up.retiredControllers).toBeUndefined();
    expect(up.previousControllers).toEqual([
      { address: a, backend: "memory", switchedAt: "t1" },
      { address: b, backend: "memory", switchedAt: "t2", chainId: 42 },
    ]);
    // configs without the legacy field are returned unchanged
    const plain = { version: 1, previousControllers: [{ address: a, backend: "memory", switchedAt: "t" }] };
    expect(upgradeConfig(plain)).toBe(plain);
  });

  it("an old config loads, its earlier keys stay listed and usable, and it is saved under the new name", async () => {
    const mem = internalBackend("memory");
    const current = await mem.create();
    const earlier = await mem.create();
    await writeFile(
      paths.config(home.dir),
      JSON.stringify({ version: 1, controller: { address: current, backend: "memory", createdAt: "x" }, retiredControllers: [{ address: earlier, backend: "memory", retiredAt: "2026-01-01T00:00:00.000Z" }] }),
      { mode: 0o600 },
    );
    const ctx = createContext({ home: home.dir, flags: { json: true, dryRun: false, yes: false, approval: "use the earlier key again" } });
    expect((await ctx.config()).previousControllers).toEqual([{ address: earlier, backend: "memory", switchedAt: "2026-01-01T00:00:00.000Z" }]);

    const keys: any = await getVerb("key address")!.run(ctx, coerceArgs(getVerb("key address")!, {}));
    expect(keys.data.otherKeys).toEqual([{ address: earlier, backend: "memory", kind: "previous" }]);

    await getVerb("key activate")!.run(ctx, coerceArgs(getVerb("key activate")!, { address: earlier }));
    const disk = JSON.parse(await readFile(paths.config(home.dir), "utf8"));
    expect(disk.controller.address).toBe(earlier);
    expect(disk.retiredControllers).toBeUndefined();
    expect(disk.previousControllers.map((k: any) => k.address)).toEqual([current]);
    expect(await mem.has(current)).toBe(true);
    expect(await mem.has(earlier)).toBe(true);
  });
});

describe("keys are never lost, forgotten or unlisted (concurrency and damaged state)", () => {
  let home: Awaited<ReturnType<typeof tempHome>>;
  const saved = { home: process.env.UP_HOME, eph: process.env.UP_TEST_EPHEMERAL_KEY };
  beforeEach(async () => {
    home = await tempHome();
    process.env.UP_HOME = home.dir;
    process.env.UP_TEST_EPHEMERAL_KEY = "1";
    resetMemoryBackend();
  });
  afterEach(async () => {
    setBackendsForTests();
    for (const [k, v] of [["UP_HOME", saved.home], ["UP_TEST_EPHEMERAL_KEY", saved.eph]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await home.cleanup();
  });

  const mk = (approval?: string) => createContext({ home: home.dir, flags: { json: true, dryRun: false, yes: false, ...(approval ? { approval } : {}) } });
  const run = async (ctx: VerbContext, name: string, raw: Record<string, unknown> = {}): Promise<any> => getVerb(name)!.run(ctx, coerceArgs(getVerb(name)!, raw));
  const disk = () => JSON.parse(readFileSync(paths.config(home.dir), "utf8"));
  const listed = (cfg: any) => configKeys(cfg).map((k) => k.address);

  async function setupKeys(n: number) {
    const c = mk("human: yes");
    const a = (await run(c, "init", { backend: "memory" })).data.address as string;
    const extra: string[] = [];
    for (let i = 0; i < n; i++) extra.push((await run(c, "key new-candidate")).data.address);
    return [a, ...extra];
  }

  it("a stale config writer (config set) never brings back an old key or drops the new one", async () => {
    const [A, B] = await setupKeys(1);
    const stale = mk();
    expect((await stale.config()).controller!.address).toBe(A); // read before the switch
    await run(mk("switch"), "key activate", { address: B });
    await run(stale, "config set", { key: "default-chain", value: "42" });
    const cfg = disk();
    expect(cfg.controller.address).toBe(B);
    expect(cfg.defaultChain).toBe(42);
    expect(cfg.previousControllers.map((k: any) => k.address)).toEqual([A]);
    // a writer that even drops the controller field cannot unlist a key
    const s2 = mk();
    const c2 = await s2.config();
    await run(mk("switch back"), "key activate", { address: A });
    await s2.saveConfig({ ...c2, controller: undefined });
    expect(listed(disk()).sort()).toEqual([A, B].sort());
  });

  it("preserveKeyInventory appends every key a writer would drop", () => {
    const latest = { version: 1 as const, controller: { address: "0x00000000000000000000000000000000000000a1" as const, backend: "memory", createdAt: "t" }, chainControllers: { "42": { address: "0x00000000000000000000000000000000000000c3" as const, backend: "memory", createdAt: "t" } } };
    const out = preserveKeyInventory(latest, { version: 1 }, "now");
    expect(out.previousControllers).toEqual([
      { address: latest.controller.address, backend: "memory", switchedAt: "now" },
      { address: latest.chainControllers["42"].address, backend: "memory", switchedAt: "now", chainId: 42 },
    ]);
  });

  it("an activation queued with an old view keeps the history other commands made (A→B→A, then C)", async () => {
    const [A, B, C] = await setupKeys(2);
    const queued = mk("use C");
    expect((await queued.config()).previousControllers).toBeUndefined(); // its view: A, no history
    const other = mk("switch");
    await run(other, "key activate", { address: B });
    await run(other, "key activate", { address: A });
    expect(disk().previousControllers.map((k: any) => k.address)).toEqual([B]);
    await run(queued, "key activate", { address: C });
    const cfg = disk();
    expect(cfg.controller.address).toBe(C);
    expect(cfg.previousControllers.map((k: any) => k.address).sort()).toEqual([A, B].sort());
    expect(existsSync(paths.config(home.dir) + ".bak")).toBe(true);
    expect(JSON.parse(readFileSync(paths.config(home.dir) + ".bak", "utf8")).controller.address).toBe(A);
  });

  it("a damaged config.json is never overwritten and no key is created", async () => {
    await writeFile(paths.config(home.dir), "{broken", { mode: 0o600 });
    const e = await run(mk(), "init", { backend: "memory" }).catch((x) => x);
    expect(e).toBeInstanceOf(UpError);
    expect(e.message).toMatch(/not valid JSON; nothing was changed/);
    expect(readFileSync(paths.config(home.dir), "utf8")).toBe("{broken");
    expect(existsSync(inventoryFile(home.dir))).toBe(false);
    const w = await mk().saveConfig({ version: 1, defaultChain: 42 }).catch((x) => x);
    expect(w).toBeInstanceOf(UpError);
    expect(readFileSync(paths.config(home.dir), "utf8")).toBe("{broken");
  });

  it("a damaged candidates list is never overwritten and no key is created", async () => {
    const [A] = await setupKeys(0);
    const f = join(home.dir, "keys", "candidates.json");
    await writeFile(f, "nope{", { mode: 0o600 });
    const e = await run(mk("add"), "key new-candidate").catch((x) => x);
    expect(e.message).toMatch(/not valid JSON/);
    expect(readFileSync(f, "utf8")).toBe("nope{");
    expect((await readInventory(home.dir)).map((k) => k.address)).toEqual([A]);
  });

  it("a key whose config save failed stays listed (recovery inventory) and can be activated", async () => {
    const c = mk();
    c.updateConfig = async () => {
      throw new Error("disk full");
    };
    const e = await run(c, "init", { backend: "memory" }).catch((x) => x);
    const address = /new key (0x[0-9a-fA-F]{40})/.exec(e.message)![1];
    expect(await internalBackend("memory").has(address as any)).toBe(true);
    const listedErr = await run(mk(), "key address").catch((x) => x);
    expect(listedErr.code).toBe("NO_SIGNER");
    expect(listedErr.details.otherKeys).toEqual([expect.objectContaining({ address, kind: "recovered" })]);
    // the advertised recovery works: no controller before (absence-aware guard), store found from the inventory
    const r = await run(mk("record it"), "key activate", { address });
    expect(r.data.changed).toBe(true);
    expect(disk().controller.address).toBe(address);
  });

  it("a key that cannot be read back after storing is kept, recorded and listed", async () => {
    class FlakyMemory extends MemoryBackend {
      protected override async readSecret(): Promise<string> {
        throw new UpError("SIGNER_LOCKED", "store locked right now");
      }
    }
    setBackendsForTests([new FlakyMemory()]);
    const e = await run(mk(), "init", { backend: "memory" }).catch((x) => x);
    expect(e.details).toMatchObject({ kept: true, problem: "read-back-failed" });
    setBackendsForTests();
    expect(await internalBackend("memory").has(e.details.address)).toBe(true);
    const inv = await readInventory(home.dir);
    expect(inv).toEqual([expect.objectContaining({ address: e.details.address, note: "kept after read-back-failed" })]);
    const listedErr = await run(mk(), "key address").catch((x) => x);
    expect(listedErr.details.otherKeys.map((k: any) => k.address)).toEqual([e.details.address]);
  });

  it("refreshConfig (used after taking the write lock) sees a key switched by another command", async () => {
    const [A, B] = await setupKeys(1);
    const queued = mk();
    expect((await queued.signer()).address).toBe(A);
    await run(mk("switch"), "key activate", { address: B });
    await queued.refreshConfig!();
    expect((await queued.signer()).address).toBe(B);
    const srcDir = join(import.meta.dirname, "..", "..", "..", "src");
    for (const f of [join(srcDir, "cli", "main.ts"), join(srcDir, "mcp", "server.ts")]) {
      expect(readFileSync(f, "utf8")).toMatch(/withLock\(ctx\.home, "write", async \(\) => \{[^}]*?await ctx\.refreshConfig\?\.\(\);/s);
    }
  });
});
