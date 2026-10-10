import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgv } from "../../../src/core/args.ts";
import { defineVerb, coerceArgs, matchVerb, mcpToolName, inputSchema } from "../../../src/core/verbs.ts";
import { requireConsent, policyAllows, DEFAULT_POLICY, savePolicy } from "../../../src/core/policy.ts";
import { UpError } from "../../../src/core/errors.ts";
import { redact, toJson } from "../../../src/core/json.ts";
import { writeFileAtomic, paths } from "../../../src/core/home.ts";
import { createRegistry } from "../../../src/chain/registry.ts";
import { createRpcManager } from "../../../src/chain/rpc.ts";
import { decodeRevert } from "../../../src/chain/tx.ts";
import { encodeErrorResult, parseAbi } from "viem";

const tmp = () => mkdtempSync(join(tmpdir(), "up-core-"));

describe("argv parser", () => {
  it("parses words, flags, =values, repeated flags, --no-x and --", () => {
    const r = parseArgv(["exec", "send", "--to", "0xabc", "--value=5", "--yes", "--no-json", "--arg", "1", "--arg", "2", "--", "--literal"]);
    expect(r.words).toEqual(["exec", "send", "--literal"]);
    expect(r.options).toEqual({ to: "0xabc", value: "5", yes: true, json: false, arg: ["1", "2"] });
  });
});

describe("verb registry", () => {
  const v = defineVerb({
    name: "test echo",
    group: "test",
    summary: "echo",
    risk: "local",
    params: [
      { name: "count", type: "integer", description: "n", required: true },
      { name: "names", type: "string[]", description: "list" },
      { name: "mode", type: "string", description: "m", enum: ["a", "b"], default: "a" },
      { name: "flag", type: "boolean", description: "f" },
      { name: "obj", type: "json", description: "j" },
    ],
    async run(_ctx, a) {
      return { data: a };
    },
  });
  it("matches longest verb prefix and builds MCP names", () => {
    expect(matchVerb(["test", "echo", "x"])?.rest).toEqual(["x"]);
    expect(mcpToolName("account 4337 enable")).toBe("up_account_4337_enable");
    const s: any = inputSchema(v);
    expect(s.required).toEqual(["count"]);
    expect(s.properties.names.type).toBe("array");
    expect(s.properties.chain).toBeDefined(); // global params included
  });
  it("coerces CLI strings and validates", () => {
    expect(coerceArgs(v, { count: "3", names: "a, b", flag: "false", obj: '{"x":1}' })).toMatchObject({ count: 3, names: ["a", "b"], flag: false, obj: { x: 1 }, mode: "a" });
    expect(() => coerceArgs(v, {})).toThrow(/missing required/);
    expect(() => coerceArgs(v, { count: "1.5" })).toThrow(/integer/);
    expect(() => coerceArgs(v, { count: 1, mode: "z" })).toThrow(/one of/);
    expect(() => coerceArgs(v, { count: 1, bogus: 1 })).toThrow(/unknown option/);
  });
});

describe("consent policy", () => {
  let home: string;
  beforeEach(() => {
    home = tmp();
  });
  const base = { json: true, dryRun: false, yes: false };
  it("read/local never need consent; dry-run never needs consent", async () => {
    await requireConsent(home, base, { verb: "x", risk: "read", summary: {} });
    await requireConsent(home, { ...base, dryRun: true }, { verb: "x", risk: "admin", summary: {} });
  });
  it("write needs --yes within policy, else CONSENT_REQUIRED", async () => {
    await expect(requireConsent(home, base, { verb: "exec send", risk: "write", chainId: 42, summary: { to: "0x1" } })).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    await requireConsent(home, { ...base, yes: true }, { verb: "exec send", risk: "write", chainId: 42, summary: {}, value: 0n });
    const audit = readFileSync(paths.audit(home), "utf8");
    expect(audit).toContain('"decision":"policy"');
  });
  it("native value above the policy cap is denied with --yes but allowed with --approval", async () => {
    await expect(requireConsent(home, { ...base, yes: true }, { verb: "exec send", risk: "write", chainId: 42, value: 1n, summary: {} })).rejects.toMatchObject({ code: "POLICY_DENIED" });
    await requireConsent(home, { ...base, approval: "yes send 1 wei" }, { verb: "exec send", risk: "write", chainId: 42, value: 1n, summary: {} });
  });
  it("admin needs a human approval unless policy.allowAdmin", async () => {
    await expect(requireConsent(home, { ...base, yes: true }, { verb: "controller add", risk: "admin", summary: {} })).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    await savePolicy(home, { ...DEFAULT_POLICY, allowAdmin: true });
    await requireConsent(home, { ...base, yes: true }, { verb: "controller add", risk: "admin", summary: {} });
  });
  it("policy target/selector/chain filters", () => {
    const p = { ...DEFAULT_POLICY, chains: [42], targets: ["0xAbC0000000000000000000000000000000000001"], selectors: ["0xa9059cbb"], maxValuePerTx: { "*": "100" }, allowTokenMoves: true, tokenTargets: ["*"] } as any;
    expect(policyAllows(p, { verb: "v", risk: "write", chainId: 1, summary: {} }).ok).toBe(false);
    expect(policyAllows(p, { verb: "v", risk: "write", chainId: 42, target: "0xabc0000000000000000000000000000000000001", selector: "0xA9059CBB", value: 100n, summary: {} }).ok).toBe(true);
    expect(policyAllows(p, { verb: "v", risk: "write", chainId: 42, target: "0xabc0000000000000000000000000000000000002", summary: {} }).ok).toBe(false);
  });
});

describe("json + home helpers", () => {
  it("redacts secret-shaped keys and serialises bigint", () => {
    expect(JSON.parse(toJson(redact({ privateKey: "0xdead", nested: { apiKey: "k", ok: 1n } })))).toEqual({ privateKey: "[redacted]", nested: { apiKey: "[redacted]", ok: "1" } });
  });
  it("writes files atomically with 0600 in a 0700 dir", async () => {
    const home = tmp();
    const f = join(home, "sub", "x.json");
    await writeFileAtomic(f, "{}");
    expect(statSync(f).isFile()).toBe(true);
    // Windows has no POSIX modes (key files there are protected by DPAPI / the user profile ACL).
    if (process.platform !== "win32") {
      expect(statSync(f).mode & 0o777).toBe(0o600);
      expect(statSync(join(home, "sub")).mode & 0o777).toBe(0o700);
    }
  });
});

describe("registry", () => {
  it("resolves chains by id, slug, alias; knows canonical addresses", () => {
    const r = createRegistry(tmp());
    expect(r.chain(42).slug).toBe("lukso");
    expect(r.chain("lukso-testnet").chainId).toBe(4201);
    expect(r.chain("base").chainId).toBe(8453);
    expect(r.chain("arbitrum").chainId).toBe(42161);
    expect(() => r.chain(999999999)).toThrow(UpError);
    expect(r.canonical("UniversalProfileInit", "0.14.0")).toBe("0x3024D38EA2434BA6635003Dc1BDC0daB5882ED4F");
    expect(r.canonical("LSP23LinkedContractsFactory")).toBe("0x2300000A84D25dF63081feAa37ba6b62C4c89a30");
    const counts = r.chains().length;
    expect(counts).toBe(75);
    expect(r.chains().filter((c) => c.lsp.deployed).length).toBe(73);
    // every chain has at least one RPC and an explorer
    for (const c of r.chains()) {
      expect(c.rpcs.length).toBeGreaterThan(0);
      expect(c.explorers.length).toBeGreaterThan(0);
    }
  });
});

describe("rpc manager failover", () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
  });
  const serve = async (handler: (m: any) => any): Promise<string> => {
    const s = createServer(async (req, res) => {
      let b = "";
      for await (const c of req) b += c;
      const out = handler(JSON.parse(b));
      if (out === "500") {
        res.writeHead(500);
        res.end("x");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(out));
    });
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    servers.push(s);
    return `http://127.0.0.1:${(s.address() as any).port}`;
  };
  const block = () => ({ number: "0x10", timestamp: "0x" + Math.floor(Date.now() / 1000).toString(16) });

  it("skips a wrong-chain and a failing endpoint, uses the healthy one, records health", async () => {
    const home = tmp();
    const wrong = await serve((m) => ({ jsonrpc: "2.0", id: m.id, result: m.method === "eth_chainId" ? "0x1" : block() }));
    const broken = await serve(() => "500");
    const good = await serve((m) => ({ jsonrpc: "2.0", id: m.id, result: m.method === "eth_chainId" ? "0x2a" : m.method === "eth_blockNumber" ? "0x10" : block() }));
    const registry = createRegistry(home);
    const rpc = createRpcManager(home, registry, async () => ({ version: 1, rpcOverrides: { "42": [wrong, broken, good] } }) as any);
    // force only our endpoints: registry rpcs come after user overrides, and our good one succeeds first
    expect(await rpc.request(42, "eth_blockNumber")).toBe("0x10");
    const health = JSON.parse(readFileSync(paths.cache(home, "rpc-health.json"), "utf8"))["42"];
    expect(health[wrong].ok).toBe(false);
    expect(health[wrong].error).toMatch(/eth_chainId returned 1/);
    expect(health[broken].ok).toBe(false);
    expect(health[good].ok).toBe(true);
  });

  it("does not fail over on execution reverts (application errors)", async () => {
    const home = tmp();
    let calls = 0;
    const reverting = await serve((m) => {
      if (m.method === "eth_call") {
        calls++;
        return { jsonrpc: "2.0", id: m.id, error: { code: 3, message: "execution reverted", data: "0x08c379a0" } };
      }
      return { jsonrpc: "2.0", id: m.id, result: m.method === "eth_chainId" ? "0x2a" : block() };
    });
    const second = await serve((m) => ({ jsonrpc: "2.0", id: m.id, result: m.method === "eth_chainId" ? "0x2a" : m.method === "eth_call" ? "0x" : block() }));
    const rpc = createRpcManager(home, createRegistry(home), async () => ({ version: 1, rpcOverrides: { "42": [reverting, second] } }) as any);
    await expect(rpc.request(42, "eth_call", [{}, "latest"])).rejects.toThrow(/execution reverted/);
    expect(calls).toBe(1);
  });
});

describe("revert decoding", () => {
  it("decodes LSP6 NotAuthorised and Error(string)", () => {
    const abi = parseAbi(["error NotAuthorised(address from, string permission)"]);
    const data = encodeErrorResult({ abi, errorName: "NotAuthorised", args: ["0x0000000000000000000000000000000000000001", "TRANSFERVALUE"] });
    const d = decodeRevert(data);
    expect(d.errorName).toBe("NotAuthorised");
    expect(d.message).toContain("TRANSFERVALUE");
    const e = decodeRevert(encodeErrorResult({ abi: parseAbi(["error Error(string)"]), errorName: "Error", args: ["boom"] }));
    expect(e.message).toBe("Error(boom)");
    expect(decodeRevert("0x").message).toMatch(/without reason/);
  });
});

describe("state dir paths", () => {
  it("never puts profiles outside home", () => {
    const home = tmp();
    expect(paths.profile(home, "0xABC").startsWith(home)).toBe(true);
    expect(existsSync(home)).toBe(true);
  });
});
