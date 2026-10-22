// A damaged profile record (profiles/<address>.json: not valid JSON, not a JSON object, or unreadable) is never
// written over. Every record writer and every reader that decides what to do (the profile's address on a chain,
// its deployment manifest, its relay channel, backups) stops with a repair hint before anything changes, so the
// saved relay channel, the deployment manifest and the links cannot silently disappear, and no new relay channel
// is made after the damage. A missing record is created; a valid record keeps every field, unknown ones included.
// The network is mocked and must not be used.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import "../../../src/verbs/index.ts";
import { createContext, preloadConfig } from "../../../src/core/context.ts";
import { paths } from "../../../src/core/home.ts";
import type { UpError } from "../../../src/core/errors.ts";
import { profileAddressOn, readProfileRecord, updateProfileRecord } from "../../../src/core/profile-record.ts";
import { clearSecretsForTests } from "../../../src/core/secret-guard.ts";
import { coerceArgs, getVerb } from "../../../src/core/verbs.ts";
import { loadManifest, saveManifest } from "../../../src/lsp/lsp23.ts";
import { saveStatusSnapshot } from "../../../src/lsp/multichain.ts";
import { ensureRelayChannel, relayChannelState, setChannelEntropy } from "../../../src/lsp/relay-channel.ts";
import { setBackendsForTests } from "../../../src/signer/index.ts";
import { resetMemoryBackend } from "../../../src/signer/memory.ts";
import { fakeManifest, seedHome } from "../../support/backup-fixtures.ts";

vi.mock("../../../src/lsp/read.ts", async (original) => ({
  ...(await original<typeof import("../../../src/lsp/read.ts")>()),
  hasCode: async () => true,
}));
vi.mock("../../../src/lsp/profile.ts", async (original) => ({
  ...(await original<typeof import("../../../src/lsp/profile.ts")>()),
  supportsInterface: async () => true,
  resolveKeyManager: async () => ({ keyManager: "0x" + "cc".repeat(20), owner: "0x" + "cc".repeat(20), ownerKind: "key-manager" }),
  readControllerPermissions: async () => ({ permissions: { value: 1n, names: ["CHANGEOWNER"] } }),
  readControllers: async () => ({ controllers: [] }),
}));

const K0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex; // public Anvil key
const A = getAddress("0x" + "a1".repeat(20));
const LINKED = getAddress("0x" + "77".repeat(20));
const APPROVAL = "human: yes, do it";
const OFFLINE = "human: yes, restore it, offline please";
const saved = { home: process.env.UP_HOME, eph: process.env.UP_TEST_EPHEMERAL_KEY };
let network = 0;

/** A record that a botched hand edit left without its final brace: it still names the channel and the manifest. */
const truncated = (address: Address) => JSON.stringify({ address, deployment: { kind: "x" }, relayChannel: { channel: "123456789012345678901234567890", createdAt: "2026-10-21T00:00:00.000Z", source: "random" } }).slice(0, -1);
const recordFile = (home: string, id: Address) => paths.profile(home, id);
function writeRecord(home: string, id: Address, text: string) {
  mkdirSync(paths.profiles(home), { recursive: true });
  writeFileSync(recordFile(home, id), text);
}
async function run(name: string, raw: Record<string, unknown>, home: string, flags: { approval?: string; dryRun?: boolean } = {}) {
  process.env.UP_HOME = home;
  const ctx = createContext({ home, flags: { json: true, dryRun: flags.dryRun ?? false, yes: false, approval: flags.approval } });
  await preloadConfig(ctx);
  const v = getVerb(name)!;
  return (await v.run(ctx, coerceArgs(v, raw))) as { data: any; text?: string; warnings?: string[] };
}
const fail = async (p: Promise<unknown>) => (await p.then(() => undefined, (e) => e)) as UpError;
const DAMAGED = /profiles[\\/]0x[0-9a-f]{40}\.json is not a valid profile record \(not valid JSON\); nothing was changed and it will not be overwritten/;

beforeEach(() => {
  network = 0;
  vi.stubGlobal("fetch", async () => {
    network++;
    throw new Error("no network in this test");
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  setChannelEntropy();
  clearSecretsForTests();
  setBackendsForTests();
  for (const [k, v] of [["UP_HOME", saved.home], ["UP_TEST_EPHEMERAL_KEY", saved.eph]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("a damaged record is refused, never replaced (the review's repro)", () => {
  it("not valid JSON: the relay channel code, every record writer and the address lookup stop; the file is unchanged and no new channel is made", async () => {
    const home = mkdtempSync(join(tmpdir(), "up-rec-"));
    const m = fakeManifest({ controller: privateKeyToAddress(K0), label: "damaged" });
    writeRecord(home, m.profile, truncated(m.profile));
    const before = readFileSync(recordFile(home, m.profile), "utf8");
    setChannelEntropy(() => Buffer.alloc(16, 0x42)); // would show up as a new channel

    await expect(relayChannelState(home, m.profile)).rejects.toMatchObject({ code: "INTERNAL", message: DAMAGED });
    const e = await fail(updateProfileRecord(home, m.profile, () => ({ status: { checkedAt: "t", chains: {} } })));
    expect(e).toMatchObject({ code: "INTERNAL", message: DAMAGED });
    expect(e.hint).toMatch(/repair it by hand or put back a copy/);
    expect(e.hint).toMatch(/never delete it/i);
    await expect(saveStatusSnapshot(home, m.profile, [])).rejects.toMatchObject({ code: "INTERNAL", message: DAMAGED });
    await expect(saveManifest(home, m)).rejects.toMatchObject({ code: "INTERNAL", message: DAMAGED });
    await expect(ensureRelayChannel(home, m.profile)).rejects.toMatchObject({ code: "INTERNAL" });
    await expect(ensureRelayChannel(home, m.profile, { explicit: true })).rejects.toMatchObject({ code: "INTERNAL" });
    // no silent fallback to "no link" (the wrong address on a linked chain) or "no manifest"
    await expect(profileAddressOn(home, m.profile, 8453)).rejects.toMatchObject({ code: "INTERNAL", message: DAMAGED });
    await expect(loadManifest(home, m.profile)).rejects.toMatchObject({ code: "INTERNAL", message: DAMAGED });
    expect(readFileSync(recordFile(home, m.profile), "utf8")).toBe(before);
  });

  it.each([
    ["an array", "[1,2]"],
    ["a string", '"x"'],
    ["null", "null"],
    ["a number", "7"],
  ])("a record that is %s is not a JSON object: refused, unchanged", async (_name, text) => {
    const home = mkdtempSync(join(tmpdir(), "up-rec-"));
    writeRecord(home, A, text);
    await expect(updateProfileRecord(home, A, () => ({ joined: { at: "t" } }))).rejects.toMatchObject({ code: "INTERNAL", message: /is not a valid profile record \(not a JSON object\); nothing was changed/ });
    await expect(readProfileRecord(home, A)).rejects.toMatchObject({ code: "INTERNAL" });
    expect(readFileSync(recordFile(home, A), "utf8")).toBe(text);
  });

  it("a record that cannot be read (here: a directory in its place) is refused and left alone", async () => {
    const home = mkdtempSync(join(tmpdir(), "up-rec-"));
    mkdirSync(recordFile(home, A), { recursive: true });
    await expect(updateProfileRecord(home, A, () => ({ joined: { at: "t" } }))).rejects.toMatchObject({ code: "INTERNAL", message: /cannot read the profile record .*; nothing was changed/ });
    expect(readdirSync(recordFile(home, A))).toEqual([]);
  });
});

describe("missing and valid records", () => {
  it("a missing record is created; a writer changes only its key and keeps every other one, unknown ones and the relay channel included", async () => {
    const home = mkdtempSync(join(tmpdir(), "up-rec-"));
    expect(await readProfileRecord(home, A)).toEqual({});
    await updateProfileRecord(home, A, () => ({ joined: { at: "t1" } }));
    expect(JSON.parse(readFileSync(recordFile(home, A), "utf8"))).toEqual({ address: A, joined: { at: "t1" } });

    const rec = { address: A, relayChannel: { channel: "123456789012345678901234567890", createdAt: "2026-10-21T00:00:00.000Z", source: "random", future: 1 }, deployment: { kind: "x" }, laterVersionField: { nested: [1, "two"] } };
    writeRecord(home, A, JSON.stringify(rec));
    await saveStatusSnapshot(home, A, []);
    const after = JSON.parse(readFileSync(recordFile(home, A), "utf8"));
    expect(after).toMatchObject(rec);
    expect(Object.keys(after).sort()).toEqual(["address", "deployment", "laterVersionField", "relayChannel", "status"]);
    expect((await relayChannelState(home, A)).saved?.channel).toBe(123456789012345678901234567890n);
  });
});

// (`profile identity`, read-only and the first command of every chat, lists such a profile as damaged instead: unit/verbs/identity.test.ts)
describe("verbs stop before anything changes (nothing written, no network, no key restored)", () => {
  let home: string;
  let m: ReturnType<typeof fakeManifest>;
  let damaged: string;
  let config: string;
  beforeEach(async () => {
    m = fakeManifest({ controller: privateKeyToAddress(K0), label: "verbs", chainIds: [42] });
    home = await seedHome({ keys: [K0], manifests: [m] });
    damaged = truncated(m.profile);
    writeFileSync(recordFile(home, m.profile), damaged);
    config = readFileSync(paths.config(home), "utf8");
  });
  const unchanged = () => {
    expect(readFileSync(recordFile(home, m.profile), "utf8")).toBe(damaged);
    expect(readFileSync(paths.config(home), "utf8")).toBe(config);
    expect(network).toBe(0);
  };

  it.each([
    ["profile status", {}],
    ["profile link", { address: LINKED, chain: "8453" }],
    ["profile join", { address: "PROFILE", alias: "work" }],
    ["account manifest show", {}],
    ["nonce channel", { chain: "8453" }],
    ["nonce channel create", {}],
  ])("%s", async (verb, raw) => {
    const args = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v === "PROFILE" ? m.profile : v]));
    expect(await fail(run(verb, args, home, { approval: APPROVAL }))).toMatchObject({ code: "INTERNAL", message: DAMAGED });
    unchanged();
  });

  it("backup export writes no backup that silently lacks the profile's manifest", async () => {
    expect(await fail(run("backup export", {}, home, { approval: APPROVAL }))).toMatchObject({ code: "INTERNAL", message: DAMAGED });
    expect(existsSync(paths.backups(home)) ? readdirSync(paths.backups(home)).filter((f) => f.endsWith(".json")) : []).toEqual([]);
    unchanged();
  });

  it("backup import into a home with a damaged record of that profile stops before the consent and before any key is restored", async () => {
    writeFileSync(recordFile(home, m.profile), JSON.stringify({ address: m.profile, deployment: m })); // export from an intact home
    const exported = await run("backup export", {}, home, { approval: APPROVAL });
    const target = mkdtempSync(join(tmpdir(), "up-rec-import-"));
    resetMemoryBackend();
    writeRecord(target, m.profile, damaged);
    const e = await fail(run("backup import", { path: exported.data.path, password: exported.data.password, offline: true }, target, { approval: OFFLINE }));
    expect(e).toMatchObject({ code: "INTERNAL", message: DAMAGED });
    await expect(run("backup import", { path: exported.data.path, password: exported.data.password, offline: true }, target, { dryRun: true, approval: OFFLINE })).rejects.toMatchObject({ code: "INTERNAL" });
    expect(readFileSync(recordFile(target, m.profile), "utf8")).toBe(damaged);
    expect(existsSync(join(paths.keys(target), "inventory.jsonl"))).toBe(false);
    expect(existsSync(paths.config(target))).toBe(false);
    expect(existsSync(paths.audit(target))).toBe(false);
    expect(network).toBe(0);
  });
});
