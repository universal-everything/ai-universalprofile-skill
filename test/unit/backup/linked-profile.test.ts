// Second review, finding 5: a linked profile (the same profile at another address on one chain) keeps its
// controllers through a backup. `profile link` stores what it verified about the linked address, export and
// --refresh use the linked address itself, and the exported account imports as restorable. The network is mocked.
// Public Anvil test keys only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import "../../../src/verbs/index.ts";
import { createContext, preloadConfig } from "../../../src/core/context.ts";
import type { UpError } from "../../../src/core/errors.ts";
import { chainAddressesOf, linkEvidenceOf, readProfileRecord, updateProfileRecord } from "../../../src/core/profile-record.ts";
import { clearSecretsForTests } from "../../../src/core/secret-guard.ts";
import { coerceArgs, getVerb } from "../../../src/core/verbs.ts";
import { setBackendsForTests } from "../../../src/signer/index.ts";
import { resetMemoryBackend } from "../../../src/signer/memory.ts";
import { fakeManifest, seedHome } from "../../support/backup-fixtures.ts";

const net = vi.hoisted(() => ({ code: new Set<string>(), controllers: {} as Record<string, string[]>, permissions: 1n }));
const at = (chain: number, address: string) => `${chain}:${address.toLowerCase()}`;
vi.mock("../../../src/lsp/read.ts", async (original) => ({
  ...(await original<typeof import("../../../src/lsp/read.ts")>()),
  hasCode: async (_ctx: unknown, chainId: number, address: string) => net.code.has(at(chainId, address)),
}));
vi.mock("../../../src/lsp/profile.ts", async (original) => ({
  ...(await original<typeof import("../../../src/lsp/profile.ts")>()),
  supportsInterface: async () => true,
  resolveKeyManager: async () => ({ keyManager: "0x" + "cc".repeat(20), owner: "0x" + "cc".repeat(20), ownerKind: "key-manager" }),
  readControllerPermissions: async () => ({ permissions: { value: net.permissions } }),
  readControllers: async (_ctx: unknown, chainId: number, address: string) => ({ controllers: (net.controllers[at(chainId, address)] ?? []).map((a) => ({ address: a })) }),
}));

const A0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex; // public Anvil keys
const A1 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const addr = (k: Hex) => privateKeyToAddress(k);
const BASE = 8453;
const LINKED = getAddress("0x" + "77".repeat(20));
const LINKED2 = getAddress("0x" + "78".repeat(20));
const APPROVAL = "human: yes, link it and back it up";
const OFFLINE = { approval: "yes, restore it, offline please" };
const saved = { home: process.env.UP_HOME, eph: process.env.UP_TEST_EPHEMERAL_KEY };
let home: string;
let ma: ReturnType<typeof fakeManifest>;

async function run(name: string, raw: Record<string, unknown> = {}, flags: { approval?: string } = { approval: APPROVAL }, inHome = home) {
  process.env.UP_HOME = inHome;
  const ctx = createContext({ home: inHome, flags: { json: true, dryRun: false, yes: false, approval: flags.approval } });
  await preloadConfig(ctx);
  const v = getVerb(name)!;
  return (await v.run(ctx, coerceArgs(v, raw))) as { data: any; text?: string; warnings?: string[] };
}
const fail = async (p: Promise<unknown>) => ((await p.then(() => undefined, (e) => e)) as UpError);
const fileOf = (r: { data: { path: string } }) => JSON.parse(readFileSync(r.data.path, "utf8"));
const accountOf = (f: any, a: Address) => f.accounts.find((x: any) => x.address === a);
const fresh = () => {
  const h = mkdtempSync(join(tmpdir(), "up-linked-"));
  process.env.UP_HOME = h;
  resetMemoryBackend();
  return h;
};

beforeEach(async () => {
  net.code = new Set([at(BASE, LINKED), at(BASE, LINKED2)]);
  net.controllers = {};
  net.permissions = 1n;
  ma = fakeManifest({ controller: addr(A0), label: "linked", chainIds: [42] });
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

describe("profile link keeps what it verified", () => {
  it("stores the agent key as a verified controller of the linked address, per chain and per address", async () => {
    await run("profile link", { address: LINKED, chain: String(BASE) });
    const rec = await readProfileRecord(home, ma.profile);
    expect(chainAddressesOf(rec)).toEqual({ [String(BASE)]: LINKED });
    expect(rec.linkEvidence[String(BASE)]).toMatchObject({ address: LINKED, controllers: [addr(A0)] });
    expect(linkEvidenceOf(rec, BASE)).toEqual([addr(A0)]);
    expect(linkEvidenceOf(rec, 42)).toEqual([]);
  });

  it("a key that is not a controller there leaves no evidence; a re-link replaces it; an unlink removes it", async () => {
    net.permissions = 0n;
    await run("profile link", { address: LINKED, chain: String(BASE) });
    expect(linkEvidenceOf(await readProfileRecord(home, ma.profile), BASE)).toEqual([]);
    net.permissions = 1n;
    await run("profile link", { address: LINKED2, chain: String(BASE) });
    expect((await readProfileRecord(home, ma.profile)).linkEvidence[String(BASE)].address).toBe(LINKED2);
    // evidence is only valid for the address it was checked for
    await updateProfileRecord(home, ma.profile, (latest) => ({ chainAddresses: { ...latest.chainAddresses, [String(BASE)]: LINKED } }));
    expect(linkEvidenceOf(await readProfileRecord(home, ma.profile), BASE)).toEqual([]);
    await run("profile link", { address: LINKED2, chain: String(BASE) });
    await run("profile link", { unlink: true, chain: String(BASE) });
    expect((await readProfileRecord(home, ma.profile)).linkEvidence).toEqual({});
    expect(await fail(run("profile link", { address: LINKED, chain: String(BASE) }, {}))).toMatchObject({ code: "CONSENT_REQUIRED" });
  });
});

describe("a linked account exports with its controllers and imports as restorable", () => {
  it("export lists the verified controller (with its key) for the linked address; the file imports as restorable, online and offline", async () => {
    await run("profile link", { address: LINKED, chain: String(BASE) });
    const r = await run("backup export", {});
    const f = fileOf(r);
    const linked = accountOf(f, LINKED);
    expect(linked.networks).toHaveLength(1);
    expect(linked.networks[0]).toMatchObject({ chainID: BASE });
    expect(linked.networks[0].controllers).toEqual([expect.objectContaining({ address: addr(A0), type: "Device", privateKeyIndex: expect.any(Number) })]);
    // the identity keeps its own chain
    expect(accountOf(f, ma.profile).networks.map((n: any) => n.chainID)).toEqual([42]);

    const h = fresh();
    net.code.add(at(42, ma.profile));
    const online = await run("backup import", { path: r.data.path, password: r.data.password, "all-keys": true }, { approval: APPROVAL }, h);
    const verdicts = Object.fromEntries(online.data.profiles.map((p: any) => [p.address, p.verdict]));
    expect(verdicts[LINKED]).toBe("restorable");
    expect(online.data.skippedProfiles).toEqual([]);
    expect(online.data.profilesResult.map((p: any) => p.address)).toContain(LINKED);

    const h2 = fresh();
    const offline = await run("backup import", { path: r.data.path, password: r.data.password, offline: true }, OFFLINE, h2);
    expect(offline.data.skippedProfiles).toEqual([]);
    expect(offline.data.profiles.find((p: any) => p.address === LINKED)).toMatchObject({ restoring: true });
  });

  it("without the link evidence (a link made before it existed) --refresh reads the linked address itself", async () => {
    await updateProfileRecord(home, ma.profile, () => ({ chainAddresses: { [String(BASE)]: LINKED } }));
    const none = fileOf(await run("backup export", {}));
    expect(accountOf(none, LINKED).networks[0].controllers).toEqual([]); // nothing is known, nothing is invented

    net.controllers[at(BASE, LINKED)] = [addr(A1), "0x" + "99".repeat(20)];
    net.code.add(at(42, ma.profile));
    net.controllers[at(42, ma.profile)] = [addr(A0)];
    const r = await run("backup export", { refresh: true });
    const controllers = accountOf(fileOf(r), LINKED).networks[0].controllers;
    expect(controllers.map((c: any) => c.address).sort()).toEqual([addr(A1), getAddress("0x" + "99".repeat(20))].sort());
    expect(controllers.find((c: any) => c.address === addr(A1))).toMatchObject({ privateKeyIndex: expect.any(Number) });
    // the identity is unaffected
    expect(accountOf(fileOf(r), ma.profile).networks.map((n: any) => n.chainID)).toEqual([42]);

    // an unreachable linked address is a warning, not a failed export
    net.code.delete(at(BASE, LINKED));
    const quiet = await run("backup export", { refresh: true });
    expect(accountOf(fileOf(quiet), LINKED).networks[0].controllers).toEqual([]);
  });

  it("a status snapshot of ANOTHER address on that chain is not taken as the linked address's controller", async () => {
    await updateProfileRecord(home, ma.profile, () => ({
      chainAddresses: { [String(BASE)]: LINKED },
      status: { chains: { [String(BASE)]: { profile: ma.profile, controller: addr(A1), isController: true } } },
    }));
    expect(accountOf(fileOf(await run("backup export", {})), LINKED).networks[0].controllers).toEqual([]);
    await updateProfileRecord(home, ma.profile, () => ({ status: { chains: { [String(BASE)]: { profile: LINKED, controller: addr(A1), isController: true } } } }));
    expect(accountOf(fileOf(await run("backup export", {})), LINKED).networks[0].controllers.map((c: any) => c.address)).toEqual([addr(A1)]);
  });

  it("a newly linked controller makes an older backup stale", async () => {
    await run("backup export", {});
    expect((await run("backup list")).data.current).toBe(true);
    await run("profile link", { address: LINKED, chain: String(BASE) });
    expect((await run("backup list")).data.current).toBe(false);
  });
});
