// Default backup file names carry the generating agent's own display name (--bot-name, else the host's
// UP_AGENT_NAME), never a guessed or hard-coded one. Unsafe names are made file-system safe and the file always
// stays inside <UP_HOME>/backups; an explicit --path is used as given; the file format and import are unchanged.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { privateKeyToAddress } from "viem/accounts";
import "../../../src/verbs/index.ts";
import { agentLabel, defaultBackupPath, sanitizeAgentLabel } from "../../../src/backup/store.ts";
import { createContext, preloadConfig } from "../../../src/core/context.ts";
import { UpError } from "../../../src/core/errors.ts";
import { paths } from "../../../src/core/home.ts";
import { clearSecretsForTests, assertNotKeyMaterialPath } from "../../../src/core/secret-guard.ts";
import { coerceArgs, getVerb } from "../../../src/core/verbs.ts";
import { setBackendsForTests } from "../../../src/signer/index.ts";
import { appReads } from "../../support/app-reader.ts";
import { fakeManifest, newKey, seedHome } from "../../support/backup-fixtures.ts";

const saved = { home: process.env.UP_HOME, eph: process.env.UP_TEST_EPHEMERAL_KEY, name: process.env.UP_AGENT_NAME };
const APPROVAL = "human: yes, make the backup";
const DAY = new Date().toISOString().slice(0, 10);
const key = newKey();
let home: string;

async function run(name: string, raw: Record<string, unknown> = {}, flags: { approval?: string } = {}, inHome = home) {
  process.env.UP_HOME = inHome;
  const ctx = createContext({ home: inHome, flags: { json: true, dryRun: false, yes: false, approval: flags.approval } });
  await preloadConfig(ctx);
  const v = getVerb(name)!;
  return (await v.run(ctx, coerceArgs(v, raw))) as { data: any };
}
const files = () => readdirSync(paths.backups(home)).filter((f) => f.endsWith(".json"));

beforeEach(async () => {
  delete process.env.UP_AGENT_NAME;
  home = await seedHome({ keys: [key], manifests: [fakeManifest({ controller: privateKeyToAddress(key), label: "one", chainIds: [42] })] });
});
afterEach(() => {
  clearSecretsForTests();
  setBackendsForTests();
  for (const [k, v] of [["UP_HOME", saved.home], ["UP_TEST_EPHEMERAL_KEY", saved.eph], ["UP_AGENT_NAME", saved.name]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("backup default file name: the generating agent's own display name", () => {
  it("--bot-name prefixes the default name; two different agents get two different names; nothing is hard-coded", async () => {
    const a = await run("backup export", { "bot-name": "Alice" }, { approval: APPROVAL });
    const b = await run("backup export", { "bot-name": "Emmet" }, { approval: APPROVAL });
    expect(basename(a.data.path)).toBe(`Alice - universal-profiles-backup-${DAY}.json`);
    expect(basename(b.data.path)).toBe(`Emmet - universal-profiles-backup-${DAY}.json`);
    expect(dirname(a.data.path)).toBe(paths.backups(home));
    expect(files().join("|")).not.toMatch(/grok/i);
    expect(a.data.path).not.toBe(b.data.path);
  });

  it("without any label the name is the unchanged default (no Grok or any other guessed prefix)", async () => {
    const r = await run("backup export", {}, { approval: APPROVAL });
    expect(basename(r.data.path)).toBe(`universal-profiles-backup-${DAY}.json`);
  });

  it("UP_AGENT_NAME (the host's public label) is used when no --bot-name is given; --bot-name wins", async () => {
    process.env.UP_AGENT_NAME = "Hermes Helper";
    const viaEnv = await run("backup export", {}, { approval: APPROVAL });
    expect(basename(viaEnv.data.path)).toBe(`Hermes Helper - universal-profiles-backup-${DAY}.json`);
    const viaFlag = await run("backup export", { "bot-name": "Alice" }, { approval: APPROVAL });
    expect(basename(viaFlag.data.path)).toBe(`Alice - universal-profiles-backup-${DAY}.json`);
  });

  it("the same agent twice on one day gets -2, never an overwrite; every mode is prefixed", async () => {
    const first = await run("backup export", { "bot-name": "Alice" }, { approval: APPROVAL });
    const second = await run("backup export", { "bot-name": "Alice" }, { approval: APPROVAL });
    const plain = await run("backup export", { "bot-name": "Alice", mode: "unencrypted", "explicit-consent": true }, { approval: APPROVAL });
    const pub = await run("backup export", { "bot-name": "Alice", mode: "public" });
    expect([first, second, plain, pub].map((r) => basename(r.data.path))).toEqual([
      `Alice - universal-profiles-backup-${DAY}.json`,
      `Alice - universal-profiles-backup-${DAY}-2.json`,
      `Alice - universal-profiles-backup-${DAY}-3.json`,
      `Alice - universal-profiles-backup-${DAY}-4.json`,
    ]);
    expect(readFileSync(first.data.path, "utf8")).not.toBe(readFileSync(second.data.path, "utf8"));
  });

  it("an explicit --path is used exactly as given, without the prefix", async () => {
    const dir = mkdtempSync(join(tmpdir(), "up-explicit-"));
    const target = join(dir, "mine.json");
    const r = await run("backup export", { path: target, "bot-name": "Alice" }, { approval: APPROVAL });
    expect(r.data.path).toBe(target);
    expect(existsSync(target)).toBe(true);
  });

  it("the file content does not carry the agent name and still reads as before (format and import unchanged)", async () => {
    const r = await run("backup export", { "bot-name": "Alice" }, { approval: APPROVAL });
    const text = readFileSync(r.data.path, "utf8");
    expect(text).not.toContain("Alice");
    expect(appReads(text).errors).toEqual([]);
    expect(JSON.parse(text)).toMatchObject({ version: 2 });
    const inspected = await run("backup inspect", { path: r.data.path });
    expect(inspected.data.problems ?? []).toEqual([]);
    // a prefixed backup moved to another place under any name is still recognised as a backup and refused by other readers
    expect(() => assertNotKeyMaterialPath(join(dir(), `Alice - universal-profiles-backup-${DAY}.json`), "file")).toThrow(/backup/);
    // and renamed to anything, the backup verbs still open it
    const renamed = join(dir(), "whatever.json");
    await (await import("node:fs/promises")).copyFile(r.data.path, renamed);
    expect((await run("backup inspect", { path: renamed })).data.problems ?? []).toEqual([]);
  });
});

const dir = () => mkdtempSync(join(tmpdir(), "up-elsewhere-"));

describe("agent label sanitising", () => {
  it.each([
    ["../../etc/passwd", "etc passwd"],
    ["..\\..\\Windows\\System32", "Windows System32"],
    ["a/b\\c", "a b c"],
    ['Bad<>:"|?*Name', "Bad Name"],
    ["line1\nline2\u0000‮", "line1line2"],
    ["  Alice  the   Bot  ", "Alice the Bot"],
    ["Zoë Ünïcode", "Zoë Ünïcode"],
    ["Bot 🤖 One", "Bot One"],
    ["...dots...", "dots"],
    ["CON", "CON-agent"],
    ["lpt1", "lpt1-agent"],
  ])("%j → %j", (raw, want) => {
    expect(sanitizeAgentLabel(raw)).toBe(want);
  });

  it("caps the length, and refuses empty, non-text and key-shaped labels", () => {
    expect(sanitizeAgentLabel("x".repeat(500))).toHaveLength(40);
    for (const bad of ["", "   ", "///", "..", "🤖🤖", undefined, 42, `0x${"ab".repeat(32)}`, "ab".repeat(32)]) expect(sanitizeAgentLabel(bad)).toBeUndefined();
  });

  it("an unusable explicit --bot-name fails clearly; an unusable UP_AGENT_NAME is ignored", () => {
    expect(() => agentLabel("///")).toThrow(UpError);
    expect(agentLabel(undefined, { UP_AGENT_NAME: "///" } as NodeJS.ProcessEnv)).toBeUndefined();
    expect(agentLabel(" Alice ", {} as NodeJS.ProcessEnv)).toBe("Alice");
  });

  it("a hostile name never leaves the backups folder and never puts a key in the file name", async () => {
    const r = await run("backup export", { "bot-name": "../../outside/..\\x" }, { approval: APPROVAL });
    expect(dirname(r.data.path)).toBe(paths.backups(home));
    expect(basename(r.data.path)).toBe(`outside x - universal-profiles-backup-${DAY}.json`);
    await expect(run("backup export", { "bot-name": `0x${"cd".repeat(32)}` }, { approval: APPROVAL })).rejects.toThrow(UpError);
    expect(files()).toEqual([`outside x - universal-profiles-backup-${DAY}.json`]);
  });

  it("defaultBackupPath: the date is the UTC day and collisions count up", async () => {
    const p = await defaultBackupPath(home, new Date("2026-10-11T23:59:59Z"), "Alice");
    expect(basename(p)).toBe("Alice - universal-profiles-backup-2026-10-11.json");
  });
});
