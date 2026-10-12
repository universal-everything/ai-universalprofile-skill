// Native value of a profile action (regression for a reported LYX → token swap through a router that
// failed with InsufficientETH()): the inner ERC725X CALL carries the coin amount in wei, every entry
// wrapper sends nothing itself (the profile pays), --value units are understood where agents write
// them, and router / profile-balance reverts decode with hints that keep the agent on the profile path.
import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeErrorResult, encodeFunctionData, parseAbi, parseEther, type Address, type Hex } from "viem";
import { bareValueWarning, buildCall, parseValue } from "../../../src/exec/inputs.ts";
import { encodeUpExecute, upPayload } from "../../../src/exec/common.ts";
import { buildKmEntry } from "../../../src/exec/km.ts";
import { buildLsp0Entry } from "../../../src/exec/lsp0.ts";
import { buildCallData } from "../../../src/erc4337/userop.ts";
import { parseNativeValue } from "../../../src/abi/contract.ts";
import { decodeRevert, hintForRevert } from "../../../src/chain/tx.ts";
import { KM_ABI, UP_ABI } from "../../../src/lsp/abis.ts";

const UP = "0xBB645D97B0c7D101ca0d73131e521fe89B463BFD" as Address;
// placeholder addresses: no real router or token is implied
const ROUTER = "0x3333333333333333333333333333333333333333" as Address;
const TOKEN = "0x4444444444444444444444444444444444444444" as Address;
const FIVE = 5_000_000_000_000_000_000n;
const routerCall = encodeFunctionData({ abi: parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]), functionName: "execute", args: ["0x0b00", ["0x01", "0x02"], 1n] });

describe("the 5-coin call", () => {
  it("--value 5lyx is 5 coins in wei and the CALL carries it unchanged; a bare number is wei", () => {
    const { call } = buildCall({ to: ROUTER, value: "5lyx", data: routerCall });
    expect(call).toEqual({ operation: 0, to: ROUTER, value: FIVE, data: routerCall });
    expect(decodeFunctionData({ abi: UP_ABI, data: encodeUpExecute(call) })).toMatchObject({ functionName: "execute", args: [0n, ROUTER, FIVE, routerCall] });
    for (const v of ["5lyx", "5 LYX", "5ether", "5 native", "5000000000000000000"]) expect(parseValue(v), v).toBe(FIVE);
    expect(parseValue("5")).toBe(5n);
  });

  it("km and lsp0: the transaction itself sends 0; the Key Manager / profile receives the profile call with the 5 coins inside", () => {
    const req = { chainId: 42, profile: UP, calls: [buildCall({ to: ROUTER, value: "5lyx", data: routerCall }).call] };
    const km = buildKmEntry(req, false);
    expect(km).toMatchObject({ value: 0n, function: "execute(bytes)" });
    const kmArgs = decodeFunctionData({ abi: KM_ABI, data: km.data });
    expect(kmArgs.functionName).toBe("execute");
    expect(kmArgs.args![0]).toBe(upPayload(req));
    expect(decodeFunctionData({ abi: UP_ABI, data: kmArgs.args![0] as Hex }).args![2]).toBe(FIVE);
    const lsp0 = buildLsp0Entry(req, false);
    expect(lsp0).toMatchObject({ value: 0n, data: upPayload(req) });
    // only --fund-from-controller makes the transaction carry the value (from the agent's key)
    expect(buildKmEntry(req, true).value).toBe(FIVE);
    expect(buildLsp0Entry(req, true).value).toBe(FIVE);
  });

  it("batch (approve + swap): KM.executeBatch values are all 0 (their sum is msg.value), each payload keeps its own inner value", () => {
    const approve = buildCall({ to: TOKEN, fn: "approve(address,uint256)", args: [ROUTER, "1000"] }).call;
    const swap = buildCall({ to: ROUTER, value: "5lyx", data: routerCall }).call;
    const batch = { chainId: 42, profile: UP, calls: [approve, swap] };
    const km = buildKmEntry(batch, false);
    expect(km.value).toBe(0n);
    const args = decodeFunctionData({ abi: KM_ABI, data: km.data });
    expect(args.functionName).toBe("executeBatch");
    expect(args.args![0]).toEqual([0n, 0n]);
    expect((args.args![1] as Hex[]).map((p) => decodeFunctionData({ abi: UP_ABI, data: p }).args![2])).toEqual([0n, FIVE]);
    // lsp0 and relay send one UP.executeBatch payload with the inner values
    const up = decodeFunctionData({ abi: UP_ABI, data: upPayload(batch) });
    expect(up.functionName).toBe("executeBatch");
    expect(up.args![2]).toEqual([0n, FIVE]);
    expect(buildLsp0Entry(batch, false).value).toBe(0n);
  });

  it("userop: the EntryPoint executes the same profile call, value from the profile", () => {
    const call = buildCall({ to: ROUTER, value: "5lyx", data: routerCall }).call;
    expect(buildCallData({ calls: [call] })).toBe(encodeUpExecute(call));
  });
});

describe("value units", () => {
  it("contract call --value understands lyx / lyxt / native like exec send (a bare number there is whole coins)", () => {
    for (const v of ["5lyx", "5 LYX", "5 native", "5", "5 ether", "5000000000000000000 wei"]) expect(parseNativeValue(v), v).toBe(FIVE);
    expect(parseNativeValue("0.5lyxt")).toBe(parseEther("0.5"));
    expect(() => parseNativeValue("-5lyx")).toThrow(/negative/);
    expect(() => parseNativeValue("5 lyxx")).toThrow();
  });

  it("exec verbs warn about a bare integer below 1 gwei (it is wei), never about explicit units or hex", () => {
    expect(bareValueWarning("5", 5n)).toMatch(/--value 5 has no unit, so it is 5 wei/);
    expect(bareValueWarning("5", 5n)).toMatch(/5lyx/);
    expect(bareValueWarning(7, 7n, "calls[1].value")).toMatch(/^calls\[1\]\.value 7 has no unit/);
    for (const [raw, v] of [["5lyx", FIVE], ["5wei", 5n], ["0x5", 5n], ["5000000000000000000", FIVE], ["0", 0n], [undefined, 0n], ["1000000000", 1_000_000_000n]] as const) {
      expect(bareValueWarning(raw, v), String(raw)).toBeUndefined();
    }
  });
});

describe("decoded reverts and their hints", () => {
  it("InsufficientETH() from a router: the native coin of this chain, the profile sends it, never a wallet app", () => {
    const d = decodeRevert("0x6a12f104");
    expect(d).toMatchObject({ errorName: "InsufficientETH", message: "InsufficientETH()" });
    const hint = hintForRevert(d)!;
    for (const want of [/native coin/, /LYX on LUKSO/, /5lyx/, /bare 5 is 5 wei/, /through the profile/, /wallet app/]) expect(hint).toMatch(want);
  });

  it("ERC725X_InsufficientBalance: fund the profile address, the gas money does not count", () => {
    const data = encodeErrorResult({ abi: parseAbi(["error ERC725X_InsufficientBalance(uint256 balance, uint256 value)"]), errorName: "ERC725X_InsufficientBalance", args: [parseEther("1"), FIVE] });
    const d = decodeRevert(data);
    expect(d).toMatchObject({ errorName: "ERC725X_InsufficientBalance", args: [parseEther("1"), FIVE] });
    const hint = hintForRevert(d)!;
    expect(hint).toMatch(/profile address \(not the gas address\)/);
    expect(hint).toMatch(/never from the agent's gas money/);
  });

  it("TransactionDeadlinePassed(): re-quote with a new deadline", () => {
    const d = decodeRevert("0x5bf6f916");
    expect(d.errorName).toBe("TransactionDeadlinePassed");
    expect(hintForRevert(d)).toMatch(/new deadline/);
  });
});
