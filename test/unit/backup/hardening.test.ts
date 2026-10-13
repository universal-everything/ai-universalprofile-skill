// Findings of the independent security review of the backup feature, one test group each:
// key-shaped metadata in a backup file must reach no output, error, audit line, inventory note,
// profile record, index or config; imported profiles export again at once; every profile exports
// only its own controllers; oversized files are never "current"; the MCP server echoes no key.
// Public Anvil test keys only.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import "../../../src/verbs/index.ts";
import { decryptSecrets } from "../../../src/backup/lsp30-crypto.ts";
import { parseBackup } from "../../../src/backup/lsp30-format.ts";
import { assertNoKeyIn, scrubPublicText } from "../../../src/backup/restore.ts";
import { createContext, preloadConfig } from "../../../src/core/context.ts";
import type { UpError } from "../../../src/core/errors.ts";
import { paths } from "../../../src/core/home.ts";
import { renderResult } from "../../../src/core/output.ts";
import { KEY_WITHHELD } from "../../../src/core/safe-text.ts";
import { clearSecretsForTests, registerSecret } from "../../../src/core/secret-guard.ts";
import { coerceArgs, getVerb } from "../../../src/core/verbs.ts";
import { handleMcpMessage } from "../../../src/mcp/server.ts";
import { readInventory } from "../../../src/signer/inventory.ts";
import { getBackend, setBackendsForTests } from "../../../src/signer/index.ts";
import { resetMemoryBackend } from "../../../src/signer/memory.ts";
import { appReads } from "../../support/app-reader.ts";
import { fakeManifest, seedHome } from "../../support/backup-fixtures.ts";

const A0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex; // public Anvil keys
const A1 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const KEYS = [A0, A1];
const addr = (k: Hex) => privateKeyToAddress(k);
const APPROVAL = "human: yes, back it up";
const OFFLINE = { approval: "yes, restore it, offline please" };
const JOINED = getAddress("0x" + "31".repeat(20));
const saved = { home: process.env.UP_HOME, eph: process.env.UP_TEST_EPHEMERAL_KEY };

let home: string;
let ma: ReturnType<typeof fakeManifest>;
let mb: ReturnType<typeof fakeManifest>;

async function run(name: string, raw: Record<string, unknown> = {}, flags: { approval?: string; dryRun?: boolean } = {}, inHome = home) {
  process.env.UP_HOME = inHome;
  const ctx = createContext({ home: inHome, flags: { json: true, dryRun: flags.dryRun === true, yes: false, approval: flags.approval } });
  await preloadConfig(ctx);
  const v = getVerb(name)!;
  return (await v.run(ctx, coerceArgs(v, raw))) as { data: any; text?: string; warnings?: string[] };
}
const fail = async (p: Promise<unknown>) => ((await p.then(() => undefined, (e) => e)) as UpError);
/** True when the value holds either test key, in any case, with or without 0x, also when other characters are mixed in. */
const leaks = (v: unknown): boolean => {
  const text = typeof v === "string" ? v : JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
  const squashed = text.toLowerCase().replace(/[^0-9a-z]/g, "");
  return KEYS.some((k) => squashed.includes(k.slice(2)));
};
const filesUnder = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)])) : []);
/** Every file of a home (audit log, inventory, records, index, config ...) free of both keys. */
const scanHome = (h: string) => {
  const files = filesUnder(h);
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) expect(leaks(readFileSync(f, "utf8")), `a key was written to ${f}`).toBe(false);
  return files;
};
const fresh = () => {
  const h = mkdtempSync(join(tmpdir(), "up-hard-"));
  process.env.UP_HOME = h;
  resetMemoryBackend();
  return h;
};
const writeTemp = (name: string, data: unknown) => {
  const file = join(mkdtempSync(join(tmpdir(), "up-hard-file-")), name);
  writeFileSync(file, JSON.stringify(data, undefined, 2));
  return file;
};

beforeEach(async () => {
  ma = fakeManifest({ controller: addr(A0), label: "hard-a", chainIds: [42] });
  mb = fakeManifest({ controller: addr(A1), label: "hard-b", chainIds: [42, 8453] });
  home = await seedHome({ keys: [A0, A1], candidates: [1], manifests: [ma, mb], joined: [{ address: JOINED, chains: [42] }] });
});
afterEach(() => {
  clearSecretsForTests();
  setBackendsForTests();
  for (const [k, v] of [["UP_HOME", saved.home], ["UP_TEST_EPHEMERAL_KEY", saved.eph]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("key-shaped metadata in a backup file (finding 1 and 2)", () => {
  /** The file with every free-text field turned into a copy of a key: plain, upper case, bare, spread over spaces. */
  const tampered = (f: any) => {
    f.backupDate = A0;
    f.accounts[0].name = A0.toUpperCase().replace("0X", "0x");
    f.accounts[1].name = A1.slice(2).match(/.{8}/g)!.join(" ");
    f.accounts[2].name = "Agent " + A0.slice(2);
    for (const a of f.accounts) {
      a.type = "LSP0-ERC725Account";
      for (const n of a.networks) {
        n.name = A0;
        for (const c of n.controllers) (c.name = A1.slice(2), (c.type = A0));
      }
    }
    if (f.secrets.encrypted) {
      f.secrets.passwordHint = A1;
      f.secrets.encryptionType = A0.slice(2).toUpperCase();
    }
    return f;
  };
  const exportAs = async (mode: "encrypted" | "unencrypted") => {
    const r = await run("backup export", mode === "unencrypted" ? { mode, "explicit-consent": true } : {}, { approval: APPROVAL });
    const file = writeTemp("crafted.json", tampered(JSON.parse(readFileSync(r.data.path, "utf8"))));
    return { file, password: r.data.password as string | undefined };
  };

  it("inspect of an encrypted file shows none of it: date, labels and types are replaced, with a note each", async () => {
    const { file } = await exportAs("encrypted");
    clearSecretsForTests(); // inspect never opens the keys: only the shape of the text can protect it
    const i = await run("backup inspect", { path: file });
    expect(leaks(i)).toBe(false);
    expect(leaks(renderResult("backup inspect", i, true))).toBe(false);
    expect(i.data.backupDate).toBe("unknown");
    expect(i.data.keyMaterial).toMatchObject({ kind: "encrypted", encryptionType: "unrecognized", hintPresent: true, hint: KEY_WITHHELD });
    expect(i.data.accounts.map((a: any) => a.name)).toEqual([KEY_WITHHELD, KEY_WITHHELD, KEY_WITHHELD]);
    expect(i.data.accounts[0].networks[0].controllers[0]).toMatchObject({ name: KEY_WITHHELD, type: KEY_WITHHELD });
    expect(i.data.issues.map((x: any) => x.code)).toEqual(expect.arrayContaining(["bad-date", "key-shaped-text", "encryption-type"]));
    expect(i.data.valid).toBe(true);
  });

  it("verify: a missing password error carries a withheld hint, a wrong one nothing; an opened file shows no key", async () => {
    const { file, password } = await exportAs("encrypted");
    clearSecretsForTests();
    const missing = await fail(run("backup verify", { path: file }));
    expect(missing.message).toMatch(/password protected/);
    expect(leaks(missing.toJSON())).toBe(false);
    expect(missing.details).toMatchObject({ passwordHint: KEY_WITHHELD });
    const wrong = await fail(run("backup verify", { path: file, password: "definitely-wrong-12" }));
    expect(leaks(wrong.toJSON())).toBe(false);
    const ok = await run("backup verify", { path: file, password });
    expect(ok.data.valid).toBe(true);
    expect(leaks(ok)).toBe(false);
    expect(leaks(renderResult("backup verify", ok, true))).toBe(false);
    expect(ok.data.issues.map((x: any) => x.code)).toContain("key-shaped-text");
  });

  it("import of an encrypted file writes the key nowhere: not the audit log, inventory, profile records, index, config or candidates", async () => {
    const { file, password } = await exportAs("encrypted");
    clearSecretsForTests();
    const h = fresh();
    const r = await run("backup import", { path: file, password, offline: true, "all-keys": true }, OFFLINE, h);
    expect(r.data.restored).toBe(true);
    expect(leaks(r)).toBe(false);
    expect(leaks(renderResult("backup import", r, true))).toBe(false);
    const files = scanHome(h);
    expect(files.some((f) => f === paths.audit(h))).toBe(true);
    expect(files.some((f) => f.endsWith("index.jsonl"))).toBe(true);
    expect((await readInventory(h)).every((e) => e.note === "restored from LSP-30 backup unknown")).toBe(true);
    for (const m of [ma, mb]) {
      const rec = JSON.parse(readFileSync(paths.profile(h, m.profile), "utf8"));
      expect(rec.imported.backupDate).toBe("unknown");
      expect(rec.imported.name).toBeUndefined(); // a withheld name is not stored as a label
    }
    // the consent summary (it is audited) does not carry it either
    const refused = await fail(run("backup import", { path: file, password, offline: true }, { approval: undefined }, fresh()));
    expect(leaks(refused.toJSON())).toBe(false);
  });

  it("the same for a plain-text file: inspect, verify and import", async () => {
    const { file } = await exportAs("unencrypted");
    clearSecretsForTests();
    const i = await run("backup inspect", { path: file });
    expect(i.data.keyMaterial).toMatchObject({ kind: "plain-text keys", keyCount: 2 });
    expect(leaks(i)).toBe(false);
    expect(leaks(await run("backup verify", { path: file }))).toBe(false);
    clearSecretsForTests();
    const h = fresh();
    const r = await run("backup import", { path: file, offline: true, "all-keys": true }, OFFLINE, h);
    expect(r.data.restored).toBe(true);
    expect(leaks(r)).toBe(false);
    scanHome(h);
  });

  it("a name that holds a loaded key in a form only the opened key reveals is replaced, and storing it is refused", () => {
    registerSecret("not-hex-but-secret-1234");
    const file = { version: 2, backupDate: "2026-10-10T12:00:00Z", accounts: [{ address: JOINED, name: "mine not-hex-but-secret-1234 x", networks: [] }], LSP23CrossChainDeployment: [], secrets: { encrypted: false, data: [] } };
    const parsed = parseBackup(JSON.stringify(file)).backup!;
    expect(parsed.accounts[0].name).toContain("not-hex-but-secret"); // the shape alone cannot know it
    expect(() => assertNoKeyIn("the backup", parsed.accounts[0].name)).toThrow(/holds private key material/);
    expect(scrubPublicText(parsed)).toBe(1);
    expect(parsed.accounts[0].name).toBe(KEY_WITHHELD);
    expect(() => assertNoKeyIn("the backup", parsed.accounts[0].name)).not.toThrow();
  });
});

describe("an imported profile can be exported again at once (finding 6)", () => {
  it("all profiles, deployment data and joined profiles come back; the networks are marked as imported and unverified", async () => {
    const first = await run("backup export", {}, { approval: APPROVAL });
    const f1 = JSON.parse(readFileSync(first.data.path, "utf8"));
    const h = fresh();
    await run("backup import", { path: first.data.path, password: first.data.password, offline: true, "all-keys": true }, OFFLINE, h);
    const rec = JSON.parse(readFileSync(paths.profile(h, ma.profile), "utf8"));
    expect(rec.imported.chains).toEqual([{ chainId: 42, provenance: "imported, unverified", controllers: expect.arrayContaining([addr(A0)]) }]);
    expect(rec.deployment.deployments).toEqual({}); // no transaction history is invented

    const again = await run("backup export", {}, { approval: APPROVAL }, h);
    expect(again.data.profiles.sort()).toEqual([ma.profile, mb.profile, JOINED].sort());
    expect(again.data.keyCount).toBe(2);
    expect(again.warnings!.join(" ")).toContain("come from an imported backup and were not confirmed");
    const f2 = JSON.parse(readFileSync(again.data.path, "utf8"));
    expect(appReads(readFileSync(again.data.path, "utf8")).errors).toEqual([]);
    const shape = (f: any) => f.accounts.map((a: any) => [a.address, a.networks.map((n: any) => [n.chainID, n.controllers.map((c: any) => c.address).sort()])]).sort();
    expect(shape(f2)).toEqual(shape(f1));
    const items = (f: any) => f.LSP23CrossChainDeployment.map((l: any) => [l.profileAddress, l.initialChainID, l.deploymentCalldata]).sort();
    expect(items(f2)).toEqual(items(f1));
    expect((await decryptSecrets(f2.secrets.data, again.data.password, f2.secrets.iterations)).keys.map((k) => k.address).sort()).toEqual([addr(A0), addr(A1)].sort());
    // and that file imports once more
    const h2 = fresh();
    const third = await run("backup import", { path: again.data.path, password: again.data.password, offline: true, "all-keys": true }, OFFLINE, h2);
    expect(third.data.profilesResult.map((p: any) => p.address).sort()).toEqual([ma.profile, mb.profile, JOINED].sort());
  });

  it("an imported verification is never downgraded by a later offline import", async () => {
    const first = await run("backup export", {}, { approval: APPROVAL });
    const h = fresh();
    await run("backup import", { path: first.data.path, password: first.data.password, offline: true, "all-keys": true }, OFFLINE, h);
    const { updateProfileRecord } = await import("../../../src/core/profile-record.ts");
    await updateProfileRecord(h, ma.profile, (latest) => ({ imported: { ...latest.imported, chains: latest.imported.chains.map((c: any) => ({ ...c, provenance: "verified" })) } }));
    await run("backup import", { path: first.data.path, password: first.data.password, offline: true, "all-keys": true }, OFFLINE, h);
    expect(JSON.parse(readFileSync(paths.profile(h, ma.profile), "utf8")).imported.chains[0].provenance).toBe("verified");
  });
});

describe("a profile lists only its own controllers (finding 7)", () => {
  it("two profiles with disjoint keys: each file network names its own key; both keys are in the secrets", async () => {
    const r = await run("backup export", {}, { approval: APPROVAL });
    const f = JSON.parse(readFileSync(r.data.path, "utf8"));
    const controllersOf = (profile: Address) => f.accounts.find((a: any) => a.address === profile).networks.flatMap((n: any) => n.controllers.filter((c: any) => c.type !== "UniversalReceiver").map((c: any) => c.address));
    expect(new Set(controllersOf(ma.profile))).toEqual(new Set([addr(A0)]));
    expect(new Set(controllersOf(mb.profile))).toEqual(new Set([addr(A1)]));
    expect(new Set(controllersOf(JOINED))).toEqual(new Set([addr(A0)])); // the key that joined it
    const keyed = f.accounts.find((a: any) => a.address === mb.profile).networks[0].controllers.find((c: any) => c.address === addr(A1));
    expect(keyed).toMatchObject({ type: "Device", privateKeyIndex: expect.any(Number) });
    expect((await decryptSecrets(f.secrets.data, r.data.password, f.secrets.iterations)).keys.map((k) => k.address).sort()).toEqual([addr(A0), addr(A1)].sort());
  });

  it("restoring one profile restores its key only, with no edit of the file; --all-keys adds the rest", async () => {
    const r = await run("backup export", {}, { approval: APPROVAL });
    let h = fresh();
    const one = await run("backup import", { path: r.data.path, password: r.data.password, offline: true, profiles: [mb.profile] }, OFFLINE, h);
    expect(one.data.keysResult.map((k: any) => k.address)).toEqual([addr(A1)]);
    expect(await getBackend("memory").has(addr(A0))).toBe(false);
    h = fresh();
    const all = await run("backup import", { path: r.data.path, password: r.data.password, offline: true, profiles: [mb.profile], "all-keys": true }, OFFLINE, h);
    expect(all.data.keysResult.map((k: any) => k.address).sort()).toEqual([addr(A0), addr(A1)].sort());
  });
});

describe("backup list (finding 9)", () => {
  it("a file over the size limit is unusable and changed, never current, and a replacement is offered", async () => {
    const r = await run("backup export", {}, { approval: APPROVAL });
    expect((await run("backup list")).data.current).toBe(true);
    appendFileSync(r.data.path, Buffer.alloc(5 * 1024 * 1024));
    expect(statSync(r.data.path).size).toBeGreaterThan(5 * 1024 * 1024);
    const l = await run("backup list");
    expect(l.data.backups[0]).toMatchObject({ exists: true, oversized: true, changed: true });
    expect(l.data.current).toBe(false);
    expect(l.data.publicCurrent).toBe(false);
    expect(l.data.ask).toMatchObject({ kind: "keys" });
    expect(l.warnings!.join(" ")).toContain("larger than 5 MiB");
  });
});

describe("backup inspect (interop finding F2)", () => {
  it("a plain-key file gets no false orphan-deployment note; a real orphan is still flagged", async () => {
    const r = await run("backup export", { mode: "unencrypted", "explicit-consent": true }, { approval: APPROVAL });
    const i = await run("backup inspect", { path: r.data.path });
    expect(i.data.issues.filter((x: any) => x.code === "orphan-deployment")).toEqual([]);
    expect(i.data.valid).toBe(true);
    const f = JSON.parse(readFileSync(r.data.path, "utf8"));
    f.accounts = f.accounts.filter((a: any) => a.address !== ma.profile);
    const orphaned = await run("backup inspect", { path: writeTemp("orphan.json", f) });
    expect(orphaned.data.issues.filter((x: any) => x.code === "orphan-deployment")).toHaveLength(1);
  });
});

describe("the MCP server echoes no key-shaped identifier (pre-existing path)", () => {
  it("unknown tool, resource and method names are shortened", async () => {
    const bare = A0.slice(2);
    const calls: any[] = [
      { method: "tools/call", params: { name: `up_${bare}`, arguments: {} } },
      { method: "tools/call", params: { name: A0.toUpperCase(), arguments: {} } },
      { method: "resources/read", params: { uri: `up://references/${A0}` } },
      { method: A0 },
    ];
    for (const [i, c] of calls.entries()) {
      const res: any = await handleMcpMessage({ jsonrpc: "2.0", id: i + 1, ...c });
      expect(res.error, JSON.stringify(res)).toBeDefined();
      expect(leaks(res)).toBe(false);
      expect(JSON.stringify(res)).toContain("<hidden>");
    }
    const odd: any = await handleMcpMessage({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: { toString: () => A0 } } });
    expect(leaks(odd)).toBe(false);
  });
});
