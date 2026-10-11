// Second review, findings 7 and 8:
//  7. once the backup file is published, a temp-file cleanup failure is a warning: the export still returns path, hash and password
//  8. a write that fails cancels its path reservation; the path guard folds reserved/committed/cancelled events, so a cancelled
//     reservation no longer keeps other readers from an unrelated file at that path
// Public Anvil test keys only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import "../../../src/verbs/index.ts";
import { decryptSecrets } from "../../../src/backup/lsp30-crypto.ts";
import { appendIndex } from "../../../src/backup/store.ts";
import { createContext, preloadConfig } from "../../../src/core/context.ts";
import { UpError } from "../../../src/core/errors.ts";
import { paths } from "../../../src/core/home.ts";
import { assertNotKeyMaterialPath, clearSecretsForTests } from "../../../src/core/secret-guard.ts";
import { coerceArgs, getVerb } from "../../../src/core/verbs.ts";
import { setBackendsForTests } from "../../../src/signer/index.ts";
import { writeNewFileExclusive } from "../../../src/signer/verbs.ts";
import { fakeManifest, seedHome } from "../../support/backup-fixtures.ts";

const sim = vi.hoisted(() => ({ rm: false, write: null as null | "plain" | "partial" | "taken" }));
vi.mock("node:fs/promises", async (original) => {
  const m = await original<typeof import("node:fs/promises")>();
  return {
    ...m,
    rm: async (p: string, o?: unknown) => {
      if (sim.rm && String(p).endsWith(".tmp")) throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
      return (m.rm as any)(p, o);
    },
  };
});
vi.mock("../../../src/signer/verbs.ts", async (original) => {
  const m = await original<typeof import("../../../src/signer/verbs.ts")>();
  return {
    ...m,
    writeNewFileExclusive: async (file: string, content: string) => {
      if (sim.write === "plain") throw new Error("EIO: i/o error");
      if (sim.write === "partial") {
        writeFileSync(file, content.slice(0, 200), { mode: 0o600 }); // the start of a real backup, then the failure
        throw new Error("ENOSPC: no space left on device");
      }
      if (sim.write === "taken") {
        writeFileSync(file, "somebody else's file", { mode: 0o600 });
        throw new UpError("BAD_ARGS", `${file} already exists; refusing to overwrite it`);
      }
      return m.writeNewFileExclusive(file, content);
    },
  };
});

const A0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const APPROVAL = "human: yes, back it up";
const saved = { home: process.env.UP_HOME, eph: process.env.UP_TEST_EPHEMERAL_KEY };
let home: string;

async function run(name: string, raw: Record<string, unknown> = {}) {
  process.env.UP_HOME = home;
  const ctx = createContext({ home, flags: { json: true, dryRun: false, yes: false, approval: APPROVAL } });
  await preloadConfig(ctx);
  const v = getVerb(name)!;
  return (await v.run(ctx, coerceArgs(v, raw))) as { data: any; text?: string; warnings?: string[] };
}
const indexLines = () => readFileSync(join(paths.backups(home), "index.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const customPath = () => join(mkdtempSync(join(tmpdir(), "up-wr-")), "mine.json");

beforeEach(async () => {
  sim.rm = false;
  sim.write = null;
  home = await seedHome({ keys: [A0], manifests: [fakeManifest({ controller: privateKeyToAddress(A0), label: "writer", chainIds: [42] })] });
});
afterEach(() => {
  sim.rm = false;
  sim.write = null;
  clearSecretsForTests();
  setBackendsForTests();
  for (const [k, v] of [["UP_HOME", saved.home], ["UP_TEST_EPHEMERAL_KEY", saved.eph]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("the writer after publication (finding 7)", () => {
  it("a temp file that cannot be removed is a warning: the export still returns path, hash and password", async () => {
    sim.rm = true;
    const dest = customPath();
    const r = await run("backup export", { path: dest });
    expect(r.data).toMatchObject({ path: dest, indexed: true, passwordGenerated: true, encrypted: true });
    expect(r.data.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.data.say).toContain(r.data.password);
    expect(r.warnings!.join(" ")).toMatch(/temporary copy .* could not be removed \(EBUSY\)/);
    expect((await decryptSecrets(JSON.parse(readFileSync(dest, "utf8")).secrets.data, r.data.password)).keys.map((k) => k.address)).toEqual([privateKeyToAddress(A0)]);
    expect(indexLines().some((l) => l.sha256 === r.data.sha256)).toBe(true);
    sim.rm = false;
    for (const f of readdirSync(join(dest, ".."))) if (f.endsWith(".tmp")) rmSync(join(dest, "..", f));
  });

  it("the writer itself returns the warning; a failure BEFORE publication is still the original error, not the cleanup's", async () => {
    sim.rm = true;
    const dir = mkdtempSync(join(tmpdir(), "up-wr-"));
    const ok = await writeNewFileExclusive(join(dir, "a.json"), "content");
    expect(ok.warning).toMatch(/could not be removed/);
    expect(readFileSync(join(dir, "a.json"), "utf8")).toBe("content");
    await expect(writeNewFileExclusive(join(dir, "a.json"), "again")).rejects.toMatchObject({ code: "BAD_ARGS", message: expect.stringMatching(/already exists/) });
    expect(readFileSync(join(dir, "a.json"), "utf8")).toBe("content");
    sim.rm = false;
    expect(await writeNewFileExclusive(join(dir, "b.json"), "x")).toEqual({});
  });
});

describe("path reservations (finding 8)", () => {
  it("a failed write cancels its reservation: an unrelated file at that path is no longer kept from other readers", async () => {
    sim.write = "plain";
    const dest = customPath();
    const e = (await run("backup export", { path: dest }).then(() => undefined, (x) => x)) as Error;
    expect(e.message).toMatch(/EIO/);
    expect(existsSync(dest)).toBe(false);
    expect(indexLines().map((l) => [l.event, l.file])).toEqual([["reserved", dest], ["cancelled", dest]]);
    // an unrelated file now created there is an ordinary file
    writeFileSync(dest, JSON.stringify({ shopping: ["milk"] }));
    expect(() => assertNotKeyMaterialPath(dest)).not.toThrow();
  });

  it("a reservation (and a commit) guards the path; a cancel frees it; a newer reservation guards it again", async () => {
    const dest = customPath();
    writeFileSync(dest, JSON.stringify({ shopping: ["milk"] }));
    const at = new Date().toISOString();
    expect(() => assertNotKeyMaterialPath(dest)).not.toThrow();
    await appendIndex(home, { at, event: "reserved", file: dest });
    expect(() => assertNotKeyMaterialPath(dest)).toThrow(/backups or a backup file/);
    await appendIndex(home, { at, event: "committed", file: dest });
    expect(() => assertNotKeyMaterialPath(dest)).toThrow(/backups or a backup file/);
    await appendIndex(home, { at, event: "cancelled", file: dest });
    expect(() => assertNotKeyMaterialPath(dest)).not.toThrow();
    await appendIndex(home, { at, event: "reserved", file: dest });
    expect(() => assertNotKeyMaterialPath(dest)).toThrow(/backups or a backup file/);
  });

  it("a cancel for one path frees only that path", async () => {
    const a = customPath();
    const b = customPath();
    writeFileSync(a, "{}");
    writeFileSync(b, "{}");
    const at = new Date().toISOString();
    await appendIndex(home, { at, event: "reserved", file: a });
    await appendIndex(home, { at, event: "reserved", file: b });
    await appendIndex(home, { at, event: "cancelled", file: a });
    expect(() => assertNotKeyMaterialPath(a)).not.toThrow();
    expect(() => assertNotKeyMaterialPath(b)).toThrow(/backups or a backup file/);
  });

  it("an incomplete file left by a failed write stays guarded (committed), a file somebody else made is not ours (cancelled)", async () => {
    sim.write = "partial";
    const partial = customPath();
    await expect(run("backup export", { path: partial })).rejects.toThrow(/ENOSPC/);
    expect(existsSync(partial)).toBe(true);
    expect(indexLines().map((l) => l.event)).toEqual(["reserved", "committed"]);
    expect(() => assertNotKeyMaterialPath(partial)).toThrow(/backups or a backup file/);

    sim.write = "taken";
    const taken = customPath();
    await expect(run("backup export", { path: taken })).rejects.toThrow(/already exists/);
    expect(readFileSync(taken, "utf8")).toBe("somebody else's file");
    expect(() => assertNotKeyMaterialPath(taken)).not.toThrow();
  });

  it("a successful export reserves, commits and indexes; the file stays guarded", async () => {
    const dest = customPath();
    const r = await run("backup export", { path: dest });
    expect(indexLines().map((l) => l.event ?? "entry")).toEqual(["reserved", "committed", "entry"]);
    expect(r.data.indexed).toBe(true);
    expect(() => assertNotKeyMaterialPath(dest)).toThrow(/backups or a backup file/);
    expect((await run("backup list")).data.backups).toHaveLength(1);
  });
});
