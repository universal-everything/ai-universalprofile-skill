import { describe, expect, it } from "vitest";
import { decodeAbiParameters, encodeFunctionData, keccak256, recoverMessageAddress, toFunctionSelector, type Address, type Hex } from "viem";
import { getUserOperationHash } from "viem/account-abstraction";
import { generatePrivateKey } from "viem/accounts";
import { formatAbiItem } from "abitype";
import { testSigner } from "../../support/context.ts";
import { ENTRYPOINT_V06, UP_ABI, VALIDATE_USER_OP_SELECTOR, entryPoint06Abi, extension4337Abi } from "../../../src/erc4337/constants.ts";
import {
  buildCallData,
  calcPreVerificationGas,
  fromRpcUserOp,
  getUserOpHashV06,
  packUserOpForHash,
  requiredPrefund,
  signUserOp,
  toRpcUserOp,
  type UserOperationV06,
} from "../../../src/erc4337/userop.ts";
import { nonceKeyFor } from "../../../src/erc4337/entrypoint.ts";
import { OPERATION } from "../../../src/exec/transport.ts";

const UP = "0x1111111111111111111111111111111111111111" as Address;

function op(over: Partial<UserOperationV06> = {}): UserOperationV06 {
  return {
    sender: UP,
    nonce: (BigInt("0x2222222222222222222222222222222222222222") << 64n) + 7n,
    initCode: "0x",
    callData: encodeFunctionData({ abi: UP_ABI, functionName: "execute", args: [0n, "0x3333333333333333333333333333333333333333", 10n ** 15n, "0x1234"] }),
    callGasLimit: 123_456n,
    verificationGasLimit: 250_000n,
    preVerificationGas: 48_000n,
    maxFeePerGas: 3_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    paymasterAndData: "0x",
    signature: "0x",
    ...over,
  };
}

describe("UserOperation v0.6 hash", () => {
  const cases: [string, Partial<UserOperationV06>][] = [
    ["plain execute op", {}],
    ["with initCode and paymasterAndData", { initCode: ("0x9406cc6185a346906296840746125a0e44976454" + "abcdef") as Hex, paymasterAndData: ("0x" + "ab".repeat(20) + "cdcd") as Hex }],
    ["zero gas fields", { callGasLimit: 0n, verificationGasLimit: 0n, preVerificationGas: 0n, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n }],
    ["large values", { nonce: (1n << 255n) + 1n, callGasLimit: (1n << 120n) - 1n }],
  ];
  for (const [name, over] of cases) {
    it(`equals viem getUserOperationHash (0.6) — ${name}`, () => {
      const o = op(over);
      for (const chainId of [1, 42, 4201, 31337]) {
        const ours = getUserOpHashV06(o, ENTRYPOINT_V06, chainId);
        const viemHash = getUserOperationHash({ chainId, entryPointAddress: ENTRYPOINT_V06, entryPointVersion: "0.6", userOperation: o as any });
        expect(ours).toBe(viemHash);
      }
    });
  }

  it("binds chain id, EntryPoint and every field; ignores the signature", () => {
    const o = op();
    const h = getUserOpHashV06(o, ENTRYPOINT_V06, 42);
    expect(getUserOpHashV06({ ...o, signature: "0xdeadbeef" }, ENTRYPOINT_V06, 42)).toBe(h);
    expect(getUserOpHashV06(o, ENTRYPOINT_V06, 4201)).not.toBe(h);
    expect(getUserOpHashV06(o, "0x0000000071727De22E5E9d8BAf0edAc6f37da032", 42)).not.toBe(h);
    for (const k of ["nonce", "callGasLimit", "verificationGasLimit", "preVerificationGas", "maxFeePerGas", "maxPriorityFeePerGas"] as const) {
      expect(getUserOpHashV06({ ...o, [k]: o[k] + 1n }, ENTRYPOINT_V06, 42), k).not.toBe(h);
    }
    expect(getUserOpHashV06({ ...o, callData: "0x00" }, ENTRYPOINT_V06, 42)).not.toBe(h);
    expect(getUserOpHashV06({ ...o, paymasterAndData: "0x01" }, ENTRYPOINT_V06, 42)).not.toBe(h);
  });

  it("packs the 10 hashed fields with keccak'd dynamic bytes (UserOperationLib.pack)", () => {
    const o = op({ initCode: "0xaa", paymasterAndData: "0xbb" });
    const d = decodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }],
      packUserOpForHash(o),
    );
    expect(d[0]).toBe(o.sender);
    expect(d[1]).toBe(o.nonce);
    expect(d[2]).toBe(keccak256("0xaa"));
    expect(d[3]).toBe(keccak256(o.callData));
    expect([d[4], d[5], d[6], d[7], d[8]]).toEqual([o.callGasLimit, o.verificationGasLimit, o.preVerificationGas, o.maxFeePerGas, o.maxPriorityFeePerGas]);
    expect(d[9]).toBe(keccak256("0xbb"));
    expect((packUserOpForHash(o).length - 2) / 2).toBe(320);
  });

  it("signature is EIP-191 personal_sign over the 32-byte userOpHash (recoverable as Extension4337 does)", async () => {
    const s = testSigner(generatePrivateKey());
    const { op: signed, userOpHash } = await signUserOp(s, op(), ENTRYPOINT_V06, 4201);
    expect(userOpHash).toBe(getUserOpHashV06(op(), ENTRYPOINT_V06, 4201));
    expect((signed.signature.length - 2) / 2).toBe(65);
    expect(await recoverMessageAddress({ message: { raw: userOpHash }, signature: signed.signature })).toBe(s.address);
  });
});

describe("UserOperation helpers", () => {
  it("validateUserOp v0.6 selector is 0x3a871cdd and matches the bundled Extension4337 ABI", () => {
    const fn = extension4337Abi().find((x: any) => x.type === "function" && x.name === "validateUserOp") as any;
    expect(toFunctionSelector(formatAbiItem(fn))).toBe(VALIDATE_USER_OP_SELECTOR);
    expect(toFunctionSelector("validateUserOp((address,uint256,bytes,bytes,uint256,uint256,uint256,uint256,uint256,bytes,bytes),bytes32,uint256)")).toBe("0x3a871cdd");
    // EntryPoint v0.6 ABI handleOps selector
    expect(toFunctionSelector(formatAbiItem(entryPoint06Abi.find((x: any) => x.name === "handleOps") as any))).toBe("0x1fad948c");
  });

  it("builds UP.execute for one call, UP.executeBatch for several, passes raw payloads", () => {
    const c1 = { operation: OPERATION.CALL, to: UP, value: 5n, data: "0x" as Hex };
    const c2 = { operation: OPERATION.STATICCALL, to: UP, value: 0n, data: "0xabcdef01" as Hex };
    expect(buildCallData({ calls: [c1] }).slice(0, 10)).toBe("0x44c028fe");
    expect(buildCallData({ calls: [c1, c2] }).slice(0, 10)).toBe("0x31858452");
    expect(buildCallData({ payload: "0x97902421aa" })).toBe("0x97902421aa");
    expect(() => buildCallData({})).toThrow(/nothing to execute/);
    expect(() => buildCallData({ payload: "0x12" })).toThrow(/selector/);
    expect(() => buildCallData({ calls: [{ ...c1, operation: 4 as any }] })).toThrow(/DELEGATECALL/);
    expect(() => buildCallData({ calls: [c1], payload: "0x12345678" })).toThrow(/either/);
  });

  it("requiredPrefund follows EntryPoint v0.6 (verification gas x3 with a paymaster)", () => {
    const o = op();
    expect(requiredPrefund(o)).toBe((o.callGasLimit + o.verificationGasLimit + o.preVerificationGas) * o.maxFeePerGas);
    const p = op({ paymasterAndData: ("0x" + "11".repeat(20)) as Hex });
    expect(requiredPrefund(p)).toBe((p.callGasLimit + p.verificationGasLimit * 3n + p.preVerificationGas) * p.maxFeePerGas);
  });

  it("preVerificationGas grows with calldata and includes the 21000 + 18300 fixed overhead", () => {
    const small = calcPreVerificationGas(op({ callData: "0x12345678" }));
    const big = calcPreVerificationGas(op({ callData: ("0x" + "ff".repeat(1000)) as Hex }));
    expect(small).toBeGreaterThan(39_300n);
    expect(big - small).toBeGreaterThanOrEqual(16_000n - 64n);
  });

  it("RPC (ERC-7769 v0.6 field set) round-trips", () => {
    const o = op({ signature: ("0x" + "12".repeat(65)) as Hex });
    const r = toRpcUserOp(o);
    expect(Object.keys(r).sort()).toEqual(["callData", "callGasLimit", "initCode", "maxFeePerGas", "maxPriorityFeePerGas", "nonce", "paymasterAndData", "preVerificationGas", "sender", "signature", "verificationGasLimit"]);
    expect(r.nonce.startsWith("0x")).toBe(true);
    expect(fromRpcUserOp(r as any)).toEqual(o);
  });

  it("nonce key is uint192(controller address)", () => {
    const a = "0x00000000000000000000000000000000000000ff" as Address;
    expect(nonceKeyFor(a)).toBe(255n);
    expect(nonceKeyFor("0xffffffffffffffffffffffffffffffffffffffff")).toBeLessThan(1n << 192n);
  });
});
