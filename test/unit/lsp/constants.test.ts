import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { keccak256, toBytes, toFunctionSelector, type Hex } from "viem";
import { ERC725, encodePermissions as e725EncodePermissions } from "@erc725/erc725.js";
import { SCHEMAS as AllSchemas } from "../../../src/lsp/schemas.ts";
import {
  ALL_PERMISSIONS,
  ALL_PERMISSIONS_HEX,
  CALLTYPE,
  DATA_KEYS,
  ERC1271_MAGIC,
  INTERFACE_IDS,
  LSP20_MAGIC,
  LSP25_VERSION,
  PERMISSION_BITS,
  PERMISSION_NAMES,
  PERMISSIONS,
  TYPE_IDS,
  URD_PERMISSIONS,
  VERIFICATION_METHODS,
  allowedCallsKey,
  allowedDataKeysKey,
  extensionKey,
  parseArrayLength,
  permissionsArrayIndexKey,
  permissionsKey,
  uint128Hex,
  urdTypeKey,
} from "../../../src/lsp/constants.ts";

const abiDir = join(import.meta.dirname, "..", "..", "..", "skills", "universal-profile", "assets", "abis");
const abi = (rel: string) => JSON.parse(readFileSync(join(abiDir, rel), "utf8")).abi as any[];
const k = (s: string) => keccak256(toBytes(s));
const schema = (name: string) => (AllSchemas as any[]).find((s) => s.name === name);

/** ERC-165 interface id = XOR of the function selectors of the interface. */
function interfaceId(fns: any[]): Hex {
  let x = 0;
  for (const f of fns.filter((f) => f.type === "function")) {
    const sig = `${f.name}(${f.inputs.map((i: any) => formatType(i)).join(",")})`;
    x ^= Number(BigInt(toFunctionSelector(sig)));
  }
  return ("0x" + (x >>> 0).toString(16).padStart(8, "0")) as Hex;
}
function formatType(i: any): string {
  if (i.type.startsWith("tuple")) return `(${i.components.map(formatType).join(",")})${i.type.slice(5)}`;
  return i.type;
}

describe("LSP6 permission constants", () => {
  it("every named bit matches erc725.js encodePermissions", () => {
    for (const name of PERMISSION_NAMES) {
      const e725Name = name === "_4337_PERMISSION" ? "ERC4337_PERMISSION" : name;
      expect(BigInt(e725EncodePermissions({ [e725Name]: true } as any)), name).toBe(PERMISSIONS[name]);
      expect(PERMISSIONS[name]).toBe(1n << BigInt(PERMISSION_BITS[name]));
    }
  });
  it("defines 23 LSP6 bits + the Extension4337 bit 23 (0x800000)", () => {
    expect(PERMISSION_NAMES.length).toBe(24);
    expect(PERMISSIONS._4337_PERMISSION).toBe(0x800000n);
    expect(PERMISSIONS.EXECUTE_RELAY_CALL).toBe(0x400000n);
  });
  it("ALL_PERMISSIONS equals erc725.js and the LSP6 constant 0x7f3f7f, excludes REENTRANCY/DELEGATECALL/4337", () => {
    expect(BigInt(e725EncodePermissions({ ALL_PERMISSIONS: true }))).toBe(ALL_PERMISSIONS);
    expect(ALL_PERMISSIONS_HEX).toBe(ERC725.encodePermissions({ ALL_PERMISSIONS: true }));
    expect(ALL_PERMISSIONS & PERMISSIONS.REENTRANCY).toBe(0n);
    expect(ALL_PERMISSIONS & PERMISSIONS.DELEGATECALL).toBe(0n);
    expect(ALL_PERMISSIONS & PERMISSIONS.SUPER_DELEGATECALL).toBe(0n);
    expect(ALL_PERMISSIONS & PERMISSIONS._4337_PERMISSION).toBe(0n);
    expect(ALL_PERMISSIONS & PERMISSIONS.EXECUTE_RELAY_CALL).not.toBe(0n);
  });
  it("URD permissions = SUPER_SETDATA + REENTRANCY (lsp-factory.js)", () => {
    expect(BigInt(e725EncodePermissions({ SUPER_SETDATA: true, REENTRANCY: true }))).toBe(URD_PERMISSIONS);
  });
  it("AllowedCalls call types", () => {
    expect(CALLTYPE).toEqual({ VALUE: 1, CALL: 2, STATICCALL: 4, DELEGATECALL: 8 });
  });
});

describe("ERC725Y data keys", () => {
  it("LSP6 keys match erc725.js schemas", () => {
    const ctl = "0xcafecafecafecafecafecafecafecafecafecafe";
    expect(DATA_KEYS["AddressPermissions[]"]).toBe(schema("AddressPermissions[]").key);
    expect(DATA_KEYS["AddressPermissions[]"]).toBe(k("AddressPermissions[]"));
    expect(DATA_KEYS.AddressPermissionsIndexPrefix).toBe(DATA_KEYS["AddressPermissions[]"].slice(0, 34));
    expect(permissionsKey(ctl)).toBe(ERC725.encodeKeyName("AddressPermissions:Permissions:<address>", ctl).toLowerCase());
    expect(allowedCallsKey(ctl)).toBe(ERC725.encodeKeyName("AddressPermissions:AllowedCalls:<address>", ctl).toLowerCase());
    expect(allowedDataKeysKey(ctl)).toBe(ERC725.encodeKeyName("AddressPermissions:AllowedERC725YDataKeys:<address>", ctl).toLowerCase());
    // LSP2 MappingWithGrouping: bytes6(keccak(first)) + bytes4(keccak(second)) + 0000 + address
    expect(DATA_KEYS.AddressPermissionsPermissionsPrefix).toBe(k("AddressPermissions").slice(0, 14) + k("Permissions").slice(2, 10) + "0000");
    expect(DATA_KEYS.AddressPermissionsAllowedCallsPrefix).toBe(k("AddressPermissions").slice(0, 14) + k("AllowedCalls").slice(2, 10) + "0000");
    expect(DATA_KEYS.AddressPermissionsAllowedERC725YDataKeysPrefix).toBe(k("AddressPermissions").slice(0, 14) + k("AllowedERC725YDataKeys").slice(2, 10) + "0000");
  });
  it("AddressPermissions[] index keys match erc725.js array encoding", () => {
    const enc = ERC725.encodeData([{ keyName: "AddressPermissions[]", value: ["0x1111111111111111111111111111111111111111", "0x2222222222222222222222222222222222222222", "0x3333333333333333333333333333333333333333"] }], AllSchemas as any);
    expect(enc.keys[1]).toBe(permissionsArrayIndexKey(0));
    expect(enc.keys[3]).toBe(permissionsArrayIndexKey(2));
    expect(enc.values[0]).toBe(uint128Hex(3));
    expect(parseArrayLength(uint128Hex(3))).toBe(3n);
    expect(parseArrayLength("0x" + "0".repeat(63) + "5" as Hex)).toBe(5n); // legacy 32-byte length
    expect(parseArrayLength("0x")).toBe(0n);
  });
  it("LSP1 / LSP17 / LSP3 / LSP5 / LSP10 / LSP12 keys", () => {
    expect(DATA_KEYS.LSP1UniversalReceiverDelegate).toBe(k("LSP1UniversalReceiverDelegate"));
    expect(DATA_KEYS.LSP1UniversalReceiverDelegate).toBe(schema("LSP1UniversalReceiverDelegate").key);
    expect(DATA_KEYS.LSP1UniversalReceiverDelegatePrefix).toBe(k("LSP1UniversalReceiverDelegate").slice(0, 22) + "0000");
    const typeId = k("LSP7Tokens_RecipientNotification");
    expect(urdTypeKey(typeId)).toBe(ERC725.encodeKeyName("LSP1UniversalReceiverDelegate:<bytes32>", typeId).toLowerCase());
    expect(DATA_KEYS.LSP17ExtensionPrefix).toBe(k("LSP17Extension").slice(0, 22) + "0000");
    expect(extensionKey("0x12345678")).toBe(ERC725.encodeKeyName("LSP17Extension:<bytes4>", "0x12345678").toLowerCase());
    expect(DATA_KEYS.LSP3Profile).toBe(k("LSP3Profile"));
    expect(DATA_KEYS.LSP3Profile).toBe(schema("LSP3Profile").key);
    expect(DATA_KEYS["SupportedStandards:LSP3Profile"]).toBe(schema("SupportedStandards:LSP3Profile").key);
    expect(DATA_KEYS.SupportedStandardsLSP3Value).toBe(schema("SupportedStandards:LSP3Profile").valueContent);
    expect(DATA_KEYS["LSP5ReceivedAssets[]"]).toBe(k("LSP5ReceivedAssets[]"));
    expect(DATA_KEYS.LSP5ReceivedAssetsMapPrefix).toBe(k("LSP5ReceivedAssetsMap").slice(0, 22) + "0000");
    expect(DATA_KEYS["LSP10Vaults[]"]).toBe(k("LSP10Vaults[]"));
    expect(DATA_KEYS.LSP10VaultsMapPrefix).toBe(k("LSP10VaultsMap").slice(0, 22) + "0000");
    expect(DATA_KEYS["LSP12IssuedAssets[]"]).toBe(k("LSP12IssuedAssets[]"));
    expect(DATA_KEYS["LSP12IssuedAssets[]"]).toBe(schema("LSP12IssuedAssets[]").key);
    expect(DATA_KEYS.LSP12IssuedAssetsMapPrefix).toBe(k("LSP12IssuedAssetsMap").slice(0, 22) + "0000");
    expect(() => extensionKey("0x1234")).toThrow();
  });
});

describe("interface ids, magic values, type ids", () => {
  it("interface ids derived from the bundled interface ABIs", () => {
    // LSP6 id = ILSP6 (target, execute, executeBatch, isValidSignature) ^ ILSP25 ^ ILSP20 functions
    expect(interfaceId([...abi("lsp/ILSP6KeyManager.json"), ...abi("lsp/ILSP25ExecuteRelayCall.json"), ...abi("lsp/ILSP20CallVerifier.json")])).toBe(INTERFACE_IDS.LSP6KeyManager);
    expect(interfaceId(abi("lsp/ILSP25ExecuteRelayCall.json"))).toBe(INTERFACE_IDS.LSP25ExecuteRelayCall);
    // LSP14 id includes owner() inherited from IERC173/OwnableUnset
    expect(interfaceId([...abi("lsp/ILSP14Ownable2Step.json"), { type: "function", name: "owner", inputs: [] }])).toBe(INTERFACE_IDS.LSP14Ownable2Step);
    // LSP7/LSP8 ids are fixed constants upstream (LSP7Constants.sol / LSP8Constants.sol) that no longer equal the XOR of the
    // current ABI; they are verified with supportsInterface() on deployed fixtures in test/chain/account.test.ts.
    expect(interfaceId(abi("lsp/ILSP20CallVerifier.json"))).toBe(INTERFACE_IDS.LSP20CallVerifier);
    expect(interfaceId(abi("lsp/ILSP1UniversalReceiver.json"))).toBe(INTERFACE_IDS.LSP1UniversalReceiver);
    expect(interfaceId(abi("lsp/ILSP1UniversalReceiverDelegate.json"))).toBe(INTERFACE_IDS.LSP1UniversalReceiverDelegate);
    const sel = (s: string) => Number(BigInt(toFunctionSelector(s)));
    const xor = (...s: string[]) => "0x" + (s.map(sel).reduce((a, b) => a ^ b, 0) >>> 0).toString(16).padStart(8, "0");
    expect(xor("execute(uint256,address,uint256,bytes)", "executeBatch(uint256[],address[],uint256[],bytes[])")).toBe(INTERFACE_IDS.ERC725X);
    expect(xor("getData(bytes32)", "setData(bytes32,bytes)", "getDataBatch(bytes32[])", "setDataBatch(bytes32[],bytes[])")).toBe(INTERFACE_IDS.ERC725Y);
    expect(xor("supportsInterface(bytes4)")).toBe(INTERFACE_IDS.ERC165);
    expect(xor("isValidSignature(bytes32,bytes)")).toBe(INTERFACE_IDS.ERC1271);
    expect(xor("lsp20VerifyCall(address,address,address,uint256,bytes)", "lsp20VerifyCallResult(bytes32,bytes)")).toBe(INTERFACE_IDS.LSP20CallVerifier);
    expect(xor("balanceOf(address)", "ownerOf(uint256)", "approve(address,uint256)", "getApproved(uint256)", "setApprovalForAll(address,bool)", "isApprovedForAll(address,address)", "transferFrom(address,address,uint256)", "safeTransferFrom(address,address,uint256)", "safeTransferFrom(address,address,uint256,bytes)")).toBe(INTERFACE_IDS.ERC721);
    expect(ERC725 && INTERFACE_IDS.LSP0ERC725Account).toBe("0x24871b3d"); // verified on chain in test/chain/account.test.ts
  });
  it("ERC1271 / LSP20 magic values and LSP25 version", () => {
    expect(ERC1271_MAGIC).toBe(toFunctionSelector("isValidSignature(bytes32,bytes)"));
    expect(LSP20_MAGIC.VERIFY_CALL_WITH_POST_VERIFICATION.slice(0, 8)).toBe(toFunctionSelector("lsp20VerifyCall(address,address,address,uint256,bytes)").slice(0, 8));
    expect(LSP20_MAGIC.VERIFY_CALL_RESULT).toBe(toFunctionSelector("lsp20VerifyCallResult(bytes32,bytes)"));
    expect(LSP25_VERSION).toBe(25n);
  });
  it("type ids and verification methods are keccak256 of their names", () => {
    expect(TYPE_IDS.LSP0ValueReceived).toBe(k("LSP0ValueReceived"));
    expect(TYPE_IDS.LSP0OwnershipTransferStarted).toBe(k("LSP0OwnershipTransferStarted"));
    expect(TYPE_IDS.LSP0OwnershipTransferred_SenderNotification).toBe(k("LSP0OwnershipTransferred_SenderNotification"));
    expect(TYPE_IDS.LSP0OwnershipTransferred_RecipientNotification).toBe(k("LSP0OwnershipTransferred_RecipientNotification"));
    expect(VERIFICATION_METHODS["keccak256(utf8)"]).toBe(k("keccak256(utf8)").slice(0, 10));
    expect(VERIFICATION_METHODS["keccak256(bytes)"]).toBe(k("keccak256(bytes)").slice(0, 10));
    expect(VERIFICATION_METHODS.ecdsa).toBe(k("ecdsa").slice(0, 10));
  });
});

describe("more reference ids", () => {
  it("ERC1155, ERC721Metadata and ERC20 probe selectors", async () => {
    const { ERC20_PROBES } = await import("../../../src/lsp/constants.ts");
    const sel = (s: string) => Number(BigInt(toFunctionSelector(s)));
    const xor = (...s: string[]) => "0x" + (s.map(sel).reduce((a, b) => a ^ b, 0) >>> 0).toString(16).padStart(8, "0");
    expect(xor("balanceOf(address,uint256)", "balanceOfBatch(address[],uint256[])", "setApprovalForAll(address,bool)", "isApprovedForAll(address,address)", "safeTransferFrom(address,address,uint256,uint256,bytes)", "safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)")).toBe(INTERFACE_IDS.ERC1155);
    expect(xor("name()", "symbol()", "tokenURI(uint256)")).toBe(INTERFACE_IDS.ERC721Metadata);
    expect(ERC20_PROBES).toEqual({ totalSupply: toFunctionSelector("totalSupply()"), balanceOf: toFunctionSelector("balanceOf(address)"), decimals: toFunctionSelector("decimals()") });
  });
});
