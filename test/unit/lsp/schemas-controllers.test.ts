import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeFunctionData, toFunctionSelector, toEventSelector, type Abi, type Address, type Hex } from "viem";
import { ERC725 } from "@erc725/erc725.js";
import { DATA_KEYS, PERMISSIONS, allowedCallsKey, extensionKey, permissionsArrayIndexKey, permissionsKey, uint128Hex, urdTypeKey } from "../../../src/lsp/constants.ts";
import { allowedKeyFor, classifyDataKey, decodeDataValue, encodeDataValue, resolveDataKey } from "../../../src/lsp/schemas.ts";
import { buildAddController, buildEditController, buildRemoveController, recommend, requireLockApproval, setDataPayload, wouldLockProfile, type ControllerState } from "../../../src/lsp/controllers.ts";
import { decodePermissions } from "../../../src/lsp/permissions.ts";
import { KM_ABI, LSP23_ABI, UP_ABI, POST_DEPLOYMENT_MODULE_ABI } from "../../../src/lsp/abis.ts";
import { UP_ABI as _UP } from "../../../src/lsp/abis.ts";

const A = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa" as Address;
const B = "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB" as Address;
const C = "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC" as Address;

describe("ERC725Y key resolution", () => {
  it("static, array, array element, dynamic (parts and filled-in) and raw keys", () => {
    expect(resolveDataKey("LSP3Profile").key).toBe(DATA_KEYS.LSP3Profile);
    expect(resolveDataKey("AddressPermissions[]")).toMatchObject({ key: DATA_KEYS["AddressPermissions[]"], isArrayLength: true });
    expect(resolveDataKey("AddressPermissions[2]").key).toBe(permissionsArrayIndexKey(2));
    expect(resolveDataKey("AddressPermissions:Permissions:<address>", [A]).key).toBe(permissionsKey(A));
    expect(resolveDataKey(`AddressPermissions:AllowedCalls:${A}`).key).toBe(allowedCallsKey(A));
    expect(resolveDataKey("LSP17Extension:0x12345678").key).toBe(extensionKey("0x12345678"));
    const typeId = "0x" + "ab".repeat(32);
    expect(resolveDataKey(`LSP1UniversalReceiverDelegate:${typeId}`).key).toBe(urdTypeKey(typeId));
    expect(resolveDataKey(DATA_KEYS.LSP3Profile).name).toBe("LSP3Profile");
    expect(resolveDataKey("0x" + "12".repeat(32)).schema).toBeUndefined();
    expect(() => resolveDataKey("NoSuchKey")).toThrow();
    expect(() => resolveDataKey("AddressPermissions:Permissions:<address>")).toThrow(/dynamic parts/);
  });
  it("encodes/decodes values with the schemas (address, VerifiableURI) and passes raw hex for unknown keys", () => {
    const urd = resolveDataKey("LSP1UniversalReceiverDelegate");
    const enc = encodeDataValue(urd, A);
    expect(enc.toLowerCase()).toBe(A.toLowerCase());
    expect(String(decodeDataValue(urd, enc)).toLowerCase()).toBe(A.toLowerCase());
    const lsp3 = resolveDataKey("LSP3Profile");
    const value = { json: { LSP3Profile: { name: "agent" } }, url: "ipfs://QmTest" };
    const encoded = encodeDataValue(lsp3, value);
    expect(encoded).toBe(ERC725.encodeData([{ keyName: "LSP3Profile", value }], [lsp3.schema!]).values[0]);
    expect((decodeDataValue(lsp3, encoded) as any).url).toBe("ipfs://QmTest");
    expect(encodeDataValue(resolveDataKey("0x" + "12".repeat(32)), "0xdeadbeef")).toBe("0xdeadbeef");
    expect(() => encodeDataValue(resolveDataKey("0x" + "12".repeat(32)), "hello")).toThrow();
    expect(decodeDataValue(resolveDataKey("AddressPermissions[]"), uint128Hex(3))).toBe("3");
  });
  it("allowed-key inputs: full keys, array prefixes (16 bytes) and mapping prefixes", () => {
    expect(allowedKeyFor("LSP3Profile")).toBe(DATA_KEYS.LSP3Profile);
    expect(allowedKeyFor("LSP12IssuedAssets[]")).toBe(DATA_KEYS["LSP12IssuedAssets[]"].slice(0, 34));
    expect(allowedKeyFor("LSP12IssuedAssetsMap:<address>")).toBe(DATA_KEYS.LSP12IssuedAssetsMapPrefix);
    expect(allowedKeyFor("0xAABB")).toBe("0xaabb");
  });
});

describe("LSP6 setData routing (which permission a key needs)", () => {
  it("classifies like LSP6SetDataModule", () => {
    expect(classifyDataKey(DATA_KEYS["AddressPermissions[]"]).class).toBe("permissions-array");
    expect(classifyDataKey(permissionsArrayIndexKey(5)).class).toBe("permissions-array");
    expect(classifyDataKey(permissionsKey(A)).class).toBe("controller-permissions");
    expect(classifyDataKey(allowedCallsKey(A)).class).toBe("allowed-calls");
    expect(classifyDataKey(("0x4b80742de2bf866c29110000" + A.slice(2)) as Hex).class).toBe("allowed-data-keys");
    expect(classifyDataKey(("0x4b80742de2bf" + "00".repeat(26)) as Hex).class).toBe("lsp6-unknown");
    expect(classifyDataKey(DATA_KEYS.LSP1UniversalReceiverDelegate).class).toBe("urd");
    expect(classifyDataKey(urdTypeKey("0x" + "cd".repeat(32))).class).toBe("urd");
    expect(classifyDataKey(extensionKey("0x3a871cdd"))).toMatchObject({ class: "extension", admin: true });
    expect(classifyDataKey(DATA_KEYS.LSP3Profile)).toMatchObject({ class: "data", admin: false });
  });
});

function state(entries: { address: Address; perms: bigint }[]): ControllerState {
  return {
    length: BigInt(entries.length),
    controllers: entries.map((e, i) => ({ address: e.address, index: i, permissions: decodePermissions(e.perms), allowedCalls: [], allowedCallsDescribed: [], allowedDataKeys: [], raw: { permissions: "0x", allowedCalls: "0x", allowedDataKeys: "0x" } })),
  };
}

const kv = (ws: { keys: Hex[]; values: Hex[] }) => Object.fromEntries(ws.keys.map((k, i) => [k.toLowerCase(), ws.values[i]]));

describe("controller write sets", () => {
  const st = state([{ address: A, perms: 0x7f3f7fn }, { address: B, perms: 0x20080n }]);
  it("add: array length+1, new index, permissions, allowed lists", () => {
    const ws = buildAddController(st, C, { permissions: PERMISSIONS.CALL | PERMISSIONS.TRANSFERVALUE, allowedCalls: [{ callTypes: ["CALL", "VALUE"], address: A }], allowedDataKeys: [DATA_KEYS.LSP3Profile] });
    const m = kv(ws);
    expect(m[DATA_KEYS["AddressPermissions[]"]]).toBe(uint128Hex(3));
    expect(m[permissionsArrayIndexKey(2)]).toBe(C.toLowerCase());
    expect(BigInt(m[permissionsKey(C)])).toBe(PERMISSIONS.CALL | PERMISSIONS.TRANSFERVALUE);
    expect(m[allowedCallsKey(C)]).toBe("0x0020" + "00000003" + A.slice(2).toLowerCase() + "ffffffff" + "ffffffff");
    expect(decodeFunctionData({ abi: UP_ABI, data: ws.payload }).functionName).toBe("setDataBatch");
    expect(() => buildAddController(st, A, { permissions: 1n })).toThrow(/already a controller/);
    expect(() => buildAddController(st, C, { permissions: 0n })).toThrow();
    expect(buildAddController(st, C, { permissions: PERMISSIONS.CALL }).warnings.join()).toMatch(/NoCallsAllowed/);
  });
  it("edit: only the permission key (and allowed lists when given)", () => {
    const ws = buildEditController(st, A, { permissions: 0x7f3f7fn | PERMISSIONS._4337_PERMISSION });
    expect(ws.keys).toEqual([permissionsKey(A)]);
    expect(ws.summary.added).toEqual(["_4337_PERMISSION"]);
    expect(() => buildEditController(st, C, { permissions: 1n })).toThrow(/not a controller/);
    expect(() => buildEditController(st, A, {})).toThrow(/nothing to change/);
    expect(buildEditController(st, A, { allowedCalls: [] }).values).toEqual(["0x"]);
  });
  it("remove: swap-with-last, shrink, clear permission keys", () => {
    const three = state([{ address: A, perms: 0x7f3f7fn }, { address: B, perms: 0x20080n }, { address: C, perms: 0x800n }]);
    const ws = buildRemoveController(three, A);
    const m = kv(ws);
    expect(m[permissionsArrayIndexKey(0)]).toBe(C.toLowerCase());
    expect(m[permissionsArrayIndexKey(2)]).toBe("0x");
    expect(m[DATA_KEYS["AddressPermissions[]"]]).toBe(uint128Hex(2));
    expect(m[permissionsKey(A)]).toBe("0x");
    expect(m[allowedCallsKey(A)]).toBe("0x");
    const last = buildRemoveController(three, C);
    expect(kv(last)[permissionsArrayIndexKey(0)]).toBeUndefined();
    expect(kv(last)[permissionsArrayIndexKey(2)]).toBe("0x");
  });
  it("last-admin guard", () => {
    expect(wouldLockProfile(st, { address: A, permissions: null })).toBe(true);
    expect(wouldLockProfile(st, { address: A, permissions: PERMISSIONS.CALL })).toBe(true);
    expect(wouldLockProfile(st, { address: A, permissions: PERMISSIONS.EDITPERMISSIONS })).toBe(false);
    expect(wouldLockProfile(st, { address: B, permissions: null })).toBe(false);
    const two = state([{ address: A, perms: 0x7f3f7fn }, { address: C, perms: 0x7f3f7fn }]);
    expect(wouldLockProfile(two, { address: A, permissions: null })).toBe(false);
    expect(() => requireLockApproval(undefined)).toThrow(/LAST controller/);
    expect(() => requireLockApproval("yes do it")).toThrow();
    expect(() => requireLockApproval("I understand this removes the last admin controller")).not.toThrow();
  });
  it("setDataPayload uses setData for one pair and setDataBatch for several", () => {
    expect(setDataPayload([DATA_KEYS.LSP3Profile], ["0x01"]).slice(0, 10)).toBe("0x7f23690c");
    expect(setDataPayload([DATA_KEYS.LSP3Profile, DATA_KEYS.LSP3Profile], ["0x01", "0x02"]).slice(0, 10)).toBe("0x97902421");
    expect(() => setDataPayload([], [])).toThrow();
  });
});

describe("recommendation for J2 / any existing profile", () => {
  it("agent-operator with token-standard AllowedCalls, plain-language text and JSON", () => {
    const r = recommend(A, B);
    expect(r.permissions.names.sort()).toEqual(["CALL", "EXECUTE_RELAY_CALL", "SETDATA", "SIGN", "STATICCALL", "TRANSFERVALUE"]);
    expect(r.notAllowed).toContain("ADDCONTROLLER");
    expect(r.text).toContain(A);
    expect(r.text).toMatch(/What it can NOT do/);
    expect(r.dataKeys.permissions).toBe(permissionsKey(A));
    expect(r.allowedCalls.entries.length).toBe(6);
  });
  it("adds targets, keys and the 4337 bit only on request", () => {
    expect(BigInt(recommend(A, B).permissions.hex) & PERMISSIONS._4337_PERMISSION).toBe(0n);
    const r = recommend(A, B, { with4337: true, allowTargets: [{ address: C }], allowedDataKeys: [DATA_KEYS.LSP3Profile] });
    expect(BigInt(r.permissions.hex) & PERMISSIONS._4337_PERMISSION).not.toBe(0n);
    expect(r.allowedCalls.entries.at(-1)).toMatchObject({ address: C, callTypes: 3 });
    expect(r.allowedDataKeys.keys).toEqual([DATA_KEYS.LSP3Profile]);
  });
});

describe("ABI fragments match the bundled upstream ABIs", () => {
  const root = join(import.meta.dirname, "..", "..", "..", "skills", "universal-profile", "assets", "abis", "lsp");
  const bundled = (n: string) => JSON.parse(readFileSync(join(root, `${n}.json`), "utf8")).abi as Abi;
  const sigs = (abi: Abi, type: "function" | "event") =>
    new Set(abi.filter((x: any) => x.type === type).map((x: any) => (type === "function" ? toFunctionSelector(x) : toEventSelector(x))));
  it.each([
    ["UniversalProfile", UP_ABI],
    ["LSP6KeyManager", KM_ABI],
    ["LSP23LinkedContractsFactory", LSP23_ABI],
    ["UniversalProfileInitPostDeploymentModule", POST_DEPLOYMENT_MODULE_ABI],
  ] as const)("%s", (name, ours) => {
    const ref = bundled(name);
    for (const t of ["function", "event"] as const) {
      const theirs = sigs(ref, t);
      for (const s of sigs(ours as Abi, t)) expect(theirs.has(s), `${name} ${t} ${s}`).toBe(true);
    }
    expect(_UP).toBe(UP_ABI);
  });
});

describe("signature guards (pure)", async () => {
  const { isBlindHashMessage, isValueMovingTypedData, EXTENSION_4337_KEY } = await import("../../../src/lsp/verbs-sign.ts");
  it("blind-hash detection", () => {
    expect(isBlindHashMessage({ raw: ("0x" + "11".repeat(32)) as Hex })).toBe(true);
    expect(isBlindHashMessage({ raw: ("0x" + "11".repeat(31)) as Hex })).toBe(false);
    expect(isBlindHashMessage("0x" + "ab".repeat(32))).toBe(true);
    expect(isBlindHashMessage("x".repeat(32))).toBe(true);
    expect(isBlindHashMessage("é".repeat(16))).toBe(true); // 32 utf-8 bytes
    expect(isBlindHashMessage("login nonce 42")).toBe(false);
    expect(EXTENSION_4337_KEY).toBe("0xcee78b4094da8601109600003a871cdd00000000000000000000000000000000");
  });
  it("value-moving typed data", () => {
    for (const pt of ["Permit", "PermitSingle", "PermitBatch", "PermitTransferFrom", "Order"]) expect(isValueMovingTypedData({ domain: {}, types: {}, primaryType: pt, message: {} } as any), pt).toBe(true);
    expect(isValueMovingTypedData({ domain: { name: "Permit2" }, types: {}, primaryType: "Anything", message: {} } as any)).toBe(true);
    expect(isValueMovingTypedData({ domain: { name: "Gnosis Protocol" }, types: {}, primaryType: "X", message: {} } as any)).toBe(true);
    expect(isValueMovingTypedData({ domain: { name: "Login" }, types: {}, primaryType: "Login", message: {} } as any)).toBe(false);
  });
});
