import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeFunctionData, encodeAbiParameters, encodeErrorResult, encodeEventTopics, encodeFunctionData, parseAbi, type Hex } from "viem";
import {
  coerceArgs,
  coerceValue,
  decodeCalldata,
  decodeErrorData,
  decodeLog,
  decodeParams,
  decodeReturn,
  encodeCall,
  encodeParams,
  fromBaseUnits,
  parseAbiInput,
  parseFragments,
  parseInteger,
  resolveFunction,
  toBaseUnits,
} from "../../../src/abi/codec.ts";
import { ERROR_ABIS } from "../../../src/chain/error-abis.ts";
import { bundledAbi, bundledIndexes, canonicalContracts, findBundled } from "../../../src/abi/bundled.ts";
import { canonicalSignature, humanSignature, selectorOf } from "../../../src/abi/signature.ts";

const A = "0x0F4180da178ed1C71398a57ca8Cb177F69591f1f";
const B = "0xf01103E5a9909Fc0DBe8166dA7085e0285daDDcA";

const fn = (sig: string) => parseFragments(sig)[0] as any;

describe("human units", () => {
  it("converts exactly and never rounds", () => {
    expect(toBaseUnits("1.5", 18)).toBe(1_500_000_000_000_000_000n);
    expect(toBaseUnits("0.000001", 6)).toBe(1n);
    expect(toBaseUnits("12", 0)).toBe(12n);
    expect(toBaseUnits("1.50", 1)).toBe(15n); // trailing zeros are fine
    expect(toBaseUnits("1.5e3", 0)).toBe(1500n);
    expect(toBaseUnits("15e-1", 1)).toBe(15n);
    expect(toBaseUnits(".5", 2)).toBe(50n);
    expect(() => toBaseUnits("1.0000001", 6)).toThrow(/more than 6 decimal places/);
    expect(() => toBaseUnits("1.5", 0)).toThrow(/indivisible|decimal places/);
    expect(() => toBaseUnits("abc", 18)).toThrow(/not a decimal number/);
    expect(() => toBaseUnits("", 18)).toThrow();
  });

  it("formats base units back", () => {
    expect(fromBaseUnits(1_500_000_000_000_000_000n, 18)).toBe("1.5");
    expect(fromBaseUnits(1n, 6)).toBe("0.000001");
    expect(fromBaseUnits(42n, 0)).toBe("42");
    expect(fromBaseUnits(-25n, 1)).toBe("-2.5");
    for (const [s, d] of [["123.456", 18], ["0.1", 1], ["1000000", 6], ["0.000000000000000001", 18]] as const) expect(fromBaseUnits(toBaseUnits(s, d), d)).toBe(s);
  });

  it("parses integer notations", () => {
    expect(parseInteger(42)).toBe(42n);
    expect(parseInteger("0x2a")).toBe(42n);
    expect(parseInteger("-17")).toBe(-17n);
    expect(parseInteger("1_000")).toBe(1000n);
    expect(parseInteger("1.5e18")).toBe(1_500_000_000_000_000_000n);
    expect(parseInteger("2 gwei")).toBe(2_000_000_000n);
    expect(parseInteger("0.5 ether")).toBe(500_000_000_000_000_000n);
    expect(parseInteger("7wei")).toBe(7n);
    expect(() => parseInteger(1.5)).toThrow(/safe integer/);
    expect(() => parseInteger(2 ** 60)).toThrow(/safe integer/);
    expect(() => parseInteger("1.5")).toThrow(/not an integer/);
    expect(() => parseInteger(true)).toThrow();
  });
});

describe("value coercion", () => {
  it("enforces integer ranges for signed and unsigned types", () => {
    expect(coerceValue({ type: "uint8", name: "x" }, 255)).toBe(255n);
    expect(() => coerceValue({ type: "uint8", name: "x" }, 256)).toThrow(/does not fit in uint8/);
    expect(() => coerceValue({ type: "uint256", name: "x" }, -1)).toThrow(/unsigned/);
    expect(coerceValue({ type: "int8", name: "x" }, -128)).toBe(-128n);
    expect(() => coerceValue({ type: "int8", name: "x" }, 128)).toThrow(/int8/);
    expect(coerceValue({ type: "int256", name: "x" }, "-0x10")).toBe(-16n);
  });

  it("validates addresses incl. EIP-55 checksum", () => {
    expect(coerceValue({ type: "address", name: "a" }, A.toLowerCase())).toBe(A);
    expect(coerceValue({ type: "address", name: "a" }, A)).toBe(A);
    const bad = A.replace("F4180", "f4180"); // flip case of one letter → wrong checksum
    expect(() => coerceValue({ type: "address", name: "a" }, bad)).toThrow(/checksum/);
    expect(() => coerceValue({ type: "address", name: "a" }, "0x1234")).toThrow(/20-byte/);
  });

  it("handles bytes, fixed bytes, bool and string", () => {
    expect(coerceValue({ type: "bytes", name: "b" }, "0xABCD")).toBe("0xabcd");
    expect(() => coerceValue({ type: "bytes", name: "b" }, "0xabc")).toThrow(/even/);
    expect(coerceValue({ type: "bytes4", name: "b" }, "0xc52d6008")).toBe("0xc52d6008");
    expect(() => coerceValue({ type: "bytes32", name: "b" }, "0x01")).toThrow(/exactly 32 bytes/);
    expect(coerceValue({ type: "bool", name: "f" }, "true")).toBe(true);
    expect(coerceValue({ type: "bool", name: "f" }, 0)).toBe(false);
    expect(() => coerceValue({ type: "bool", name: "f" }, "yes")).toThrow();
    expect(coerceValue({ type: "string", name: "s" }, 12)).toBe("12");
  });

  it("coerces arrays (dynamic, fixed, nested, JSON strings)", () => {
    expect(coerceValue({ type: "uint256[]", name: "v" }, ["1", 2, "0x3"])).toEqual([1n, 2n, 3n]);
    expect(coerceValue({ type: "uint8[2][]", name: "v" }, "[[1,2],[3,4]]")).toEqual([
      [1n, 2n],
      [3n, 4n],
    ]);
    expect(() => coerceValue({ type: "uint8[2]", name: "v" }, [1])).toThrow(/exactly 2/);
  });

  it("coerces tuples from arrays and objects, rejecting unknown/missing fields", () => {
    const p = { type: "tuple", name: "call", components: [{ name: "target", type: "address" }, { name: "allowFailure", type: "bool" }, { name: "callData", type: "bytes" }] } as const;
    const fromArray = coerceValue(p as any, [A.toLowerCase(), "false", "0x"]);
    const fromObject = coerceValue(p as any, { target: A, allowFailure: false, callData: "0x" });
    expect(fromArray).toEqual({ target: A, allowFailure: false, callData: "0x" });
    expect(fromObject).toEqual(fromArray);
    expect(() => coerceValue(p as any, { target: A, allowFailure: false })).toThrow(/missing tuple field/);
    expect(() => coerceValue(p as any, { target: A, allowFailure: false, callData: "0x", extra: 1 })).toThrow(/unknown tuple field/);
  });

  it("accepts arguments as array, object or a single scalar", () => {
    const f = fn("function transfer(address to, uint256 amount)");
    expect(coerceArgs(f.inputs, [A, "5"])).toEqual([A, 5n]);
    expect(coerceArgs(f.inputs, { amount: "5", to: A })).toEqual([A, 5n]);
    expect(coerceArgs(fn("function balanceOf(address owner)").inputs, A)).toEqual([A]);
    expect(() => coerceArgs(f.inputs, [A])).toThrow(/expected 2 argument/);
    expect(() => coerceArgs(f.inputs, { to: A })).toThrow(/missing argument/);
  });
});

describe("encode/decode round trips", () => {
  it("round-trips a call with tuples, arrays, bytes and signed ints", () => {
    const f = fn("function mix((address to, uint256[] amounts, bytes data)[] items, int128 delta, bytes32 key, string note) returns (bool ok, int256[] out)");
    const args = [[{ to: A, amounts: ["1", "2.5e3"], data: "0x1234" }, [B, [], "0x"]], "-170141183460469231731687303715884105728", `0x${"ab".repeat(32)}`, "héllo"];
    const enc = encodeCall(f, args);
    const viemData = encodeFunctionData({
      abi: [f],
      functionName: "mix",
      args: [[{ to: A, amounts: [1n, 2500n], data: "0x1234" }, { to: B, amounts: [], data: "0x" }], -(2n ** 127n), `0x${"ab".repeat(32)}`, "héllo"],
    } as any);
    expect(enc.data).toBe(viemData);
    expect(enc.signature).toBe("mix((address,uint256[],bytes)[],int128,bytes32,string)");
    expect(enc.selector).toBe(selectorOf(f));
    const dec = decodeCalldata(enc.data, [{ abi: [f], source: "inline" }])!;
    expect(dec.exact).toBe(true);
    expect(dec.signature).toBe(enc.signature);
    expect(dec.args.map((x) => x.name)).toEqual(["items", "delta", "key", "note"]);
    expect(dec.args[0].value).toEqual([
      { to: A, amounts: ["1", "2500"], data: "0x1234" },
      { to: B, amounts: [], data: "0x" },
    ]);
    expect(dec.args[1].value).toBe("-170141183460469231731687303715884105728");
    // return data
    const ret = encodeAbiParameters(f.outputs, [true, [-1n, 5n]]);
    expect(decodeReturn(f, ret)).toEqual([
      { name: "ok", type: "bool", value: true },
      { name: "out", type: "int256[]", value: ["-1", "5"] },
    ]);
  });

  it("flags non-canonical calldata (trailing bytes) as inexact", () => {
    const f = fn("function approve(address spender, uint256 amount)");
    const { data } = encodeCall(f, [A, 1]);
    const d = decodeCalldata(`${data}deadbeef` as Hex, [{ abi: [f], source: "x" }])!;
    expect(d.exact).toBe(false);
  });

  it("encodes and decodes bare parameters", () => {
    const e = encodeParams("bytes4,uint128", ["0xc52d6008", 3]);
    expect(e.data).toBe(encodeAbiParameters([{ type: "bytes4" }, { type: "uint128" }], ["0xc52d6008", 3n]));
    expect(decodeParams("bytes4,uint128", e.data).map((p) => p.value)).toEqual(["0xc52d6008", "3"]);
  });

  it("decodes custom errors, Error(string) and Panic codes", () => {
    const lsp6 = bundledAbi("LSP6KeyManager");
    const notAuth = encodeErrorResult({ abi: lsp6, errorName: "NotAuthorised", args: [A, "TRANSFERVALUE"] } as any);
    const d1 = decodeErrorData(notAuth, ERROR_ABIS.map((abi) => ({ abi, source: "bundled" })))!;
    expect(d1.name).toBe("NotAuthorised");
    expect(d1.args[1].value).toBe("TRANSFERVALUE");
    const err = encodeErrorResult({ abi: parseAbi(["error Error(string)"]), errorName: "Error", args: ["nope"] });
    expect(decodeErrorData(err, ERROR_ABIS.map((abi) => ({ abi, source: "bundled" })))!.message).toBe("revert: nope");
    const panic = encodeErrorResult({ abi: parseAbi(["error Panic(uint256)"]), errorName: "Panic", args: [0x11n] });
    expect(decodeErrorData(panic, ERROR_ABIS.map((abi) => ({ abi, source: "bundled" })))!.message).toMatch(/overflow/);
  });

  it("decodes ERC-20 and ERC-721 Transfer logs (same topic, different indexing)", () => {
    const erc20 = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
    const erc721 = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"]);
    const t20 = encodeEventTopics({ abi: erc20, eventName: "Transfer", args: { from: A, to: B } }) as Hex[];
    const d20 = encodeAbiParameters([{ type: "uint256" }], [5n]);
    const t721 = encodeEventTopics({ abi: erc721, eventName: "Transfer", args: { from: A, to: B, tokenId: 7n } }) as Hex[];
    const cands = (bundledIndexes().events.get(t20[0]) ?? []).map((x) => ({ abi: [x.item], source: "bundled" }));
    expect(cands.length).toBeGreaterThanOrEqual(2);
    expect(decodeLog(t20, d20, cands)!.args.map((x) => x.value)).toEqual([A, B, "5"]);
    expect(decodeLog(t721, "0x", cands)!.args.map((x) => x.value)).toEqual([A, B, "7"]);
  });
});

describe("ABI inputs and function resolution", () => {
  it("accepts bundled names/aliases, JSON, files and fragments", () => {
    expect(parseAbiInput("LSP7DigitalAsset")).toMatchObject({ source: "bundled:LSP7DigitalAsset", trust: "bundled" });
    expect(parseAbiInput("erc20").source).toBe("bundled:ERC20");
    expect(parseAbiInput("lsp26").source).toBe("bundled:LSP26FollowerSystem");
    const fromJson = parseAbiInput('[{"type":"function","name":"f","inputs":[],"outputs":[],"stateMutability":"view"}]');
    expect(fromJson.trust).toBe("user");
    expect(fromJson.abi).toHaveLength(1);
    const frag = parseAbiInput("balanceOf(address) view returns (uint256); function transfer(address to, uint256 amount) returns (bool)");
    expect(frag.abi.map((x: any) => x.name)).toEqual(["balanceOf", "transfer"]);
    const dir = mkdtempSync(join(tmpdir(), "abi-"));
    const file = join(dir, "x.json");
    writeFileSync(file, JSON.stringify({ abi: [{ type: "function", name: "g", inputs: [], outputs: [], stateMutability: "nonpayable" }] }));
    expect(parseAbiInput(file)).toMatchObject({ source: `file:${file}`, trust: "user" });
    expect(() => parseAbiInput("NoSuchContract")).toThrow(/not a bundled ABI name/);
    expect(() => parseAbiInput('[{"name":"x"}]')).toThrow(/no "type"/);
  });

  it("resolves overloads by signature or argument count", () => {
    const abi = parseAbi(["function safeTransferFrom(address,address,uint256)", "function safeTransferFrom(address,address,uint256,bytes)"]);
    expect(() => resolveFunction(abi, "safeTransferFrom")).toThrow(/overloaded/);
    expect(canonicalSignature(resolveFunction(abi, "safeTransferFrom", 4).fn)).toBe("safeTransferFrom(address,address,uint256,bytes)");
    expect(canonicalSignature(resolveFunction(abi, "safeTransferFrom(address,address,uint256)").fn)).toBe("safeTransferFrom(address,address,uint256)");
    expect(resolveFunction(abi, "0x42842e0e").fn.inputs).toHaveLength(3);
    expect(() => resolveFunction(abi, "transfer(address,uint256)")).toThrow(/not in the ABI/);
    expect(resolveFunction(abi, "transfer(address,uint256)", undefined, true).inAbi).toBe(false);
    try {
      resolveFunction(abi, "SafeTransferFrom");
      expect.unreachable();
    } catch (e: any) {
      expect(e.code).toBe("ABI_NOT_FOUND");
      expect(e.hint).toMatch(/did you mean safeTransferFrom/);
    }
  });

  it("formats human-readable fragments", () => {
    expect(humanSignature(fn("function transfer(address to, uint256 amount) returns (bool)"))).toBe("function transfer(address to, uint256 amount) returns (bool)");
    expect(humanSignature(fn("function f((uint8 a, bytes b)[] xs) view returns (uint256)"))).toBe("function f((uint8 a, bytes b)[] xs) view returns (uint256)");
  });
});

describe("bundled catalog", () => {
  it("indexes LSP/ERC ABIs and maps canonical deployments to them", () => {
    expect(findBundled("UniversalProfileInit@0.14.0")?.group).toBe("deployed");
    expect(findBundled("LSP7DigitalAsset")?.group).toBe("lsp");
    const transfer = bundledIndexes().functions.get("0x760d9bba")!;
    expect(transfer[0].signature).toBe("transfer(address,address,uint256,bool,bytes)");
    const up = canonicalContracts().get("0x3024d38ea2434ba6635003dc1bdc0dab5882ed4f")!;
    expect(up).toMatchObject({ name: "UniversalProfileInit", version: "0.14.0", abiName: "UniversalProfileInit@0.14.0" });
    expect(canonicalContracts().get("0xf01103e5a9909fc0dbe8166da7085e0285daddca")?.abiName).toBe("LSP26FollowerSystem");
    expect(canonicalContracts().get("0xca11bde05977b3631167028862be2a173976ca11")?.abiName).toBe("Multicall3");
    // every bundled ABI decodes its own calldata
    const lsp8 = bundledAbi("LSP8IdentifiableDigitalAsset");
    const data = encodeFunctionData({ abi: lsp8, functionName: "transfer", args: [A, B, `0x${"00".repeat(31)}01`, true, "0x"] } as any);
    expect(decodeFunctionData({ abi: lsp8, data }).functionName).toBe("transfer");
  });
});
