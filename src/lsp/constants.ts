// LSP constants used by the account core. Every value is cross-checked in
// test/unit/lsp/constants.test.ts against @erc725/erc725.js schemas, keccak256
// computations or the bundled upstream ABIs (lsp-smart-contracts @ abe865b,
// identical to upstream main 16ab244 for these constants).
//
// Sources (local mirror of https://github.com/lukso-network/lsp-smart-contracts):
//   packages/lsp6-contracts/contracts/LSP6Constants.sol
//   packages/lsp17-contracts/contracts/Extension4337.sol        (_4337_PERMISSION)
//   packages/lsp0/1/9/14/17/20/25-contracts/contracts/*Constants.sol
import type { Hex } from "viem";

// ---------------------------------------------------------------------------
// LSP6 permissions (bytes32 bit array; bit n = 1 << n)
// ---------------------------------------------------------------------------

/** Ordered permission names with their bit index. Bit 23 is defined only in Extension4337.sol. */
export const PERMISSION_BITS = {
  CHANGEOWNER: 0,
  ADDCONTROLLER: 1,
  EDITPERMISSIONS: 2,
  ADDEXTENSIONS: 3,
  CHANGEEXTENSIONS: 4,
  ADDUNIVERSALRECEIVERDELEGATE: 5,
  CHANGEUNIVERSALRECEIVERDELEGATE: 6,
  REENTRANCY: 7,
  SUPER_TRANSFERVALUE: 8,
  TRANSFERVALUE: 9,
  SUPER_CALL: 10,
  CALL: 11,
  SUPER_STATICCALL: 12,
  STATICCALL: 13,
  SUPER_DELEGATECALL: 14,
  DELEGATECALL: 15,
  DEPLOY: 16,
  SUPER_SETDATA: 17,
  SETDATA: 18,
  ENCRYPT: 19,
  DECRYPT: 20,
  SIGN: 21,
  EXECUTE_RELAY_CALL: 22,
  /**
   * `_4337_PERMISSION` from Extension4337.sol (bit 23, 0x…00800000). It is NOT part of
   * LSP6Constants.sol, the @lukso/lsp-smart-contracts TS `PERMISSIONS` object or
   * ALL_PERMISSIONS. erc725.js calls the same bit `ERC4337_PERMISSION`.
   */
  _4337_PERMISSION: 23,
} as const;

export type PermissionName = keyof typeof PERMISSION_BITS;

export const PERMISSION_NAMES = Object.keys(PERMISSION_BITS) as PermissionName[];

/** Permission name -> bigint bit value. */
export const PERMISSIONS: Record<PermissionName, bigint> = Object.fromEntries(PERMISSION_NAMES.map((n) => [n, 1n << BigInt(PERMISSION_BITS[n])])) as Record<PermissionName, bigint>;

/** Aliases accepted when parsing permission names (case-insensitive). */
export const PERMISSION_ALIASES: Record<string, PermissionName> = {
  ERC4337_PERMISSION: "_4337_PERMISSION",
  ERC4337: "_4337_PERMISSION",
  "4337": "_4337_PERMISSION",
  "4337_PERMISSION": "_4337_PERMISSION",
  RELAY: "EXECUTE_RELAY_CALL",
  EXECUTERELAYCALL: "EXECUTE_RELAY_CALL",
  CHANGE_OWNER: "CHANGEOWNER",
  ADD_CONTROLLER: "ADDCONTROLLER",
  EDIT_PERMISSIONS: "EDITPERMISSIONS",
  TRANSFER_VALUE: "TRANSFERVALUE",
  SUPER_TRANSFER_VALUE: "SUPER_TRANSFERVALUE",
  SET_DATA: "SETDATA",
  SUPER_SET_DATA: "SUPER_SETDATA",
  STATIC_CALL: "STATICCALL",
  SUPER_STATIC_CALL: "SUPER_STATICCALL",
};

/** LSP6 `ALL_REGULAR_PERMISSIONS` = 0x…7f3f7f (everything except REENTRANCY, SUPER_DELEGATECALL, DELEGATECALL and bit 23). */
export const ALL_PERMISSIONS = 0x7f3f7fn;
export const ALL_PERMISSIONS_HEX: Hex = "0x00000000000000000000000000000000000000000000000000000000007f3f7f";

/** Permissions LUKSO gives the LSP1 Universal Receiver Delegate of a UP: SUPER_SETDATA + REENTRANCY (lsp-factory.js, LUKSO docs). */
export const URD_PERMISSIONS = PERMISSIONS.SUPER_SETDATA | PERMISSIONS.REENTRANCY; // 0x20080

/** Controller is an "admin" if it can change who controls the profile. */
export const ADMIN_PERMISSIONS = PERMISSIONS.CHANGEOWNER | PERMISSIONS.ADDCONTROLLER | PERMISSIONS.EDITPERMISSIONS;

// ---------------------------------------------------------------------------
// AllowedCalls call types (bytes4 bit field, LSP6Constants.sol _ALLOWEDCALLS_*)
// ---------------------------------------------------------------------------
export const CALLTYPE = {
  VALUE: 0x00000001,
  CALL: 0x00000002,
  STATICCALL: 0x00000004,
  DELEGATECALL: 0x00000008,
} as const;
export type CallTypeName = keyof typeof CALLTYPE;

export const WILDCARD_ADDRESS = "0xffffffffffffffffffffffffffffffffffffffff" as const;
export const WILDCARD_BYTES4: Hex = "0xffffffff";

// ---------------------------------------------------------------------------
// ERC725Y data keys
// ---------------------------------------------------------------------------
export const DATA_KEYS = {
  // LSP6
  "AddressPermissions[]": "0xdf30dba06db6a30e65354d9a64c609861f089545ca58c6b4dbe31a5f338cb0e3" as Hex,
  /** bytes16 prefix of the AddressPermissions[] index keys (index = uint128 appended) */
  AddressPermissionsIndexPrefix: "0xdf30dba06db6a30e65354d9a64c60986" as Hex,
  /** bytes6 prefix shared by all AddressPermissions:* mapping keys */
  AddressPermissionsPrefix: "0x4b80742de2bf" as Hex,
  /** AddressPermissions:Permissions:<address> = prefix (12 bytes) + address */
  AddressPermissionsPermissionsPrefix: "0x4b80742de2bf82acb3630000" as Hex,
  AddressPermissionsAllowedCallsPrefix: "0x4b80742de2bf393a64c70000" as Hex,
  AddressPermissionsAllowedERC725YDataKeysPrefix: "0x4b80742de2bf866c29110000" as Hex,
  // LSP1
  LSP1UniversalReceiverDelegate: "0x0cfc51aec37c55a4d0b1a65c6255c4bf2fbdf6277f3cc0730c45b828b6db8b47" as Hex,
  /** LSP1UniversalReceiverDelegate:<bytes32 typeId> mapping prefix (12 bytes incl. 2 zero bytes) */
  LSP1UniversalReceiverDelegatePrefix: "0x0cfc51aec37c55a4d0b10000" as Hex,
  // LSP17
  /** LSP17Extension:<bytes4> = prefix (12 bytes) + selector (4) + 16 zero bytes */
  LSP17ExtensionPrefix: "0xcee78b4094da860110960000" as Hex,
  // LSP3
  LSP3Profile: "0x5ef83ad9559033e6e941db7d7c495acdce616347d28e90c7ce47cbfcfcad3bc5" as Hex,
  "SupportedStandards:LSP3Profile": "0xeafec4d89fa9619884b600005ef83ad9559033e6e941db7d7c495acdce616347" as Hex,
  SupportedStandardsLSP3Value: "0x5ef83ad9" as Hex,
  // LSP5
  "LSP5ReceivedAssets[]": "0x6460ee3c0aac563ccbf76d6e1d07bada78e3a9514e6382b736ed3f478ab7b90b" as Hex,
  LSP5ReceivedAssetsMapPrefix: "0x812c4334633eb816c80d0000" as Hex,
  // LSP10
  "LSP10Vaults[]": "0x55482936e01da86729a45d2b87a6b1d3bc582bea0ec00e38bdb340e3af6f9f06" as Hex,
  LSP10VaultsMapPrefix: "0x192448c3c0f88c7f238c0000" as Hex,
  // LSP12
  "LSP12IssuedAssets[]": "0x7c8c3416d6cda87cd42c71ea1843df28ac4850354f988d55ee2eaa47b6dc05cd" as Hex,
  LSP12IssuedAssetsMapPrefix: "0x74ac2555c10b9349e78f0000" as Hex,
} as const;

// ---------------------------------------------------------------------------
// ERC-165 interface IDs
// ---------------------------------------------------------------------------
export const INTERFACE_IDS = {
  ERC165: "0x01ffc9a7",
  ERC1271: "0x1626ba7e",
  ERC725X: "0x7545acac",
  ERC725Y: "0x629aa694",
  LSP0ERC725Account: "0x24871b3d",
  LSP1UniversalReceiver: "0x6bb56a14",
  LSP1UniversalReceiverDelegate: "0xa245bbda",
  LSP6KeyManager: "0x23f34c62",
  /** current LSP7 id (LSP7MintableInit 0.17.3 and 0.19.0 report it) */
  LSP7DigitalAsset: "0xc52d6008",
  /** reported by the canonical LSP7MintableInit 0.14.0 deployment */
  LSP7DigitalAsset_v0_14: "0xb3c4928f",
  LSP7DigitalAsset_v0_12: "0xdaa746b7",
  /** current LSP8 id — also reported by the canonical LSP8MintableInit 0.14.0 deployment */
  LSP8IdentifiableDigitalAsset: "0x3a271706",
  /** legacy id named _INTERFACEID_LSP8_V0_14_0 in LSP8Constants.sol (lsp8-contracts package numbering) */
  LSP8IdentifiableDigitalAsset_v0_14: "0xecad9f75",
  LSP8IdentifiableDigitalAsset_v0_12: "0x30dc5278",
  LSP9Vault: "0x28af17e6",
  LSP14Ownable2Step: "0x94be5999",
  LSP17Extendable: "0xa918fa6b",
  LSP17Extension: "0xcee78b40",
  LSP20CallVerification: "0x1a0eb6a5",
  LSP20CallVerifier: "0x0d6ecac7",
  LSP25ExecuteRelayCall: "0x5ac79908",
  ERC721: "0x80ac58cd",
  ERC721Metadata: "0x5b5e139f",
  ERC1155: "0xd9b67a26",
  // ERC-20 has no ERC-165 id: detect with probes (decimals()/totalSupply()/balanceOf()).
} as const satisfies Record<string, Hex>;

/** Function selectors used to probe ERC-20 (no ERC-165 id). */
export const ERC20_PROBES = { totalSupply: "0x18160ddd", balanceOf: "0x70a08231", decimals: "0x313ce567" } as const;

// ---------------------------------------------------------------------------
// Magic values / versions / type ids
// ---------------------------------------------------------------------------
export const ERC1271_MAGIC: Hex = "0x1626ba7e";
export const ERC1271_FAIL: Hex = "0xffffffff";
export const LSP20_MAGIC = {
  VERIFY_CALL_WITH_POST_VERIFICATION: "0xde928f01" as Hex,
  VERIFY_CALL_WITHOUT_POST_VERIFICATION: "0xde928f00" as Hex,
  VERIFY_CALL_RESULT: "0xd3fc45d3" as Hex,
};
export const LSP25_VERSION = 25n;

/** LSP14 renounce ownership delay/period (blocks), see LSP14Ownable2Step.sol. */
export const LSP14_RENOUNCE_DELAY = 200n;
export const LSP14_RENOUNCE_PERIOD = 200n;

export const TYPE_IDS = {
  LSP0ValueReceived: "0x9c4705229491d365fb5434052e12a386d6771d976bea61070a8c694e8affea3d" as Hex,
  LSP0OwnershipTransferStarted: "0xe17117c9d2665d1dbeb479ed8058bbebde3c50ac50e2e65619f60006caac6926" as Hex,
  LSP0OwnershipTransferred_SenderNotification: "0xa4e59c931d14f7c8a7a35027f92ee40b5f2886b9fdcdb78f30bc5ecce5a2f814" as Hex,
  LSP0OwnershipTransferred_RecipientNotification: "0xceca317f109c43507871523e82dc2a3cc64dfa18f12da0b6db14f6e23f995538" as Hex,
};

/** LSP2 VerifiableURI verification method ids. */
export const VERIFICATION_METHODS = {
  "keccak256(utf8)": "0x6f357c6a" as Hex,
  "keccak256(bytes)": "0x8019f9b1" as Hex,
  ecdsa: "0xac75a10e" as Hex,
};

/** ERC725X operation types. DELEGATECALL through the Key Manager always reverts (DelegateCallDisallowedViaKeyManager). */
export const OPERATIONS = { CALL: 0, CREATE: 1, CREATE2: 2, STATICCALL: 3, DELEGATECALL: 4 } as const;

/** Well-known selectors that can be registered as LSP17 extensions on a UP. */
export const KNOWN_EXTENSION_SELECTORS: Record<string, string> = {
  "0x3a871cdd": "validateUserOp (ERC-4337 v0.6, Extension4337)",
  "0x150b7a02": "onERC721Received (ERC-721 safe transfers)",
  "0xf23a6e61": "onERC1155Received",
  "0xbc197c81": "onERC1155BatchReceived",
  "0x0023de29": "tokensReceived (ERC-777)",
  "0x06fdde03": "name()",
  "0x95d89b41": "symbol()",
};

// Small key builders -------------------------------------------------------

const addr20 = (a: string) => a.toLowerCase().replace(/^0x/, "").padStart(40, "0");

export function permissionsKey(controller: string): Hex {
  return (DATA_KEYS.AddressPermissionsPermissionsPrefix + addr20(controller)) as Hex;
}
export function allowedCallsKey(controller: string): Hex {
  return (DATA_KEYS.AddressPermissionsAllowedCallsPrefix + addr20(controller)) as Hex;
}
export function allowedDataKeysKey(controller: string): Hex {
  return (DATA_KEYS.AddressPermissionsAllowedERC725YDataKeysPrefix + addr20(controller)) as Hex;
}
/** AddressPermissions[index] key: bytes16 prefix + uint128 index. */
export function permissionsArrayIndexKey(index: number | bigint): Hex {
  return (DATA_KEYS.AddressPermissionsIndexPrefix + BigInt(index).toString(16).padStart(32, "0")) as Hex;
}
/** LSP17Extension:<selector> key. */
export function extensionKey(selector: string): Hex {
  const s = selector.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{8}$/.test(s)) throw new Error(`invalid bytes4 selector: ${selector}`);
  return (DATA_KEYS.LSP17ExtensionPrefix + s + "0".repeat(32)) as Hex;
}
/** LSP1UniversalReceiverDelegate:<typeId> key (first 20 bytes of the typeId). */
export function urdTypeKey(typeId: string): Hex {
  const t = typeId.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(t)) throw new Error(`invalid bytes32 typeId: ${typeId}`);
  return (DATA_KEYS.LSP1UniversalReceiverDelegatePrefix + t.slice(0, 40)) as Hex;
}
/** uint128 value (16 bytes) used for LSP2 array lengths. */
export function uint128Hex(n: number | bigint): Hex {
  return ("0x" + BigInt(n).toString(16).padStart(32, "0")) as Hex;
}
/** Parses an LSP2 array length value (16 bytes per LSP2; legacy 32-byte values accepted). */
export function parseArrayLength(v: Hex | undefined | null): bigint {
  if (!v || v === "0x") return 0n;
  return BigInt(v);
}
