import { describe, expect, it } from "vitest";
import { parseEther } from "viem";
import { AA_ERRORS, BUNDLER_RPC_ERRORS, aaUpError, explainAA } from "../../../src/erc4337/aa-errors.ts";
import { redactUrl, validateBundlerUrl } from "../../../src/erc4337/bundler.ts";
import { callsFromArgs, parseAmount } from "../../../src/erc4337/verbs.ts";
import { allVerbs, coerceArgs, getVerb, inputSchema } from "../../../src/core/verbs.ts";
import { availablePaths } from "../../../src/exec/transport.ts";
import { UpError } from "../../../src/core/errors.ts";

describe("AA error dictionary (EntryPoint v0.6)", () => {
  it("covers every v0.6 FailedOp code AA10–AA96", () => {
    for (const c of ["AA10", "AA13", "AA14", "AA15", "AA20", "AA21", "AA22", "AA23", "AA24", "AA25", "AA30", "AA31", "AA32", "AA33", "AA34", "AA40", "AA41", "AA50", "AA51", "AA90", "AA91", "AA92", "AA93", "AA94", "AA95", "AA96"]) {
      expect(AA_ERRORS[c], c).toBeDefined();
      expect(AA_ERRORS[c].reason.startsWith(c)).toBe(true);
    }
  });
  it("maps the Universal-Profile-specific meanings", () => {
    const wrongEp = explainAA("AA23 reverted: Only EntryPoint contract can call this");
    expect(wrongEp.code).toBe("AA23");
    expect(wrongEp.up).toMatch(/different EntryPoint/);
    expect(explainAA("AA23 reverted (or OOG)").up).toMatch(/NotAuthorised/);
    expect(explainAA("AA24 signature error").up).toMatch(/bit 23/);
    expect(explainAA("AA21 didn't pay prefund").up).toMatch(/never pays prefund/);
    expect(explainAA("AA25 invalid account nonce").code).toBe("AA25");
    expect(explainAA("something else").code).toBeUndefined();
    // bundler messages embed the reason
    expect(explainAA("UserOperation reverted during simulation with reason: AA24 signature error").code).toBe("AA24");
  });
  it("aaUpError carries the code and a hint", () => {
    const e = aaUpError("AA24 signature error", "handleOps");
    expect(e).toBeInstanceOf(UpError);
    expect(e.code).toBe("NOT_AUTHORISED");
    expect(e.hint).toMatch(/enable/);
    expect((e.details as any).aa.code).toBe("AA24");
    expect(aaUpError("AA21 didn't pay prefund", "x").hint).toMatch(/deposit/);
  });
  it("knows the ERC-7769 bundler error codes", () => {
    expect(BUNDLER_RPC_ERRORS[-32500]).toMatch(/simulateValidation/);
    expect(BUNDLER_RPC_ERRORS[-32507]).toMatch(/signature/);
  });
});

describe("bundler URL handling", () => {
  it("never prints credentials", () => {
    expect(redactUrl("https://api.pimlico.io/v1/42/rpc?apikey=pim_SECRETSECRET")).toBe("https://api.pimlico.io/v1/42/rpc?apikey=***");
    expect(redactUrl("https://user:pass@bundler.example.com/rpc")).not.toMatch(/pass/);
    expect(redactUrl("https://bundler.example.com/v2/abcdefghijklmnopqrstuvwxyz0123456789")).not.toMatch(/abcdefghij/);
  });
  it("requires https except for localhost", () => {
    expect(() => validateBundlerUrl("http://bundler.example.com")).toThrow(/https/);
    expect(validateBundlerUrl("http://127.0.0.1:4337")).toBe("http://127.0.0.1:4337/");
    expect(() => validateBundlerUrl("not a url")).toThrow(/invalid/);
  });
});

describe("verb inputs", () => {
  it("parses amounts strictly", () => {
    expect(parseAmount("1000")).toBe(1000n);
    expect(parseAmount("0.5 ether")).toBe(parseEther("0.5"));
    expect(parseAmount("1lyx")).toBe(parseEther("1"));
    expect(parseAmount("10 gwei")).toBe(10_000_000_000n);
    expect(parseAmount(42)).toBe(42n);
    expect(() => parseAmount("0.5")).toThrow(/no unit/);
    expect(() => parseAmount("-1")).toThrow();
    expect(() => parseAmount("1 dogecoin")).toThrow(/unknown unit/);
  });
  it("builds calls like exec send (--to/--value/--data, --fn/--args, --calls, --payload)", () => {
    const to = "0x3333333333333333333333333333333333333333";
    expect(callsFromArgs({ to, value: "0.1 ether" }).calls).toEqual([{ operation: 0, to, value: parseEther("0.1"), data: "0x" }]);
    const fn = callsFromArgs({ to, fn: "transfer(address to, uint256 amount)", args: JSON.stringify([to, "5"]) }).calls![0];
    expect(fn.data.slice(0, 10)).toBe("0xa9059cbb");
    const batch = callsFromArgs({ calls: JSON.stringify([{ to, value: "1" }, { to, data: "0x1234", operation: "STATICCALL" }]) }).calls!;
    expect(batch.map((c) => c.operation)).toEqual([0, 3]);
    expect(callsFromArgs({ payload: "0x97902421" })).toEqual({ payload: "0x97902421" });
    expect(() => callsFromArgs({})).toThrow(/missing --to/);
    expect(() => callsFromArgs({ to, operation: "DELEGATECALL" })).toThrow(/DELEGATECALL/);
    expect(() => callsFromArgs({ to, calls: "[]" })).toThrow(/either/);
    expect(() => callsFromArgs({ to: "0x12" })).toThrow(/address/);
  });
  it("registers the module's verbs with valid schemas and the userop transport", () => {
    const names = ["account 4337 status", "account 4337 deploy-entrypoint", "account 4337 deploy-extension", "account 4337 enable", "account 4337 disable", "account 4337 deposit", "account 4337 withdraw", "exec userop", "bundler set"];
    for (const n of names) {
      const v = getVerb(n);
      expect(v, n).toBeDefined();
      expect(inputSchema(v!)).toMatchObject({ type: "object" });
    }
    expect(getVerb("account 4337 enable")!.risk).toBe("admin");
    expect(getVerb("account 4337 disable")!.risk).toBe("admin");
    expect(getVerb("account 4337 deploy-entrypoint")!.risk).toBe("admin");
    expect(getVerb("account 4337 deploy-extension")!.risk).toBe("admin");
    expect(getVerb("exec userop")!.risk).toBe("write");
    expect(getVerb("account 4337 deposit")!.risk).toBe("write");
    expect(getVerb("account 4337 status")!.risk).toBe("read");
    expect(getVerb("bundler set")!.risk).toBe("local");
    expect(allVerbs().length).toBeGreaterThanOrEqual(names.length);
    expect(availablePaths()).toContain("userop");
    // enable keeps an existing EntryPoint controller unless a scope is passed: no default
    expect(coerceArgs(getVerb("account 4337 enable")!, {})["ep-scope"]).toBeUndefined();
    expect(coerceArgs(getVerb("bundler set")!, { chain: "42", url: "none" }).verify).toBe(true);
  });
});
