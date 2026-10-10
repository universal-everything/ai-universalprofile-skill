import { describe, expect, it, beforeAll, afterEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../../../src/verbs/setup.ts";
import { handleMcpMessage } from "../../../src/mcp/server.ts";
import { findRpcs } from "../../../src/chain/discovery.ts";

describe("MCP stdio server", () => {
  beforeAll(() => {
    process.env.UP_HOME = mkdtempSync(join(tmpdir(), "up-mcp-"));
  });
  it("negotiates the protocol version and lists tools with JSON schemas + annotations", async () => {
    const init: any = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(init.result.capabilities.tools).toBeDefined();
    expect(await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeUndefined();
    const list: any = await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const names = list.result.tools.map((t: any) => t.name);
    expect(names).toContain("up_doctor");
    expect(names).toContain("up_chains_rpc_find");
    const cfgSet = list.result.tools.find((t: any) => t.name === "up_config_set");
    expect(cfgSet.inputSchema.required).toEqual(["key", "value"]);
    expect(list.result.tools.find((t: any) => t.name === "up_policy_set").annotations.destructiveHint).toBe(true);
    expect(list.result.tools.find((t: any) => t.name === "up_chains_list").annotations.readOnlyHint).toBe(true);
  });
  it("calls tools and returns structured content; errors are isError results, not protocol errors", async () => {
    const r: any = await handleMcpMessage({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "up_chains_list", arguments: { filter: "lukso" } } });
    expect(r.result.isError).toBe(false);
    expect(r.result.structuredContent.data.chains.map((c: any) => c.chainId).sort()).toEqual([42, 4201]);
    const bad: any = await handleMcpMessage({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "up_config_set", arguments: { key: "default-chain" } } });
    expect(bad.result.isError).toBe(true);
    expect(bad.result.structuredContent.error.code).toBe("BAD_ARGS");
    const unknown: any = await handleMcpMessage({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "up_nope", arguments: {} } });
    expect(unknown.error.code).toBe(-32602);
    const nf: any = await handleMcpMessage({ jsonrpc: "2.0", id: 6, method: "bogus/method" });
    expect(nf.error.code).toBe(-32601);
  });
});

describe("RPC discovery (chainlist)", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("probes candidates, keeps only chainId-correct fresh endpoints, ranks by tracking/latency and stores them", async () => {
    const home = mkdtempSync(join(tmpdir(), "up-disc-"));
    const now = Math.floor(Date.now() / 1000);
    const rpcBehaviour: Record<string, (m: string) => any> = {
      "https://good.example": (m) => (m === "eth_chainId" ? "0x1069" : { number: "0x5", timestamp: "0x" + now.toString(16) }),
      "https://wrongchain.example": (m) => (m === "eth_chainId" ? "0x1" : { number: "0x5", timestamp: "0x" + now.toString(16) }),
      "https://stale.example": (m) => (m === "eth_chainId" ? "0x1069" : { number: "0x5", timestamp: "0x" + (now - 99999).toString(16) }),
    };
    vi.stubGlobal("fetch", async (url: string, init?: any) => {
      if (url === "https://chainlist.org/rpcs.json")
        return new Response(JSON.stringify([{ chainId: 4201, name: "LUKSO Testnet", rpc: [{ url: "https://wrongchain.example", tracking: "none" }, { url: "https://stale.example", tracking: "none" }, { url: "https://good.example", tracking: "limited" }, { url: "https://${INFURA_KEY}.example" }, "wss://ws.example"] }]));
      if (url === "https://chainid.network/chains.json") return new Response("[]");
      const beh = rpcBehaviour[url];
      if (!beh) return new Response("nope", { status: 503 });
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: beh(body.method) }));
    });
    const r = await findRpcs(home, 4201);
    expect(r.working.map((w) => w.url)).toEqual(["https://good.example"]);
    expect(r.working[0].trust).toBe("remote-discovered");
    expect(r.checked.length).toBe(3); // template + wss filtered out
  });
});
