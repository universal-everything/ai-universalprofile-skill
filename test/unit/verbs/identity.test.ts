// profile identity: a new chat (fresh context, even a separate process) that shares the same UP_HOME finds the
// profile(s), per-network addresses and recorded controllers again, offline, without keys and without changing
// anything; an empty home reports the limitation honestly instead of creating anything.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Address } from "viem";
import { getAddress } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import "../../../src/verbs/index.ts";
import { createContext, preloadConfig } from "../../../src/core/context.ts";
import { updateProfileRecord } from "../../../src/core/profile-record.ts";
import { getVerb } from "../../../src/core/verbs.ts";
import { renderResult } from "../../../src/core/output.ts";
import { fakeManifest, newKey } from "../../support/backup-fixtures.ts";

const saved = { home: process.env.UP_HOME };
const k1 = privateKeyToAddress(newKey());
const k2 = privateKeyToAddress(newKey());
const human = "0x4444444444444444444444444444444444444444" as Address;
const m1 = fakeManifest({ controller: k1, label: "one", chainIds: [42, 8453] });
const m2 = fakeManifest({ controller: k1, label: "two", chainIds: [42] });
const linkedOnBase = getAddress("0x5555555555555555555555555555555555555555");
let home: string;

async function identity(inHome = home) {
  process.env.UP_HOME = inHome;
  const ctx = createContext({ home: inHome, flags: { json: true, dryRun: false, yes: false } }); // a new chat: a fresh context
  await preloadConfig(ctx);
  return (await getVerb("profile identity")!.run(ctx, {})) as { data: any; text?: string; warnings?: string[] };
}
/** Every file under home with its size and mtime: proves nothing was written. */
function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(`${p}:${statSync(p).size}:${statSync(p).mtimeMs}`);
    }
  };
  walk(dir);
  return out.sort();
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "up-identity-"));
  process.env.UP_HOME = home;
  // public state only: no key store, no key file anywhere
  writeFileSync(
    join(home, "config.json"),
    JSON.stringify({
      version: 1,
      controller: { address: k1, backend: "macos-keychain", createdAt: "2026-10-01T00:00:00.000Z" },
      chainControllers: { "8453": { address: k2, backend: "macos-keychain", createdAt: "2026-10-02T00:00:00.000Z" } },
      defaultProfile: m1.profile,
      chains: [42, 8453],
      aliases: { work: m2.profile },
    }),
  );
  await updateProfileRecord(home, m1.profile, (r) => ({ deployment: m1, chainAddresses: { "8453": linkedOnBase }, status: { checkedAt: "2026-10-03T00:00:00.000Z", chains: { "42": { checkedAt: "2026-10-03T00:00:00.000Z", permissions: ["ALL"], isController: true, controller: k1 } } } }));
  await updateProfileRecord(home, m2.profile, () => ({ deployment: m2 }));
});
afterEach(() => {
  if (saved.home === undefined) delete process.env.UP_HOME;
  else process.env.UP_HOME = saved.home;
});

describe("profile identity", () => {
  it("a fresh context on the same UP_HOME finds the default profile, every profile and the per-chain addresses", async () => {
    const r = await identity();
    expect(r.data.found).toBe(true);
    expect(r.data.defaultProfile).toBe(m1.profile);
    expect(r.data.profiles.map((p: any) => [p.address, p.isDefault])).toEqual([[m1.profile, true], [m2.profile, false]]);
    const [p1, p2] = r.data.profiles;
    expect(p2.alias).toBe("work");
    expect(p1.networks.map((n: any) => [n.chainId, n.network, n.address, n.linkedAddress])).toEqual([[42, "LUKSO", m1.profile, false], [8453, "Base", linkedOnBase, true]]);
    expect(p2.networks.map((n: any) => n.chainId)).toEqual([42]);
    expect(p1.networks[0].link).toBe(`https://universaleverything.io/${m1.profile}?network=mainnet`);
    expect(r.data.say).toContain(m1.profile);
    expect(r.data.say).not.toMatch(/\.json|\bup \w|profiles\//); // plain words: no file names or commands for the human
  });

  it("keeps the profile, the agent's key addresses and the recorded controllers apart", async () => {
    const r = await identity();
    expect(r.data.agentControllers.default.address).toBe(k1);
    expect(r.data.agentControllers.perChain).toEqual([{ chainId: 8453, address: k2, backend: "macos-keychain" }]);
    const rec = r.data.profiles[0].networks[0].recordedControllers.map((c: any) => c.address);
    expect(rec).toContain(k1);
    expect(r.data.profiles.map((p: any) => p.address)).not.toContain(k1);
    expect(r.data.profiles.map((p: any) => p.address)).not.toContain(k2);
    expect(human).not.toBe(k1);
  });

  it("is offline saved state, never fresh: it reports no saved permissions as current and points to profile status", async () => {
    const r = await identity();
    expect(r.data.fresh).toBe(false);
    const text = JSON.stringify(r.data.profiles);
    expect(text).not.toContain("permissions");
    expect(text).not.toContain("ALL");
    expect(r.data.profiles[0].networks[0].lastCheckedAt).toBe("2026-10-03T00:00:00.000Z");
    expect(r.data.next.join(" ")).toMatch(/up profile status/);
    expect(r.data.next.join(" ")).toMatch(/Never tell the human you have no profile/);
  });

  it("works with no key anywhere, writes nothing and creates no key or profile", async () => {
    const before = snapshot(home);
    const r = await identity();
    const again = await identity();
    expect(again.data).toEqual(r.data);
    expect(snapshot(home)).toEqual(before);
    expect(existsSync(join(home, "keys"))).toBe(false);
    expect(existsSync(join(home, "backups"))).toBe(false);
  });

  it("the result survives the output path unchanged (public addresses only)", async () => {
    const r = await identity();
    expect(JSON.parse(renderResult("profile identity", r as any, true)).data).toEqual(JSON.parse(JSON.stringify(r.data)));
  });

  it("an empty UP_HOME says plainly that nothing is saved here, not that no profile exists, and creates nothing", async () => {
    const empty = mkdtempSync(join(tmpdir(), "up-identity-empty-"));
    const r = await identity(empty);
    expect(r.data.found).toBe(false);
    expect(r.data.profiles).toEqual([]);
    expect(r.data.keyPresent).toBe(false);
    expect(r.data.say).toMatch(/don't have a Universal Profile saved in this place/);
    expect(r.data.say).toMatch(/doesn't mean none exists/);
    expect(r.data.next.join(" ")).toMatch(/isolated environment|reset cloud VM/);
    expect(r.data.next.join(" ")).toMatch(/address alone is not access/);
    expect(readdirSync(empty)).toEqual([]);
  });

  it("a different UP_HOME (another user or environment) never sees these profiles", async () => {
    const other = mkdtempSync(join(tmpdir(), "up-identity-other-"));
    const r = await identity(other);
    expect(JSON.stringify(r.data)).not.toContain(m1.profile);
  });

  it("a damaged profile record or an address-only default still lists the address", async () => {
    mkdirSync(join(home, "profiles"), { recursive: true });
    writeFileSync(join(home, "profiles", `${m2.profile.toLowerCase()}.json`), "{ not json");
    const r = await identity();
    expect(r.data.profiles.map((p: any) => p.address)).toContain(m2.profile);
  });

  it("separate process (the shipped bundle, as a new chat starts it): same answer, key store untouched", () => {
    const bundle = join(import.meta.dirname, "..", "..", "..", "skills", "universal-profile", "scripts", "up.mjs");
    expect(existsSync(bundle), "run npm run build first").toBe(true);
    const before = snapshot(home);
    const out = execFileSync(process.execPath, [bundle, "profile", "identity", "--json"], { env: { ...process.env, UP_HOME: home, NODE_NO_WARNINGS: "1" }, encoding: "utf8" });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.defaultProfile).toBe(m1.profile);
    expect(parsed.data.profiles[0].networks.map((n: any) => n.address)).toEqual([m1.profile, linkedOnBase]);
    expect(parsed.data.agentControllers.default.address).toBe(k1);
    expect(snapshot(home)).toEqual(before);
    expect(readFileSync(join(home, "config.json"), "utf8")).toContain(m1.profile);
  });
});
