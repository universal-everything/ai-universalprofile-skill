import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeFunctionData, parseAbi, parseEther, zeroAddress, type Address, type Hex } from "viem";
import { testContext, testSigner } from "../../support/context.ts";
import { buildCall, buildCalls, coerceArg, loadAbi, parseOperation, parseValue, resolveFunction } from "../../../src/exec/inputs.ts";
import { confirmationBlock, consentForRequest, decodeCalldata, encodeUpExecute, payloadRisk, upPayload, validateRequest, decodeReceiptEvents } from "../../../src/exec/common.ts";
import { buildKmEntry } from "../../../src/exec/km.ts";
import { buildLsp0Entry } from "../../../src/exec/lsp0.ts";
import { OPERATION } from "../../../src/exec/transport.ts";
import { UP_ABI, KM_ABI } from "../../../src/lsp/abis.ts";
import { DATA_KEYS, permissionsKey } from "../../../src/lsp/constants.ts";
import { savePolicy, DEFAULT_POLICY } from "../../../src/core/policy.ts";

const UP = "0xBB645D97B0c7D101ca0d73131e521fe89B463BFD" as Address;
const KM = "0x2Fe3AeD98684E7351aD2D408A43cE09a738BF8a4" as Address;
const T1 = "0x1111111111111111111111111111111111111111" as Address;
const T2 = "0x2222222222222222222222222222222222222222" as Address;

function home(): string {
  const h = mkdtempSync(join(tmpdir(), "up-unit-"));
  writeFileSync(join(h, "config.json"), JSON.stringify({ version: 1, defaultChain: 42 }));
  return h;
}

describe("call inputs", () => {
  it("parses values in wei, hex and with units", () => {
    expect(parseValue("1000")).toBe(1000n);
    expect(parseValue("0x10")).toBe(16n);
    expect(parseValue("1.5ether")).toBe(parseEther("1.5"));
    expect(parseValue("0.5 lyx")).toBe(parseEther("0.5"));
    expect(parseValue("20gwei")).toBe(20_000_000_000n);
    expect(parseValue(undefined)).toBe(0n);
    expect(() => parseValue("1.5")).toThrow(/cannot parse/);
    expect(() => parseValue(-1)).toThrow();
  });
  it("parses operations", () => {
    expect(parseOperation("staticcall")).toBe(3);
    expect(parseOperation(undefined)).toBe(0);
    expect(() => parseOperation("jump")).toThrow();
  });
  it("encodes --fn/--args with type coercion (decimal strings → uint)", () => {
    const b = buildCall({ to: T1, fn: "transfer(address,uint256)", args: [T2, "1000000000000000000000"] });
    expect(b.call.data).toBe(encodeFunctionData({ abi: parseAbi(["function transfer(address,uint256)"]), functionName: "transfer", args: [T2, 10n ** 21n] }));
    expect(b.call.operation).toBe(0);
    expect(() => buildCall({ to: T1, fn: "transfer(address,uint256)", args: [T2] })).toThrow(/expects 2/);
    expect(() => buildCall({ to: T1, fn: "transfer(address,uint256)", args: ["nope", "1"] })).toThrow(/address/);
    expect(() => buildCall({ to: T1, fn: "transfer", args: [] })).toThrow(/signature/);
    expect(() => buildCall({ to: T1, data: "0x12", fn: "x()" })).toThrow(/either/);
    expect(() => buildCall({ to: "nope" })).toThrow(/address/);
  });
  it("tuples, arrays and bools are coerced", () => {
    const fn = resolveFunction("f((uint256 a,address b)[] xs, bool ok)");
    expect(coerceArg(fn.inputs[0], [{ a: "5", b: T1 }])).toEqual([{ a: 5n, b: T1 }]);
    expect(coerceArg(fn.inputs[1], "true")).toBe(true);
  });
  it("loads bundled ABIs and resolves functions by name / overload signature", () => {
    const { abi, source } = loadAbi("LSP7DigitalAsset");
    expect(source).toBe("bundled:lsp/LSP7DigitalAsset");
    expect(() => resolveFunction("transfer", abi)).not.toThrow();
    const erc20 = loadAbi("ERC20");
    expect(erc20.source).toMatch(/reference\/ERC20/);
    const b = buildCall({ to: T1, abi: "ERC20", fn: "approve", args: [T2, "1"] });
    expect(b.call.data.slice(0, 10)).toBe("0x095ea7b3");
    expect(() => loadAbi("NoSuchContract")).toThrow(/no ABI/);
  });
  it("CREATE uses the zero address; batches", () => {
    expect(buildCall({ operation: "create", data: "0x6000" }).call.to).toBe(zeroAddress);
    const { calls } = buildCalls([{ to: T1, value: "1" }, { to: T2, data: "0xaa" }]);
    expect(calls.map((c) => c.to)).toEqual([T1, T2]);
    expect(() => buildCalls([])).toThrow();
  });
});

describe("payloads, entries, validation", () => {
  const one = { chainId: 42, profile: UP, calls: [{ operation: OPERATION.CALL, to: T1, value: 5n, data: "0x" as Hex }] };
  const two = { chainId: 42, profile: UP, calls: [{ operation: OPERATION.CALL, to: T1, value: 5n, data: "0x" as Hex }, { operation: OPERATION.CALL, to: T2, value: 7n, data: "0xaabbccdd" as Hex }] };
  it("UP payload: execute for one call, executeBatch for several, raw payload passthrough", () => {
    expect(upPayload(one).slice(0, 10)).toBe("0x44c028fe");
    expect(upPayload(two).slice(0, 10)).toBe("0x31858452");
    expect(upPayload({ chainId: 42, profile: UP, payload: "0x7f23690c" })).toBe("0x7f23690c");
    expect(() => upPayload({ chainId: 42, profile: UP })).toThrow();
    expect(() => upPayload({ ...one, payload: "0x7f23690c" })).toThrow();
  });
  it("km entry: value from the profile by default; fundFromController sends Σ values", () => {
    expect(buildKmEntry(one, false)).toMatchObject({ value: 0n, function: "execute(bytes)" });
    expect(buildKmEntry(one, true).value).toBe(5n);
    const b = buildKmEntry(two, false);
    expect(b.function).toBe("executeBatch(uint256[],bytes[])");
    expect(b.value).toBe(0n);
    expect(buildKmEntry(two, true).value).toBe(12n);
    expect(b.data).toBe(encodeFunctionData({ abi: KM_ABI, functionName: "executeBatch", args: [[0n, 0n], two.calls.map(encodeUpExecute)] }));
  });
  it("lsp0 entry calls the profile directly", () => {
    expect(buildLsp0Entry(one, false)).toMatchObject({ value: 0n, function: "execute(uint256,address,uint256,bytes)" });
    expect(buildLsp0Entry(two, true).value).toBe(12n);
  });
  it("refuses DELEGATECALL, calls to the KM, CREATE with a target, STATICCALL with value", () => {
    expect(() => validateRequest({ ...one, calls: [{ ...one.calls[0], operation: OPERATION.DELEGATECALL }] })).toThrow(/DELEGATECALL/);
    expect(() => validateRequest({ ...one, calls: [{ ...one.calls[0], to: KM }] }, KM)).toThrow(/CallingKeyManagerNotAllowed/);
    expect(() => validateRequest({ ...one, calls: [{ ...one.calls[0], operation: OPERATION.CREATE }] })).toThrow(/zero address/);
    expect(() => validateRequest({ ...one, calls: [{ ...one.calls[0], operation: OPERATION.STATICCALL }] })).toThrow(/STATICCALL/);
    expect(validateRequest({ ...one, calls: [{ ...one.calls[0], to: UP, data: "0x12345678" }] })[0]).toMatch(/calls itself/);
  });
  it("risk: admin for permission/URD/extension keys and ownership, write otherwise", () => {
    const sd = (k: Hex) => encodeFunctionData({ abi: UP_ABI, functionName: "setData", args: [k, "0x01"] });
    expect(payloadRisk(sd(DATA_KEYS.LSP3Profile))).toBe("write");
    expect(payloadRisk(sd(permissionsKey(T1)))).toBe("admin");
    expect(payloadRisk(sd(DATA_KEYS.LSP1UniversalReceiverDelegate))).toBe("admin");
    expect(payloadRisk(encodeFunctionData({ abi: UP_ABI, functionName: "setDataBatch", args: [[DATA_KEYS.LSP3Profile, DATA_KEYS["AddressPermissions[]"]], ["0x", "0x"]] }))).toBe("admin");
    expect(payloadRisk(encodeFunctionData({ abi: UP_ABI, functionName: "transferOwnership", args: [T1] }))).toBe("admin");
    expect(payloadRisk(encodeFunctionData({ abi: UP_ABI, functionName: "renounceOwnership" }))).toBe("admin");
  });
  it("decodes inner calldata with an ABI or the bundled selector table", () => {
    const data = encodeFunctionData({ abi: UP_ABI, functionName: "setData", args: [DATA_KEYS.LSP3Profile, "0x01"] });
    expect(decodeCalldata(data)).toMatchObject({ source: "bundled-selector" });
    expect(decodeCalldata(data).function).toMatch(/^setData\(/);
    expect(decodeCalldata("0x")).toEqual({ source: "value-transfer" });
    expect(decodeCalldata("0xdeadbeef").source).toBe("unknown");
    const abi = parseAbi(["function ping(uint256 x)"]);
    expect(decodeCalldata(encodeFunctionData({ abi, functionName: "ping", args: [1n] }), abi)).toMatchObject({ function: "ping", source: "abi" });
  });
  it("decodes receipt events (DataChanged, Executed, PermissionsVerified)", () => {
    const logs = [
      { address: UP, topics: ["0xece574603820d07bc9b91f2a932baadf4628aabcb8afba49776529c14a6104b2", DATA_KEYS.LSP3Profile], data: "0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000101" + "0".repeat(62) },
    ];
    const ev = decodeReceiptEvents({ logs: logs as any });
    expect(ev[0]).toMatchObject({ event: "DataChanged", address: UP });
  });
});

describe("confirmation block and consent integration", () => {
  const signer = testSigner();
  const req = { chainId: 42, profile: UP, calls: [{ operation: OPERATION.CALL, to: T1, value: parseEther("1"), data: "0x" as Hex }], verb: "exec send" };
  it("contains actor, chain, Key Manager, path, gas payer, value source, decoded calls and raw calldata", () => {
    const ctx = testContext(home(), signer);
    const entry = buildKmEntry(req, false);
    const c = confirmationBlock(ctx, req, { path: "km", keyManager: KM, gasPayer: `controller EOA ${signer.address}`, entry: { to: KM, ...entry }, payload: upPayload(req), signer: signer.address });
    expect(c).toMatchObject({ actor: UP, chainId: 42, keyManager: KM, path: "km", signer: signer.address, totalValue: parseEther("1").toString(), valueSource: "profile balance (ERC725X value field)" });
    expect(c.chain).toMatch(/LUKSO/);
    expect(c.totalValueFormatted).toBe("1 LYX");
    expect((c.calls as any[])[0]).toMatchObject({ operation: "CALL", to: T1, decodedBy: "value-transfer" });
    expect((c.entry as any).calldata).toBe(entry.data);
    expect(c.entryPath).toMatch(/Key Manager/);
  });
  it("CONSENT_REQUIRED without --yes/--approval; POLICY_DENIED for value under the default policy; admin needs approval", async () => {
    const h = home();
    const block = { actor: UP };
    await expect(consentForRequest(testContext(h, signer, { yes: false }), req, block)).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    await expect(consentForRequest(testContext(h, signer, { yes: true }), req, block)).rejects.toMatchObject({ code: "POLICY_DENIED" });
    await expect(consentForRequest(testContext(h, signer, { yes: true, approval: "send 1 LYX to 0x1111" }), req, block)).resolves.toBeUndefined();
    const admin = { chainId: 42, profile: UP, payload: encodeFunctionData({ abi: UP_ABI, functionName: "setData", args: [permissionsKey(T1), "0x01"] }) };
    const err = await consentForRequest(testContext(h, signer, { yes: true }), admin, block).catch((e) => e);
    expect(err.code).toBe("CONSENT_REQUIRED");
    expect(err.message).toMatch(/human approval/);
    await expect(consentForRequest(testContext(h, signer, { dryRun: true, yes: false }), admin, block)).resolves.toBeUndefined();
  });
  it("multi-target batches are checked against the policy per call", async () => {
    const h = home();
    await savePolicy(h, { ...DEFAULT_POLICY, targets: [T1] });
    const batch = { chainId: 42, profile: UP, calls: [{ operation: 0 as const, to: T1, value: 0n, data: "0x" as Hex }, { operation: 0 as const, to: T2, value: 0n, data: "0x" as Hex }] };
    const err = await consentForRequest(testContext(h, signer, { yes: true }), batch, {}).catch((e) => e);
    expect(err.code).toBe("POLICY_DENIED");
    expect(err.message).toMatch(/batch call/);
    await expect(consentForRequest(testContext(h, signer, { yes: true }), { ...batch, calls: [batch.calls[0], batch.calls[0]] }, {})).resolves.toBeUndefined();
  });
});

describe("decodeProfilePayload", async () => {
  const { decodeProfilePayload, encodeUpExecuteBatch } = await import("../../../src/exec/common.ts");
  it("execute / executeBatch: real total value, targets and inner selectors", () => {
    const d = decodeProfilePayload(encodeUpExecute({ operation: 0, to: T1, value: 9n, data: "0xa9059cbb00" }));
    expect(d).toMatchObject({ kind: "execute", totalValue: 9n, targets: [T1], innerSelectors: ["0xa9059cbb"], risk: "write" });
    const b = decodeProfilePayload(encodeUpExecuteBatch([{ operation: 0, to: T1, value: 1n, data: "0x" }, { operation: 0, to: T2, value: 2n, data: "0x12345678" }, { operation: 0, to: T1, value: 3n, data: "0x" }]));
    expect(b).toMatchObject({ kind: "executeBatch", totalValue: 6n, targets: [T1, T2], innerSelectors: ["0x", "0x12345678", "0x"] });
  });
  it("setData classes, ownership and unknown payloads", () => {
    const sd = (k: Hex) => encodeFunctionData({ abi: UP_ABI, functionName: "setData", args: [k, "0x01"] });
    expect(decodeProfilePayload(sd(DATA_KEYS.LSP3Profile))).toMatchObject({ kind: "setData", dataKeys: [DATA_KEYS.LSP3Profile], risk: "write" });
    expect(decodeProfilePayload(sd(permissionsKey(T1))).risk).toBe("admin");
    expect(decodeProfilePayload(sd(("0xcee78b4094da860110960000" + "3a871cdd" + "0".repeat(32)) as Hex)).risk).toBe("admin");
    expect(decodeProfilePayload(sd(DATA_KEYS.LSP1UniversalReceiverDelegate)).risk).toBe("admin");
    expect(decodeProfilePayload(encodeFunctionData({ abi: UP_ABI, functionName: "setDataBatch", args: [[DATA_KEYS.LSP3Profile, permissionsKey(T1)], ["0x", "0x"]] }))).toMatchObject({ kind: "setDataBatch", risk: "admin" });
    expect(decodeProfilePayload(encodeFunctionData({ abi: UP_ABI, functionName: "transferOwnership", args: [T2] }))).toMatchObject({ kind: "ownership", ownership: "transferOwnership", targets: [T2], risk: "admin" });
    expect(decodeProfilePayload(encodeFunctionData({ abi: UP_ABI, functionName: "acceptOwnership" }))).toMatchObject({ kind: "ownership", risk: "admin" });
    expect(decodeProfilePayload(encodeFunctionData({ abi: UP_ABI, functionName: "batchCalls", args: [[]] }))).toMatchObject({ kind: "unknown", risk: "admin" });
    expect(decodeProfilePayload("0xdeadbeef")).toMatchObject({ kind: "unknown", risk: "admin", totalValue: 0n });
  });
  it("raw payloads: confirmation shows the decoded calls/value and consent uses them", async () => {
    const h0 = home();
    const raw = { chainId: 42, profile: UP, payload: encodeUpExecute({ operation: 0, to: T1, value: parseEther("2"), data: "0x" }) };
    const c = confirmationBlock(testContext(h0, testSigner()), raw, { path: "km", keyManager: KM, gasPayer: "x", entry: { to: KM, data: "0x", value: 0n, function: "execute(bytes)" }, payload: raw.payload, signer: T2 });
    expect(c.totalValue).toBe(parseEther("2").toString());
    expect(c.payloadKind).toBe("execute");
    expect((c.calls as any[])[0].to).toBe(T1);
    const err = await consentForRequest(testContext(h0, testSigner(), { yes: true }), { ...raw, risk: "write" }, {}).catch((e) => e);
    expect(err.code).toBe("POLICY_DENIED");
    const adm = await consentForRequest(testContext(h0, testSigner(), { yes: true }), { chainId: 42, profile: UP, payload: "0xdeadbeef", risk: "write" }, {}).catch((e) => e);
    expect(adm.code).toBe("CONSENT_REQUIRED"); // caller-supplied "write" never downgrades an unknown payload
  });
});
