// Keys are permanent: the agent's key is the private key of a blockchain account. It is never
// rotated away, replaced or deleted, and no verb text suggests otherwise. Older configs that
// listed earlier keys under the legacy field still load, and those keys stay listed and usable.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import "../../../src/verbs/index.ts";
import { createContext, upgradeConfig } from "../../../src/core/context.ts";
import { allVerbs, coerceArgs, getVerb, mcpToolName } from "../../../src/core/verbs.ts";
import { paths } from "../../../src/core/home.ts";
import { internalBackend } from "../../../src/signer/index.ts";
import { resetMemoryBackend } from "../../../src/signer/memory.ts";
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

  it("no code outside the key store implementations deletes a key (no backend .remove() call)", () => {
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
