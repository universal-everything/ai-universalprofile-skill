import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodePacked, keccak256, recoverMessageAddress, type Hex } from "viem";
import { testContext, testSigner } from "../../support/context.ts";
import { runVerb } from "../../support/mock-relayer.ts";
import { AMBIGUOUS_HINT, RelayerClient, joinUrl, mapRelayerError, quotaMessageHash, quotaPositive, signQuota, type FetchLike, type RelayerEntry } from "../../../src/relayer/client.ts";
import { listRelayers } from "../../../src/relayer/registry.ts";
import { composeNonce, lsp25Digest, recoverLsp25Signer, signLsp25, splitNonce } from "../../../src/lsp/lsp25.ts";
import { UpError } from "../../../src/core/errors.ts";
import "../../../src/relayer/verbs.ts";

const PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex; // hardhat account #1 (public test key)
const UP = "0xBB645D97B0c7D101ca0d73131e521fe89B463BFD" as const;

interface Call {
  url: string;
  method: string;
  /** the request body exactly as sent over HTTP */
  raw?: string;
  body?: any;
}

function mockFetch(routes: Record<string, (c: Call) => { status: number; body?: unknown }>) {
  const calls: Call[] = [];
  const f: FetchLike = async (url, init) => {
    const c: Call = { url, method: init?.method ?? "GET", raw: init?.body ? String(init.body) : undefined, body: init?.body ? JSON.parse(String(init.body)) : undefined };
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
  it("lukso-live: no chainId field, the full nonce and the validity window as 0x hex uints, taskId tracking", async () => {
    const { f, calls } = mockFetch({
      "POST /api/execute": () => ({ status: 201, body: { taskId: "t1", transactionHash: "0x" + "cd".repeat(32) } }),
      "GET /api/task/t1": () => ({ status: 200, body: { taskId: "t1", status: "COMPLETE", transactionHash: "0x" + "cd".repeat(32) } }),
    });
    const c = new RelayerClient(entry({ profile: "lukso-live" }), { fetch: f });
    const r = await c.execute({ address: UP, chainId: 42, transaction: { ...tx, nonce: 7n } });
    expect(r.taskId).toBe("t1");
    expect(calls[0].body).toEqual({ address: UP, transaction: { abi: tx.abi, signature: tx.signature, nonce: "0x7", validityTimestamps: "0x" + tx.validityTimestamps.toString(16) } });
    expect((await c.task("t1")).status).toBe("COMPLETE");
    const r2 = await c.execute({ address: UP, chainId: 42, transaction: tx });
    expect(calls[2].body.transaction.nonce).toBe("0x" + tx.nonce.toString(16));
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

// The relay nonce is the full value getNonce(controller, channel) returns: channel in the high 128 bits, counter in
// the low 128 bits. Every relayer profile gets it (and the validity window) as an exact 0x hex uint256 string:
// minimal form (lowercase, no leading zeros, "0x0" for zero), never a JSON number (not exact above 2^53 - 1) and
// never a decimal string. The hex form changes neither the value nor the LSP25 digest (that packs a 32-byte uint256).
describe("relay nonce on the wire: the full getNonce value as a 0x hex uint256", () => {
  const U128 = (1n << 128n) - 1n;
  const SAVED = 0x9f3c5be1d2a4476e8b0c1d2e3f405162n; // a saved random channel
  const nonces: [string, bigint][] = [
    ["0: channel 0, first counter", 0n],
    ["1", 1n],
    ["2^53 - 1: the largest exact JSON number", 2n ** 53n - 1n],
    ["2^53", 2n ** 53n],
    ["2^53 + 1: the first value a JSON number cannot carry", 2n ** 53n + 1n],
    ["2^128: channel 1, first counter", 2n ** 128n],
    ["2^128 + 1: channel 1, second counter", 2n ** 128n + 1n],
    ["a saved random channel, first counter", composeNonce(SAVED, 0n)],
    ["a saved random channel, counter 41", composeNonce(SAVED, 41n)],
    ["the largest channel, first counter", composeNonce(U128, 0n)],
    ["the largest channel and counter: 2^256 - 1", composeNonce(U128, U128)],
  ];
  for (const profile of ["lsp15", "lukso-live"] as const) {
    it.each(nonces)(`${profile}: %s`, async (_label, nonce) => {
      const { f, calls } = mockFetch({ "POST /api/execute": () => ({ status: 200, body: { transactionHash: "0x" + "ab".repeat(32), ...(profile === "lsp15" ? { chainId: 42 } : { taskId: "t1" }) } }) });
      await new RelayerClient(entry({ profile }), { fetch: f }).execute({ address: UP, chainId: 42, transaction: { ...tx, nonce } });
      expect(calls).toHaveLength(1);
      const wire = calls[0].body.transaction.nonce;
      expect(wire).toBe("0x" + nonce.toString(16));
      expect(wire).toMatch(/^0x(0|[1-9a-f][0-9a-f]{0,63})$/);
      expect(calls[0].raw).toContain(`"nonce":"${wire}"`); // a JSON string in the HTTP body, not a number
      expect(BigInt(wire)).toBe(nonce); // exact: decoded, it is the very value that was signed
      expect(splitNonce(BigInt(wire))).toEqual(splitNonce(nonce)); // channel and counter unchanged, not packed twice
    });
  }

  it("the decoded wire values reproduce the signed LSP25 message: same digest, the signature recovers to the controller (both profiles)", async () => {
    const s = testSigner(PK);
    const keyManager = "0x1234567890AbcdEF1234567890aBcdef12345678" as const;
    for (const nonce of [0n, 2n ** 53n + 1n, composeNonce(SAVED, 0n), composeNonce(U128, U128)]) {
      const msg = { keyManager, chainId: 42, nonce, validityTimestamps: tx.validityTimestamps, value: 0n, payload: tx.abi };
      const signature = await signLsp25(s, msg);
      for (const profile of ["lsp15", "lukso-live"] as const) {
        const { f, calls } = mockFetch({ "POST /api/execute": () => ({ status: 200, body: { transactionHash: "0x" + "ab".repeat(32), ...(profile === "lsp15" ? { chainId: 42 } : { taskId: "t1" }) } }) });
        await new RelayerClient(entry({ profile }), { fetch: f }).execute({ address: UP, chainId: 42, transaction: { abi: tx.abi, signature, nonce, validityTimestamps: tx.validityTimestamps } });
        const t = JSON.parse(calls[0].raw!).transaction;
        const decoded = { keyManager, chainId: 42, nonce: BigInt(t.nonce), validityTimestamps: BigInt(t.validityTimestamps), value: 0n, payload: t.abi as Hex };
        expect(decoded.nonce).toBe(nonce);
        expect(lsp25Digest(decoded)).toBe(lsp25Digest(msg));
        expect(await recoverLsp25Signer(decoded, t.signature)).toBe(s.address);
      }
    }
  });

  it("a nonce or validity window that is not a uint256 bigint is refused before anything is sent", async () => {
    const bad: unknown[] = [-1n, 2n ** 256n, 7, Number.MAX_SAFE_INTEGER + 2, "0x7", "7", undefined];
    for (const profile of ["lsp15", "lukso-live"] as const) {
      for (const v of bad) {
        for (const field of ["nonce", "validityTimestamps"] as const) {
          const { f, calls } = mockFetch({});
          const err = await new RelayerClient(entry({ profile }), { fetch: f }).execute({ address: UP, chainId: 42, transaction: { ...tx, [field]: v as bigint } }).catch((e) => e);
          expect(err, `${profile} ${field} ${String(v)}`).toBeInstanceOf(UpError);
          expect(err.code).toBe("INTERNAL");
          expect(calls).toHaveLength(0);
        }
      }
    }
  });
});

describe("relayer API targets: LUKSO's public relayer is lukso-live, any other URL (e.g. the Universal Relayer) is lsp15", () => {
  it("the bundled registry lists LUKSO's public relayer for LUKSO Mainnet and Testnet as lukso-live", async () => {
    const ctx = testContext(mkdtempSync(join(tmpdir(), "up-relayer-target-")));
    expect((await listRelayers(ctx, 42)).map((r) => [r.baseUrl, r.profile])).toEqual([["https://relayer.mainnet.lukso.network/api", "lukso-live"]]);
    expect((await listRelayers(ctx, 4201)).map((r) => [r.baseUrl, r.profile])).toEqual([["https://relayer.testnet.lukso.network/api", "lukso-live"]]);
  });
  it("relayer add: a relayer URL that is not LUKSO's (e.g. the Universal Relayer) gets the lsp15 profile", async () => {
    const ctx = testContext(mkdtempSync(join(tmpdir(), "up-relayer-target-")));
    const srv = createServer((_req, res) => {
      res.writeHead(404, { "content-type": "application/json" });
      res.end("{}");
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    try {
      const url = `http://127.0.0.1:${(srv.address() as any).port}/api`;
      const other = await runVerb(ctx, "relayer add", { url, name: "universal", chains: ["42"] });
      expect(other.data.relayer).toMatchObject({ name: "universal", baseUrl: url, profile: "lsp15", chainIds: [42] });
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
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
      expect(e.hint).toBe(AMBIGUOUS_HINT);
      expect(e.hint).toMatch(/^do not resend; check whether this call executed .*a used nonce alone does not prove it/);
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
