// A backup file must never be stranded without its password or without protection when the backups
// index cannot be written (full disk, read-only folder): before the file exists the index failure
// stops the export; after it exists the export still reports path, hash and password. Public Anvil keys only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import "../../../src/verbs/index.ts";
import { decryptSecrets } from "../../../src/backup/lsp30-crypto.ts";
import { createContext, preloadConfig } from "../../../src/core/context.ts";
import type { UpError } from "../../../src/core/errors.ts";
import { paths } from "../../../src/core/home.ts";
import { assertNotKeyMaterialPath, clearSecretsForTests } from "../../../src/core/secret-guard.ts";
import { coerceArgs, getVerb } from "../../../src/core/verbs.ts";
import { setBackendsForTests } from "../../../src/signer/index.ts";
import { fakeManifest, seedHome } from "../../support/backup-fixtures.ts";

const failing = vi.hoisted(() => ({ on: null as null | "reserve" | "final" }));
vi.mock("../../../src/core/home.ts", async (original) => {
  const m = await original<typeof import("../../../src/core/home.ts")>();
  return {
    ...m,
    appendLine: async (file: string, line: string) => {
      if (file.endsWith("index.jsonl") && ((failing.on === "reserve" && line.includes('"reserved"')) || (failing.on === "final" && line.includes('"sha256"')))) throw new Error("ENOSPC: no space left on device");
      return m.appendLine(file, line);
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

beforeEach(async () => {
  failing.on = null;
  const m = fakeManifest({ controller: privateKeyToAddress(A0), label: "index-failure", chainIds: [42] });
  home = await seedHome({ keys: [A0], manifests: [m] });
});
afterEach(() => {
  failing.on = null;
  clearSecretsForTests();
  setBackendsForTests();
  for (const [k, v] of [["UP_HOME", saved.home], ["UP_TEST_EPHEMERAL_KEY", saved.eph]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("export when the index cannot be written", () => {
  it("after the file is written: a recoverable partial success with path, hash, password and a warning; the file stays and stays guarded", async () => {
    failing.on = "final";
    const custom = join(mkdtempSync(join(tmpdir(), "up-idx-")), "mine.json");
    const r = await run("backup export", { path: custom });
    expect(r.data).toMatchObject({ path: custom, indexed: false, passwordGenerated: true, encrypted: true });
    expect(r.data.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.data.say).toContain(r.data.password);
    expect(r.warnings!.join(" ")).toContain("could not be added to the backups index");
    // the file is complete and opens with that password
    expect((await decryptSecrets(JSON.parse(readFileSync(custom, "utf8")).secrets.data, r.data.password, JSON.parse(readFileSync(custom, "utf8")).secrets.iterations)).keys.map((k) => k.address)).toEqual([privateKeyToAddress(A0)]);
    // other readers are kept away although the final index line is missing (the path was reserved first)
    expect(() => assertNotKeyMaterialPath(custom)).toThrow(/backups or a backup file/);
    failing.on = null;
    const list = await run("backup list");
    expect(list.data.backups).toEqual([]);
    expect(list.data.current).toBe(false);
  });

  it("before the file is written: the export stops with a clear error and leaves no file and no password behind", async () => {
    failing.on = "reserve";
    const custom = join(mkdtempSync(join(tmpdir(), "up-idx-")), "mine.json");
    const e = (await run("backup export", { path: custom }).then(() => undefined, (x) => x)) as UpError;
    expect(e.message).toMatch(/index cannot be written, so no backup was made/);
    expect(existsSync(custom)).toBe(false);
    expect(existsSync(paths.backups(home)) ? readdirSync(paths.backups(home)).filter((f) => f.endsWith(".json")) : []).toEqual([]);
    expect(JSON.stringify(e.toJSON())).not.toMatch(/\b[A-HJ-NP-Za-km-z2-9]{5}(-[A-HJ-NP-Za-km-z2-9]{5}){3}\b/);
  });
});

describe("the backup path guard does not depend on the index", () => {
  it("a file that starts like an LSP-30 backup is refused for other readers wherever it lives; other JSON is not", () => {
    const dir = mkdtempSync(join(tmpdir(), "up-sniff-"));
    const backup = join(dir, "anything.json");
    writeFileSync(backup, JSON.stringify({ version: 2, backupDate: "2026-10-10T12:00:00Z", accounts: [], LSP23CrossChainDeployment: [], secrets: { encrypted: false, data: [] } }, undefined, 2));
    expect(() => assertNotKeyMaterialPath(backup)).toThrow(/backups or a backup file/);
    expect(() => assertNotKeyMaterialPath(backup, "file", { allowBackups: true })).not.toThrow(); // the backup verbs' own reader
    const other = join(dir, "other.json");
    writeFileSync(other, JSON.stringify({ version: 2, name: "not a backup" }));
    expect(() => assertNotKeyMaterialPath(other)).not.toThrow();
  });
});
