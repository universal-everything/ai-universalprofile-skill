// Findings of the second independent security review of the backup feature (the re-review of the fixes):
//  1. decodedPermissions property names of a file reach no output (known LSP6 names only, the rest is counted)
//  2. a manifest or profile record is checked as a whole for key material before any write
//  4. an undefined permission bit (31) is no deployment proof
//  6. export public fields (alias, hint, destination) are validated before consent and persistence
//  9. the freshness fingerprint covers networks and controllers
// (3 and 4 on the network are in restore-decisions.test.ts, 5 in linked-profile.test.ts, 7 and 8 in writer-recovery.test.ts.)
// Public Anvil test keys only.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Address, Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import "../../../src/verbs/index.ts";
import { collectState, fingerprints } from "../../../src/backup/build.ts";
import { decodeDeployment, hasDefinedPermission, permissionMismatch } from "../../../src/backup/lsp23-decode.ts";
import { parseBackup } from "../../../src/backup/lsp30-format.ts";
import { analyseAccounts, openBackup, writeProfileRecords } from "../../../src/backup/restore.ts";
import { createContext, preloadConfig } from "../../../src/core/context.ts";
import type { UpError } from "../../../src/core/errors.ts";
import { paths } from "../../../src/core/home.ts";
import { renderResult } from "../../../src/core/output.ts";
import { readProfileRecord, updateProfileRecord } from "../../../src/core/profile-record.ts";
import { assertNoKeyMaterial, holdsKeyMaterial } from "../../../src/core/public-record.ts";
import { clearSecretsForTests, registerSecret } from "../../../src/core/secret-guard.ts";
import { coerceArgs, getVerb } from "../../../src/core/verbs.ts";
import { DATA_KEYS } from "../../../src/lsp/constants.ts";
import { getBackend, setBackendsForTests } from "../../../src/signer/index.ts";
import { resetMemoryBackend } from "../../../src/signer/memory.ts";
import { editedDeployment, fakeManifest, seedHome } from "../../support/backup-fixtures.ts";

const A0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex; // public Anvil keys
const A1 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const KEYS = [A0, A1];
const addr = (k: Hex) => privateKeyToAddress(k);
const APPROVAL = "human: yes, back it up";
const OFFLINE = { approval: "yes, restore it, offline please" };
const saved = { home: process.env.UP_HOME, eph: process.env.UP_TEST_EPHEMERAL_KEY };

let home: string;
let ma: ReturnType<typeof fakeManifest>;

async function run(name: string, raw: Record<string, unknown> = {}, flags: { approval?: string; dryRun?: boolean } = {}, inHome = home) {
  process.env.UP_HOME = inHome;
  const ctx = createContext({ home: inHome, flags: { json: true, dryRun: flags.dryRun === true, yes: false, approval: flags.approval } });
  await preloadConfig(ctx);
  const v = getVerb(name)!;
  return (await v.run(ctx, coerceArgs(v, raw))) as { data: any; text?: string; warnings?: string[] };
}
const fail = async (p: Promise<unknown>) => ((await p.then(() => undefined, (e) => e)) as UpError);
const leaks = (v: unknown): boolean => {
  const text = typeof v === "string" ? v : JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
  const squashed = text.toLowerCase().replace(/[^0-9a-z]/g, "");
  return KEYS.some((k) => squashed.includes(k.slice(2)));
};
const filesUnder = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)])) : []);
const scanHome = (h: string) => {
  for (const f of filesUnder(h)) expect(leaks(readFileSync(f, "utf8")), `a key was written to ${f}`).toBe(false);
};
const fresh = () => {
  const h = mkdtempSync(join(tmpdir(), "up-rev2-"));
  process.env.UP_HOME = h;
  resetMemoryBackend();
  return h;
};
const writeTemp = (name: string, data: unknown) => {
  const file = join(mkdtempSync(join(tmpdir(), "up-rev2-file-")), name);
  writeFileSync(file, JSON.stringify(data, undefined, 2));
  return file;
};

beforeEach(async () => {
  ma = fakeManifest({ controller: addr(A0), label: "rev2-a", chainIds: [42] });
  home = await seedHome({ keys: [A0, A1], candidates: [1], manifests: [ma] });
});
afterEach(() => {
  clearSecretsForTests();
  setBackendsForTests();
  for (const [k, v] of [["UP_HOME", saved.home], ["UP_TEST_EPHEMERAL_KEY", saved.eph]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("decodedPermissions property names (finding 1)", () => {
  const crafted = (f: any) => {
    for (const it of f.LSP23CrossChainDeployment) for (const c of it.initialControllers) c.addressPermissions.decodedPermissions = { [A0]: true, [A1.slice(2).toUpperCase()]: true, [A1.slice(2).match(/.{8}/g)!.join(" ")]: true, "made up": true, CALL: false, SETDATA: true };
    return f;
  };

  it("permissionMismatch names only known permissions and counts the rest", () => {
    const p = "0x" + "00".repeat(32);
    const notes = permissionMismatch({ permissions: p as Hex, decodedPermissions: { [A0]: true, "made up": true, CHANGEOWNER: false } });
    expect(notes).toEqual(["2 unrecognised permission names (not shown)"]);
    expect(permissionMismatch({ permissions: p as Hex, decodedPermissions: { x: false } })).toEqual(["1 unrecognised permission name (not shown)"]);
    expect(JSON.stringify(notes)).not.toContain(A0.slice(2));
  });

  it("an encrypted file: inspect (keys not opened) and verify show no name; import writes none", async () => {
    const r = await run("backup export", {}, { approval: APPROVAL });
    const file = writeTemp("crafted.json", crafted(JSON.parse(readFileSync(r.data.path, "utf8"))));
    clearSecretsForTests();
    const parsed = parseBackup(readFileSync(file, "utf8")).backup!;
    const dp = parsed.lsp23[0].initialControllers[0].addressPermissions;
    expect(Object.keys(dp.decodedPermissions!).sort()).toEqual(["CALL", "SETDATA"]);
    expect(dp.unrecognisedNames).toBe(4);
    const i = await run("backup inspect", { path: file });
    expect(leaks(i)).toBe(false);
    expect(leaks(renderResult("backup inspect", i, true))).toBe(false);
    expect(i.data.issues.some((x: any) => x.code === "decoded-permissions" && /4 unrecognised permission names \(not shown\)/.test(x.message))).toBe(true);
    const v = await run("backup verify", { path: file, password: r.data.password });
    expect(leaks(v)).toBe(false);
    clearSecretsForTests();
    const h = fresh();
    const imp = await run("backup import", { path: file, password: r.data.password, offline: true, "all-keys": true }, OFFLINE, h);
    expect(imp.data.restored).toBe(true);
    expect(leaks(imp)).toBe(false);
    expect(leaks(renderResult("backup import", imp, true))).toBe(false);
    scanHome(h);
  });

  it("a plain-text file: the keys are loaded, and still no name reaches any output", async () => {
    const r = await run("backup export", { mode: "unencrypted", "explicit-consent": true }, { approval: APPROVAL });
    const file = writeTemp("crafted-plain.json", crafted(JSON.parse(readFileSync(r.data.path, "utf8"))));
    clearSecretsForTests();
    const i = await run("backup inspect", { path: file });
    expect(leaks(i)).toBe(false);
    expect(leaks(renderResult("backup inspect", i, true))).toBe(false);
    expect(leaks(await run("backup verify", { path: file }))).toBe(false);
  });
});

describe("a deployment needs a DEFINED permission bit to prove anything (finding 4)", () => {
  it("bit 31 alone is no permission; a defined bit is; the 4337 bit counts", () => {
    expect(hasDefinedPermission(1n << 31n)).toBe(false);
    expect(hasDefinedPermission(0xff000000n)).toBe(false);
    expect(hasDefinedPermission((1n << 31n) | 1n)).toBe(true);
    expect(hasDefinedPermission(1n << 23n)).toBe(true);
    expect(hasDefinedPermission(0n)).toBe(false);
  });

  it("the decoder marks a controller whose only bit is 31 as without permissions, and no manifest is rebuilt", () => {
    const e = editedDeployment(ma, (k, v) => {
      const i = k.findIndex((x) => x.toLowerCase() === (DATA_KEYS.AddressPermissionsPermissionsPrefix + addr(A0).slice(2)).toLowerCase());
      v[i] = `0x${"00".repeat(28)}80000000`;
      return [k, v];
    });
    const d = decodeDeployment({ profileAddress: e.profile, factoryAddress: ma.plan.factory, deploymentCalldata: e.calldata });
    const c = d.initialControllers.find((x) => x.address === addr(A0))!;
    expect(c).toMatchObject({ permissionsValid: true, hasPermissions: false });
  });
});

describe("a profile record is checked as a whole before it is stored (finding 2)", () => {
  /** The analysis of the unencrypted file's profile; opening the file registers both keys. */
  async function analysisOfPlainFile() {
    const r = await run("backup export", { mode: "unencrypted", "explicit-consent": true }, { approval: APPROVAL });
    const opened = await openBackup(readFileSync(r.data.path, "utf8"), undefined);
    const x = analyseAccounts(opened, new Set())[0];
    return { x, manifest: x.items[0].manifest! };
  }
  const info = { file: "/tmp/b.json", sha256: "ab".repeat(32), backupDate: "2026-10-10T12:00:00Z", restoredKeys: [] as Address[], skippedKeys: [] as Address[] };

  for (const field of ["lsp3", "deployCalldata", "dataValues", "salt", "name"] as const) {
    it(`a loaded key in the manifest's ${field} is refused and nothing is stored`, async () => {
      const { x, manifest } = await analysisOfPlainFile();
      const h = fresh();
      const bad: any = JSON.parse(JSON.stringify(manifest));
      const key = A0.slice(2);
      if (field === "lsp3") bad.lsp3 = `0x${key}`;
      else if (field === "deployCalldata") bad.deployCalldata = `${bad.deployCalldata}${key}`;
      else if (field === "dataValues") bad.plan.dataValues = [...bad.plan.dataValues, `0x${key}`];
      else if (field === "salt") bad.salt = `0x${key}`;
      else bad.label = `my ${key}`;
      const ctx = createContext({ home: h, flags: { json: true, dryRun: false, yes: false, approval: undefined } });
      const e = await fail(writeProfileRecords(ctx, [{ analysis: x, manifest: bad }], info));
      if (field === "deployCalldata") {
        // calldata that was extended no longer re-derives the profile: such a manifest is never stored at all
        expect(e).toBeUndefined();
        expect((await readProfileRecord(h, x.account.address)).deployment).toBeUndefined();
      } else {
        expect(e?.message).toMatch(/private key material/);
        expect(leaks(e.toJSON())).toBe(false);
        expect((await readProfileRecord(h, x.account.address)).deployment).toBeUndefined();
      }
      scanHome(h);
    });
  }

  it("the same through the verb: a file whose LSP3 data value holds a loaded key is rejected before anything is restored", async () => {
    const r = await run("backup export", { mode: "unencrypted", "explicit-consent": true }, { approval: APPROVAL });
    const f = JSON.parse(readFileSync(r.data.path, "utf8"));
    const e = editedDeployment(ma, (k, v) => [[...k, DATA_KEYS.LSP3Profile as Hex], [...v, `0x${A0.slice(2)}` as Hex]]);
    f.LSP23CrossChainDeployment[0].deploymentCalldata = e.calldata;
    f.LSP23CrossChainDeployment[0].profileAddress = e.profile;
    f.accounts[0].address = e.profile;
    const file = writeTemp("lsp3-key.json", f);
    clearSecretsForTests();
    const h = fresh();
    const err = await fail(run("backup import", { path: file, offline: true, "all-keys": true }, OFFLINE, h));
    expect(err?.message).toMatch(/private key material/);
    expect(leaks(err.toJSON())).toBe(false);
    expect(await getBackend("memory").has(addr(A0))).toBe(false); // no key was restored either
    expect(existsSync(paths.audit(h))).toBe(false);
    scanHome(h);
  });

  it("the state writers refuse a loaded key whatever the caller: profile record, audit line, index line", async () => {
    registerSecret(A0);
    const e1 = await fail(updateProfileRecord(home, addr(A1), () => ({ note: `x ${A0.slice(2)}` })));
    expect(e1?.message).toMatch(/refusing to write/);
    expect(leaks(e1.toJSON())).toBe(false);
    const { appendIndex } = await import("../../../src/backup/store.ts");
    const e2 = await fail(appendIndex(home, { at: "x", event: "asked", kind: A0 }));
    expect(e2?.message).toMatch(/private key material/);
    expect(existsSync(join(paths.backups(home), "index.jsonl"))).toBe(false);
  });

  it("the scan: hex data is only checked against loaded keys, text also for its shape, object keys too", () => {
    const hexData = { deployCalldata: `0x${"ab".repeat(40)}`, sha256: "cd".repeat(32), dataKeys: [`0x${"12".repeat(32)}`] };
    expect(holdsKeyMaterial(hexData)).toBe(false); // 64 hex digits of data are normal
    expect(holdsKeyMaterial({ name: "ef".repeat(32) })).toBe(true); // in a name they are a key
    expect(holdsKeyMaterial({ [A0]: true })).toBe(true);
    expect(holdsKeyMaterial([{ a: { b: ["x", "y 0x" + A1.slice(2)] } }])).toBe(true);
    registerSecret(A0);
    expect(holdsKeyMaterial({ sha256: A0.slice(2) })).toBe(true); // a loaded key is never data
    expect(holdsKeyMaterial({ calldata: `0x11${A0.slice(2)}22` })).toBe(true);
    expect(() => assertNoKeyMaterial("the thing", { x: A0 })).toThrow(/the thing holds private key material/);
    try {
      assertNoKeyMaterial("the thing", { x: A0 });
    } catch (e) {
      expect(leaks((e as UpError).toJSON())).toBe(false);
    }
  });
});

describe("export refuses key material in its public fields before consent and persistence (finding 6)", () => {
  const nothingPersisted = (h: string) => {
    expect(existsSync(paths.audit(h))).toBe(false);
    expect(existsSync(join(paths.backups(h), "index.jsonl"))).toBe(false);
    expect(existsSync(paths.backups(h)) ? readdirSync(paths.backups(h)).filter((f) => f.endsWith(".json")) : []).toEqual([]);
  };

  it("an alias, a hint and a destination with a key (loaded or only key-shaped, bare, upper case, spread out)", async () => {
    registerSecret(A0); // loaded
    registerSecret("not-hex-but-secret-1234");
    const variants = [A0, A1.slice(2).toUpperCase(), A1.slice(2).match(/.{8}/g)!.join(" "), "mine not-hex-but-secret-1234"];
    for (const [i, v] of variants.entries()) {
      // alias
      let h = await seedHome({ keys: [A0, A1], manifests: [fakeManifest({ controller: addr(A0), label: `alias-${i}`, chainIds: [42] })], extraConfig: { aliases: { [v]: fakeManifest({ controller: addr(A0), label: `alias-${i}`, chainIds: [42] }).profile } } });
      let e = await fail(run("backup export", {}, { approval: APPROVAL }, h));
      expect(e?.message, `alias ${i}`).toMatch(/private key material/);
      expect(leaks(e.toJSON())).toBe(false);
      expect(JSON.stringify(e.toJSON())).not.toContain("not-hex-but-secret");
      nothingPersisted(h);
      // hint
      h = await seedHome({ keys: [A0, A1], manifests: [ma] });
      e = await fail(run("backup export", { hint: `the ${v} one` }, { approval: APPROVAL }, h));
      expect(e?.message, `hint ${i}`).toMatch(/private key material/);
      expect(leaks(e.toJSON())).toBe(false);
      expect(JSON.stringify(e.toJSON())).not.toContain("not-hex-but-secret");
      nothingPersisted(h);
      // destination
      const dir = mkdtempSync(join(tmpdir(), "up-rev2-dest-"));
      e = await fail(run("backup export", { path: join(dir, `${v.replace(/ /g, "_")}.json`) }, { approval: APPROVAL }, h));
      expect(e?.message, `path ${i}`).toMatch(/private key material/);
      expect(leaks(e.toJSON())).toBe(false);
      expect(readdirSync(dir)).toEqual([]);
      nothingPersisted(h);
    }
  });

  it("a dry run and a public export refuse them too; clean fields still export", async () => {
    const h = await seedHome({ keys: [A0, A1], manifests: [ma], extraConfig: { aliases: { [`agent ${A0}`]: ma.profile } } });
    expect((await fail(run("backup export", { mode: "public" }, {}, h)))?.message).toMatch(/private key material/);
    expect((await fail(run("backup export", {}, { approval: APPROVAL, dryRun: true }, h)))?.message).toMatch(/private key material/);
    const ok = await seedHome({ keys: [A0, A1], manifests: [ma], extraConfig: { aliases: { "my agent": ma.profile } } });
    const r = await run("backup export", { hint: "the usual one" }, { approval: APPROVAL }, ok);
    expect(r.data.indexed).toBe(true);
    expect(JSON.parse(readFileSync(r.data.path, "utf8")).accounts[0].name).toBe("my agent");
  });
});

describe("the freshness fingerprint covers networks and controllers (finding 9)", () => {
  it("a retained network or controller changes the fingerprint and an older backup stops being current", async () => {
    const r = await run("backup export", {}, { approval: APPROVAL });
    expect((await run("backup list")).data.current).toBe(true);
    const before = fingerprints(await collectState(createContext({ home, flags: { json: true, dryRun: false, yes: false, approval: undefined } })));

    // a network kept from an import
    await updateProfileRecord(home, ma.profile, () => ({ imported: { chains: [{ chainId: 8453, provenance: "imported, unverified", controllers: [] }] } }));
    const withNetwork = await run("backup list");
    expect(withNetwork.data.backups[0].covers).toMatchObject({ keys: false, profiles: false });
    expect(withNetwork.data.current).toBe(false);

    // a controller kept for a network
    await updateProfileRecord(home, ma.profile, () => ({ imported: { chains: [{ chainId: 42, provenance: "imported, unverified", controllers: [addr(A1)] }] } }));
    const state = await collectState(createContext({ home, flags: { json: true, dryRun: false, yes: false, approval: undefined } }));
    const fp = fingerprints(state);
    expect(fp.full).not.toBe(before.full);
    expect(fp.profiles).not.toBe(before.profiles);
    expect((await run("backup list")).data.current).toBe(false);

    // the same state in a different order is the same fingerprint
    const shuffled = { ...state, profiles: state.profiles.map((p) => ({ ...p, chainIds: [...p.chainIds].reverse(), controllers: Object.fromEntries(Object.entries(p.controllers).map(([c, l]) => [c, [...l].reverse()])) })) };
    expect(fingerprints(shuffled).full).toBe(fp.full);

    // a fresh export covers the new state again
    await run("backup export", {}, { approval: APPROVAL });
    expect((await run("backup list")).data.current).toBe(true);
    expect(r.data.path).toBeTruthy();
  });
});
