// Hooks the backup feature adds to the core: the release of the generated password in redact(),
// the path guard for backup files, and keys restored from a backup (recorded before stored, never lost).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { paths } from "../../../src/core/home.ts";
import { redact, releaseKeys } from "../../../src/core/json.ts";
import { assertNotKeyMaterialPath, clearSecretsForTests } from "../../../src/core/secret-guard.ts";
import { UpError } from "../../../src/core/errors.ts";
import { readInventory, inventoryFile } from "../../../src/signer/inventory.ts";
import { MemoryBackend, resetMemoryBackend } from "../../../src/signer/memory.ts";
import { importRecorded } from "../../../src/signer/verbs.ts";
import { readFileSync } from "node:fs";

const saved = { home: process.env.UP_HOME, eph: process.env.UP_TEST_EPHEMERAL_KEY };
let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "up-guards-"));
  process.env.UP_HOME = home;
  process.env.UP_TEST_EPHEMERAL_KEY = "1";
  resetMemoryBackend();
});
afterEach(() => {
  clearSecretsForTests();
  for (const [k, v] of [["UP_HOME", saved.home], ["UP_TEST_EPHEMERAL_KEY", saved.eph]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("redact() and the released backup password", () => {
  it("only the marked key of the marked object is left alone; every other password-shaped field is still redacted", () => {
    const data = releaseKeys({ password: "ABCDE-FGHJK-LMNPQ-RSTUV", nested: { password: "x-secret" }, secretNote: "n" }, "password");
    const out = redact({ ok: true, data, other: { password: "also-secret" } }) as any;
    expect(out.data.password).toBe("ABCDE-FGHJK-LMNPQ-RSTUV");
    expect(out.data.nested.password).toBe("[redacted]");
    expect(out.other.password).toBe("[redacted]");
    expect(redact({ password: "ABCDE-FGHJK-LMNPQ-RSTUV" })).toEqual({ password: "[redacted]" }); // not marked: redacted as before
  });
});

describe("backup files are off limits to every other file-reading verb", () => {
  it("refuses the backups folder, the default file name anywhere, and files named in the index; the key store stays refused", () => {
    mkdirSync(paths.backups(home), { recursive: true });
    const inFolder = join(paths.backups(home), "mine.json");
    writeFileSync(inFolder, "{}");
    expect(() => assertNotKeyMaterialPath(inFolder)).toThrow(/backups or a backup file/);
    const elsewhere = join(mkdtempSync(join(tmpdir(), "up-elsewhere-")), "universal-profiles-backup-2026-10-10.json");
    writeFileSync(elsewhere, "{}");
    expect(() => assertNotKeyMaterialPath(elsewhere)).toThrow(/backups or a backup file/);
    const custom = join(mkdtempSync(join(tmpdir(), "up-elsewhere-")), "my-copy.json");
    writeFileSync(custom, "{}");
    expect(() => assertNotKeyMaterialPath(custom)).not.toThrow();
    writeFileSync(join(paths.backups(home), "index.jsonl"), JSON.stringify({ file: custom, sha256: "x" }) + "\n");
    expect(() => assertNotKeyMaterialPath(custom)).toThrow(/backups or a backup file/); // now named in the index
    // the backup verbs' own reader may open them, but never the key store
    for (const f of [inFolder, elsewhere, custom]) expect(() => assertNotKeyMaterialPath(f, "backup file", { allowBackups: true })).not.toThrow();
    mkdirSync(paths.keys(home), { recursive: true });
    expect(() => assertNotKeyMaterialPath(join(paths.keys(home), "x.json"), "backup file", { allowBackups: true })).toThrow(/key store or a key file/);
  });
});

describe("importRecorded: a restored key is listed before it is stored and never lost", () => {
  it("records the key in keys/inventory.jsonl with a note first, then stores it", async () => {
    const pk = generatePrivateKey();
    const address = privateKeyToAddress(pk);
    const mem = new MemoryBackend();
    const order: string[] = [];
    const spy = {
      id: "memory",
      importKey: async (k: any, before: any) =>
        mem.importKey(k, async (a: any) => {
          await before(a);
          order.push(`recorded:${(readFileSync(inventoryFile(home), "utf8").match(/restored/g) ?? []).length}`);
        }),
    };
    expect(await importRecorded(home, spy as any, pk, "restored from LSP-30 backup 2026-10-10T12:00:00Z")).toBe(address);
    expect(order).toEqual(["recorded:1"]); // the inventory line existed when the store was about to happen
    expect(await mem.has(address)).toBe(true);
    expect(await readInventory(home)).toEqual([expect.objectContaining({ address, backend: "memory", note: "restored from LSP-30 backup 2026-10-10T12:00:00Z" })]);
  });

  it("a store that fails after the record leaves a 'not stored' follow-up; a store without import is refused", async () => {
    const pk = generatePrivateKey();
    const failing = { id: "memory", importKey: async (_k: any, before: any) => { await before(privateKeyToAddress(pk)); throw new UpError("SIGNER_LOCKED", "store is locked"); } };
    await expect(importRecorded(home, failing as any, pk, "note")).rejects.toThrow(/locked/);
    expect(await readInventory(home)).toEqual([expect.objectContaining({ notStored: true })]);
    await expect(importRecorded(home, { id: "remote-signer" } as any, pk, "n")).rejects.toThrow(/cannot import a key/);
  });
});
