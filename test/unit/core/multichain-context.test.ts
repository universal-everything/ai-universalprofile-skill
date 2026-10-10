// One profile, many chains — config and context: which key signs on which chain, and which
// address the profile has on which chain. Old configs (no chainControllers, no links) must
// behave exactly as before.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createContext } from "../../../src/core/context.ts";
import { chainAddressesOf, profileAddressOn, readProfileRecord, writeProfileRecord } from "../../../src/core/profile-record.ts";
import type { UpConfig } from "../../../src/core/types.ts";
import { getBackend, loadSignerFromConfig } from "../../../src/signer/index.ts";
import { resetMemoryBackend } from "../../../src/signer/memory.ts";
import { chainControllerList, controllerFor, localControllers } from "../../../src/signer/select.ts";
import { controllerAddress, defaultControllerAddress } from "../../../src/exec/verbs.ts";

const ID = getAddress("0x1111111111111111111111111111111111111111");
const ON_BASE = getAddress("0x4444444444444444444444444444444444444444");
const OTHER = getAddress("0x5555555555555555555555555555555555555555");
const D = { address: getAddress("0x2222222222222222222222222222222222222222"), backend: "memory", createdAt: "t0" };
const C = { address: getAddress("0x3333333333333333333333333333333333333333"), backend: "memory", createdAt: "t1" };

function homeWith(cfg: Partial<UpConfig>): string {
  const home = mkdtempSync(join(tmpdir(), "up-mc-"));
  writeFileSync(join(home, "config.json"), JSON.stringify({ version: 1, ...cfg }));
  return home;
}

describe("controllerFor: the key used on a chain", () => {
  it("old config: the single controller everywhere", () => {
    const cfg: UpConfig = { version: 1, controller: D };
    expect(controllerFor(cfg)).toEqual({ ...D, scope: "default" });
    expect(controllerFor(cfg, 8453)).toEqual({ ...D, scope: "default" });
    expect(chainControllerList(cfg)).toEqual([]);
    expect(controllerFor({ version: 1 })).toBeUndefined();
  });

  it("a chain with its own key uses it; every other chain the default", () => {
    const cfg: UpConfig = { version: 1, controller: D, chainControllers: { "8453": C } };
    expect(controllerFor(cfg, 8453)).toEqual({ ...C, scope: "chain", chainId: 8453 });
    expect(controllerFor(cfg, 42)).toEqual({ ...D, scope: "default" });
    expect(controllerFor(cfg)).toEqual({ ...D, scope: "default" });
    // a chain key works even before a default key exists
    expect(controllerFor({ version: 1, chainControllers: { "8453": C } }, 8453)?.address).toBe(C.address);
  });

  it("lists and groups local keys; rejects a broken entry with NO_SIGNER", () => {
    const cfg: UpConfig = { version: 1, controller: D, chainControllers: { "8453": C, "1": C, "42161": { ...D } } };
    expect(chainControllerList(cfg).map((c) => c.chainId)).toEqual([1, 8453, 42161]);
    expect(localControllers(cfg)).toEqual([
      { address: D.address, backend: "memory", default: true, chains: [42161] },
      { address: C.address, backend: "memory", default: false, chains: [1, 8453] },
    ]);
    expect(() => controllerFor({ version: 1, chainControllers: { "10": { address: "0xnope" as any, backend: "memory", createdAt: "x" } } }, 10)).toThrow(/not a valid controller entry/);
  });
});

describe("signer selection by chain (memory backend, real context)", () => {
  const saved = process.env.UP_TEST_EPHEMERAL_KEY;
  const pkD = generatePrivateKey();
  const pkC = generatePrivateKey();
  const kD = privateKeyToAccount(pkD).address;
  const kC = privateKeyToAccount(pkC).address;
  beforeEach(async () => {
    process.env.UP_TEST_EPHEMERAL_KEY = "1";
    resetMemoryBackend();
    await getBackend("memory").importKey!(pkD);
    await getBackend("memory").importKey!(pkC);
  });
  afterEach(() => {
    resetMemoryBackend();
    if (saved === undefined) delete process.env.UP_TEST_EPHEMERAL_KEY;
    else process.env.UP_TEST_EPHEMERAL_KEY = saved;
  });

  it("loadSignerFromConfig picks the chain's key; no chain = the default key; old configs unchanged", async () => {
    const cfg: UpConfig = { version: 1, controller: { address: kD, backend: "memory", createdAt: "x" }, chainControllers: { "8453": { address: kC, backend: "memory", createdAt: "y" } } };
    expect((await loadSignerFromConfig(cfg, 8453)).address).toBe(kC);
    expect((await loadSignerFromConfig(cfg, 42)).address).toBe(kD);
    expect((await loadSignerFromConfig(cfg)).address).toBe(kD);
    expect((await loadSignerFromConfig({ version: 1, controller: { address: kD, backend: "memory", createdAt: "x" } }, 8453)).address).toBe(kD);
    await expect(loadSignerFromConfig({ version: 1 }, 8453)).rejects.toMatchObject({ code: "NO_SIGNER", hint: "run: up init" });
    await expect(loadSignerFromConfig({ version: 1, controller: { address: "0xbad" as any, backend: "memory", createdAt: "x" } })).rejects.toThrow(/not a valid address/);
  });

  it("ctx.signer(): explicit chain, else the verb's chain (--chain / default chain), else the default key", async () => {
    const home = homeWith({ controller: { address: kD, backend: "memory", createdAt: "x" }, chainControllers: { "8453": { address: kC, backend: "memory", createdAt: "y" } }, defaultChain: 42 });
    const ctx = createContext({ home, flags: { json: true, dryRun: false, yes: false } });
    expect((await ctx.signer(8453)).address).toBe(kC);
    expect((await ctx.signer(42)).address).toBe(kD);
    expect((await ctx.signer()).address).toBe(kD); // default chain 42 has no own key
    const onBase = createContext({ home, flags: { json: true, dryRun: false, yes: false, chain: "base" } });
    expect((await onBase.signer()).address).toBe(kC);
    expect(await controllerAddress(onBase)).toBe(kC);
    expect(await controllerAddress(onBase, 42)).toBe(kD);
    // address derivation of new profiles is chain-independent: always the default key
    expect(await defaultControllerAddress(onBase)).toBe(kD);
  });
});

describe("the profile's address per chain", () => {
  it("records: links are read per chain, invalid entries ignored, other keys kept on write", async () => {
    const home = mkdtempSync(join(tmpdir(), "up-mc-"));
    await writeProfileRecord(home, ID, { deployment: { profile: ID } });
    await writeProfileRecord(home, ID, { chainAddresses: { "8453": ON_BASE.toLowerCase(), x: OTHER, "10": "nope" } });
    const rec = await readProfileRecord(home, ID);
    expect(rec.deployment).toEqual({ profile: ID });
    expect(chainAddressesOf(rec)).toEqual({ "8453": ON_BASE });
    expect(await profileAddressOn(home, ID, 8453)).toBe(ON_BASE);
    expect(await profileAddressOn(home, ID, 42)).toBe(ID);
    expect(await profileAddressOn(home, OTHER, 8453)).toBe(OTHER); // no record at all
  });

  it("ctx.profile maps the identity per chain; identity() and resolveAddress() never do", async () => {
    const home = homeWith({ defaultProfile: ID, defaultChain: 42, aliases: { me: ID, friend: OTHER } });
    await writeProfileRecord(home, ID, { chainAddresses: { "8453": ON_BASE } });
    const ctx = createContext({ home, flags: { json: true, dryRun: false, yes: false } });
    expect(await ctx.profile(undefined, 8453)).toBe(ON_BASE);
    expect(await ctx.profile(undefined, 42)).toBe(ID);
    expect(await ctx.profile()).toBe(ID); // the verb's chain is the default chain 42
    expect(await ctx.profile("me", 8453)).toBe(ON_BASE); // alias of the identity
    expect(await ctx.profile(ID, 8453)).toBe(ON_BASE);
    expect(await ctx.profile(ON_BASE, 8453)).toBe(ON_BASE); // a chain address passed explicitly stays as is
    expect(await ctx.identity()).toBe(ID);
    expect(await ctx.resolveAddress("me")).toBe(ID); // counterparties are never mapped
    expect(await ctx.resolveAddress("friend")).toBe(OTHER);
    await expect(ctx.resolveAddress("nobody")).rejects.toMatchObject({ code: "BAD_ARGS" });
    const onBase = createContext({ home, flags: { json: true, dryRun: false, yes: false, chain: "base" } });
    expect(await onBase.profile()).toBe(ON_BASE);
    expect(await onBase.profile(undefined, 42)).toBe(ID);
  });

  it("without links or a chain everything resolves exactly as before", async () => {
    const home = homeWith({ defaultProfile: ID });
    const ctx = createContext({ home, flags: { json: true, dryRun: false, yes: false } });
    expect(await ctx.profile()).toBe(ID);
    expect(await ctx.profile(undefined, 8453)).toBe(ID);
    const none = createContext({ home: homeWith({}), flags: { json: true, dryRun: false, yes: false } });
    await expect(none.profile()).rejects.toMatchObject({ code: "BAD_ARGS", hint: "pass --profile <address> or set one: up config set default-profile <address>" });
  });
});
