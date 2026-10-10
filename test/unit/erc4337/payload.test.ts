import { describe, expect, it } from "vitest";
import { encodeFunctionData, keccak256, parseEther, parseSignature, recoverAddress, toBytes, type Address, type Hex } from "viem";
import { DUMMY_SIGNATURE, EXTENSION_4337_KEY, UP_ABI } from "../../../src/erc4337/constants.ts";
import { classifyKey, decodeProfilePayload, describeCalls } from "../../../src/erc4337/payload.ts";
import { allowedCallsKey, arrayIndexKey, arrayLengthKey, permissionsKey } from "../../../src/erc4337/lsp6.ts";

const UP = "0x1111111111111111111111111111111111111111" as Address;
const A = "0x2222222222222222222222222222222222222222" as Address;
const B = "0x3333333333333333333333333333333333333333" as Address;
const enc = (functionName: string, args: unknown[] = []) => encodeFunctionData({ abi: UP_ABI, functionName, args } as any);

describe("decodeProfilePayload (raw --payload consent content)", () => {
  it("execute: real value, target and inner selector", () => {
    const d = decodeProfilePayload(enc("execute", [0n, A, parseEther("0.5"), "0xa9059cbb0000"]), UP);
    expect(d).toMatchObject({ kind: "execute", risk: "write", totalValue: parseEther("0.5"), targets: [A], innerSelectors: ["0xa9059cbb"] });
    expect(d.calls[0]).toEqual({ operation: 0, to: A, value: parseEther("0.5"), data: "0xa9059cbb0000" });
  });
  it("executeBatch: summed value and every target", () => {
    const d = decodeProfilePayload(enc("executeBatch", [[0n, 0n, 3n], [A, B, A], [1n, 2n, 0n], ["0x", "0x12345678", "0xabcdef01"]]), UP);
    expect(d.kind).toBe("executeBatch");
    expect(d.totalValue).toBe(3n);
    expect(d.targets).toEqual([A, B]);
    expect(d.innerSelectors).toEqual(["0x", "0x12345678", "0xabcdef01"]);
  });
  it("refuses DELEGATECALL and mismatched batches", () => {
    expect(() => decodeProfilePayload(enc("execute", [4n, A, 0n, "0x"]), UP)).toThrow(/DELEGATECALL/);
    expect(() => decodeProfilePayload(enc("executeBatch", [[0n], [A, B], [0n, 0n], ["0x", "0x"]]), UP)).toThrow(/different lengths/);
  });
  it("setData on permissions / extensions / URD keys is admin; other keys are write", () => {
    for (const key of [permissionsKey(A), allowedCallsKey(A), arrayLengthKey, arrayIndexKey(3), EXTENSION_4337_KEY, "0x0cfc51aec37c55a4d0b1a65c6255c4bf2fbdf6277f3cc0730c45b828b6db8b47", "0x0cfc51aec37c55a4d0b10000aabbccdd00000000000000000000000000000000"] as Hex[]) {
      expect(decodeProfilePayload(enc("setData", [key, "0x"]), UP).risk, key).toBe("admin");
    }
    const lsp3 = "0x5ef83ad9559033e6e941db7d7c495acdce616347d28e90c7ce47cbfcfcad3bc5" as Hex;
    const plain = decodeProfilePayload(enc("setData", [lsp3, "0x1234"]), UP);
    expect(plain).toMatchObject({ kind: "setData", risk: "write", targets: [UP], totalValue: 0n });
    expect(decodeProfilePayload(enc("setDataBatch", [[lsp3, permissionsKey(B)], ["0x", "0x"]]), UP).risk).toBe("admin");
    expect(classifyKey(lsp3)).toBe("other");
  });
  it("ownership calls and unknown payloads are admin", () => {
    expect(decodeProfilePayload(enc("transferOwnership", [A]), UP)).toMatchObject({ kind: "ownership", risk: "admin" });
    expect(decodeProfilePayload(enc("acceptOwnership"), UP).risk).toBe("admin");
    expect(decodeProfilePayload(enc("renounceOwnership"), UP).risk).toBe("admin");
    expect(decodeProfilePayload("0x6963d4380000", UP)).toMatchObject({ kind: "unknown", risk: "admin" }); // batchCalls
    expect(decodeProfilePayload("0xdeadbeef", UP)).toMatchObject({ kind: "unknown", risk: "admin" });
    expect(() => decodeProfilePayload("0x12" as Hex, UP)).toThrow(/at least 4 bytes/);
  });
  it("describeCalls gives the same shape for explicit calls", () => {
    const d = describeCalls([{ operation: 0, to: A, value: 5n, data: "0x" }]);
    expect(d).toMatchObject({ kind: "execute", totalValue: 5n, targets: [A], innerSelectors: ["0x"], risk: "write" });
  });
});

describe("DUMMY_SIGNATURE (estimation/simulation only)", () => {
  it("is well-formed (65 bytes, low-s, v 27/28) so ECDSA.recover returns an address instead of reverting", async () => {
    expect((DUMMY_SIGNATURE.length - 2) / 2).toBe(65);
    const sig = parseSignature(DUMMY_SIGNATURE);
    const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    expect(BigInt(sig.s) <= n / 2n).toBe(true);
    expect([27n, 28n]).toContain(sig.v);
    // recovers to some (different, unprivileged) address for arbitrary userOpHashes
    const a1 = await recoverAddress({ hash: keccak256(toBytes("op 1")), signature: DUMMY_SIGNATURE });
    const a2 = await recoverAddress({ hash: keccak256(toBytes("op 2")), signature: DUMMY_SIGNATURE });
    expect(a1).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(a1).not.toBe(a2);
  });
});
