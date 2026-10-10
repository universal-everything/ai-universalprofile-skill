// Every verb registered by the account core (lsp, exec, relayer modules) must be
// exercised at least once through getVerb(name).run(ctx, coerceArgs(...)) in the
// chain tests, and must produce a valid MCP input schema.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import "../../../src/lsp/verbs.ts";
import "../../../src/relayer/verbs.ts";
import { allVerbs, inputSchema, mcpToolName } from "../../../src/core/verbs.ts";

const chainDir = join(import.meta.dirname, "..", "..", "chain");
const sources = ["account.test.ts", "permissions.test.ts", "relay.test.ts", "exec.test.ts", "multichain.test.ts", "metadata.test.ts"].map((f) => readFileSync(join(chainDir, f), "utf8")).join("\n");
const ours = allVerbs();

describe("account-core verb surface", () => {
  it("registers the expected verbs", () => {
    const names = ours.map((v) => v.name);
    for (const n of [
      "account precompute", "account deploy", "account info", "account data get", "account data set", "account manifest show", "account manifest export",
      "account extensions add", "account extensions remove", "account urd set", "profile join",
      "profile metadata show", "profile metadata set", "profile url",
      "permissions list", "permissions show", "permissions encode", "permissions decode", "permissions presets", "permissions recommend",
      "controller add", "controller edit", "controller remove", "allowed-calls set", "allowed-calls show", "allowed-keys set", "allowed-keys show",
      "ownership transfer", "ownership accept", "ownership renounce",
      "exec call", "exec send", "exec relay", "exec batch", "exec simulate", "exec receipt", "nonce",
      "sign message", "sign typed-data", "verify-1271",
      "relayer add", "relayer list", "relayer remove", "relayer quota", "relayer execute",
    ]) expect(names, n).toContain(n);
  });

  it.each(ours.map((v) => [v.name]))("%s is exercised in a chain test", (name) => {
    const re = new RegExp(`run\\([^,()]+(\\([^)]*\\))?[^,()]*,\\s*"${name.replace(/[-]/g, "\\-")}"`);
    expect(re.test(sources), `no chain test runs "${name}"`).toBe(true);
  });

  it.each(ours.map((v) => [v.name]))("%s has a valid MCP schema and risk class", (name) => {
    const v = ours.find((x) => x.name === name)!;
    const s = inputSchema(v) as any;
    expect(s.type).toBe("object");
    expect(mcpToolName(v.name)).toMatch(/^up_[a-z0-9_]+$/);
    expect(["local", "read", "write", "admin", "secret"]).toContain(v.risk);
    for (const p of v.params) expect(p.description.length, `${name} --${p.name}`).toBeGreaterThan(5);
  });
});
