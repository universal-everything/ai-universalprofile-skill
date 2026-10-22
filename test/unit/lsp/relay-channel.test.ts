// The persistent relay channel (src/lsp/relay-channel.ts): 16 CSPRNG bytes as a uint128 with 0..3 drawn
// again; created once under the profile record's lock (also by real processes racing on first use) and the
// same after a restart; saved as public, strictly validated data; never replaced, rotated or regenerated;
// one per profile and state folder; an explicit step for profiles restored from a backup.
import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress, type Address } from "viem";
import { ensureRelayChannel, MIN_SAVED_CHANNEL, profileIdentityFor, randomChannel, relayChannelState, setChannelEntropy } from "../../../src/lsp/relay-channel.ts";
import "../../../src/verbs/index.ts";
import { coerceArgs, getVerb } from "../../../src/core/verbs.ts";
import { handleMcpMessage } from "../../../src/mcp/server.ts";
import type { VerbContext } from "../../../src/core/types.ts";
import { testContext } from "../../support/context.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const CHILD = join(ROOT, "test", "support", "channel-child.ts");
const U128 = (1n << 128n) - 1n;
const A = getAddress("0x" + "a1".repeat(20));
const B = getAddress("0x" + "b2".repeat(20));
const C = getAddress("0x" + "c3".repeat(20));

/** Entropy fixture: hands out the given uint128 values in turn (the last one repeats). */
function fixture(...values: bigint[]): (n: number) => Uint8Array {
  let i = 0;
  return (n) => Buffer.from(values[Math.min(i++, values.length - 1)].toString(16).padStart(n * 2, "0"), "hex");
}
const newHome = () => mkdtempSync(join(tmpdir(), "up-chan-"));
const recordFile = (home: string, id: Address) => join(home, "profiles", `${id.toLowerCase()}.json`);
function writeRecord(home: string, id: Address, rec: unknown) {
  mkdirSync(join(home, "profiles"), { recursive: true });
  writeFileSync(recordFile(home, id), typeof rec === "string" ? rec : JSON.stringify(rec));
}
const readRecord = (home: string, id: Address) => JSON.parse(readFileSync(recordFile(home, id), "utf8"));
function child(mode: "ensure" | "read", home: string, id: Address): Promise<{ channel: string | null; created: boolean }> {
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, ["--import", "tsx", CHILD, mode, home, id], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("exit", (c) => (c === 0 ? res(JSON.parse(out.trim())) : rej(new Error(`child exit ${c}: ${err.slice(0, 300)}`))));
  });
}

afterEach(() => setChannelEntropy());

describe("random channel value", () => {
  it("16 CSPRNG bytes as a uint128; 0..3 are drawn again", () => {
    setChannelEntropy(fixture(0n, 3n, 1n, 2n, 0xfeedn));
    expect(randomChannel()).toBe(0xfeedn);
    setChannelEntropy(fixture(U128));
    expect(randomChannel()).toBe(U128);
    expect(MIN_SAVED_CHANNEL).toBe(4n);
  });
  it("a source that only gives trivial values or wrong lengths saves nothing (INTERNAL)", () => {
    setChannelEntropy(fixture(2n));
    expect(() => randomChannel()).toThrow(/no usable relay channel/);
    setChannelEntropy(() => new Uint8Array(8));
    expect(() => randomChannel()).toThrow(/no usable relay channel/);
  });
  it("by default it comes from crypto.randomBytes: in range, and two draws differ", () => {
    const [x, y] = [randomChannel(), randomChannel()];
    for (const c of [x, y]) expect(c >= 4n && c <= U128).toBe(true);
    expect(x).not.toBe(y); // 2^-128 chance of a false failure
  });
});

describe("saved once, never replaced", () => {
  it("first use creates it as a canonical decimal string in the profile record (0600), next to the record's other fields; later uses read it", async () => {
    const home = newHome();
    writeRecord(home, A, { address: A, deployment: { kind: "x" }, status: { checkedAt: "t" } });
    setChannelEntropy(fixture(123456789012345678901234567890n));
    const first = await ensureRelayChannel(home, A);
    expect(first).toMatchObject({ channel: 123456789012345678901234567890n, created: true, source: "random" });
    const rec = readRecord(home, A);
    expect(rec).toMatchObject({ address: A, deployment: { kind: "x" }, status: { checkedAt: "t" }, relayChannel: { channel: "123456789012345678901234567890", source: "random" } });
    expect(typeof rec.relayChannel.createdAt).toBe("string");
    if (process.platform !== "win32") expect(statSync(recordFile(home, A)).mode & 0o777).toBe(0o600);
    setChannelEntropy(fixture(999n));
    expect(await ensureRelayChannel(home, A)).toMatchObject({ channel: 123456789012345678901234567890n, created: false });
    expect((await relayChannelState(home, A)).saved?.channel).toBe(123456789012345678901234567890n);
  });

  it("a profile without a record yet gets one holding only its address and the channel", async () => {
    const home = newHome();
    expect(await relayChannelState(home, A)).toEqual({ restored: false });
    setChannelEntropy(fixture(77n));
    await ensureRelayChannel(home, A);
    expect(Object.keys(readRecord(home, A)).sort()).toEqual(["address", "relayChannel"]);
  });

  it("concurrent first uses in one process all get the single saved channel", async () => {
    const home = newHome();
    let n = 100n;
    setChannelEntropy((len) => Buffer.from((n++).toString(16).padStart(len * 2, "0"), "hex"));
    const got = await Promise.all(Array.from({ length: 12 }, () => ensureRelayChannel(home, A)));
    expect(new Set(got.map((g) => g.channel)).size).toBe(1);
    expect(got.filter((g) => g.created)).toHaveLength(1);
    expect(BigInt(readRecord(home, A).relayChannel.channel)).toBe(got[0].channel);
  });

  it("real processes racing on first use all get the same channel, and a process started later (restart) reads that one", async () => {
    const home = newHome();
    const got = await Promise.all([0, 1, 2, 3].map(() => child("ensure", home, A)));
    expect(new Set(got.map((g) => g.channel)).size).toBe(1);
    expect(got.filter((g) => g.created)).toHaveLength(1);
    const c = BigInt(got[0].channel!);
    expect(c >= 4n && c <= U128).toBe(true);
    expect((await child("read", home, A)).channel).toBe(got[0].channel);
    expect(await child("ensure", home, A)).toEqual({ channel: got[0].channel, created: false });
  }, 60_000);

  it("each profile and each state folder (agent) has its own channel (fixture values, no reliance on chance)", async () => {
    const [h1, h2] = [newHome(), newHome()];
    setChannelEntropy(fixture(1001n, 2002n, 3003n));
    expect((await ensureRelayChannel(h1, A)).channel).toBe(1001n);
    expect((await ensureRelayChannel(h2, A)).channel).toBe(2002n); // same profile, another agent
    expect((await ensureRelayChannel(h1, B)).channel).toBe(3003n); // another profile, same agent
    setChannelEntropy(fixture(4004n));
    expect([(await ensureRelayChannel(h1, A)).channel, (await ensureRelayChannel(h2, A)).channel, (await ensureRelayChannel(h1, B)).channel]).toEqual([1001n, 2002n, 3003n]);
  });
});

describe("strict validation: damage is an error, never a new channel or channel 0", () => {
  it.each([
    ["a number", { channel: 5 }],
    ["zero", { channel: "0" }],
    ["a trivial value", { channel: "3" }],
    ["hex", { channel: "0x10" }],
    ["leading zeros", { channel: "0012" }],
    ["2^128", { channel: (1n << 128n).toString() }],
    ["negative", { channel: "-5" }],
    ["null", null],
    ["a bare string", "123"],
    ["no channel", { createdAt: "x" }],
  ])("%s", async (_name, bad) => {
    const home = newHome();
    writeRecord(home, A, { address: A, relayChannel: bad });
    const before = readFileSync(recordFile(home, A), "utf8");
    await expect(ensureRelayChannel(home, A)).rejects.toMatchObject({ code: "INTERNAL", message: /saved relay channel .* is damaged/ });
    await expect(relayChannelState(home, A)).rejects.toMatchObject({ code: "INTERNAL" });
    expect(readFileSync(recordFile(home, A), "utf8")).toBe(before);
  });

  it("a record that is not valid JSON is an error and is not written over", async () => {
    const home = newHome();
    writeRecord(home, A, "{ not json");
    await expect(ensureRelayChannel(home, A)).rejects.toMatchObject({ code: "INTERNAL", message: /not a valid profile record/ });
    expect(readFileSync(recordFile(home, A), "utf8")).toBe("{ not json");
  });

  it("unknown extra fields are ignored and kept", async () => {
    const home = newHome();
    writeRecord(home, A, { address: A, relayChannel: { channel: "77", createdAt: "2026-01-01T00:00:00Z", future: { x: 1 } } });
    const before = readFileSync(recordFile(home, A), "utf8");
    expect(await ensureRelayChannel(home, A)).toMatchObject({ channel: 77n, created: false });
    expect(readFileSync(recordFile(home, A), "utf8")).toBe(before);
  });
});

describe("restored from a backup: an explicit step, never a silent new channel", () => {
  it("no implicit channel for an imported record; explicit creation or adopting the earlier channel works; a saved one is never replaced", async () => {
    const home = newHome();
    writeRecord(home, A, { address: A, imported: { file: "backup.json", chains: [] } });
    const before = readFileSync(recordFile(home, A), "utf8");
    await expect(ensureRelayChannel(home, A)).rejects.toMatchObject({ code: "NOT_SUPPORTED", details: { code: "relay_channel_not_created", restored: true } });
    expect(readFileSync(recordFile(home, A), "utf8")).toBe(before);
    expect(await relayChannelState(home, A)).toEqual({ saved: undefined, restored: true });
    setChannelEntropy(fixture(4242n));
    expect(await ensureRelayChannel(home, A, { explicit: true })).toMatchObject({ channel: 4242n, created: true, source: "random" });
    expect(readRecord(home, A).imported).toEqual({ file: "backup.json", chains: [] });

    writeRecord(home, B, { address: B, imported: { file: "backup.json" } });
    expect(await ensureRelayChannel(home, B, { explicit: true, adopt: 98765432109876543210n })).toMatchObject({ channel: 98765432109876543210n, created: true, source: "adopted" });
    expect(await ensureRelayChannel(home, B, { explicit: true, adopt: 98765432109876543210n })).toMatchObject({ created: false });
    await expect(ensureRelayChannel(home, B, { explicit: true, adopt: 5n })).rejects.toMatchObject({ code: "BAD_ARGS", message: /never replaced/ });
    await expect(ensureRelayChannel(home, C, { explicit: true, adopt: 3n })).rejects.toMatchObject({ code: "BAD_ARGS", message: /between 4 and 2\^128 - 1/ });
  });
});

describe("profile identity of a chain-specific address", () => {
  it("a linked address maps to the profile that links it; the verb's profile wins; two linking profiles are refused", async () => {
    const home = newHome();
    writeRecord(home, A, { address: A, chainAddresses: { "31338": B } });
    const ctx = testContext(home);
    expect(await profileIdentityFor(ctx, 31338, B)).toBe(A);
    expect(await profileIdentityFor(ctx, 42, A)).toBe(A);
    expect(await profileIdentityFor(ctx, 31338, C)).toBe(C);
    writeFileSync(join(home, "config.json"), JSON.stringify({ version: 1, defaultProfile: A }));
    expect(await profileIdentityFor(testContext(home), 31338, B)).toBe(A);
    // the chain-specific address given as --profile (no record of its own) still names the profile that links it
    expect(await profileIdentityFor(testContext(home, undefined, { profile: B }), 31338, B)).toBe(A);
    const h2 = newHome();
    writeRecord(h2, A, { address: A, chainAddresses: { "31338": B } });
    writeRecord(h2, C, { address: C, chainAddresses: { "31338": B } });
    await expect(profileIdentityFor(testContext(h2), 31338, B)).rejects.toMatchObject({ code: "BAD_ARGS", message: /linked on chain 31338 by several profiles/ });
  });

  it("a linked address that also has its own record (it relayed for itself before the link) belongs to the linking profile for every caller: one channel there", async () => {
    const home = newHome();
    writeRecord(home, A, { address: A, chainAddresses: { "31338": B } });
    writeRecord(home, B, { address: B, relayChannel: { channel: "4242", source: "random" } });
    writeFileSync(join(home, "config.json"), JSON.stringify({ version: 1, defaultProfile: A }));
    const asB = await profileIdentityFor(testContext(home, undefined, { profile: B }), 31338, B);
    const asA = await profileIdentityFor(testContext(home), 31338, B);
    expect([asB, asA]).toEqual([A, A]);
    // where nothing links it, the address is its own profile
    expect(await profileIdentityFor(testContext(home, undefined, { profile: B }), 42, B)).toBe(B);
  });

  it("two profiles linking one address on a chain are refused whoever asks (no channel per caller)", async () => {
    const home = newHome();
    writeRecord(home, A, { address: A, chainAddresses: { "31338": B } });
    writeRecord(home, C, { address: C, chainAddresses: { "31338": B } });
    for (const profile of [A, C, undefined]) {
      await expect(profileIdentityFor(testContext(home, undefined, profile ? { profile } : {}), 31338, B)).rejects.toMatchObject({ code: "BAD_ARGS", message: /linked on chain 31338 by several profiles/ });
    }
  });

  it("a damaged record could link the address: the lookup stops (INTERNAL) instead of guessing, and no channel is made", async () => {
    const home = newHome();
    writeRecord(home, A, { address: A });
    writeRecord(home, C, '{"address":"' + C + '","chainAddresses":{"31338":"' + A + '"}');
    await expect(profileIdentityFor(testContext(home), 31338, A)).rejects.toMatchObject({ code: "INTERNAL", message: /not a valid profile record/ });
    expect(readRecord(home, A)).toEqual({ address: A });
  });
});

describe("nonce channel shows; nonce channel create is a controlled write of permanent state", () => {
  const run = async (ctx: VerbContext, name: string, raw: Record<string, unknown> = {}) => {
    const v = getVerb(name)!;
    return (await v.run(ctx, coerceArgs(v, raw))) as { data: any; text?: string };
  };
  const auditLines = (home: string) => {
    try {
      return readFileSync(join(home, "audit.log"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  };

  it("nonce channel has no --create and never writes", async () => {
    const home = newHome();
    expect(() => coerceArgs(getVerb("nonce channel")!, { create: true })).toThrow(/unknown option --create/);
    expect((await run(testContext(home), "nonce channel", { profile: A })).data).toMatchObject({ profile: A, relayChannel: null });
    expect(() => readFileSync(recordFile(home, A))).toThrow();
    expect(getVerb("nonce channel")!.risk).toBe("local");
    expect(getVerb("nonce channel create")!.risk).toBe("write");
  });

  it("--dry-run reports what would be saved and writes nothing; the real run needs --yes (or the human's --approval) and is audited", async () => {
    const home = newHome();
    setChannelEntropy(fixture(0xabcdefn));
    const dry = await run(testContext(home, undefined, { dryRun: true, yes: false }), "nonce channel create", { profile: A });
    expect(dry.data).toMatchObject({ dryRun: true, profile: A, relayChannel: null, created: false, wouldCreate: { source: "random", channel: null }, restored: false });
    expect(dry.text).toMatch(/^DRY RUN: a new random relay channel would be saved for/);
    await expect(run(testContext(home, undefined, { yes: false }), "nonce channel create", { profile: A })).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    expect(() => readFileSync(recordFile(home, A))).toThrow();
    expect(auditLines(home)).toEqual([]);

    const made = await run(testContext(home, undefined, { yes: true }), "nonce channel create", { profile: A });
    expect(made.data).toMatchObject({ profile: A, created: true, relayChannel: { channel: "11259375", source: "random" } });
    expect(readRecord(home, A).relayChannel.channel).toBe("11259375");
    expect(auditLines(home)).toEqual([expect.objectContaining({ action: "nonce channel create", decision: "policy", profile: A })]);
    // once saved: nothing to create, so no consent is needed and nothing is written (also not by a dry run)
    const before = readFileSync(recordFile(home, A), "utf8");
    for (const flags of [{ yes: false }, { yes: false, dryRun: true }]) {
      expect((await run(testContext(home, undefined, flags), "nonce channel create", { profile: A })).data).toMatchObject({ created: false, relayChannel: { channel: "11259375" } });
    }
    await expect(run(testContext(home, undefined, { approval: "human: yes" }), "nonce channel create", { profile: A, channel: "99" })).rejects.toMatchObject({ code: "BAD_ARGS", message: /never replaced/ });
    expect(readFileSync(recordFile(home, A), "utf8")).toBe(before);
    expect(auditLines(home)).toHaveLength(1);
  });

  it("a profile restored from a backup needs the human's own approval (--yes is not enough); the dry run shows the channel that would be continued", async () => {
    const home = newHome();
    writeRecord(home, A, { address: A, imported: { file: "backup.json", chains: [] } });
    const before = readFileSync(recordFile(home, A), "utf8");
    const yesOnly = await run(testContext(home, undefined, { yes: true }), "nonce channel create", { profile: A }).catch((e) => e);
    expect(yesOnly).toMatchObject({ code: "CONSENT_REQUIRED", details: { confirmation: { action: "nonce channel create", restored: true } } });
    expect(yesOnly.details.confirmation.note).toMatch(/still be pending on the earlier channel/);
    const dry = await run(testContext(home, undefined, { dryRun: true, yes: false }), "nonce channel create", { profile: A, channel: "98765432109876543210" });
    expect(dry.data).toMatchObject({ dryRun: true, created: false, wouldCreate: { source: "adopted", channel: "98765432109876543210" }, restored: true });
    await expect(run(testContext(home, undefined, { dryRun: true }), "nonce channel create", { profile: A, channel: "3" })).rejects.toMatchObject({ code: "BAD_ARGS", message: /between 4 and 2\^128 - 1/ });
    expect(readFileSync(recordFile(home, A), "utf8")).toBe(before);
    const adopted = await run(testContext(home, undefined, { yes: false, approval: "human: continue the earlier channel" }), "nonce channel create", { profile: A, channel: "98765432109876543210" });
    expect(adopted.data).toMatchObject({ created: true, relayChannel: { channel: "98765432109876543210", source: "adopted" } });
    expect(auditLines(home)).toEqual([expect.objectContaining({ action: "nonce channel create", decision: "approval", restored: true })]);
  });

  it("MCP: up_nonce_channel is read-only, up_nonce_channel_create is not (and is not destructive); its dry run writes nothing", async () => {
    const list: any = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const tool = (n: string) => list.result.tools.find((t: any) => t.name === n);
    expect(tool("up_nonce_channel").annotations).toMatchObject({ readOnlyHint: true });
    expect(tool("up_nonce_channel_create").annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(Object.keys(tool("up_nonce_channel").inputSchema.properties)).not.toContain("create");
    const home = newHome();
    process.env.UP_HOME = home;
    const r: any = await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "up_nonce_channel_create", arguments: { profile: A, "dry-run": true } } });
    expect(r.result.isError).toBe(false);
    expect(r.result.structuredContent.data).toMatchObject({ dryRun: true, created: false });
    expect(() => readFileSync(recordFile(home, A))).toThrow();
  });
});
