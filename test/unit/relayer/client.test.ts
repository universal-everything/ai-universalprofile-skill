import { describe, expect, it } from "vitest";
import { encodePacked, keccak256, recoverMessageAddress, type Hex } from "viem";
import { testSigner } from "../../support/context.ts";
import { RelayerClient, joinUrl, mapRelayerError, quotaMessageHash, quotaPositive, signQuota, type FetchLike, type RelayerEntry } from "../../../src/relayer/client.ts";
import { UpError } from "../../../src/core/errors.ts";

const PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex; // hardhat account #1 (public test key)
const UP = "0xBB645D97B0c7D101ca0d73131e521fe89B463BFD" as const;

interface Call {
  url: string;
  method: string;
  body?: any;
}

function mockFetch(routes: Record<string, (c: Call) => { status: number; body?: unknown }>) {
  const calls: Call[] = [];
  const f: FetchLike = async (url, init) => {
    const c: Call = { url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const key = `${c.method} ${new URL(url).pathname}`;
    const h = routes[key];
    const r = h ? h(c) : { status: 404, body: { error: "not_found" } };
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  };
  return { f, calls };
}

const entry = (over: Partial<RelayerEntry> = {}): RelayerEntry => ({ name: "r", baseUrl: "https://relayer.example/api", chainIds: [42], profile: "lsp15", ...over });
const tx = { abi: "0x7f23690c" as Hex, signature: ("0x" + "11".repeat(65)) as Hex, nonce: (5n << 128n) | 3n, validityTimestamps: (10n << 128n) | 20n };

describe("capability negotiation", () => {
  it("reads /.well-known/lsp15.json under the base URL", async () => {
    const { f, calls } = mockFetch({ "GET /api/.well-known/lsp15.json": () => ({ status: 200, body: { lsp15Version: "1.1", supportedChainIds: [42, 8453], chainIdRequired: true, quotaScope: "both", quotaAuth: "lsp15-signature", quotaSignatureVersions: [1, 2], features: ["batch"] } }) });
    const caps = await new RelayerClient(entry(), { fetch: f }).capabilities();
    expect(caps).toMatchObject({ legacy: false, lsp15Version: "1.1", supportedChainIds: [42, 8453], chainIdRequired: true, quotaSignatureVersions: [1, 2] });
    expect(calls[0].url).toBe("https://relayer.example/api/.well-known/lsp15.json");
  });
  it("falls back to the origin and /capabilities, then legacy mode", async () => {
    const a = mockFetch({ "GET /.well-known/lsp15.json": () => ({ status: 200, body: { supportedChainIds: [42] } }) });
    expect((await new RelayerClient(entry(), { fetch: a.f }).capabilities()).source).toBe("https://relayer.example/.well-known/lsp15.json");
    const b = mockFetch({ "GET /api/capabilities": () => ({ status: 200, body: { supportedChainIds: [42] } }) });
    expect((await new RelayerClient(entry(), { fetch: b.f }).capabilities()).source).toBe("https://relayer.example/api/capabilities");
    const c = mockFetch({});
    const caps = await new RelayerClient(entry(), { fetch: c.f }).capabilities();
    expect(caps.legacy).toBe(true);
    expect(c.calls.length).toBe(3);
  });
  it("assertServes: capability list and configured chains", async () => {
    const client = new RelayerClient(entry({ chainIds: [42] }));
    expect(() => client.assertServes(42, { legacy: false, supportedChainIds: [42], fetchedAt: "" })).not.toThrow();
    expect(() => client.assertServes(8453, { legacy: false, supportedChainIds: [42], fetchedAt: "" })).toThrow(/does not list chain 8453/);
    expect(() => client.assertServes(8453, { legacy: true, fetchedAt: "" })).toThrow(/configured for chain/);
  });
  it("rejects non-http base URLs", () => {
    expect(() => new RelayerClient(entry({ baseUrl: "ftp://x" }))).toThrow();
    expect(joinUrl("https://a/b/", "/execute")).toBe("https://a/b/execute");
  });
});

describe("POST /execute request shape", () => {
  it("lsp15: LSP15 body + top-level integer chainId, hex nonce/validity, abi = payload", async () => {
    const { f, calls } = mockFetch({ "POST /api/execute": () => ({ status: 200, body: { transactionHash: "0x" + "ab".repeat(32), chainId: 42 } }) });
    const r = await new RelayerClient(entry(), { fetch: f }).execute({ address: UP, chainId: 42, transaction: tx });
    expect(r.transactionHash).toBe("0x" + "ab".repeat(32));
    expect(calls[0].body).toEqual({ address: UP, chainId: 42, transaction: { abi: tx.abi, signature: tx.signature, nonce: "0x" + tx.nonce.toString(16), validityTimestamps: "0x" + tx.validityTimestamps.toString(16) } });
  });
  it("lukso-live: no chainId field, numeric nonce when safe, taskId tracking", async () => {
    const { f, calls } = mockFetch({
      "POST /api/execute": () => ({ status: 201, body: { taskId: "t1", transactionHash: "0x" + "cd".repeat(32) } }),
      "GET /api/task/t1": () => ({ status: 200, body: { taskId: "t1", status: "COMPLETE", transactionHash: "0x" + "cd".repeat(32) } }),
    });
    const c = new RelayerClient(entry({ profile: "lukso-live" }), { fetch: f });
    const r = await c.execute({ address: UP, chainId: 42, transaction: { ...tx, nonce: 7n } });
    expect(r.taskId).toBe("t1");
    expect(calls[0].body.chainId).toBeUndefined();
    expect(calls[0].body.transaction.nonce).toBe(7);
    expect((await c.task("t1")).status).toBe("COMPLETE");
    const r2 = await c.execute({ address: UP, chainId: 42, transaction: tx });
    expect(calls[2].body.transaction.nonce).toBe(tx.nonce.toString());
    expect(r2.transactionHash).toBeDefined();
  });
  it("refuses a response echoing another chainId or carrying no hash/task", async () => {
    const a = mockFetch({ "POST /api/execute": () => ({ status: 200, body: { transactionHash: "0x" + "ab".repeat(32), chainId: 1 } }) });
    await expect(new RelayerClient(entry(), { fetch: a.f }).execute({ address: UP, chainId: 42, transaction: tx })).rejects.toThrow(/echoed chainId/);
    const b = mockFetch({ "POST /api/execute": () => ({ status: 200, body: { ok: true } }) });
    await expect(new RelayerClient(entry(), { fetch: b.f }).execute({ address: UP, chainId: 42, transaction: tx })).rejects.toThrow(/neither a transaction hash/);
  });
  it("network failures map to NETWORK_ERROR", async () => {
    const f: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(new RelayerClient(entry(), { fetch: f }).execute({ address: UP, chainId: 42, transaction: tx })).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });
});

describe("error map (relay-api-plan §3.5)", () => {
  const cases: [number, unknown, string, string][] = [
    [400, { error: "chainId_required" }, "chainId_required", "none"],
    [400, { error: "chain_unsupported" }, "chain_unsupported", "km"],
    [422, { error: "chain_binding_mismatch" }, "chain_binding_mismatch", "none"],
    [402, { error: "quota_exhausted", scope: "perChain" }, "quota_exhausted", "km"],
    [401, {}, "auth_required", "km"],
    [403, { code: "profile_not_authorised" }, "profile_not_authorised", "km"],
    [409, {}, "nonce_conflict", "none"],
    [425, {}, "not_yet_valid", "resign"],
    [410, {}, "expired", "resign"],
    [502, { error: "chain_submission_failed", message: "out of gas" }, "chain_submission_failed", "none"],
  ];
  it.each(cases)("HTTP %i %j → %s", (status, body, code, fallback) => {
    const e = mapRelayerError({ name: "r", profile: "lsp15" }, status, body, "execute");
    expect(e).toBeInstanceOf(UpError);
    expect(e.code).toBe("RELAYER_ERROR");
    expect((e.details as any).code).toBe(code);
    expect((e.details as any).fallback).toBe(fallback);
    expect(e.hint).toBeTruthy();
  });
  it("ambiguous /execute failures (5xx, 409, timeouts) never suggest another path", async () => {
    for (const [status, body] of [[500, {}], [502, { error: "chain_submission_failed" }], [503, "oops"], [409, { error: "nonce_conflict" }]] as const) {
      const e = mapRelayerError({ name: "r", profile: "lsp15" }, status, body, "execute");
      expect((e.details as any).ambiguous, String(status)).toBe(true);
      expect((e.details as any).fallback).toBe("none");
      expect(e.hint).toBe("do not resend; check `up nonce` (has the nonce been used?) or wait until the validity window ends");
      expect(e.hint).not.toMatch(/--via km/);
    }
    expect((mapRelayerError({ name: "l", profile: "lukso-live" }, 500, {}, "execute").details as any).fallback).toBe("none");
    // quota 5xx is harmless (nothing was signed for a call)
    expect((mapRelayerError({ name: "r", profile: "lsp15" }, 500, {}, "quota").details as any).ambiguous).toBe(false);
    const f: FetchLike = async () => {
      throw new TypeError("socket hang up");
    };
    const err = await new RelayerClient(entry(), { fetch: f }).execute({ address: UP, chainId: 42, transaction: tx }).catch((x) => x);
    expect(err.code).toBe("NETWORK_ERROR");
    expect(err.hint).not.toMatch(/--via km/);
    expect(err.details.ambiguous).toBe(true);
  });
  it("relayer text is truncated and labelled untrusted", () => {
    const e = mapRelayerError({ name: "r", profile: "lsp15" }, 500, { message: "x".repeat(1000) }, "execute");
    expect(((e.details as any).relayerMessage as string).length).toBeLessThan(310);
    expect((e.details as any).note).toMatch(/untrusted/);
  });
  it("lukso-live statuses", () => {
    expect(mapRelayerError({ name: "l", profile: "lukso-live" }, 422, {}, "execute").message).toMatch(/not registered/);
    expect(mapRelayerError({ name: "l", profile: "lukso-live" }, 401, {}, "execute").message).toMatch(/lacks permission/);
    expect(mapRelayerError({ name: "l", profile: "lukso-live" }, 403, {}, "execute").message).toMatch(/banned/);
  });
});

describe("POST /quota signed message", () => {
  it("hash = keccak256(abi.encodePacked(address, uint256 timestamp[, uint256 chainId]))", () => {
    expect(quotaMessageHash(UP, 1656408193)).toBe(keccak256(encodePacked(["address", "uint256"], [UP, 1656408193n])));
    expect(quotaMessageHash(UP, 1656408193, 42)).toBe(keccak256(encodePacked(["address", "uint256", "uint256"], [UP, 1656408193n, 42n])));
  });
  it("v1 (global) by default: controller signs (personal_sign) and is the subject; chainId still routed top-level", async () => {
    const s = testSigner(PK);
    const { f, calls } = mockFetch({ "POST /api/quota": () => ({ status: 200, body: { quota: 1543091, unit: "gas", totalQuota: 5000000, resetDate: 1656408193 } }) });
    const q = await new RelayerClient(entry(), { fetch: f }).quota(s, { chainId: 42, now: 1656408193_000 });
    const b = calls[0].body;
    expect(b).toMatchObject({ address: s.address, chainId: 42, timestamp: 1656408193 });
    expect(b.quotaSignatureVersion).toBeUndefined();
    expect(await recoverMessageAddress({ message: { raw: quotaMessageHash(s.address, 1656408193) }, signature: b.signature })).toBe(s.address);
    expect(q).toMatchObject({ available: true, quota: "1543091", unit: "gas", signatureVersion: 1, scope: "global" });
    expect(quotaPositive(q)).toBe(true);
  });
  it("v2 (per chain) when the capabilities allow it; subject = profile when negotiated", async () => {
    const s = testSigner(PK);
    const { f, calls } = mockFetch({ "POST /api/quota": () => ({ status: 200, body: { quota: 0, unit: "transactionCount", chainId: 42 } }) });
    const caps = { legacy: false, quotaScope: "perChain" as const, quotaSignatureVersions: [1, 2], quotaSubject: "profile" as const, fetchedAt: "" };
    const q = await new RelayerClient(entry(), { fetch: f }).quota(s, { chainId: 42, profile: UP, caps, now: 1_700_000_000_000 });
    const b = calls[0].body;
    expect(b).toMatchObject({ address: UP, chainId: 42, quotaSignatureVersion: 2 });
    expect(await recoverMessageAddress({ message: { raw: quotaMessageHash(UP, 1_700_000_000, 42) }, signature: b.signature })).toBe(s.address);
    expect(q.signatureVersion).toBe(2);
    expect(quotaPositive(q)).toBe(false);
  });
  it("lukso-live quota is reported unavailable instead of failing (JWT-gated)", async () => {
    const q = await new RelayerClient(entry({ profile: "lukso-live" })).quota(testSigner(PK), { chainId: 42 });
    expect(q.available).toBe(false);
    expect(q.reason).toMatch(/LUKSO account/);
  });
  it("signQuota helper", async () => {
    const s = testSigner(PK);
    const r = await signQuota(s, s.address, 100, 4201);
    expect(await recoverMessageAddress({ message: { raw: r.hash }, signature: r.signature })).toBe(s.address);
  });
});
