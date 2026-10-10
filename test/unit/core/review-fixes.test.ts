// Regression tests for the final-review findings fixed in src/core and src/chain.
import { describe, expect, it, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeFunctionData, erc20Abi, keccak256, type Hex } from "viem";
import { requireConsent, savePolicy, DEFAULT_POLICY, VALUE_MOVING_SELECTORS } from "../../../src/core/policy.ts";
import { redact } from "../../../src/core/json.ts";
import { withLock } from "../../../src/core/lock.ts";
import { sendTx } from "../../../src/chain/tx.ts";
import { testSigner, testContext } from "../../support/context.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "up-fix-"));
const base = { json: true, dryRun: false, yes: true };

describe("policy: token moves, secret verbs, policy changes", () => {
  it("token transfers/approvals need approval by default even with --yes; allowed when the human enables allowTokenMoves", async () => {
    const home = tmp();
    const transfer = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: ["0x0000000000000000000000000000000000000001", 1n] }).slice(0, 10) as Hex;
    const approve = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: ["0x0000000000000000000000000000000000000001", 1n] }).slice(0, 10) as Hex;
    expect(VALUE_MOVING_SELECTORS.has(transfer)).toBe(true);
    expect(VALUE_MOVING_SELECTORS.has("0x760d9bba")).toBe(true); // LSP7 transfer
    expect(VALUE_MOVING_SELECTORS.has("0xa22cb465")).toBe(true); // setApprovalForAll
    const token = "0x00000000000000000000000000000000000000aa";
    await expect(requireConsent(home, base, { verb: "token transfer", risk: "write", chainId: 42, selector: transfer, target: token, value: 0n, summary: {} })).rejects.toMatchObject({ code: "POLICY_DENIED" });
    await expect(requireConsent(home, base, { verb: "token approve", risk: "write", chainId: 42, selector: approve, target: token, value: 0n, summary: {} })).rejects.toMatchObject({ code: "POLICY_DENIED" });
    await requireConsent(home, { ...base, yes: false, approval: "send 1 token" }, { verb: "token transfer", risk: "write", chainId: 42, selector: transfer, target: token, summary: {} });
    await savePolicy(home, { ...DEFAULT_POLICY, allowTokenMoves: true, tokenTargets: [token] });
    await requireConsent(home, base, { verb: "token transfer", risk: "write", chainId: 42, selector: transfer, target: token, summary: {} });
    await expect(requireConsent(home, base, { verb: "token transfer", risk: "write", chainId: 42, selector: transfer, target: "0x00000000000000000000000000000000000000bb", summary: {} })).rejects.toMatchObject({ code: "POLICY_DENIED" });
  });
  it("secret verbs and policy changes always need the human, even with allowAdmin", async () => {
    const home = tmp();
    await savePolicy(home, { ...DEFAULT_POLICY, allowAdmin: true });
    await expect(requireConsent(home, base, { verb: "key activate", risk: "secret", summary: {} })).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    await expect(requireConsent(home, base, { verb: "policy set", risk: "admin", summary: {} })).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    await requireConsent(home, base, { verb: "controller add", risk: "admin", summary: {} }); // delegated admin still works
  });
});

describe("redaction", () => {
  it("masks credential containers and provider keys in URLs but keeps data keys and public URLs", () => {
    const out: any = redact({
      explorerKeys: { etherscan: "ABCDEF123" },
      rpc: "https://eth-mainnet.g.alchemy.com/v2/AbCdEfGhIjKlMnOpQrStUvWxYz012345",
      q: "https://bundler.example/rpc?apikey=secret123&chain=1",
      pub: "https://rpc.mainnet.lukso.network",
      ipfs: "https://ipfs.io/ipfs/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
      keys: ["0x4b80742de2bf82acb3630000aabbccddeeff00112233445566778899aabbccdd"],
      seed: "0x" + "11".repeat(32),
      privateKey: "0xdead",
    });
    expect(out.explorerKeys.etherscan).toBe("[redacted]");
    expect(out.rpc).not.toContain("AbCdEf");
    expect(out.q).not.toContain("secret123");
    expect(out.pub).toBe("https://rpc.mainnet.lukso.network");
    expect(out.ipfs).toContain("bafybei");
    expect(out.keys[0]).toMatch(/^0x4b80742d/);
    expect(out.seed).toBe("0x" + "11".repeat(32));
    expect(out.privateKey).toBe("[redacted]");
  });
});

describe("cross-process lock", () => {
  it("runs critical sections one at a time", async () => {
    const home = tmp();
    const order: string[] = [];
    const job = (n: string) =>
      withLock(home, "write", async () => {
        order.push(`start ${n}`);
        await new Promise((r) => setTimeout(r, 30));
        order.push(`end ${n}`);
      });
    await Promise.all([job("a"), job("b")]);
    expect(order[0].startsWith("start")).toBe(true);
    expect(order[1].startsWith("end")).toBe(true);
    expect(order[0].slice(6)).toBe(order[1].slice(4));
  });
});

describe("idempotent transaction submission", () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
  });
  async function mockChain(sendBehaviour: "already-known" | "timeout", knownAfterSend: boolean) {
    let sentRaw: Hex | undefined;
    const s = createServer(async (req, res) => {
      let b = "";
      for await (const c of req) b += c;
      const m = JSON.parse(b);
      const reply = (result: unknown) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }));
      };
      const now = "0x" + Math.floor(Date.now() / 1000).toString(16);
      switch (m.method) {
        case "eth_chainId":
          return reply("0xf3d59");
        case "eth_getBlockByNumber":
          return reply({ number: "0x10", timestamp: now, baseFeePerGas: "0x3b9aca00" });
        case "eth_call":
          return reply("0x");
        case "eth_estimateGas":
          return reply("0x5208");
        case "eth_getTransactionCount":
          return reply("0x7");
        case "eth_maxPriorityFeePerGas":
          return reply("0x3b9aca00");
        case "eth_getBalance":
          return reply("0xde0b6b3a7640000");
        case "eth_sendRawTransaction":
          sentRaw = m.params[0];
          if (sendBehaviour === "already-known") {
            res.writeHead(200, { "content-type": "application/json" });
            return res.end(JSON.stringify({ jsonrpc: "2.0", id: m.id, error: { code: -32000, message: "already known" } }));
          }
          res.writeHead(500);
          return res.end("gateway timeout");
        case "eth_getTransactionByHash":
          return reply(knownAfterSend && sentRaw ? { hash: keccak256(sentRaw) } : null);
        case "eth_getTransactionReceipt":
          return reply(
            knownAfterSend && sentRaw
              ? { transactionHash: keccak256(sentRaw), status: "0x1", blockNumber: "0x10", blockHash: "0x" + "ab".repeat(32), gasUsed: "0x5208", effectiveGasPrice: "0x3b9aca00", logs: [], cumulativeGasUsed: "0x5208", from: "0x0000000000000000000000000000000000000001", to: "0x0000000000000000000000000000000000000002", transactionIndex: "0x0", type: "0x2", contractAddress: null, logsBloom: "0x" + "00".repeat(256) }
              : null,
          );
        case "eth_blockNumber":
          return reply("0x10");
        default:
          return reply(null);
      }
    });
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    servers.push(s);
    return `http://127.0.0.1:${(s.address() as any).port}`;
  }
  const setup = async (url: string) => {
    const home = tmp();
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(home, "config.json"), JSON.stringify({ version: 1, rpcOverrides: { "998745": [url] } }));
    return testContext(home, testSigner());
  };
  it("'already known' after submission waits for the receipt of the locally computed hash instead of failing", async () => {
    process.env.UP_RECEIPT_TIMEOUT_MS = "5000";
    process.env.UP_POLL_MS = "20";
    const ctx = await setup(await mockChain("already-known", true));
    const out = await sendTx(ctx, await ctx.signer(), { chainId: 998745, to: "0x0000000000000000000000000000000000000002", value: 1n });
    expect(out.status).toBe("success");
    expect(out.hash).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it("an ambiguous failure reports the hash and nonce and tells the agent not to resend", async () => {
    const ctx = await setup(await mockChain("timeout", false));
    await expect(sendTx(ctx, await ctx.signer(), { chainId: 998745, to: "0x0000000000000000000000000000000000000002", value: 1n })).rejects.toMatchObject({
      code: "TX_FAILED",
      details: { nonce: 7 },
      hint: expect.stringMatching(/do NOT rebuild and resend/),
    });
  });
});
