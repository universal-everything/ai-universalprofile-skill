// LSP-30 backups against real chains (two in-process EVMs with the canonical LSP stack): two
// profiles with two keys are deployed, exported, and restored into a fresh machine; the restored
// deployment data replays to the same address on another chain; the app's anti-impersonation rules
// hold against a forged file, a revoked key and a profile that does not exist. Keys live only in the
// in-memory test key store (UP_TEST_EPHEMERAL_KEY): no OS key store is ever touched.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEther, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { getHarness, getSecondHarness, multiChainHome, type Harness } from "./harness.ts";
import { testContext, testSigner } from "../support/context.ts";
import { runVerb } from "../support/mock-relayer.ts";
import { appReads } from "../support/app-reader.ts";
import { fakeManifest } from "../support/backup-fixtures.ts";
import "../../src/verbs/index.ts";
import type { VerbContext } from "../../src/core/types.ts";
import { paths } from "../../src/core/home.ts";
import { clearSecretsForTests } from "../../src/core/secret-guard.ts";
import { ALL_PERMISSIONS_HEX } from "../../src/lsp/constants.ts";
import { deployFromManifest, manifestFromPlan, planDeployment, saveManifest, verifyManifest, type DeploymentManifest } from "../../src/lsp/lsp23.ts";
import { getBackend } from "../../src/signer/index.ts";
import { resetMemoryBackend } from "../../src/signer/memory.ts";

const APPROVAL = "human: yes, back it up";
const OFFLINE_APPROVAL = "human: yes, restore it";
const pk1 = generatePrivateKey(); // the agent's default key; first controller of profile 1
const pk2 = generatePrivateKey(); // a second key; first controller of profile 2
const pkHuman = generatePrivateKey(); // the human's wallet: co-owner of profile 3
const [key1, key2, human] = [pk1, pk2, pkHuman].map(privateKeyToAddress);
const keyHex = [pk1, pk2, pkHuman].map((k) => k.slice(2).toLowerCase());
const savedEph = process.env.UP_TEST_EPHEMERAL_KEY;

let hA: Harness;
let hB: Harness;
let A: number;
let B: number;
let home: string; // the original machine
let p1: DeploymentManifest;
let p2: DeploymentManifest;
let p3: DeploymentManifest; // key1 + the human as co-owner (the human later removes key1)
let encrypted: { path: string; password: string };

const noKeysIn = (v: unknown) => {
  const text = (typeof v === "string" ? v : JSON.stringify(v)).toLowerCase();
  for (const k of keyHex) expect(text, "a private key leaked").not.toContain(k);
};
/** A new machine: no keys in any key store, a home that knows both chains. */
const newMachine = (): { home: string; ctx: VerbContext } => {
  resetMemoryBackend();
  const h = multiChainHome([hA, hB]);
  return { home: h, ctx: testContext(h, undefined, { approval: OFFLINE_APPROVAL }) };
};
const clone = async (target: VerbContext, name: string, raw: Record<string, unknown>) => runVerb(target, name, raw);
/** The original machine's agent: a fresh context per call, like a new CLI run (it re-reads config.json). */
const orig = () => testContext(home, undefined, { approval: APPROVAL });

async function deploy(manifestHome: string, signerKey: Hex, inputs: { salt: Hex; controller: Address; extra?: { address: Address; permissions: Hex }[] }): Promise<DeploymentManifest> {
  const plan = planDeployment({ salt: inputs.salt, controller: inputs.controller, permissions: ALL_PERMISSIONS_HEX, preset: "agent-owner", extraControllers: inputs.extra });
  const m = manifestFromPlan({ salt: inputs.salt, controller: inputs.controller, permissions: ALL_PERMISSIONS_HEX, preset: "agent-owner", extraControllers: inputs.extra }, plan);
  await saveManifest(manifestHome, m);
  const dctx = testContext(manifestHome, testSigner(signerKey), { approval: "human: deploy" });
  await deployFromManifest(dctx, testSigner(signerKey), m, A);
  return m;
}

beforeAll(async () => {
  hA = await getHarness();
  hB = await getSecondHarness();
  A = hA.chainId;
  B = hB.chainId;
  process.env.UP_TEST_EPHEMERAL_KEY = "1";
  resetMemoryBackend();
  const mem = getBackend("memory");
  await mem.importKey!(pk1);
  await mem.importKey!(pk2);
  home = multiChainHome([hA, hB]);
  const now = new Date().toISOString();
  const cfg = JSON.parse(readFileSync(paths.config(home), "utf8"));
  writeFileSync(paths.config(home), JSON.stringify({ ...cfg, controller: { address: key1, backend: "memory", createdAt: now } }), { mode: 0o600 });
  // key2 is an additional key: listed in the recovery inventory and in candidates.json
  const { recordKey } = await import("../../src/signer/inventory.ts");
  await recordKey(home, { address: key1, backend: "memory" });
  await recordKey(home, { address: key2, backend: "memory" });
  writeFileSync(join(paths.keys(home), "candidates.json"), JSON.stringify([{ address: key2, backend: "memory", createdAt: now }]), { mode: 0o600 });
  for (const k of [key1, key2, human]) {
    await hA.fund(k, parseEther("10"));
    await hB.fund(k, parseEther("10"));
  }
  p1 = await deploy(home, pk1, { salt: ("0x" + "a1".repeat(32)) as Hex, controller: key1 });
  p2 = await deploy(home, pk2, { salt: ("0x" + "a2".repeat(32)) as Hex, controller: key2 });
  p3 = await deploy(home, pk1, { salt: ("0x" + "a3".repeat(32)) as Hex, controller: key1, extra: [{ address: human, permissions: ALL_PERMISSIONS_HEX }] });
  writeFileSync(paths.config(home), JSON.stringify({ ...JSON.parse(readFileSync(paths.config(home), "utf8")), defaultProfile: p1.profile }), { mode: 0o600 });
}, 240_000);

// the in-memory key store is one per process: every test starts on the original machine again
beforeEach(async () => {
  resetMemoryBackend();
  await getBackend("memory").importKey!(pk1);
  await getBackend("memory").importKey!(pk2);
});

afterAll(() => {
  clearSecretsForTests();
  if (savedEph === undefined) delete process.env.UP_TEST_EPHEMERAL_KEY;
  else process.env.UP_TEST_EPHEMERAL_KEY = savedEph;
});

describe("export from a machine with three deployed profiles and two keys", () => {
  it("writes one encrypted file for all profiles and both keys, in the app's format, without a key in the result", async () => {
    const r = await clone(orig(), "backup export", { refresh: true });
    noKeysIn(r);
    expect(r.data.profiles.sort()).toEqual([p1.profile, p2.profile, p3.profile].sort());
    expect(r.data.keys).toEqual([key1, key2]);
    expect(r.data.chains).toEqual([A]);
    expect(r.data.appCompatible).toBe(true);
    expect(r.warnings ?? []).toEqual([]);
    expect(appReads(readFileSync(r.data.path, "utf8")).errors).toEqual([]);
    const f = JSON.parse(readFileSync(r.data.path, "utf8"));
    // --refresh found the controllers on chain: profile 3's human co-owner is in the file with a name, no key
    const p3Controllers = f.accounts.find((a: any) => a.address === p3.profile).networks[0].controllers;
    expect(p3Controllers.find((c: any) => c.address === human)).toMatchObject({ type: "Device", name: expect.any(String) });
    expect(p3Controllers.find((c: any) => c.address === human).privateKeyIndex).toBeUndefined();
    encrypted = { path: r.data.path, password: r.data.password };
  });

  it("verify --online: each profile is controlled by a key from the file", async () => {
    const v = await clone(orig(), "backup verify", { path: encrypted.path, password: encrypted.password, online: true });
    expect(v.data.profiles.map((p: any) => [p.address, p.decision.verdict]).sort()).toEqual([[p1.profile, "restorable"], [p2.profile, "restorable"], [p3.profile, "restorable"]].sort());
    expect(v.data.profiles[0].decision.chains).toEqual([{ chainId: A, status: "controls" }]);
    noKeysIn(v);
  });
});

describe("import into a fresh machine (online checks)", () => {
  it("restores keys, profiles and deployment data; the manifests verify and replay to the same address on another chain", async () => {
    const m = newMachine();
    const r = await clone(m.ctx, "backup import", { path: encrypted.path, password: encrypted.password });
    noKeysIn(r);
    expect(r.data.restored).toBe(true);
    expect(r.data.checkedOnNetwork).toBe(true);
    expect(r.data.profilesResult.map((p: any) => [p.address, p.manifest]).sort()).toEqual([[p1.profile, "restored"], [p2.profile, "restored"], [p3.profile, "restored"]].sort());
    expect(r.data.keysResult.map((k: any) => k.status)).toEqual(["restored", "restored"]);
    expect(await getBackend("memory").has(key1)).toBe(true);
    expect(await getBackend("memory").has(key2)).toBe(true);
    expect(r.warnings ?? []).toEqual([]);
    for (const orig of [p1, p2, p3]) {
      const rec = JSON.parse(readFileSync(paths.profile(m.home, orig.profile), "utf8"));
      expect(verifyManifest(rec.deployment).ok).toBe(true);
      expect(rec.deployment.plan).toEqual(orig.plan);
      expect(rec.deployment.deployCalldata).toBe(orig.deployCalldata);
      expect(rec.imported.restoredKeys.sort()).toEqual([key1, key2].sort());
    }
    // the machine works as the agent again: key1 is the active key, key2 an additional one
    const cfg = JSON.parse(readFileSync(paths.config(m.home), "utf8"));
    expect(cfg.controller.address).toBe(key1);
    const k = await clone(m.ctx, "key address", {});
    expect(k.data.address).toBe(key1);
    expect(k.data.otherKeys.map((o: any) => o.address)).toEqual([key2]);
    expect((await m.ctx.signer(A)).address).toBe(key1);
    // replay the restored deployment on the second chain: the same address
    const dep = await clone(m.ctx, "account deploy", { chain: String(B), profile: p1.profile });
    expect(dep.data.status).toBe("deployed");
    expect(dep.data.profile).toBe(p1.profile);
    expect(await hB.request("eth_getCode", [p1.profile, "latest"])).not.toBe("0x");
    // and the restored machine's own backup is current for its keys and profiles
    const list = await clone(m.ctx, "backup list", {});
    expect(list.data.keys.sort()).toEqual([key1, key2].sort());
  });

  it("a second import on the same machine changes nothing but the import note", async () => {
    const m = newMachine();
    await clone(m.ctx, "backup import", { path: encrypted.path, password: encrypted.password });
    const again = await clone(m.ctx, "backup import", { path: encrypted.path, password: encrypted.password });
    expect(again.data.keysResult.map((k: any) => k.status)).toEqual(["exists", "exists"]);
    expect(again.data.profilesResult.map((p: any) => p.manifest)).toEqual(["kept-existing", "kept-existing", "kept-existing"]);
  });
});

describe("anti-impersonation (the app's restore rules)", () => {
  it("a key that was revoked on chain: restorable only because the file proves it created the profile", async () => {
    // the human (co-owner of profile 3) removes the agent's key from profile 3 on chain A
    const humanCtx = testContext(home, testSigner(pkHuman), { approval: "human: remove the agent's key", profile: p3.profile } as any);
    const rm = await runVerb(humanCtx, "controller remove", { address: key1, chain: String(A), profile: p3.profile });
    expect(rm.data.status).toBe("success");
    const exported = await clone(orig(), "backup export", { "generate-password": true });
    const m = newMachine();
    const r = await clone(m.ctx, "backup import", { path: exported.data.path, password: exported.data.password, profiles: [p3.profile] });
    expect(r.data.restored).toBe(true);
    expect(r.data.profiles).toEqual([expect.objectContaining({ address: p3.profile, verdict: "restorable-with-warning", restoring: true })]);
    expect(r.warnings!.join(" ")).toContain("no longer has permissions");
    // the profiles whose keys still control them are plain "restorable"
    const v = await clone(orig(), "backup verify", { path: exported.data.path, password: exported.data.password, online: true });
    expect(v.data.profiles.find((p: any) => p.address === p1.profile).decision.verdict).toBe("restorable");
    expect(v.data.profiles.find((p: any) => p.address === p3.profile).decision.chains[0]).toMatchObject({ status: "restorable-with-warning" });
  });

  it("a forged file that names a real profile with someone else's keys and deployment data is blocked", async () => {
    const attacker = generatePrivateKey();
    const bogus = fakeManifest({ controller: privateKeyToAddress(attacker), label: "attacker", chainIds: [A] });
    const aHome = multiChainHome([hA]);
    await getBackend("memory").importKey!(attacker);
    const { recordKey } = await import("../../src/signer/inventory.ts");
    await recordKey(aHome, { address: privateKeyToAddress(attacker), backend: "memory" });
    const cfg = JSON.parse(readFileSync(paths.config(aHome), "utf8"));
    writeFileSync(paths.config(aHome), JSON.stringify({ ...cfg, controller: { address: privateKeyToAddress(attacker), backend: "memory", createdAt: "x" }, defaultProfile: bogus.profile }));
    const { updateProfileRecord } = await import("../../src/core/profile-record.ts");
    await updateProfileRecord(aHome, bogus.profile, () => ({ deployment: bogus }));
    const actx = testContext(aHome, undefined, { approval: APPROVAL });
    const made = await clone(actx, "backup export", { mode: "unencrypted", "explicit-consent": true });
    const f = JSON.parse(readFileSync(made.data.path, "utf8"));
    f.accounts[0].address = p1.profile; // the victim: a real profile on chain A
    f.LSP23CrossChainDeployment[0].profileAddress = p1.profile;
    const forged = join(mkdtempSync(join(tmpdir(), "up-forged-")), "forged.json");
    writeFileSync(forged, JSON.stringify(f, undefined, 2));

    const insp = await clone(actx, "backup inspect", { path: forged });
    expect(insp.data.issues).toContainEqual(expect.objectContaining({ code: "profile-mismatch", level: "error" }));

    const m = newMachine();
    const r = await clone(m.ctx, "backup import", { path: forged });
    expect(r.data.restored).toBe(false);
    expect(r.data.profiles).toEqual([expect.objectContaining({ address: p1.profile, verdict: "impersonation-blocked", restoring: false })]);
    expect(r.text).toMatch(/Nothing was restored/);
    expect(await getBackend("memory").has(privateKeyToAddress(attacker))).toBe(false);
    expect(() => readFileSync(paths.profile(m.home, p1.profile))).toThrow();
  });

  it("no key of the file controls the profile and none is listed: refused; a profile that is not deployed anywhere: skipped", async () => {
    const f = JSON.parse(readFileSync(encrypted.path.replace(/universal-profiles-backup/, "universal-profiles-backup"), "utf8"));
    // the same file with every controller entry stripped of its key index and listed address, for profile 1 only
    const lone = { ...f, accounts: [{ ...f.accounts.find((a: any) => a.address === p1.profile), networks: [{ chainID: A, name: "x", controllers: [{ address: human, type: "Device", name: "Someone else" }] }] }], LSP23CrossChainDeployment: [] };
    const file = join(mkdtempSync(join(tmpdir(), "up-nokey-")), "nokey.json");
    writeFileSync(file, JSON.stringify(lone, undefined, 2));
    let m = newMachine();
    const r = await clone(m.ctx, "backup import", { path: file, password: encrypted.password });
    expect(r.data.profiles).toEqual([expect.objectContaining({ address: p1.profile, verdict: "no-controlling-key", restoring: false })]);
    // a profile in the file that was never deployed on a chain the machine can check
    const ghost = fakeManifest({ controller: key1, label: "never-deployed", chainIds: [A] });
    const gf = JSON.parse(JSON.stringify(f));
    gf.accounts = [{ ...f.accounts[0], address: ghost.profile }];
    gf.LSP23CrossChainDeployment = [];
    const gfile = join(mkdtempSync(join(tmpdir(), "up-ghost-")), "ghost.json");
    writeFileSync(gfile, JSON.stringify(gf, undefined, 2));
    m = newMachine();
    const g = await clone(m.ctx, "backup import", { path: gfile, password: encrypted.password });
    expect(g.data.profiles).toEqual([expect.objectContaining({ address: ghost.profile, verdict: "not-deployed", restoring: false })]);
    expect(g.data.restored).toBe(false);
  });
});

describe("unencrypted and public files", () => {
  it("unencrypted: restores without a password; the file is plain and the result says so", async () => {
    const made = await clone(orig(), "backup export", { mode: "unencrypted", "explicit-consent": true });
    noKeysIn(made);
    expect(made.warnings!.join(" ")).toContain("UNENCRYPTED");
    expect(JSON.parse(readFileSync(made.data.path, "utf8")).secrets.data.map((e: any) => e.secret)).toEqual([pk1, pk2]);
    const m = newMachine();
    const r = await clone(m.ctx, "backup import", { path: made.data.path });
    noKeysIn(r);
    expect(r.data.keysResult.map((k: any) => k.status)).toEqual(["restored", "restored"]);
    expect(await getBackend("memory").has(key2)).toBe(true);
  });

  it("public: no keys at all; restores the profile records on a machine that still has the agent's key", async () => {
    const made = await clone(orig(), "backup export", { mode: "public" });
    const f = JSON.parse(readFileSync(made.data.path, "utf8"));
    expect(f.secrets).toEqual({ encrypted: false, data: [] });
    expect(made.data.keys).toEqual([]);
    expect(JSON.stringify(f).toLowerCase()).not.toMatch(new RegExp(keyHex.join("|")));
    resetMemoryBackend();
    await getBackend("memory").importKey!(pk1); // the agent's key survived, the records did not
    const h = multiChainHome([hA, hB]);
    const mctx = testContext(h, undefined, { approval: OFFLINE_APPROVAL });
    writeFileSync(paths.config(h), JSON.stringify({ version: 1, defaultChain: A, chains: [A], controller: { address: key1, backend: "memory", createdAt: "x" } }));
    const r = await clone(mctx, "backup import", { path: made.data.path });
    expect(r.data.keysResult).toEqual([]);
    // profiles 1 and 3 were created by key1: restored; profile 2 was created by key2, which this machine does not hold (key1 does not control it)
    expect(r.data.profilesResult.map((p: any) => p.address).sort()).toEqual([p1.profile, p3.profile].sort());
    expect(r.data.skippedProfiles.map((p: any) => [p.address, p.verdict])).toEqual([[p2.profile, "impersonation-blocked"]]);
    expect(verifyManifest(JSON.parse(readFileSync(paths.profile(h, p1.profile), "utf8")).deployment).ok).toBe(true);
  });
});
