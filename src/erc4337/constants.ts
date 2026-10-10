// ERC-4337 (opt-in module) constants: EntryPoint v0.6 + LUKSO Extension4337.
// Sources: lsp-smart-contracts packages/lsp17-contracts/contracts/Extension4337.sol
// (validateUserOp v0.6 selector, _4337_PERMISSION), packages/lsp6-contracts/contracts/
// LSP6Constants.sol (permission bits, data keys), eth-infinitism account-abstraction
// v0.6.0 (EntryPoint ABI via viem's entryPoint06Abi).
import { concat, pad, parseAbi, type Abi, type Address, type Hex } from "viem";
import { entryPoint06Abi } from "viem/account-abstraction";
import { assetJson } from "../core/assets.ts";
import { LSP } from "../chain/registry.ts";

export { entryPoint06Abi };

export const ENTRYPOINT_V06: Address = LSP.ENTRYPOINT_V06;
export const NICK_FACTORY: Address = LSP.NICK_FACTORY;
/** keccak256 of Nick's deterministic deployment proxy runtime code (identical on every chain where it exists). */
export const NICK_FACTORY_RUNTIME = "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3" as Hex;

/** IAccount.validateUserOp for the v0.6 UserOperation struct. v0.7+ (0x19822f7c) never reaches Extension4337. */
export const VALIDATE_USER_OP_SELECTOR = "0x3a871cdd" as Hex;
export const LSP17_EXTENSION_PREFIX = "0xcee78b4094da860110960000" as Hex;
/** LSP17Extension:<0x3a871cdd> = prefix(12) ++ selector(4) ++ 16 zero bytes. */
export const EXTENSION_4337_KEY = concat([LSP17_EXTENSION_PREFIX, VALIDATE_USER_OP_SELECTOR, pad("0x", { size: 16 })]) as Hex;

/** Signature-validation failure code returned by IAccount.validateUserOp. */
export const SIG_VALIDATION_FAILED = 1n;

/** UP execution ABI subset (ERC725X/ERC725Y/LSP14). */
export const UP_ABI = parseAbi([
  "function execute(uint256 operationType, address target, uint256 value, bytes data) payable returns (bytes)",
  "function executeBatch(uint256[] operationsType, address[] targets, uint256[] values, bytes[] datas) payable returns (bytes[])",
  "function setData(bytes32 dataKey, bytes dataValue) payable",
  "function setDataBatch(bytes32[] dataKeys, bytes[] dataValues) payable",
  "function getData(bytes32 dataKey) view returns (bytes)",
  "function getDataBatch(bytes32[] dataKeys) view returns (bytes[])",
  "function owner() view returns (address)",
  "function transferOwnership(address newOwner)",
  "function acceptOwnership()",
  "function renounceOwnership()",
]);

/**
 * Well-formed but unprivileged 65-byte signature (low-s, valid r; produced once by a throwaway key over a fixed
 * message). Used for every estimation/simulation so that no real userOpHash is ever signed before consent:
 * Extension4337 recovers an address without the 4337 permission and returns SIG_VALIDATION_FAILED (1) instead
 * of reverting. An op carrying it can never pass validation (AA24).
 */
export const DUMMY_SIGNATURE = "0xffbdabe82992dac6f334511d6985daa3fb0861a85ac154a486ad946c0c0861187ce1b2273376b56f68e0258839f3ca6eeac0439a6c87dcac64e6c0c0195c4cd61b" as Hex;

export const KM_ABI = parseAbi([
  "function execute(bytes payload) payable returns (bytes)",
  "function target() view returns (address)",
  "function lsp20VerifyCall(address requestor, address targetContract, address caller, uint256 msgValue, bytes callData) returns (bytes4)",
]);

/** Extension4337 ABI as bundled (assets/abis/lsp/Extension4337.json). */
export function extension4337Abi(): Abi {
  return assetJson<{ abi: Abi }>("abis", "lsp", "Extension4337.json").abi;
}

// ---------------------------------------------------------------------------
// LSP6 permissions (LSP6Constants.sol) + the extension-only 4337 bit
// ---------------------------------------------------------------------------

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
  /** `_4337_PERMISSION` — defined only in Extension4337.sol, not in LSP6Constants / ALL_PERMISSIONS. */
  ERC4337: 23,
} as const;
export type PermissionName = keyof typeof PERMISSION_BITS;

export const P = Object.fromEntries(Object.entries(PERMISSION_BITS).map(([k, b]) => [k, 1n << BigInt(b)])) as Record<PermissionName, bigint>;
export const PERMISSION_4337 = P.ERC4337; // 0x…00800000

/** Bits the EntryPoint controller may ever hold (execution only). */
export const ENTRYPOINT_ALLOWED_PERMISSIONS: PermissionName[] = ["SUPER_TRANSFERVALUE", "TRANSFERVALUE", "SUPER_CALL", "CALL", "SUPER_STATICCALL", "STATICCALL", "DEPLOY", "SUPER_SETDATA", "SETDATA"];
/** Never granted to the EntryPoint (erc4337-plan §5). */
export const ENTRYPOINT_FORBIDDEN_PERMISSIONS: PermissionName[] = (Object.keys(PERMISSION_BITS) as PermissionName[]).filter((n) => !ENTRYPOINT_ALLOWED_PERMISSIONS.includes(n));

// LSP6 data keys
export const KEY_ADDRESS_PERMISSIONS_ARRAY = "0xdf30dba06db6a30e65354d9a64c609861f089545ca58c6b4dbe31a5f338cb0e3" as Hex;
export const KEY_ADDRESS_PERMISSIONS_ARRAY_PREFIX = "0xdf30dba06db6a30e65354d9a64c60986" as Hex;
export const KEY_PREFIX_PERMISSIONS = "0x4b80742de2bf82acb3630000" as Hex;
export const KEY_PREFIX_ALLOWED_CALLS = "0x4b80742de2bf393a64c70000" as Hex;
export const KEY_PREFIX_ALLOWED_DATA_KEYS = "0x4b80742de2bf866c29110000" as Hex;

/** AllowedCalls call-type bits. */
export const CALL_TYPES = { VALUE: 0x1, CALL: 0x2, STATICCALL: 0x4, DELEGATECALL: 0x8 } as const;
