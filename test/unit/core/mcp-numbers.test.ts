// Big integers at the MCP boundary (handleMcpMessage → coerceArgs → verb): a JSON number above 2^53 - 1 has
// already been rounded by JSON.parse, so it is refused before any conversion to a string (channel, wei
// amounts, every string option) and integer options must be safe integers. Decimal and 0x strings stay exact
// up to the uint128 bound of a nonce channel; fractions, signs, exponents and out-of-range values are refused
// before any chain read, signature or relayer request.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../../../src/verbs/index.ts";
import { handleMcpMessage } from "../../../src/mcp/server.ts";
import { coerceArgs, getVerb } from "../../../src/core/verbs.ts";
import { execOptions } from "../../../src/exec/verbs.ts";
import type { VerbDef } from "../../../src/core/types.ts";

const U128 = (1n << 128n) - 1n;
const PROFILE = "0x" + "11".repeat(20);
const TARGET = "0x" + "22".repeat(20);
let home: string;
let network = 0;

/** The JSON text exactly as an MCP client sends it (numbers are parsed here, like on stdin). */
const call = async (tool: string, argumentsJson: string): Promise<any> =>
  ((await handleMcpMessage(JSON.parse(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"${tool}","arguments":${argumentsJson}}}`))) as any).result;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "up-mcp-num-"));
  writeFileSync(join(home, "config.json"), JSON.stringify({ version: 1, defaultChain: 42 }), { mode: 0o600 });
  process.env.UP_HOME = home;
  // any network use (RPC, relayer) would be a failure of "refused before anything happens"
  vi.stubGlobal("fetch", async () => {
    network++;
    throw new Error("no network in this test");
  });
});
afterAll(() => vi.unstubAllGlobals());

describe("MCP: JSON numbers above 2^53 - 1 are refused before string coercion", () => {
  it("channel 18446744073709551617 as a JSON number: BAD_ARGS, nothing read or sent (was silently 18446744073709552000)", async () => {
    const r = await call("up_exec_relay", `{"profile":"${PROFILE}","to":"${TARGET}","data":"0x01","channel":18446744073709551617}`);
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error.code).toBe("BAD_ARGS");
    expect(r.structuredContent.error.message).toMatch(/--channel: a JSON number above 2\^53 - 1 is not exact .*decimal or 0x string/);
    expect(network).toBe(0);
  });

  it("2^53 itself is refused (it may stand for 2^53 + 1), and so is a nonce channel for the nonce verbs", async () => {
    for (const [tool, args] of [
      ["up_exec_send", `{"profile":"${PROFILE}","to":"${TARGET}","data":"0x01","channel":9007199254740992}`],
      ["up_nonce", `{"profile":"${PROFILE}","channel":340282366920938463463374607431768211455}`],
      ["up_nonce_channel_create", `{"profile":"${PROFILE}","channel":340282366920938463463374607431768211455}`],
    ]) {
      const r = await call(tool, args);
      expect(r.structuredContent.error?.code, tool).toBe("BAD_ARGS");
      expect(r.structuredContent.error.message, tool).toMatch(/not exact/);
    }
    expect(network).toBe(0);
  });

  it("the same guard protects wei amounts and integer options (no silently different value or validity window)", async () => {
    const v = await call("up_exec_send", `{"profile":"${PROFILE}","to":"${TARGET}","value":1000000000000000001}`);
    expect(v.structuredContent.error.code).toBe("BAD_ARGS");
    expect(v.structuredContent.error.message).toMatch(/--value: a JSON number above 2\^53 - 1/);
    const w = await call("up_exec_relay", `{"profile":"${PROFILE}","to":"${TARGET}","data":"0x01","valid-until":1152921504606846976}`);
    expect(w.structuredContent.error.code).toBe("BAD_ARGS");
    expect(w.structuredContent.error.message).toMatch(/--valid-until is too large to be exact/);
    const def: VerbDef = { name: "t", group: "t", summary: "t", risk: "local", params: [{ name: "xs", type: "string[]", description: "list of values" }], run: async () => ({ data: null }) };
    expect(() => coerceArgs(def, JSON.parse('{"xs":[1,18446744073709551617]}'))).toThrow(/--xs: a JSON number above 2\^53 - 1/);
    expect(coerceArgs(def, JSON.parse('{"xs":[1,2]}')).xs).toEqual(["1", "2"]);
    expect(network).toBe(0);
  });

  it("safe JSON numbers keep working at the MCP boundary (a channel saved through up_nonce_channel_create)", async () => {
    const r = await call("up_nonce_channel_create", `{"profile":"${PROFILE}","channel":7,"yes":true}`);
    expect(r.isError).toBe(false);
    expect(r.structuredContent.data).toMatchObject({ created: true, relayChannel: { channel: "7", source: "adopted" } });
    expect(JSON.parse(readFileSync(join(home, "profiles", `${PROFILE.toLowerCase()}.json`), "utf8")).relayChannel.channel).toBe("7");
  });

  it("decimal and 0x strings are exact up to 2^128 - 1 (through MCP and the CLI path), 2^128 and malformed values are BAD_ARGS", async () => {
    const big = "0x" + "AB".repeat(20);
    const r = await call("up_nonce_channel_create", `{"profile":"${big}","channel":"${U128}","yes":true}`);
    expect(r.structuredContent.data.relayChannel.channel).toBe(U128.toString());
    const hexProfile = "0x" + "cd".repeat(20);
    const h = await call("up_nonce_channel_create", `{"profile":"${hexProfile}","channel":"0x${(U128 - 5n).toString(16)}","yes":true}`);
    expect(h.structuredContent.data.relayChannel.channel).toBe((U128 - 5n).toString());
    const v = getVerb("exec relay")!;
    expect(execOptions(coerceArgs(v, { channel: U128.toString() })).channel).toBe(U128);
    expect(execOptions(coerceArgs(v, { channel: "0x" + U128.toString(16) })).channel).toBe(U128);
    expect(execOptions(coerceArgs(v, JSON.parse('{"channel":9007199254740991}'))).channel).toBe(9007199254740991n);
    expect(() => execOptions(coerceArgs(v, JSON.parse('{"channel":18446744073709551617}')))).toThrow(/not exact/);
    for (const bad of [(U128 + 1n).toString(), "-1", "1.5", "1e3", "0b11", "0o7", " 7", "7 ", "0x", "abc"]) {
      const e = await call("up_exec_relay", `{"profile":"${PROFILE}","to":"${TARGET}","data":"0x01","channel":"${bad}"}`);
      expect(e.structuredContent.error?.code, bad).toBe("BAD_ARGS");
      expect(e.structuredContent.error.message, bad).toMatch(/--channel (must be a non-negative integer, given as a decimal or 0x string|is out of range \(at most 2\^128 - 1\))/);
    }
    expect(network).toBe(0);
  });
});
