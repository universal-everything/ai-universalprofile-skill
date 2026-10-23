// Vendored @erc725/erc725.js (Apache-2.0) — https://github.com/ERC725Alliance/erc725.js
// Universal Profile Agent Skill v0.2.0 — MIT-0 — https://github.com/universal-everything/ai-universalprofile-skill
// Built from source fingerprint 362e4d5b6525 (sha256 of the bundled src/ modules and build inputs) with `npm ci && npm run build` (esbuild, unminified). Do not edit; edit src/ instead.
import { createRequire as __upCreateRequire } from "node:module";
const require = __upCreateRequire(import.meta.url);


// node_modules/@erc725/erc725.js/build/chunk-AHQT6NWT.mjs
var LSP1UniversalReceiverDelegate_default = [
  {
    name: "LSP1UniversalReceiverDelegate",
    key: "0x0cfc51aec37c55a4d0b1a65c6255c4bf2fbdf6277f3cc0730c45b828b6db8b47",
    keyType: "Singleton",
    valueType: "address",
    valueContent: "Address"
  },
  {
    name: "LSP1UniversalReceiverDelegate:<bytes32>",
    key: "0x0cfc51aec37c55a4d0b10000<bytes32>",
    keyType: "Mapping",
    valueType: "address",
    valueContent: "Address"
  }
];
var LSP3ProfileMetadata_default = [
  {
    name: "SupportedStandards:LSP3Profile",
    key: "0xeafec4d89fa9619884b600005ef83ad9559033e6e941db7d7c495acdce616347",
    keyType: "Mapping",
    valueType: "bytes4",
    valueContent: "0x5ef83ad9"
  },
  {
    name: "LSP3Profile",
    key: "0x5ef83ad9559033e6e941db7d7c495acdce616347d28e90c7ce47cbfcfcad3bc5",
    keyType: "Singleton",
    valueType: "bytes",
    valueContent: "VerifiableURI"
  },
  {
    name: "LSP12IssuedAssets[]",
    key: "0x7c8c3416d6cda87cd42c71ea1843df28ac4850354f988d55ee2eaa47b6dc05cd",
    keyType: "Array",
    valueType: "address",
    valueContent: "Address"
  },
  {
    name: "LSP12IssuedAssetsMap:<address>",
    key: "0x74ac2555c10b9349e78f0000<address>",
    keyType: "Mapping",
    valueType: "(bytes4,uint128)",
    valueContent: "(Bytes4,Number)"
  },
  {
    name: "LSP5ReceivedAssets[]",
    key: "0x6460ee3c0aac563ccbf76d6e1d07bada78e3a9514e6382b736ed3f478ab7b90b",
    keyType: "Array",
    valueType: "address",
    valueContent: "Address"
  },
  {
    name: "LSP5ReceivedAssetsMap:<address>",
    key: "0x812c4334633eb816c80d0000<address>",
    keyType: "Mapping",
    valueType: "(bytes4,uint128)",
    valueContent: "(Bytes4,Number)"
  },
  {
    name: "LSP1UniversalReceiverDelegate",
    key: "0x0cfc51aec37c55a4d0b1a65c6255c4bf2fbdf6277f3cc0730c45b828b6db8b47",
    keyType: "Singleton",
    valueType: "address",
    valueContent: "Address"
  },
  {
    name: "LSP1UniversalReceiverDelegate:<bytes32>",
    key: "0x0cfc51aec37c55a4d0b10000<bytes32>",
    keyType: "Mapping",
    valueType: "address",
    valueContent: "Address"
  },
  {
    name: "LSP17Extension:<bytes4>",
    key: "0xcee78b4094da860110960000<bytes4>",
    keyType: "Mapping",
    valueType: "address",
    valueContent: "Address"
  }
];
var LSP4DigitalAsset_default = [
  {
    name: "SupportedStandards:LSP4DigitalAsset",
    key: "0xeafec4d89fa9619884b60000a4d96624a38f7ac2d8d9a604ecf07c12c77e480c",
    keyType: "Mapping",
    valueType: "bytes4",
    valueContent: "0xa4d96624"
  },
  {
    name: "LSP4TokenName",
    key: "0xdeba1e292f8ba88238e10ab3c7f88bd4be4fac56cad5194b6ecceaf653468af1",
    keyType: "Singleton",
    valueType: "string",
    valueContent: "String"
  },
  {
    name: "LSP4TokenSymbol",
    key: "0x2f0a68ab07768e01943a599e73362a0e17a63a72e94dd2e384d2c1d4db932756",
    keyType: "Singleton",
    valueType: "string",
    valueContent: "String"
  },
  {
    name: "LSP4TokenType",
    key: "0xe0261fa95db2eb3b5439bd033cda66d56b96f92f243a8228fd87550ed7bdfdb3",
    keyType: "Singleton",
    valueType: "uint256",
    valueContent: "Number"
  },
  {
    name: "LSP4Metadata",
    key: "0x9afb95cacc9f95858ec44aa8c3b685511002e30ae54415823f406128b85b238e",
    keyType: "Singleton",
    valueType: "bytes",
    valueContent: "VerifiableURI"
  },
  {
    name: "LSP4Creators[]",
    key: "0x114bd03b3a46d48759680d81ebb2b414fda7d030a7105a851867accf1c2352e7",
    keyType: "Array",
    valueType: "address",
    valueContent: "Address"
  },
  {
    name: "LSP4CreatorsMap:<address>",
    key: "0x6de85eaf5d982b4e5da00000<address>",
    keyType: "Mapping",
    valueType: "(bytes4,uint128)",
    valueContent: "(Bytes4,Number)"
  }
];
var LSP4DigitalAssetLegacy_default = [
  {
    name: "SupportedStandards:LSP4DigitalCertificate",
    key: "0xeafec4d89fa9619884b6b89135626455000000000000000000000000abf0613c",
    keyType: "Mapping",
    valueContent: "0xabf0613c",
    valueType: "bytes"
  }
];
var LSP5ReceivedAssets_default = [
  {
    name: "LSP5ReceivedAssets[]",
    key: "0x6460ee3c0aac563ccbf76d6e1d07bada78e3a9514e6382b736ed3f478ab7b90b",
    keyType: "Array",
    valueType: "address",
    valueContent: "Address"
  },
  {
    name: "LSP5ReceivedAssetsMap:<address>",
    key: "0x812c4334633eb816c80d0000<address>",
    keyType: "Mapping",
    valueType: "(bytes4,uint128)",
    valueContent: "(Bytes4,Number)"
  }
];
var LSP6KeyManager_default = [
  {
    name: "AddressPermissions[]",
    key: "0xdf30dba06db6a30e65354d9a64c609861f089545ca58c6b4dbe31a5f338cb0e3",
    keyType: "Array",
    valueType: "address",
    valueContent: "Address"
  },
  {
    name: "AddressPermissions:Permissions:<address>",
    key: "0x4b80742de2bf82acb3630000<address>",
    keyType: "MappingWithGrouping",
    valueType: "bytes32",
    valueContent: "BitArray"
  },
  {
    name: "AddressPermissions:AllowedCalls:<address>",
    key: "0x4b80742de2bf393a64c70000<address>",
    keyType: "MappingWithGrouping",
    valueType: "(bytes4,address,bytes4,bytes4)[CompactBytesArray]",
    valueContent: "(BitArray,Address,Bytes4,Bytes4)"
  },
  {
    name: "AddressPermissions:AllowedERC725YDataKeys:<address>",
    key: "0x4b80742de2bf866c29110000<address>",
    keyType: "MappingWithGrouping",
    valueType: "bytes[CompactBytesArray]",
    valueContent: "Bytes"
  }
];
var LSP8IdentifiableDigitalAsset_default = [
  {
    name: "LSP8TokenIdFormat",
    key: "0xf675e9361af1c1664c1868cfa3eb97672d6b1a513aa5b81dec34c9ee330e818d",
    keyType: "Singleton",
    valueType: "uint256",
    valueContent: "Number"
  },
  {
    name: "LSP8TokenMetadataBaseURI",
    key: "0x1a7628600c3bac7101f53697f48df381ddc36b9015e7d7c9c5633d1252aa2843",
    keyType: "Singleton",
    valueType: "bytes",
    valueContent: "VerifiableURI"
  },
  {
    name: "LSP8ReferenceContract",
    key: "0x708e7b881795f2e6b6c2752108c177ec89248458de3bf69d0d43480b3e5034e6",
    keyType: "Singleton",
    valueType: "(address,bytes32)",
    valueContent: "(Address,Bytes32)"
  }
];
var LSP9Vault_default = [
  {
    name: "SupportedStandards:LSP9Vault",
    key: "0xeafec4d89fa9619884b600007c0334a14085fefa8b51ae5a40895018882bdb90",
    keyType: "Mapping",
    valueType: "bytes4",
    valueContent: "0x7c0334a1"
  },
  {
    name: "LSP1UniversalReceiverDelegate",
    key: "0x0cfc51aec37c55a4d0b1a65c6255c4bf2fbdf6277f3cc0730c45b828b6db8b47",
    keyType: "Singleton",
    valueType: "address",
    valueContent: "Address"
  },
  {
    name: "LSP1UniversalReceiverDelegate:<bytes32>",
    key: "0x0cfc51aec37c55a4d0b10000<bytes32>",
    keyType: "Mapping",
    valueType: "address",
    valueContent: "Address"
  },
  {
    name: "LSP17Extension:<bytes4>",
    key: "0xcee78b4094da860110960000<bytes4>",
    keyType: "Mapping",
    valueType: "address",
    valueContent: "Address"
  }
];
var LSP10ReceivedVaults_default = [
  {
    name: "LSP10VaultsMap:<address>",
    key: "0x192448c3c0f88c7f238c0000<address>",
    keyType: "Mapping",
    valueType: "(bytes4,uint128)",
    valueContent: "(Bytes4,Number)"
  },
  {
    name: "LSP10Vaults[]",
    key: "0x55482936e01da86729a45d2b87a6b1d3bc582bea0ec00e38bdb340e3af6f9f06",
    keyType: "Array",
    valueType: "address",
    valueContent: "Address"
  }
];
var LSP12IssuedAssets_default = [
  {
    name: "LSP12IssuedAssets[]",
    key: "0x7c8c3416d6cda87cd42c71ea1843df28ac4850354f988d55ee2eaa47b6dc05cd",
    keyType: "Array",
    valueType: "address",
    valueContent: "Address"
  },
  {
    name: "LSP12IssuedAssetsMap:<address>",
    key: "0x74ac2555c10b9349e78f0000<address>",
    keyType: "Mapping",
    valueType: "(bytes4,uint128)",
    valueContent: "(Bytes4,Number)"
  }
];
var LSP17ContractExtension_default = [
  {
    name: "LSP17Extension:<bytes4>",
    key: "0xcee78b4094da860110960000<bytes4>",
    keyType: "Mapping",
    valueType: "address",
    valueContent: "Address"
  }
];
var LSP1Schema = LSP1UniversalReceiverDelegate_default;
var LSP3Schema = LSP3ProfileMetadata_default;
var LSP4Schema = LSP4DigitalAsset_default;
var LSP4LegacySchema = LSP4DigitalAssetLegacy_default;
var LSP5Schema = LSP5ReceivedAssets_default;
var LSP6Schema = LSP6KeyManager_default;
var LSP8Schema = LSP8IdentifiableDigitalAsset_default;
var LSP9Schema = LSP9Vault_default;
var LSP10Schema = LSP10ReceivedVaults_default;
var LSP12Schema = LSP12IssuedAssets_default;
var LSP17Schema = LSP17ContractExtension_default;
var AllSchemas = LSP1Schema.concat(
  LSP3Schema,
  LSP4Schema,
  LSP4LegacySchema,
  LSP5Schema,
  LSP6Schema,
  LSP8Schema,
  LSP9Schema,
  LSP10Schema,
  LSP12Schema,
  LSP17Schema
);
var schemas_default = AllSchemas;

// node_modules/@erc725/erc725.js/build/index.mjs
import { numberToHex, keccak256, toHex, toBytes } from "./vendor-viem.mjs";
import { decodeAbiParameters, isHex, toHex as toHex2 } from "./vendor-viem.mjs";
import { encodeAbiParameters } from "./vendor-viem.mjs";
import {
  bytesToHex,
  concat,
  decodeAbiParameters as decodeAbiParameters2,
  encodeAbiParameters as encodeAbiParameters2,
  encodePacked,
  getAddress,
  hexToBytes,
  hexToNumber,
  hexToString,
  isAddress,
  isHex as isHex2,
  numberToHex as numberToHex2,
  pad,
  size,
  slice,
  stringToHex,
  toHex as toHex3
} from "./vendor-viem.mjs";
import { isAddress as isAddress2, isHex as isHex3, slice as slice2, stringToBytes, toBytes as toBytes2 } from "./vendor-viem.mjs";
import { keccak256 as keccak2562, numberToHex as numberToHex3, pad as pad2 } from "./vendor-viem.mjs";
import { pad as pad3, isHex as isHex4 } from "./vendor-viem.mjs";
import { isHex as isHex5 } from "./vendor-viem.mjs";
import { isHex as isHex6, size as size2, slice as slice3 } from "./vendor-viem.mjs";
import {
  concat as concat2,
  hexToBytes as hexToBytes2,
  isAddress as isAddress3,
  isHex as isHex7,
  pad as pad4,
  size as size3,
  slice as slice4,
  toHex as toHex4
} from "./vendor-viem.mjs";
import { concat as concat3, isHex as isHex8, keccak256 as keccak2563, slice as slice5, toBytes as toBytes3 } from "./vendor-viem.mjs";
import { keccak256 as keccak2564, stringToHex as stringToHex2 } from "./vendor-viem.mjs";
import { hexToBigInt, isHex as isHex9, pad as pad5, toHex as toHex5 } from "./vendor-viem.mjs";
import { createPublicClient, http, isAddress as isAddress4 } from "./vendor-viem.mjs";
import { lukso } from "./vendor-viem.mjs";
var ERC725Y_INTERFACE_IDS = {
  // interface functions:
  //     - getData(bytes32)
  //     - setData(bytes32,bytes)
  legacy: "0x2bd57b73",
  // interface functions:
  //     - getData(bytes32[])
  //     - setData(bytes32[],bytes[])
  "2.0": "0x5a988c0f",
  // version 3.0.0 introduced function overloading
  // interface functions:
  //     - getData(bytes32)
  //     - setData(bytes32,bytes)
  //     - getData(bytes32[])
  //     - setData(bytes32[],bytes[])
  "3.0": "0x714df77c",
  // InterfaceId of version 3 == interfaceId of version 4
  // version 5.0.0 removed function overloading
  // interface functions:
  //     - getData(bytes32)
  //     - setData(bytes32,bytes)
  //     - getDataBatch(bytes32[])
  //     - setDataBatch(bytes32[],bytes[])
  "5.0": "0x629aa694"
};
var METHODS = {
  [
    "getDataLegacy"
    /* GET_DATA_LEGACY */
  ]: {
    // Legacy version of ERC725Y - before v0.3.0
    sig: "0x54f6127f",
    // getData(bytes32)
    value: numberToHex(0),
    returnEncoding: "bytes"
    /* BYTES */
  },
  [
    "getData"
    /* GET_DATA */
  ]: {
    // https://github.com/ERC725Alliance/ERC725/blob/v4.0.0/docs/ERC-725.md#erc725y
    sig: "0x4e3e6e9c",
    // getData(bytes32[])
    value: numberToHex(0),
    returnEncoding: "bytes[]"
    /* BYTES_ARRAY */
  },
  [
    "getDataBatch"
    /* GET_DATA_BATCH */
  ]: {
    // https://github.com/ERC725Alliance/ERC725/blob/v5.1.0/docs/ERC-725.md#erc725y
    sig: "0xdedff9c6",
    // getDataBatch(bytes32[])
    value: numberToHex(0),
    returnEncoding: "bytes[]"
    /* BYTES_ARRAY */
  },
  [
    "owner"
    /* OWNER */
  ]: {
    sig: "0x8da5cb5b",
    value: numberToHex(0),
    returnEncoding: "address"
    /* ADDRESS */
  },
  [
    "supportsInterface"
    /* SUPPORTS_INTERFACE */
  ]: {
    // https://eips.ethereum.org/EIPS/eip-165
    sig: "0x01ffc9a7",
    value: numberToHex(0),
    returnEncoding: "bool"
    /* BOOL */
  },
  [
    "isValidSignature"
    /* IS_VALID_SIGNATURE */
  ]: {
    // https://eips.ethereum.org/EIPS/eip-1271
    sig: "0x1626ba7e",
    value: numberToHex(0),
    returnEncoding: "bytes4"
    /* BYTES4 */
  }
};
var NONE_VERIFICATION_METHOD = "0x00000000";
var SUPPORTED_VERIFICATION_METHOD_STRINGS = /* @__PURE__ */ ((SUPPORTED_VERIFICATION_METHOD_STRINGS3) => {
  SUPPORTED_VERIFICATION_METHOD_STRINGS3["KECCAK256_UTF8"] = "keccak256(utf8)";
  SUPPORTED_VERIFICATION_METHOD_STRINGS3["KECCAK256_BYTES"] = "keccak256(bytes)";
  return SUPPORTED_VERIFICATION_METHOD_STRINGS3;
})(SUPPORTED_VERIFICATION_METHOD_STRINGS || {});
var SUPPORTED_VERIFICATION_METHODS_LIST = Object.values(
  SUPPORTED_VERIFICATION_METHOD_STRINGS
);
function keccak256Method(data) {
  if (data === null) {
    return keccak256(new Uint8Array([]));
  }
  if (data instanceof Uint8Array) {
    const buffer = toHex(data);
    return keccak256(buffer);
  }
  if (typeof data === "object") {
    const buffer = JSON.stringify(data);
    return keccak256(toBytes(buffer));
  }
  return keccak256(toBytes(data));
}
var KECCAK256_UTF8 = {
  method: keccak256Method,
  name: "keccak256(utf8)",
  sig: "0x6f357c6a"
  /* HASH_KECCAK256_UTF8 */
};
var KECCAK256_BYTES = {
  method: keccak256Method,
  name: "keccak256(bytes)",
  sig: "0x8019f9b1"
  /* HASH_KECCAK256_BYTES */
};
var HASH_METHODS = {
  [
    "keccak256(utf8)"
    /* KECCAK256_UTF8 */
  ]: KECCAK256_UTF8,
  [
    "0x6f357c6a"
    /* HASH_KECCAK256_UTF8 */
  ]: KECCAK256_UTF8,
  [
    "keccak256(bytes)"
    /* KECCAK256_BYTES */
  ]: KECCAK256_BYTES,
  [
    "0x8019f9b1"
    /* HASH_KECCAK256_BYTES */
  ]: KECCAK256_BYTES
};
var LSP6_DEFAULT_PERMISSIONS = {
  CHANGEOWNER: "0x0000000000000000000000000000000000000000000000000000000000000001",
  ADDCONTROLLER: "0x0000000000000000000000000000000000000000000000000000000000000002",
  EDITPERMISSIONS: "0x0000000000000000000000000000000000000000000000000000000000000004",
  ADDEXTENSIONS: "0x0000000000000000000000000000000000000000000000000000000000000008",
  CHANGEEXTENSIONS: "0x0000000000000000000000000000000000000000000000000000000000000010",
  ADDUNIVERSALRECEIVERDELEGATE: "0x0000000000000000000000000000000000000000000000000000000000000020",
  CHANGEUNIVERSALRECEIVERDELEGATE: "0x0000000000000000000000000000000000000000000000000000000000000040",
  REENTRANCY: "0x0000000000000000000000000000000000000000000000000000000000000080",
  SUPER_TRANSFERVALUE: "0x0000000000000000000000000000000000000000000000000000000000000100",
  TRANSFERVALUE: "0x0000000000000000000000000000000000000000000000000000000000000200",
  SUPER_CALL: "0x0000000000000000000000000000000000000000000000000000000000000400",
  CALL: "0x0000000000000000000000000000000000000000000000000000000000000800",
  SUPER_STATICCALL: "0x0000000000000000000000000000000000000000000000000000000000001000",
  STATICCALL: "0x0000000000000000000000000000000000000000000000000000000000002000",
  SUPER_DELEGATECALL: "0x0000000000000000000000000000000000000000000000000000000000004000",
  DELEGATECALL: "0x0000000000000000000000000000000000000000000000000000000000008000",
  DEPLOY: "0x0000000000000000000000000000000000000000000000000000000000010000",
  SUPER_SETDATA: "0x0000000000000000000000000000000000000000000000000000000000020000",
  SETDATA: "0x0000000000000000000000000000000000000000000000000000000000040000",
  ENCRYPT: "0x0000000000000000000000000000000000000000000000000000000000080000",
  DECRYPT: "0x0000000000000000000000000000000000000000000000000000000000100000",
  SIGN: "0x0000000000000000000000000000000000000000000000000000000000200000",
  EXECUTE_RELAY_CALL: "0x0000000000000000000000000000000000000000000000000000000000400000",
  ERC4337_PERMISSION: "0x0000000000000000000000000000000000000000000000000000000000800000",
  ALL_PERMISSIONS: "0x00000000000000000000000000000000000000000000000000000000007f3f7f"
};
var COMPACT_BYTES_ARRAY_STRING = "[CompactBytesArray]";
var COMPACT_BYTES_ARRAY_STRING_AT_END = /\[CompactBytesArray\]$/;
var DEFAULT_GAS_VALUE = 1e6;
var idCount = 0;
function decodeResult(method, hexString) {
  if (!isHex(hexString)) {
    return null;
  }
  const decodedData = decodeAbiParameters(
    [{ type: METHODS[method].returnEncoding }],
    hexString
  )[0] || null;
  if (Array.isArray(decodedData) && decodedData.length === 1 && decodedData[0] === "0x") {
    return [null];
  }
  return decodedData;
}
var constructJSONRPCParams = (address, method, gasInfo, methodParam) => {
  const data = methodParam ? METHODS[method].sig + methodParam.replace("0x", "") : METHODS[method].sig;
  return [
    {
      to: address,
      value: METHODS[method].value,
      ...gasInfo ? { gas: toHex2(gasInfo) } : {},
      data
    },
    "latest"
  ];
};
function constructJSONRPC(address, method, gasInfo, methodParam) {
  idCount += 1;
  return {
    jsonrpc: "2.0",
    method: "eth_call",
    params: constructJSONRPCParams(address, method, gasInfo, methodParam),
    id: idCount
  };
}
var ProviderWrapper = class {
  type;
  provider;
  gas;
  constructor(provider, gasInfo) {
    if (typeof provider.request === "function") {
      this.type = "ETHEREUM";
    } else {
      this.type = "WEB3";
    }
    this.provider = provider;
    this.gas = gasInfo;
  }
  async getOwner(address) {
    const result = await this.callContract(
      constructJSONRPC(address, "owner", this.gas)
    );
    return decodeResult("owner", result);
  }
  async getErc725YVersion(address) {
    const isErc725Yv5 = await this.supportsInterface(
      address,
      ERC725Y_INTERFACE_IDS["5.0"]
    );
    if (isErc725Yv5) {
      return "ERC725_v5";
    }
    const isErc725Yv3 = await this.supportsInterface(
      address,
      ERC725Y_INTERFACE_IDS["3.0"]
    );
    if (isErc725Yv3) {
      return "ERC725_v2";
    }
    const isErc725Yv2 = await this.supportsInterface(
      address,
      ERC725Y_INTERFACE_IDS["2.0"]
    );
    if (isErc725Yv2) {
      return "ERC725_v2";
    }
    const isErc725YLegacy = await this.supportsInterface(
      address,
      ERC725Y_INTERFACE_IDS.legacy
    );
    if (isErc725YLegacy) {
      return "ERC725_LEGACY";
    }
    return "NOT_ERC725";
  }
  /**
   * https://eips.ethereum.org/EIPS/eip-165
   *
   * @param address the smart contract address
   * @param interfaceId ERC-165 identifier as described here: https://github.com/ERC725Alliance/ERC725/blob/develop/docs/ERC-725.md#specification
   */
  async supportsInterface(address, interfaceId) {
    const result = await this.callContract(
      constructJSONRPC(
        address,
        "supportsInterface",
        this.gas,
        `${interfaceId}${"00000000000000000000000000000000000000000000000000000000"}`
      )
    );
    return decodeResult(
      "supportsInterface",
      result
    );
  }
  /**
   * https://eips.ethereum.org/EIPS/eip-1271
   *
   * @param address the contract address
   * @param hash
   * @param signature
   */
  async isValidSignature(address, hash, signature) {
    if (this.type === "ETHEREUM") {
      const encodedParams2 = encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes" }],
        [hash, signature]
      );
      const result = await this.callContract(
        constructJSONRPC(
          address,
          "isValidSignature",
          void 0,
          // this.gas,
          encodedParams2
        )
      );
      if (result.error) {
        throw result.error;
      }
      return decodeResult(
        "isValidSignature",
        result
      );
    }
    const encodedParams = encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes" }],
      [hash, signature]
    );
    const results = await this.callContract([
      constructJSONRPC(
        address,
        "isValidSignature",
        void 0,
        // this.gas,
        encodedParams
      )
    ]);
    return decodeResult(
      "isValidSignature",
      results[0]
    );
  }
  async getData(address, keyHash) {
    const result = await this.getAllData(address, [keyHash]);
    try {
      return result[0].value;
    } catch {
      return null;
    }
  }
  async getAllData(address, keyHashes) {
    const erc725Version = await this.getErc725YVersion(address);
    if (erc725Version === "NOT_ERC725") {
      throw new Error(
        `Contract: ${address} does not support ERC725Y interface.`
      );
    }
    switch (erc725Version) {
      case "ERC725_v5":
        return this._getAllDataGeneric(
          address,
          keyHashes,
          "getDataBatch"
          /* GET_DATA_BATCH */
        );
      case "ERC725_v2":
        return this._getAllDataGeneric(
          address,
          keyHashes,
          "getData"
          /* GET_DATA */
        );
      case "ERC725_LEGACY":
        return this._getAllDataLegacy(address, keyHashes);
      default:
        return [];
    }
  }
  async _getAllDataGeneric(address, keyHashes, method) {
    if (this.type === "ETHEREUM") {
      const encodedResults = await this.callContract(
        constructJSONRPC(
          address,
          method,
          void 0,
          // this.gas,
          encodeAbiParameters([{ type: "bytes32[]" }], [keyHashes])
        )
      );
      const decodedValues2 = decodeResult(method, encodedResults);
      return keyHashes.map((keyHash, index) => ({
        key: keyHash,
        value: decodedValues2 ? decodedValues2[index] : decodedValues2
      }));
    }
    const payload = [
      constructJSONRPC(
        address,
        method,
        void 0,
        // this.gas,
        encodeAbiParameters([{ type: "bytes32[]" }], [keyHashes])
      )
    ];
    const results = await this.callContract(payload);
    const decodedValues = decodeResult(method, results[0]);
    return keyHashes.map((key, index) => ({
      key,
      value: decodedValues ? decodedValues[index] : decodedValues
    }));
  }
  async _getAllDataLegacy(address, keyHashes) {
    if (this.type === "ETHEREUM") {
      const encodedResultsPromises = keyHashes.map(
        (keyHash) => this.callContract(
          constructJSONRPC(address, "getDataLegacy", this.gas, keyHash)
        )
      );
      const decodedResults = await Promise.all(encodedResultsPromises);
      return decodedResults.map((decodedResult, index) => ({
        key: keyHashes[index],
        value: decodeResult("getDataLegacy", decodedResult)
      }));
    }
    const payload = [];
    for (let index = 0; index < keyHashes.length; index++) {
      payload.push(
        constructJSONRPC(
          address,
          "getDataLegacy",
          this.gas,
          keyHashes[index]
        )
      );
    }
    const results = await this.callContract(payload);
    return payload.map((_payloadCall, index) => {
      return {
        key: keyHashes[index],
        value: decodeResult("getDataLegacy", results[index])
      };
    });
  }
  // public for testing
  async callContract(payload) {
    if (this.type === "ETHEREUM") {
      const result = await this.provider.request(payload);
      if (result.error) {
        const error = new Error("Call failed");
        Object.assign(error, result.error);
        throw error;
      }
      if (result.result) {
        return result.result;
      }
      return result;
    }
    const handleOne = async (payload2) => {
      return new Promise((resolve, reject) => {
        const doResolve = (r) => {
          if (r.error) {
            let error;
            ({ error } = r);
            if (!(error instanceof Error)) {
              error = new Error("Call failed");
              Object.assign(error, r.error);
            }
            return reject(error);
          }
          return resolve(r.result || "0x");
        };
        const promise = this.provider.send(payload2, (e, r) => {
          if (e) {
            reject(e);
          } else {
            doResolve(r);
          }
        });
        if (promise && typeof promise.then === "function") {
          promise.then(doResolve, reject);
        }
      });
    };
    if (Array.isArray(payload)) {
      return Promise.all(payload.map(handleOne));
    }
    return handleOne(payload);
  }
};
var uintNValueTypeRegex = /^u?int(\d+)(\+?)$/;
var bytesNValueTypeRegex = /^bytes(\d+)$/;
var BytesNValueContentRegex = /Bytes(\d+)/;
var encodeDataSourceWithHash = (verification, dataSource) => {
  const verificationMethod = getVerificationMethod(
    verification?.method || NONE_VERIFICATION_METHOD
  );
  return concat([
    "0x0000",
    verificationMethod?.sig ?? "0x00000000",
    verification?.data ? pad(toHex3(size(verification.data)), {
      size: 2
    }) : "0x0000",
    verification?.data ?? "0x",
    toHex3(dataSource)
  ]);
};
var decodeDataSourceWithHash = (value) => {
  if (value.slice(0, 6) === "0x0000") {
    const verificationMethodSignature2 = `0x${value.slice(6, 14)}`;
    const verificationMethod2 = getVerificationMethod(
      verificationMethodSignature2
    );
    const encodedLength = `0x${value.slice(14, 18)}`;
    const dataLength = hexToNumber(encodedLength);
    const dataHash2 = `0x${value.slice(18, 18 + dataLength * 2)}`;
    const dataSource2 = hexToString(`0x${value.slice(18 + dataLength * 2)}`);
    return {
      verification: {
        method: verificationMethod2?.name || verificationMethodSignature2,
        data: dataHash2
      },
      url: dataSource2
    };
  }
  const verificationMethodSignature = value.slice(0, 10);
  const verificationMethod = getVerificationMethod(verificationMethodSignature);
  const encodedData = value.slice(10);
  try {
    const dataSource2 = hexToString(`0x${encodedData}`);
    if (encodedData.length < 64 || /^[a-z]{2,}:[/\S]/.test(dataSource2)) {
      return {
        verification: {
          method: NONE_VERIFICATION_METHOD,
          data: "0x"
        },
        url: dataSource2
      };
    }
  } catch {
  }
  const dataHash = slice(`0x${encodedData}`, 0, 32);
  const dataSource = hexToString(slice(`0x${encodedData}`, 32));
  return {
    verification: {
      method: verificationMethod?.name || verificationMethodSignature,
      data: dataHash
    },
    url: dataSource
  };
};
var encodeToBytesN = (bytesN, value) => {
  const numberOfBytesInType = Number.parseInt(bytesN.split("bytes")[1], 10);
  let valueToEncode;
  if (!isHex2(value)) {
    valueToEncode = toHex3(value);
  } else if (typeof value === "number") {
    valueToEncode = pad(numberToHex2(value), {
      size: numberOfBytesInType
    });
  } else {
    valueToEncode = value;
  }
  const numberOfBytesInValue = countNumberOfBytes(valueToEncode);
  if (typeof value === "number" || typeof value === "bigint") {
    valueToEncode = pad(valueToEncode, {
      size: numberOfBytesInType
    });
  } else {
    valueToEncode = pad(valueToEncode, {
      size: numberOfBytesInType,
      dir: "right"
    });
  }
  if (numberOfBytesInValue > numberOfBytesInType) {
    throw new Error(
      `Can't convert ${value} to ${bytesN}. Too many bytes, expected at most ${numberOfBytesInType} bytes, received ${numberOfBytesInValue}.`
    );
  }
  const abiEncodedValue = encodeAbiParameters2(
    [{ type: bytesN, name: "" }],
    [valueToEncode]
  );
  if (numberOfBytesInType === 32) {
    return abiEncodedValue;
  }
  const bytesArray = hexToBytes(abiEncodedValue);
  return bytesToHex(bytesArray.slice(0, numberOfBytesInType));
};
var encodeCompactBytesArray = (values) => {
  const compactBytesArray = values.filter((value, index) => {
    if (value === "") {
      return "0x";
    }
    if (!isHex2(value)) {
      throw new Error(
        `Couldn't encode bytes[CompactBytesArray], value at index ${index} is not hex`
      );
    }
    if (value.length > 65535 * 2 + 2) {
      throw new Error(
        `Couldn't encode bytes[CompactBytesArray], value at index ${index} exceeds 65_535 bytes`
      );
    }
    return true;
  }).reduce((acc, value) => {
    const numberOfBytes = value.slice(2).length / 2;
    const hexNumber = pad(numberToHex2(numberOfBytes), {
      size: 2
    });
    return concat([acc, hexNumber, value]);
  }, "0x");
  return compactBytesArray;
};
var decodeCompactBytesArray = (compactBytesArray, consumed) => {
  if (!isHex2(compactBytesArray))
    throw new Error("Couldn't decode, value is not hex");
  const encodedValues = [];
  let current = compactBytesArray;
  while (size(current) > 0) {
    const length = hexToNumber(slice(current, 0, 2));
    if (length === 0) {
      encodedValues.push("");
      current = slice(current, 2);
      if (consumed) {
        consumed.bytes += 2;
      }
    } else {
      if (length > size(current) - 2) {
        throw new Error(
          "Couldn't decode bytes[CompactBytesArray] (invalid array item length)"
        );
      }
      encodedValues.push(slice(current, 2, 2 + length));
      if (consumed) {
        consumed.bytes += 2 + length;
      }
      if (size(current) === 2 + length) {
        break;
      }
      current = slice(current, 2 + length);
    }
  }
  return encodedValues;
};
var encodeBytesNCompactBytesArray = (values, numberOfBytes) => {
  values.forEach((value, index) => {
    if (size(value) > numberOfBytes)
      throw new Error(
        `Hex bytes${numberOfBytes} value at index ${index} does not fit in ${numberOfBytes} bytes`
      );
  });
  return encodeCompactBytesArray(values);
};
var decodeBytesNCompactBytesArray = (compactBytesArray, numberOfBytes, consumed) => {
  const bytesValues = decodeCompactBytesArray(compactBytesArray, consumed);
  bytesValues.forEach((bytesValue, index) => {
    if (size(bytesValue) > numberOfBytes)
      throw new Error(
        `Hex bytes${numberOfBytes} value at index ${index} does not fit in ${numberOfBytes} bytes`
      );
  });
  return bytesValues;
};
var returnTypesOfBytesNCompactBytesArray = () => {
  const types = {};
  for (let i = 1; i < 33; i++) {
    types[`bytes${i}[CompactBytesArray]`] = {
      encode: (value) => encodeBytesNCompactBytesArray(value, i),
      decode: (value, consumed) => decodeBytesNCompactBytesArray(value, i, consumed)
    };
  }
  return types;
};
var encodeUintNCompactBytesArray = (values, numberOfBytes) => {
  const hexValues = values.map((value, index) => {
    const hexNumber = pad(numberToHex2(value), {
      size: numberOfBytes
    });
    if (hexNumber.slice(2).length > numberOfBytes * 2)
      throw new Error(
        `Hex uint${numberOfBytes * 8} value at index ${index} does not fit in ${numberOfBytes} bytes`
      );
    return hexNumber;
  });
  return encodeCompactBytesArray(hexValues);
};
var decodeUintNCompactBytesArray = (compactBytesArray, numberOfBytes) => {
  const hexValues = decodeCompactBytesArray(compactBytesArray);
  return hexValues.map((hexValue, index) => {
    const hexValueStripped = hexValue.slice(2);
    if (hexValueStripped.length > numberOfBytes * 2)
      throw new Error(
        `Hex uint${numberOfBytes * 8} value at index ${index} does not fit in ${numberOfBytes} bytes`
      );
    return BigInt(hexValue);
  });
};
var returnTypesOfUintNCompactBytesArray = () => {
  const types = {};
  for (let i = 1; i < 33; i++) {
    types[`uint${i * 8}[CompactBytesArray]`] = {
      encode: (value) => encodeUintNCompactBytesArray(value, i),
      decode: (value) => decodeUintNCompactBytesArray(value, i)
    };
  }
  return types;
};
var encodeStringCompactBytesArray = (values) => {
  const hexValues = values.map((element) => stringToHex(element));
  return encodeCompactBytesArray(hexValues);
};
var decodeStringCompactBytesArray = (compactBytesArray, consumed) => {
  const hexValues = decodeCompactBytesArray(
    compactBytesArray,
    consumed
  );
  const stringValues = hexValues.map(
    (element) => hexToString(element)
  );
  return stringValues;
};
function _decodeParameter(type) {
  return (value, consumed) => {
    let actualType = type;
    const [, baseType, bitSize, append] = /^(u?int)(\d*)(.*)$/.exec(type) || [];
    if (baseType && !isValidUintSize(Number.parseInt(bitSize, 10))) {
      throw new Error(
        `Invalid \`${type}\` provided. Expected a multiple of 8 bits between 8 and 256.`
      );
    }
    const numberOfBits = Number.parseInt(bitSize, 10);
    if (type === "address") {
      actualType = "bytes20";
    } else if (baseType) {
      const byteSize = numberOfBits / 8;
      actualType = `bytes${byteSize}${append}`;
    }
    try {
      let result = decodeAbiParameters2(
        [{ type: actualType, name: "" }],
        `${value}0000000000000000000000000000000000000000000000000000000000000000`
        // Just add some zeros so that the native call doesn't run out of bytes.
      )[0];
      if (bitSize) {
        const convert = (value2) => {
          const isLikelyNegative = value2.startsWith("0xff");
          const result2 = BigInt(value2);
          if (!type.startsWith("u") && isLikelyNegative) {
            return -negateSignedBigInt(result2, numberOfBits);
          }
          return result2;
        };
        result = Array.isArray(result) ? result.map((result2) => convert(result2)) : convert(result);
      }
      if (consumed) {
        const out = type.endsWith("]") ? encodeAbiParameters2([{ type: actualType }], [result]) : encodePacked([type], [result]);
        const length = size(out);
        consumed.bytes += length;
      }
      return result;
    } catch (error) {
      throw new Error(
        `Error decoding value "${value}" as type "${type}": ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
}
var valueTypeEncodingMap = (type) => {
  const uintNRegexMatch = type.match(uintNValueTypeRegex);
  const bytesNRegexMatch = type.match(bytesNValueTypeRegex);
  const bytesLength = bytesNRegexMatch ? Number.parseInt(bytesNRegexMatch[1], 10) : "";
  const uintLength = uintNRegexMatch ? Number.parseInt(uintNRegexMatch[1], 10) : 0;
  if (type.includes("[CompactBytesArray]")) {
    const compactBytesArrayMap = {
      "bytes[CompactBytesArray]": {
        encode: (value) => encodeCompactBytesArray(value),
        decode: (value, consumed) => decodeCompactBytesArray(value, consumed)
      },
      "string[CompactBytesArray]": {
        encode: (value) => encodeStringCompactBytesArray(value),
        decode: (value, consumed) => decodeStringCompactBytesArray(value, consumed)
      },
      ...returnTypesOfBytesNCompactBytesArray(),
      ...returnTypesOfUintNCompactBytesArray()
    };
    return compactBytesArrayMap[type];
  }
  if (type === "bytes") {
    return {
      encode: (value) => isHex2(value) ? value.toLowerCase() : toHex3(value),
      decode: (value, consumed) => {
        if (consumed) {
          const length = size(value);
          consumed.bytes += length;
        }
        return value;
      }
    };
  }
  switch (type) {
    case "bool":
    case "boolean":
      return {
        encode: (value) => value ? "0x01" : "0x00",
        decode: (value, consumed) => {
          if (consumed) {
            consumed.bytes += 1;
          }
          return slice(value, 0, 1) === "0x01";
        }
      };
    case "string":
      return {
        encode: (value) => {
          if (typeof value === "number") {
            return stringToHex(`${value}`);
          }
          return stringToHex(value);
        },
        decode: (value, consumed) => {
          if (consumed) {
            consumed.bytes += size(value);
          }
          return hexToString(value);
        }
      };
    case "address":
      return {
        encode: (value) => {
          const abiEncodedValue = encodeAbiParameters2([{ type: "address" }], [
            value
          ]);
          const bytesArray = hexToBytes(abiEncodedValue);
          return bytesToHex(slice(bytesArray, 12));
        },
        decode: (value, consumed) => {
          const out = _decodeParameter("address")(value, consumed);
          return getAddress(out);
        }
      };
    // NOTE: We could add conditional handling of numeric values here...
    case `int${uintLength}`:
      return {
        encode: (value) => {
          if (!isValidUintSize(uintLength)) {
            throw new Error(
              `Can't encode ${value} as ${type}. Invalid \`uintN\` provided. Expected a multiple of 8 bits between 8 and 256.`
            );
          }
          const abiEncodedValue = encodeAbiParameters2([{ type }], [value]);
          const bytesArray = hexToBytes(abiEncodedValue);
          const numberOfBytes = uintLength / 8;
          const startIndex = 32 - numberOfBytes;
          return bytesToHex(bytesArray.slice(startIndex));
        },
        decode: (value, consumed) => {
          const typeLength = uintLength / 8 * 2 + 2;
          let actualType = type;
          if (value.length < typeLength) {
            actualType = `int${Math.round((value.length - 2) / 2) * 8}`;
          }
          const out = _decodeParameter(actualType)(value, consumed);
          return out;
        }
      };
    case `uint${uintLength}`:
      return {
        encode: (value) => {
          if (!isValidUintSize(uintLength)) {
            throw new Error(
              `Can't encode ${value} as ${type}. Invalid \`uintN\` provided. Expected a multiple of 8 bits between 8 and 256.`
            );
          }
          const abiEncodedValue = encodeAbiParameters2(
            [{ type, name: "" }],
            [value]
          );
          const numberOfBits = countSignificantBits(abiEncodedValue);
          if (numberOfBits > uintLength) {
            throw new Error(
              `Can't represent value ${value} as ${type}. To many bits required ${numberOfBits} > ${uintLength}`
            );
          }
          const bytesArray = hexToBytes(abiEncodedValue);
          const numberOfBytes = uintLength / 8;
          const startIndex = 32 - numberOfBytes;
          return bytesToHex(bytesArray.slice(startIndex));
        },
        decode: _decodeParameter(type)
      };
    case `uint${uintLength}+`:
      return {
        encode: (value) => {
          if (!isValidUintSize(uintLength)) {
            throw new Error(
              `Can't encode ${value} as ${type}. Invalid \`uintN\` provided. Expected a multiple of 8 bits between 8 and 256.`
            );
          }
          const abiEncodedValue = encodeAbiParameters2([{ type }], [value]);
          const numberOfBits = countSignificantBits(abiEncodedValue);
          if (numberOfBits > uintLength) {
            throw new Error(
              `Can't represent value ${value} as ${type}. To many bits required ${numberOfBits} > ${uintLength}`
            );
          }
          const bytesArray = hexToBytes(abiEncodedValue);
          const numberOfBytes = uintLength / 8;
          const startIndex = 32 - numberOfBytes;
          return bytesToHex(bytesArray.slice(startIndex));
        },
        decode: (value, consumed) => {
          const byteLength = (value.length - 2) / 2;
          const typeLength = Math.min(byteLength * 8, 256);
          return _decodeParameter(`uint${typeLength}`)(value, consumed);
        }
      };
    case `bytes${bytesLength}`:
      return {
        encode: (value) => {
          if (!isValidByteSize(bytesLength)) {
            throw new Error(
              `Can't encode ${value} as ${type}. Invalid \`bytesN\` provided. Expected a \`N\` value for bytesN between 1 and 32.`
            );
          }
          return encodeToBytesN(type, value);
        },
        decode: _decodeParameter(type)
      };
    case "bool[]":
      return {
        encode: (value) => encodeAbiParameters2([{ type: "bool[]" }], [value]),
        decode: _decodeParameter("bool[]")
      };
    case "boolean[]":
      return {
        encode: (value) => encodeAbiParameters2([{ type: "bool[]" }], [value]),
        decode: _decodeParameter("bool[]")
      };
    case "string[]":
      return {
        encode: (value) => encodeAbiParameters2([{ type: "string[]" }], [value]),
        decode: _decodeParameter("string[]")
      };
    case "address[]":
      return {
        encode: (value) => encodeAbiParameters2([{ type: "address[]" }], [value]),
        decode: _decodeParameter("address[]")
      };
    case "uint256[]":
      return {
        encode: (value) => encodeAbiParameters2([{ type: "uint256[]" }], [value]),
        decode: (value, consumed) => {
          return (_decodeParameter("uint256[]")(value, consumed) || []).map((numberAsString) => {
            try {
              return Number(numberAsString);
            } catch {
              return BigInt(numberAsString);
            }
          });
        }
      };
    case "bytes32[]":
      return {
        encode: (value) => encodeAbiParameters2([{ type: "bytes32[]" }], [value]),
        decode: _decodeParameter("bytes32[]")
      };
    case "bytes4[]":
      return {
        encode: (value) => encodeAbiParameters2([{ type: "bytes4[]" }], [value]),
        decode: _decodeParameter("bytes4[]")
      };
    case "bytes[]":
      return {
        encode: (value) => encodeAbiParameters2([{ type: "bytes[]" }], [value]),
        decode: _decodeParameter("bytes[]")
      };
    case "bytes[CompactBytesArray]":
      return {
        encode: (value) => encodeCompactBytesArray(value),
        decode: (value, consumed) => decodeCompactBytesArray(value, consumed)
      };
    case "string[CompactBytesArray]":
      return {
        encode: (value) => encodeStringCompactBytesArray(value),
        decode: (value, consumed) => decodeStringCompactBytesArray(value, consumed)
      };
    default:
      return {
        encode: (value) => {
          throw new Error(
            `Could not encode ${value}. Value type ${type} is unknown`
          );
        },
        decode: (value, _consumed) => {
          throw new Error(
            `Could not decode ${value}. Value type ${type} is unknown`
          );
        }
      };
  }
};
var valueContentEncodingMap = (valueContent) => {
  const bytesNRegexMatch = valueContent.match(BytesNValueContentRegex);
  const bytesLength = bytesNRegexMatch ? Number.parseInt(bytesNRegexMatch[1], 10) : "";
  switch (valueContent) {
    case "Keccak256": {
      return {
        type: "bytes32",
        encode: (value) => value,
        decode: (value) => value
      };
    }
    case "Number": {
      return {
        type: "uint256",
        encode: (value) => {
          let parsedValue;
          try {
            parsedValue = Number.parseInt(value, 10);
          } catch (error) {
            throw new Error(error);
          }
          return pad(numberToHex2(parsedValue), { size: 32 });
        },
        decode: (value) => BigInt(value)
      };
    }
    // NOTE: This is not symmetrical, and always returns a checksummed address
    case "Address": {
      return {
        type: "address",
        encode: (value) => {
          if (isAddress(value)) {
            return value.toLowerCase();
          }
          throw new Error(`Address: "${value}" is an invalid address.`);
        },
        decode: (value) => {
          try {
            return getAddress(value);
          } catch {
            throw new Error(`Address: "${value}" is an invalid address.`);
          }
        }
      };
    }
    case "String": {
      return {
        type: "string",
        encode: (value) => stringToHex(value),
        decode: (value) => hexToString(value)
      };
    }
    case "Markdown": {
      return {
        type: "string",
        encode: (value) => stringToHex(value),
        decode: (value) => hexToString(value)
      };
    }
    case "URL": {
      return {
        type: "string",
        encode: (value) => stringToHex(value),
        decode: (value) => hexToString(value)
      };
    }
    // https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-2-ERC725YJSONSchema.md#verifiableuri
    case "AssetURL":
    // Deprecated since v0.22.0
    case "JSONURL":
    // Deprecated since v0.22.0
    case "VerifiableURI": {
      return {
        type: "custom",
        encode: (dataToEncode) => {
          const {
            verification: { data, method } = {},
            json,
            url
          } = dataToEncode;
          let hashedJson = data;
          if (json) {
            if (method) {
              throw new Error(
                'When passing in the `json` property, we use "keccak256(utf8)" as a default verification method. You do not need to set a `verification.method`.'
              );
            }
            hashedJson = hashData(
              json,
              "keccak256(utf8)"
              /* KECCAK256_UTF8 */
            );
          }
          if (!hashedJson) {
            throw new Error(
              "You have to provide either the verification.data or the json via the respective properties"
            );
          }
          return encodeDataSourceWithHash(
            {
              method: method || "keccak256(utf8)",
              data: hashedJson || "0x"
            },
            url
          );
        },
        decode: (dataToDecode) => decodeDataSourceWithHash(dataToDecode)
      };
    }
    case `Bytes${bytesLength}`: {
      return {
        type: "bytes",
        encode: (value) => {
          if (typeof value !== "string" || !isHex2(value)) {
            throw new Error(`Value: ${value} is not hex.`);
          }
          if (bytesLength && !isValidByteSize(bytesLength)) {
            throw new Error(
              `Provided bytes length: ${bytesLength} for encoding valueContent: ${valueContent} is not valid.`
            );
          }
          if (bytesLength && value.length !== 2 + bytesLength * 2) {
            throw new Error(
              `Value: ${value} is not of type ${valueContent}. Expected hex value of length ${2 + bytesLength * 2}`
            );
          }
          return value;
        },
        decode: (value) => {
          if (typeof value !== "string" || !isHex2(value)) {
            console.error(`Value: ${value} is not hex.`);
            return null;
          }
          if (bytesLength && !isValidByteSize(bytesLength)) {
            throw new Error(
              `Provided bytes length: ${bytesLength} for encoding valueContent: ${valueContent} is not valid.`
            );
          }
          if (bytesLength && value.length !== 2 + bytesLength * 2) {
            console.error(
              `Value: ${value} is not of type ${valueContent}. Expected hex value of length ${2 + bytesLength * 2}`
            );
            return null;
          }
          return value;
        }
      };
    }
    case "BitArray": {
      return {
        type: "bytes",
        encode: (value) => {
          if (typeof value !== "string" || !isHex2(value)) {
            throw new Error(`Value: ${value} is not hex.`);
          }
          return value;
        },
        decode: (value) => {
          if (typeof value !== "string" || !isHex2(value)) {
            console.error(`Value: ${value} is not hex.`);
            return null;
          }
          return value;
        }
      };
    }
    case "Boolean": {
      return {
        type: "bool",
        encode: (value) => {
          return valueTypeEncodingMap("bool").encode(value);
        },
        decode: (value, consumed) => {
          return valueTypeEncodingMap("bool").decode(
            value,
            consumed
          );
        }
      };
    }
    default: {
      return {
        type: "unknown",
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        encode: (_value) => {
          throw new Error(
            `Could not encode unknown (${valueContent}) valueContent.`
          );
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        decode: (_value) => {
          throw new Error(
            `Could not decode unknown (${valueContent}) valueContent.`
          );
        }
      };
    }
  }
};
function encodeValueType(type, value) {
  if (typeof value === "undefined" || value === null) {
    return value;
  }
  return valueTypeEncodingMap(type).encode(value);
}
function decodeValueType(type, data, consumed) {
  if (data === "0x") return null;
  if (typeof data === "undefined" || data === null) {
    return data;
  }
  return valueTypeEncodingMap(type).decode(data, consumed);
}
function encodeValueContent(valueContent, value) {
  if (isValueContentLiteralHex(valueContent)) {
    return valueContent === value ? value.toLowerCase() : "0x";
  }
  const valueContentEncodingMethods = valueContentEncodingMap(valueContent);
  if (!valueContentEncodingMethods) {
    throw new Error(`Could not encode valueContent: ${valueContent}.`);
  }
  if (value === null || value === void 0) {
    return "0x";
  }
  if ((valueContent === "AssetURL" || valueContent === "JSONURL" || valueContent === "Boolean") && typeof value === "string") {
    const expectedValueType = valueContent === "Boolean" ? "boolean" : "object";
    throw new Error(
      `Could not encode valueContent: ${valueContent} with value: ${value}. Expected ${expectedValueType}.`
    );
  }
  return valueContentEncodingMethods.encode(value);
}
function decodeValueContent(valueContent, value) {
  if (isValueContentLiteralHex(valueContent)) {
    return valueContent.toLowerCase() === value ? valueContent : null;
  }
  if (value == null || value === "0x") {
    return null;
  }
  return valueContentEncodingMap(valueContent).decode(value);
}
var dynamicTypes = ["<string>", "<address>", "<bool>"];
var dynamicTypesRegex = /<(uint|int|bytes)(\d+)>/;
var encodeDynamicKeyPart = (type, value_, bytes) => {
  let baseType = "";
  let size4 = 0;
  let value = value_;
  if (dynamicTypes.includes(type)) {
    baseType = type.slice(1, -1);
  } else {
    const regexMatch = type.match(dynamicTypesRegex);
    if (!regexMatch) {
      throw new Error(`Dynamic key: ${type} is not supported`);
    }
    baseType = regexMatch[1];
    size4 = Number.parseInt(regexMatch[2], 10);
  }
  switch (baseType) {
    case "string":
      return slice2(keccak2562(stringToBytes(value)), 0, bytes).slice(2);
    case "bool": {
      if (value !== "true" && value !== "false") {
        throw new Error(
          `Wrong value: ${value} for dynamic key with type: <bool>. Expected "true" or "false".`
        );
      }
      return pad2(
        // In theory passing in 0x1 should also work
        value === "true" || Number(value) === 1 ? "0x01" : "0x00",
        { size: bytes }
      ).slice(2);
    }
    case "address": {
      if (!value) {
        throw new Error(
          `Wrong value: ${value} for dynamic key with type: <address>. Value is empty.`
        );
      }
      if (!value.startsWith("0x")) {
        value = `0x${value}`;
      }
      if (!isAddress2(value)) {
        throw new Error(
          `Wrong value: ${value} for dynamic key with type: <address>. Value is not an address.`
        );
      }
      return pad2(slice2(value, 0, bytes), {
        size: bytes
      }).slice(2).toLowerCase();
    }
    case "int":
    case "uint": {
      if (size4 > 256 || size4 % 8 !== 0) {
        throw new Error(
          `Wrong dynamic key type: ${type}. 0 < M <= 256, M % 8 == 0. Got: ${size4}.`
        );
      }
      let hex = numberToHex3(BigInt(value)).slice(2);
      if (hex.length > size4 / 4) {
        throw new Error(`Value: ${value} is too big for uint${size4}.`);
      }
      if (hex.length > bytes * 2) {
        hex = `0x${hex.slice(-bytes * 2)}`;
      } else {
        hex = `0x${hex}`;
      }
      return pad2(hex, { size: bytes }).slice(2);
    }
    case "bytes": {
      if (!value.startsWith("0x")) {
        value = `0x${value}`;
      }
      if (!isHex3(value)) {
        throw new Error(
          `Wrong value: ${value} for dynamic key with type: $type. Value is not in hex.`
        );
      }
      if (value.length > 2 + size4 * 2) {
        throw new Error(
          `Wrong value: ${value} for dynamic key with type: $type. Value is too big.`
        );
      }
      return pad2(slice2(value, 0, bytes), {
        size: bytes,
        dir: "right"
      }).slice(2);
    }
    default:
      throw new Error(`Dynamic key: ${type} is not supported`);
  }
};
function isDynamicKeyName(name) {
  if (name.startsWith("0x") && name.includes("<")) {
    return true;
  }
  const keyNameParts = name.split(":");
  for (let i = 0; i < keyNameParts.length; i++) {
    if (dynamicTypes.includes(keyNameParts[i]) || keyNameParts[i].match(dynamicTypesRegex)) {
      return true;
    }
  }
  return false;
}
var encodeDynamicMapping = (name, dynamicKeyParts) => {
  if (dynamicKeyParts.length !== 1) {
    throw new Error(
      `Dynamic key of type: Mapping expects exactly 1 variable. Got: ${dynamicKeyParts.length} (${dynamicKeyParts})`
    );
  }
  const keyNameSplit = name.split(":");
  const encodedKey = slice2(keccak2562(toBytes2(keyNameSplit[0])), 0, 10);
  return `${encodedKey}0000${encodeDynamicKeyPart(
    keyNameSplit[1],
    dynamicKeyParts[0],
    20
  )}`;
};
var encodeDynamicMappingWithGrouping = (name, dynamicKeyParts) => {
  const keyNameSplit = name.split(":");
  let numberOfVariables = 0;
  if (isDynamicKeyName(keyNameSplit[1])) {
    numberOfVariables += 1;
  }
  if (isDynamicKeyName(keyNameSplit[2])) {
    numberOfVariables += 1;
  }
  if (numberOfVariables !== dynamicKeyParts.length) {
    throw new Error(
      `Can not encode dynamic key of type: MappingWithGrouping. Wrong number of arguments. Expects exactly ${numberOfVariables} variable(s), got: ${dynamicKeyParts.length} (${dynamicKeyParts})`
    );
  }
  const firstPart = keccak2562(toBytes2(keyNameSplit[0])).slice(0, 14);
  let secondPart = "";
  if (keyNameSplit[1].startsWith("0x")) {
    secondPart = pad2(keyNameSplit[1].slice(0, 2 + 4 * 2), {
      size: 4,
      dir: "right"
    }).slice(2);
  } else if (isDynamicKeyName(keyNameSplit[1])) {
    secondPart = encodeDynamicKeyPart(keyNameSplit[1], dynamicKeyParts[0], 4);
  } else {
    secondPart = keccak2562(keyNameSplit[1]).slice(2, 2 + 4 * 2);
  }
  let lastPart = "";
  if (keyNameSplit[2].startsWith("0x")) {
    lastPart = pad2(keyNameSplit[2].slice(0, 2 + 20 * 2), {
      size: 20,
      dir: "right"
    }).slice(2);
  } else if (isDynamicKeyName(keyNameSplit[2])) {
    lastPart = encodeDynamicKeyPart(
      keyNameSplit[2],
      dynamicKeyParts[dynamicKeyParts.length - 1],
      20
    );
  } else {
    lastPart = keccak2562(keyNameSplit[2]).slice(2, 2 + 20 * 2);
  }
  return `${firstPart}${secondPart}0000${lastPart}`;
};
function encodeDynamicKeyName(name, dynamicKeyParts) {
  if (!dynamicKeyParts) {
    throw new Error(
      `Can't encode dynamic key name: ${name} without dynamicKeyParts`
    );
  }
  const dynamicKeyPartsArray = typeof dynamicKeyParts === "string" ? [dynamicKeyParts] : dynamicKeyParts;
  const keyType = guessKeyTypeFromKeyName(name);
  switch (keyType) {
    case "Mapping":
      return encodeDynamicMapping(name, dynamicKeyPartsArray);
    case "MappingWithGrouping":
      return encodeDynamicMappingWithGrouping(
        name,
        dynamicKeyPartsArray
      );
    default:
      throw new Error(
        `Could not encode dynamic key: ${name} of type: ${keyType}`
      );
  }
}
function encodeKeyName(name, dynamicKeyParts) {
  if (isDynamicKeyName(name)) {
    return encodeDynamicKeyName(name, dynamicKeyParts);
  }
  const keyType = guessKeyTypeFromKeyName(name);
  switch (keyType) {
    case "MappingWithGrouping": {
      const keyNameSplit = name.split(":");
      return encodeDynamicMappingWithGrouping(
        `${keyNameSplit[0]}:<string>:<address>`,
        [keyNameSplit[1], keyNameSplit[2]]
      );
    }
    case "Mapping": {
      const keyNameSplit = name.split(":");
      if (isAddress2(keyNameSplit[1])) {
        return encodeDynamicMapping(`${keyNameSplit[0]}:<address>`, [
          keyNameSplit[1]
        ]);
      }
      return encodeDynamicMapping(`${keyNameSplit[0]}:<string>`, [
        keyNameSplit[1]
      ]);
    }
    case "Array":
      if (dynamicKeyParts && typeof dynamicKeyParts === "number") {
        return encodeArrayKey(keccak2562(toBytes2(name)), dynamicKeyParts);
      }
      return keccak2562(toBytes2(name));
    case "Singleton":
      return keccak2562(toBytes2(name));
    default:
      return keccak2562(toBytes2(name));
  }
}
var generateDynamicKeyName = (name, dynamicKeyParts) => {
  let dynamicKeyPartsIndex = 0;
  const dynamicKeyPartsArray = typeof dynamicKeyParts === "string" ? [dynamicKeyParts] : dynamicKeyParts;
  return name.split(":").map((keyNamePart) => {
    if (!isDynamicKeyName(keyNamePart)) {
      return keyNamePart;
    }
    if (!dynamicKeyPartsArray[dynamicKeyPartsIndex]) {
      throw new Error(
        `Can not generate key name: ${name}. Missing/not enough dynamicKeyParts: ${dynamicKeyPartsArray}`
      );
    }
    const dynamicKeyPart = dynamicKeyPartsArray[dynamicKeyPartsIndex];
    if (keyNamePart === "<address>") {
      if (!isAddress2(dynamicKeyPart)) {
        throw new Error(
          `Dynamic key is expecting an <address> but got: ${dynamicKeyPart}`
        );
      }
    }
    dynamicKeyPartsIndex += 1;
    return dynamicKeyPart;
  }).join(":");
};
function isDynamicKeyPart(keyPartName) {
  return keyPartName.slice(0, 1) === "<" && keyPartName.slice(keyPartName.length - 1) === ">";
}
function decodeKeyPart(encodedKeyPart, keyPartName) {
  if (!isDynamicKeyPart(keyPartName)) return false;
  let decodedKey;
  const type = keyPartName.slice(1, keyPartName.length - 1);
  if (type === "bool") {
    decodedKey = encodedKeyPart.slice(encodedKeyPart.length - 1) === "1";
  } else if (type.includes("uint"))
    decodedKey = Number.parseInt(encodedKeyPart, 16);
  else if (type.includes("bytes")) {
    const byteLength = Number.parseInt(type.replace("bytes", ""), 10);
    decodedKey = pad3(`0x${encodedKeyPart.slice(0, byteLength * 2)}`, {
      size: byteLength,
      dir: "right"
    });
  } else if (type === "address") {
    const leftPaddedAddress = pad3(`0x${encodedKeyPart}`, {
      size: 20
    });
    decodedKey = decodeValueType(type, leftPaddedAddress);
  } else {
    decodedKey = decodeValueType(type, encodedKeyPart);
  }
  return { type, value: decodedKey };
}
function decodeMappingKey(keyHash, keyNameOrSchema) {
  let hashedKey = keyHash;
  if (hashedKey.length === 64 && hashedKey.slice(0, 2) !== "0x")
    hashedKey = `0x${hashedKey}`;
  if (hashedKey.length !== 66)
    throw new Error(
      "Invalid encodedKey length, key must be 32 bytes long hexadecimal value"
    );
  if (!isHex4(hashedKey))
    throw new Error("Invalid encodedKey, must be a hexadecimal value");
  let keyParts;
  if (typeof keyNameOrSchema === "string")
    keyParts = keyNameOrSchema.split(":");
  else keyParts = keyNameOrSchema.name.split(":");
  if (keyParts.some((p) => p.includes("string"))) {
    throw new Error(
      "String dynamic key parts cannot be decoded, because it's formatted as a keccak256 hash"
    );
  }
  const dynamicParts = [];
  switch (keyParts.length) {
    case 2:
      dynamicParts.push(decodeKeyPart(hashedKey.slice(26), keyParts[1]));
      break;
    case 3:
      dynamicParts.push(decodeKeyPart(hashedKey.slice(14, 22), keyParts[1]));
      dynamicParts.push(decodeKeyPart(hashedKey.slice(26), keyParts[2]));
      break;
    default:
      break;
  }
  return dynamicParts.filter((p) => p !== false);
}
var getSchemaElementForDynamicKeyName = (schemas, namedDynamicKey, dynamicKeyParts) => {
  const schemaElement = schemas.find((e) => e.name === namedDynamicKey);
  if (!schemaElement) {
    throw new Error(
      `No matching schema found for dynamic key: ${namedDynamicKey}`
    );
  }
  const key = encodeKeyName(namedDynamicKey, dynamicKeyParts);
  const dynamicName = generateDynamicKeyName(namedDynamicKey, dynamicKeyParts);
  return {
    ...schemaElement,
    dynamicName,
    key,
    dynamicKeyParts
  };
};
function getSchemaElement(schemas, _namedOrHashedKey, dynamicKeyParts) {
  let keyHash;
  let namedOrHashedKey = _namedOrHashedKey;
  if (/^[0-9a-f]{64}$/i.test(_namedOrHashedKey)) {
    namedOrHashedKey = `0x${_namedOrHashedKey}`;
  }
  if (namedOrHashedKey.startsWith("0x")) {
    const index = namedOrHashedKey.indexOf("<");
    if (index !== -1) {
      const partial = namedOrHashedKey.slice(0, index);
      const schemaElement2 = schemas.find(
        (e) => e.key.slice(0, index) === partial
      );
      const dynamicKeyParts2 = decodeMappingKey(
        namedOrHashedKey,
        schemaElement2
      );
      if (schemaElement2) {
        return {
          ...schemaElement2,
          ...dynamicKeyParts2 ? { dynamicKeyParts: dynamicKeyParts2 } : {}
        };
      }
    }
  }
  if (isDynamicKeyName(namedOrHashedKey)) {
    if (!dynamicKeyParts) {
      throw new Error(
        `Can't getSchemaElement for dynamic key: ${namedOrHashedKey} without dynamicKeyParts.`
      );
    }
    return getSchemaElementForDynamicKeyName(
      schemas,
      namedOrHashedKey,
      dynamicKeyParts
    );
  }
  if (isHex5(namedOrHashedKey)) {
    keyHash = isHex5(namedOrHashedKey, { strict: true }) ? namedOrHashedKey : `0x${namedOrHashedKey}`;
  } else {
    keyHash = encodeKeyName(namedOrHashedKey);
  }
  const schemaElement = schemas.find((e) => e.key === keyHash);
  if (!schemaElement) {
    throw new Error(
      `No matching schema found for key: ${namedOrHashedKey} (${keyHash}).`
    );
  }
  return schemaElement;
}
var ALL_VALUE_TYPES = [
  // unsigned integers
  "uint8",
  "uint16",
  "uint24",
  "uint32",
  "uint40",
  "uint48",
  "uint56",
  "uint64",
  "uint72",
  "uint80",
  "uint88",
  "uint96",
  "uint104",
  "uint112",
  "uint120",
  "uint128",
  "uint136",
  "uint144",
  "uint152",
  "uint160",
  "uint168",
  "uint176",
  "uint184",
  "uint192",
  "uint200",
  "uint208",
  "uint216",
  "uint224",
  "uint232",
  "uint240",
  "uint248",
  "uint256",
  // signed integers
  "int8",
  "int16",
  "int24",
  "int32",
  "int40",
  "int48",
  "int56",
  "int64",
  "int72",
  "int80",
  "int88",
  "int96",
  "int104",
  "int112",
  "int120",
  "int128",
  "int136",
  "int144",
  "int152",
  "int160",
  "int168",
  "int176",
  "int184",
  "int192",
  "int200",
  "int208",
  "int216",
  "int224",
  "int232",
  "int240",
  "int248",
  "int256",
  // bytesN
  "bytes1",
  "bytes2",
  "bytes3",
  "bytes4",
  "bytes5",
  "bytes6",
  "bytes7",
  "bytes8",
  "bytes9",
  "bytes10",
  "bytes11",
  "bytes12",
  "bytes13",
  "bytes14",
  "bytes15",
  "bytes16",
  "bytes17",
  "bytes18",
  "bytes19",
  "bytes20",
  "bytes21",
  "bytes22",
  "bytes23",
  "bytes24",
  "bytes25",
  "bytes26",
  "bytes27",
  "bytes28",
  "bytes29",
  "bytes30",
  "bytes31",
  "bytes32",
  // others static types
  "bool",
  "boolean",
  "address",
  // array and dynamic types
  "string",
  "bytes",
  // arrays
  "string[]",
  "address[]",
  "uint256[]",
  "bytes32[]",
  "bytes4[]",
  "bytes[]",
  "bool[]",
  "boolean[]"
];
function isValidValueType(value) {
  return ALL_VALUE_TYPES.includes(value);
}
var tupleValueTypesRegex = /bytes(\d+)/;
var valueContentsBytesRegex = /Bytes(\d+)/;
var isValidTupleDefinition = (tupleContent) => {
  if (tupleContent.length <= 2) {
    return false;
  }
  if (tupleContent[0] !== "(" && tupleContent[tupleContent.length - 1] !== ")") {
    return false;
  }
  return true;
};
var extractTupleElements = (tupleContent) => tupleContent.substring(1, tupleContent.length - 1).split(",");
var isValidTuple = (valueType, valueContent) => {
  if (!isValidTupleDefinition(valueType) || !isValidTupleDefinition(valueContent)) {
    return false;
  }
  const valueTypeToDecode = valueType.replace(COMPACT_BYTES_ARRAY_STRING, "");
  const valueTypeParts = extractTupleElements(valueTypeToDecode);
  const valueContentParts = extractTupleElements(valueContent);
  if (valueTypeParts.length !== valueContentParts.length) {
    throw new Error(
      `Invalid tuple for valueType: ${valueType} / valueContent: ${valueContent}. They should have the same number of elements. Got: ${valueTypeParts.length} and ${valueContentParts.length}`
    );
  }
  for (let i = 0; i < valueTypeParts.length; i++) {
    if (!isValidValueType(valueTypeParts[i])) {
      throw new Error(
        `Invalid tuple for valueType: ${valueType} / valueContent: ${valueContent}. Type: ${valueTypeParts[i]} is not valid. Valid types are: ${ALL_VALUE_TYPES}`
      );
    }
    const valueTypeBytesLength = valueTypeParts[i].replace(/\[.*?\]$/, "").split("bytes")[1];
    if (valueTypeParts[i].match(tupleValueTypesRegex) && valueContentParts[i].match(valueContentsBytesRegex)) {
      const valueContentBytesLength = valueContentParts[i].slice(5);
      if (valueTypeBytesLength > valueContentBytesLength) {
        throw new Error(
          `Invalid tuple (${valueType},${valueContent}: ${valueType[i]} cannot fit in ${valueContent[i]}`
        );
      }
    }
    if (valueContentEncodingMap(valueContentParts[i]).type === "unknown" && valueContentParts[i].slice(0, 5) !== "Bytes" && valueContentParts[i].slice(0, 2) !== "0x") {
      throw new Error(
        `Invalid tuple for valueType: ${valueType} / valueContent: ${valueContent}. valueContent of type: ${valueContentParts[i]} is not valid`
      );
    }
    if (isHex6(valueContentParts[i], { strict: true })) {
      const hexLiteralLength = valueContentParts[i].length - 2;
      if (Number.parseInt(valueTypeBytesLength, 10) < hexLiteralLength) {
        throw new Error(
          `Invalid tuple (${valueType},${valueContent}: ${valueContent[i]} cannot fit in ${valueType[i]}`
        );
      }
    } else if (valueContentParts[i].startsWith("0x")) {
      throw new Error(
        `Invalid tuple for valueType: ${valueType} / valueContent: ${valueContent}. valueContent of type: ${valueContentParts[i]} is not a valid hex value`
      );
    }
  }
  return true;
};
var decodeTupleKeyValue = (valueContent, valueType, value) => {
  const valueTypeToDecode = valueType.replace(
    COMPACT_BYTES_ARRAY_STRING_AT_END,
    ""
  );
  const valueTypeParts = extractTupleElements(valueTypeToDecode);
  const valueContentParts = extractTupleElements(valueContent);
  const consumed = {
    bytes: 0
  };
  const total = size2(value);
  const output = valueTypeParts.map((valueTypePart, index) => {
    return decodeKeyValue(
      valueContentParts[index],
      valueTypePart,
      consumed.bytes < size2(value) ? slice3(value, consumed.bytes) : "0x",
      consumed
    );
  });
  if (total !== consumed.bytes) {
    throw new Error("Tuple value is the wrong length returning null");
  }
  return output;
};
function decodeKey(schema, value) {
  const lowerCaseKeyType = schema.keyType.toLowerCase();
  switch (lowerCaseKeyType) {
    case "array": {
      if (!value || value === "0x") {
        return [];
      }
      if (typeof value === "string" && countNumberOfBytes(value) === 16) {
        return decodeKeyValue("Number", "uint128+", value, schema.name) || 0;
      }
      const valueElement = value.find((e) => e.key === schema.key);
      if (!valueElement) {
        return [];
      }
      const consumed = {
        bytes: 0,
        name: schema.name
      };
      const arrayLength = decodeKeyValue("Number", "uint128+", valueElement.value, consumed) || 0;
      const results = [];
      for (let index = 0; index < arrayLength; index++) {
        const dataElement = value.find(
          (e) => e.key === encodeArrayKey(schema.key, index)
        );
        if (dataElement) {
          results.push(
            decodeKeyValue(
              schema.valueContent,
              schema.valueType,
              dataElement.value,
              consumed
            )
          );
        }
      }
      return results;
    }
    case "mappingwithgrouping":
    case "singleton":
    case "mapping": {
      if (Array.isArray(value)) {
        const newValue = value.find((e) => e.key === schema.key);
        if (!newValue) {
          return null;
        }
        return decodeKeyValue(
          schema.valueContent,
          schema.valueType,
          newValue.value,
          schema.name
        );
      }
      if (schema.valueType.endsWith(COMPACT_BYTES_ARRAY_STRING)) {
        const valueType = schema.valueType.replace(
          COMPACT_BYTES_ARRAY_STRING_AT_END,
          ""
        );
        const valueContent = schema.valueContent.replace(
          COMPACT_BYTES_ARRAY_STRING_AT_END,
          ""
        );
        if (valueType[0] === "(" && valueType[valueType.length - 1] === ")") {
          const decodedCompactBytesArray = decodeValueType(
            "bytes[CompactBytesArray]",
            value
          );
          return decodedCompactBytesArray.map(
            (element) => decodeTupleKeyValue(valueContent, valueType, element)
          );
        }
        return decodeValueType(schema.valueType, value);
      }
      if (isValidTuple(schema.valueType, schema.valueContent)) {
        return decodeTupleKeyValue(
          schema.valueContent,
          schema.valueType,
          value
        );
      }
      return decodeKeyValue(
        schema.valueContent,
        schema.valueType,
        value,
        schema.name
      );
    }
    default: {
      throw new Error(
        `Incorrect data match or keyType in schema from decodeKey(): "${schema.keyType}"`
      );
    }
  }
}
function decodeData(data, schema, throwExceptions = false) {
  const processDataInput = ({ keyName, dynamicKeyParts, value }, throwException = true) => {
    const isDynamic = isDynamicKeyName(keyName);
    const schemaElement = isDynamic ? getSchemaElement(schema, keyName, dynamicKeyParts) : getSchemaElement(schema, keyName);
    let decodedValue = null;
    try {
      decodedValue = decodeKey(schemaElement, value);
    } catch (error) {
      if (throwException) {
        throw error;
      }
      console.error(error);
    }
    const { key, name, dynamicName } = schemaElement;
    return {
      key,
      name,
      ...dynamicName ? { dynamicName } : { dynamicName: name },
      ...dynamicKeyParts ? { dynamicKeyParts } : {},
      value: decodedValue
    };
  };
  if (Array.isArray(data)) {
    return data.map(
      (dataInput) => processDataInput(dataInput, throwExceptions)
    );
  }
  return processDataInput(data, throwExceptions);
}
function encodeKeyValue(valueContent, valueType, decodedValue, name) {
  const isSupportedValueContent = !!valueContentEncodingMap(valueContent) || isValueContentLiteralHex(valueContent);
  if (!isSupportedValueContent) {
    throw new Error(
      `The valueContent '${valueContent}' for ${name} is not supported.`
    );
  }
  const isValueTypeArray = valueType.slice(valueType.length - 1) === "]";
  if ((valueType.startsWith("uint") || valueType.startsWith("int") || valueType.startsWith("bytes")) && typeof decodedValue !== "object") {
    return encodeValueType(valueType, decodedValue);
  }
  if (!isValueTypeArray && !Array.isArray(decodedValue)) {
    return encodeValueContent(valueContent, decodedValue);
  }
  const valueContentEncodingMethods = valueContentEncodingMap(valueContent);
  const isSameEncoding = valueContentEncodingMethods && valueContentEncodingMethods.type === valueType.split("[]")[0];
  let result;
  if (Array.isArray(decodedValue)) {
    const results = [];
    for (let index = 0; index < decodedValue.length; index++) {
      const element = decodedValue[index];
      results.push(
        encodeValueContent(valueContent.replace(/\[.*?\]$/, ""), element)
      );
    }
    result = results;
  }
  if (
    // and we only skip bytes regardless
    valueType !== "bytes" && // Requires encoding because !sameEncoding means both encodings are required
    !isSameEncoding
  ) {
    result = encodeValueType(
      valueType,
      result
    );
  } else if (isValueTypeArray && isSameEncoding) {
    result = encodeValueType(valueType, decodedValue);
  }
  return result;
}
function encodeArrayKey(key, index) {
  return concat2([slice4(key, 0, 16), pad4(toHex4(index), { size: 16 })]);
}
function guessKeyTypeFromKeyName(keyName) {
  const splittedKeyName = keyName.replace(/[^:]</g, ":").split(":");
  if (splittedKeyName.length === 3) {
    return "MappingWithGrouping";
  }
  if (splittedKeyName.length === 2) {
    return "Mapping";
  }
  if (keyName.substring(keyName.length - 2, keyName.length) === "[]") {
    return "Array";
  }
  return "Singleton";
}
var encodeTupleKeyValue = (valueContent, valueType, decodedValues) => {
  const valueTypeParts = valueType.substring(1, valueType.length - 1).split(",");
  const valueContentParts = valueContent.substring(1, valueContent.length - 1).split(",");
  if (valueTypeParts.length !== decodedValues.length) {
    throw new Error(
      `Can not encode tuple key value: ${decodedValues}. Expecte array of length: ${valueTypeParts.length}`
    );
  }
  const returnValue = `0x${valueContentParts.map((valueContentPart, i) => {
    const encodedKeyValue = encodeKeyValue(
      valueContentPart,
      valueTypeParts[i],
      decodedValues[i]
    );
    if (!encodedKeyValue) {
      return "";
    }
    return encodedKeyValue.slice(2);
  }).join("")}`;
  return returnValue;
};
function encodeKey(schema, value, startingIndex = 0, totalArrayLength = Array.isArray(value) ? value.length : 0) {
  const lowerCaseKeyType = schema.keyType.toLowerCase();
  switch (lowerCaseKeyType) {
    case "array": {
      if (typeof value === "number") {
        return encodeValueType("uint128", value);
      }
      if (!Array.isArray(value)) {
        throw new Error("Can't encode a non array for key of type array");
      }
      if (typeof startingIndex !== "number" || typeof totalArrayLength !== "number") {
        throw new Error(
          "Invalid `startingIndex` or `totalArrayLength` parameters. Values must be of type number."
        );
      }
      if (startingIndex < 0) {
        throw new Error(
          "Invalid `startingIndex` parameter. Value cannot be negative."
        );
      }
      if (totalArrayLength < value.length) {
        throw new Error(
          "Invalid `totalArrayLength` parameter. Array length must be at least as large as the number of elements of the value array."
        );
      }
      const results = [];
      for (let index = 0; index < value.length; index++) {
        if (index === 0) {
          results.push({
            key: schema.key,
            // Encode the explicitly provided or default array length
            value: encodeValueType("uint128", totalArrayLength)
          });
        }
        const elementIndex = startingIndex + index;
        const dataElement = value[index];
        results.push({
          key: encodeArrayKey(schema.key, elementIndex),
          value: encodeKeyValue(
            schema.valueContent,
            schema.valueType,
            dataElement,
            schema.name
          )
        });
      }
      return results;
    }
    case "mappingwithgrouping":
    case "singleton":
    case "mapping":
      if (isValidTuple(schema.valueType, schema.valueContent)) {
        if (!Array.isArray(value)) {
          throw new Error(
            `Incorrect value for tuple. Got: ${value}, expected array.`
          );
        }
        const isCompactBytesArray = schema.valueType.endsWith(
          COMPACT_BYTES_ARRAY_STRING
        );
        if (Array.isArray(value[0]) && isCompactBytesArray) {
          const valueType = schema.valueType.replace(
            COMPACT_BYTES_ARRAY_STRING,
            ""
          );
          const valueContent = schema.valueContent.replace(
            COMPACT_BYTES_ARRAY_STRING,
            ""
          );
          const encodedTuples = value.map((element) => {
            return encodeTupleKeyValue(valueContent, valueType, element);
          });
          return encodeValueType("bytes[CompactBytesArray]", encodedTuples);
        }
        if (!Array.isArray(value)) {
          throw new Error(`Array value required ${JSON.stringify(value)}`);
        }
        return encodeTupleKeyValue(
          schema.valueContent,
          schema.valueType,
          value
        );
      }
      if (Array.isArray(value) && Array.isArray(value[0]) && !isValidTuple(schema.valueType, schema.valueContent)) {
        throw new Error("Incorrect value for nested array: not a tuple.");
      }
      return encodeKeyValue(
        schema.valueContent,
        schema.valueType,
        value,
        schema.name
      );
    default:
      console.error(
        `Incorrect data match or keyType in schema from encodeKey(): "${schema.keyType}"`
      );
      return null;
  }
}
function decodeKeyValue(valueContent, valueType, _value, name) {
  const valueContentEncodingMethods = valueContentEncodingMap(valueContent);
  let value = _value;
  if (!valueContentEncodingMethods && valueContent.slice(0, 2) !== "0x") {
    throw new Error(
      `The valueContent "${valueContent}" for "${typeof name === "object" ? name.name : name}" is not supported.`
    );
  }
  let sameEncoding = valueContentEncodingMethods && valueContentEncodingMethods.type === valueType.split("[]")[0];
  const isArray = valueType.substring(valueType.length - 1) === "]";
  const valueTypeIsBytesNonArray = valueType.slice(0, 6) === "bytes[" && valueType.slice(-1) !== "]";
  if (!valueTypeIsBytesNonArray && valueType !== "string") {
    value = decodeValueType(
      valueType,
      value,
      typeof name === "object" ? name : void 0
    );
  }
  if (sameEncoding && isAddress3(value) && !isAddress3(value, { strict: true })) {
    sameEncoding = !sameEncoding;
  }
  if (sameEncoding && valueType !== "string") {
    return value;
  }
  if (isArray && Array.isArray(value)) {
    const results = [];
    for (let index = 0; index < value.length; index++) {
      const element = value[index];
      results.push(decodeValueContent(valueContent, element));
    }
    return results;
  }
  return decodeValueContent(valueContent, value);
}
function encodeData(data, schema) {
  const dataAsArray = Array.isArray(data) ? data : [data];
  return dataAsArray.reduce(
    (accumulator, { keyName, value, dynamicKeyParts, startingIndex, totalArrayLength }) => {
      let schemaElement = null;
      let encodedValue;
      if (isDynamicKeyName(keyName)) {
        if (!dynamicKeyParts) {
          throw new Error(
            `Can't encodeData for dynamic key: ${keyName} with non dynamic values. Got: ${value}, expected object.`
          );
        }
        schemaElement = getSchemaElement(schema, keyName, dynamicKeyParts);
        encodedValue = encodeKey(
          schemaElement,
          value,
          startingIndex,
          totalArrayLength
        );
      } else {
        schemaElement = getSchemaElement(schema, keyName);
        encodedValue = encodeKey(
          schemaElement,
          value,
          startingIndex,
          totalArrayLength
        );
      }
      if (typeof encodedValue === "string") {
        accumulator.keys.push(schemaElement.key);
        accumulator.values.push(encodedValue);
      } else if (encodedValue !== false && encodedValue != null) {
        for (let i = 0; i < encodedValue.length; i++) {
          const { key, value: _value } = encodedValue[i];
          accumulator.keys.push(key);
          accumulator.values.push(_value);
        }
      }
      return accumulator;
    },
    { keys: [], values: [] }
  );
}
function getVerificationMethod(nameOrSig) {
  const verificationMethod = Object.values(HASH_METHODS).find(
    ({ name, sig }) => name === nameOrSig || sig === nameOrSig
  );
  if (!verificationMethod && nameOrSig !== "0x00000000") {
    throw new Error(
      `Chosen verification method '${nameOrSig}' is not supported. Supported verification methods: ${SUPPORTED_VERIFICATION_METHODS_LIST}`
    );
  }
  return verificationMethod;
}
function hashData(data, nameOrSig) {
  return getVerificationMethod(nameOrSig)?.method(data) || pad4(toHex4(0), { size: 32 });
}
function isDataAuthentic(data, options, capture) {
  if (!options?.method || options?.method === "0x00000000") {
    return true;
  }
  const dataHash = hashData(data, options.method);
  if (dataHash !== options.data) {
    if (capture) {
      capture.push(dataHash);
    } else {
      console.error(
        `Hash mismatch, calculated hash ("${dataHash}") is different from expected hash "${options.data}"`
      );
    }
    return false;
  }
  return true;
}
function convertIPFSGatewayUrl(ipfsGateway) {
  let convertedIPFSGateway = ipfsGateway;
  if (ipfsGateway.endsWith("/") && !ipfsGateway.endsWith("/ipfs/")) {
    convertedIPFSGateway = `${ipfsGateway}ipfs/`;
  } else if (ipfsGateway.endsWith("/ipfs")) {
    convertedIPFSGateway = `${ipfsGateway}/`;
  } else if (!ipfsGateway.endsWith("/ipfs/")) {
    convertedIPFSGateway = `${ipfsGateway}/ipfs/`;
  }
  return convertedIPFSGateway;
}
var generateSchemasFromDynamicKeys = (keyNames, schemas) => {
  return keyNames.map((keyName) => {
    if (typeof keyName === "string") {
      return getSchemaElement(schemas, keyName);
    }
    return getSchemaElement(schemas, keyName.keyName, keyName.dynamicKeyParts);
  });
};
function patchIPFSUrlsIfApplicable(receivedData, ipfsGateway) {
  if (receivedData?.url?.startsWith("ipfs://")) {
    if (typeof ipfsGateway === "string") {
      return {
        ...receivedData,
        url: receivedData.url.replace("ipfs://", ipfsGateway)
      };
    }
    if (typeof ipfsGateway !== "object" || !ipfsGateway.ipfsGateway) {
      throw new Error(
        "Invalid ipfsGateway provided. It should be a string or an object with an ipfsGateway property."
      );
    }
    if (ipfsGateway.ipfsConvertUrl) {
      const url = ipfsGateway.ipfsConvertUrl(receivedData.url);
      return {
        ...receivedData,
        url
      };
    }
    return {
      ...receivedData,
      url: receivedData.url.replace("ipfs://", ipfsGateway.ipfsGateway)
    };
  }
  return receivedData;
}
function countNumberOfBytes(data) {
  return size3(data);
}
function countSignificantBits(data) {
  const bytes = hexToBytes2(data);
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0) {
      return (bytes.length - i - 1) * 8 + // The number of bits with non-zero values from the right.
      (32 - Math.clz32(bytes[i]));
    }
  }
  return 0;
}
var splitMultiDynamicKeyNamePart = (keyName) => {
  if (keyName.length <= 1) {
    return [keyName];
  }
  if (keyName.charAt(0) !== "<" || keyName.slice(-1) !== ">") {
    return [keyName];
  }
  return keyName.substring(1, keyName.length - 1).split("|");
};
var duplicateMultiTypeERC725SchemaEntry = (schema) => {
  if (Array.isArray(schema)) {
    throw new Error(
      "Input schema should be a ERC725JSONSchema and not an array."
    );
  }
  if (!("name" in schema) || !("key" in schema) || !("keyType" in schema)) {
    throw new Error(
      "Input schema object is missing 'name', 'key' and 'keyType' properties. Did you pass a valid ERC725JSONSchema object?"
    );
  }
  const lowerCaseKeyType = schema.keyType.toLowerCase();
  if (lowerCaseKeyType !== "mapping" && lowerCaseKeyType !== "mappingwithgrouping") {
    return [schema];
  }
  if (!schema.name.includes("<") || !schema.name.includes("|") || !schema.name.includes(">")) {
    return [schema];
  }
  if (schema.name.indexOf(":") === -1) {
    throw new Error(
      `Input schema type is Mapping or MappingWithGroups but the key: ${schema.key} is not valid (missing ':').`
    );
  }
  const nameGroups = schema.name.split(":");
  const baseKey = schema.key.substring(0, schema.key.indexOf("<"));
  const baseSchema = {
    ...schema,
    name: nameGroups.shift(),
    // The first element of the key name is never dynamic.
    key: baseKey
  };
  if (nameGroups.length === 1) {
    const dynamicTypes2 = splitMultiDynamicKeyNamePart(nameGroups[0]);
    const finalSchemas2 = dynamicTypes2.map((dynamicType) => {
      return {
        ...baseSchema,
        name: `${baseSchema.name}:<${dynamicType}>`,
        key: `${baseSchema.key}<${dynamicType}>`
      };
    });
    return finalSchemas2;
  }
  let finalSchemas;
  if (nameGroups[0].charAt(0) !== "<" || nameGroups[0].slice(-1) !== ">") {
    finalSchemas = [
      {
        ...baseSchema,
        name: `${baseSchema.name}:${nameGroups[0]}`,
        key: `${baseSchema.key}`
      }
    ];
  } else {
    const dynamicTypes2 = splitMultiDynamicKeyNamePart(nameGroups[0]);
    finalSchemas = dynamicTypes2.map((dynamicType) => {
      return {
        ...baseSchema,
        name: `${baseSchema.name}:<${dynamicType}>`,
        key: `${baseSchema.key}<${dynamicType}>`
      };
    });
  }
  const lastDynamicTypes = splitMultiDynamicKeyNamePart(nameGroups[1]);
  return finalSchemas.flatMap((finalSchema) => {
    return lastDynamicTypes.map((lastDynamicType) => {
      return {
        ...finalSchema,
        name: `${finalSchema.name}:<${lastDynamicType}>`,
        key: `${finalSchema.key}<${lastDynamicType}>`
      };
    });
  });
};
function isValidUintSize(bitSize) {
  return bitSize >= 8 && bitSize <= 256 && bitSize % 8 === 0;
}
function isValidByteSize(bytesSize) {
  return bytesSize >= 1 && bytesSize <= 32;
}
function isValueContentLiteralHex(valueContent) {
  return isHex7(valueContent, { strict: true });
}
function negateSignedBigInt(value, bitLength) {
  if (value === 0n) {
    return 0n;
  }
  const maxValue = 1n << BigInt(bitLength);
  const mask = maxValue - 1n;
  return (~value & mask) + 1n;
}
var getSchemasByKeyType = (schemas) => {
  return {
    Singleton: schemas.filter((schema) => schema.keyType === "Singleton"),
    Array: schemas.filter((schema) => schema.keyType === "Array"),
    Mapping: schemas.filter((schema) => schema.keyType === "Mapping"),
    MappingWithGrouping: schemas.filter(
      (schema) => schema.keyType === "MappingWithGrouping"
    )
  };
};
var fillDynamicKeyPart = (key, keySchema) => {
  const fillOneDynamicKeyPart = (key2, keySchema2, insertQuestionMarks = false) => {
    const result = {
      ...keySchema2,
      key: key2
    };
    const keyNameParts = keySchema2.name.split(":");
    const secondWordHex = key2.substring(26);
    let dynamicPartName = "??????";
    if (isDynamicKeyName(keySchema2.name) && !insertQuestionMarks) {
      dynamicPartName = secondWordHex;
      let dynamicName = `${keyNameParts[0]}:0x${dynamicPartName}`;
      let dynamicKeyPart = `0x${secondWordHex}`;
      const dynamicPartType = keyNameParts[1].match(dynamicTypesRegex);
      if (dynamicPartType) {
        const byteSize = dynamicPartType[1] === "uint" || dynamicPartType[1] === "int" ? Number.parseInt(dynamicPartType[2]) / 8 : Number.parseInt(dynamicPartType[2]);
        if (byteSize < 20) {
          dynamicName = `${keyNameParts[0]}:0x${dynamicPartName.slice(0, byteSize * 2)}`;
          dynamicKeyPart = `0x${secondWordHex.slice(0, byteSize * 2)}`;
        }
      }
      result.dynamicName = dynamicName;
      result.dynamicKeyParts = dynamicKeyPart;
      return result;
    }
    if (concat3([slice5(keccak2563(toBytes3(keyNameParts[1])), 0, 10), "0x0000"]) === `0x${secondWordHex}`) {
      dynamicPartName = keyNameParts[1];
    }
    return result;
  };
  if (Array.isArray(keySchema)) {
    const firstWord = slice5(key, 0, 12);
    const singleSchema = keySchema.find(
      // Use string slice here, because the key can have : or < separators.
      (schema) => concat3([schema.key.slice(0, 22), "0x0000"]) === firstWord
    );
    if (singleSchema) {
      return fillOneDynamicKeyPart(key, singleSchema);
    }
    return fillOneDynamicKeyPart(key, keySchema[0], true);
  }
  return fillOneDynamicKeyPart(key, keySchema);
};
var findSingletonSchemaForKey = (key, schemas) => {
  return schemas.find((schema) => schema.key === key) || null;
};
var findArraySchemaForKey = (key, schemas) => {
  const initialKeySchema = schemas.find((schema) => schema.key === key) || null;
  if (initialKeySchema) {
    return initialKeySchema;
  }
  const first16Bytes = slice5(key, 0, 16);
  const last16Bytes = slice5(key, 16);
  if (!isHex8(first16Bytes) || !isHex8(last16Bytes)) {
    return null;
  }
  const arraySchema = schemas.find(
    (schema) => slice5(schema.key, 0, 16) === first16Bytes
  ) || null;
  if (!arraySchema) {
    return null;
  }
  const index = decodeValueType("uint128", last16Bytes);
  return {
    ...arraySchema,
    key,
    dynamicName: arraySchema.name.replace("[]", `[${index}]`),
    dynamicKeyParts: last16Bytes,
    name: arraySchema.name,
    keyType: "Singleton"
  };
};
var findMappingSchemaForKey = (key, schemas) => {
  const firstWordHex = key.substring(0, 26);
  const keySchema = schemas.find((schema) => schema.key === key) || null;
  if (keySchema) {
    return fillDynamicKeyPart(key, keySchema);
  }
  const keySchemas = schemas.filter(
    (schema) => `${schema.key.substring(0, 22)}0000` === firstWordHex
  );
  if (keySchemas.length === 0) {
    return null;
  }
  return fillDynamicKeyPart(key, keySchemas);
};
var findMappingWithGroupingSchemaForKey = (key, schemas) => {
  let keySchema = schemas.find(
    (schema) => schema.key.substring(0, 26) === key.substring(0, 26)
  ) || null;
  if (keySchema) {
    keySchema = { ...keySchema };
    const keyNameParts = keySchema.name.split(":");
    const dynamicKeyPart = key.substring(26);
    if (isDynamicKeyName(keySchema.name)) {
      keySchema.dynamicName = `${keyNameParts[0]}:${keyNameParts[1]}:0x${dynamicKeyPart}`;
      keySchema.dynamicKeyParts = `0x${dynamicKeyPart}`;
    }
    return {
      ...keySchema,
      key
    };
  }
  return null;
};
function schemaParser(key, schemas) {
  const schemasByKeyType = getSchemasByKeyType(schemas);
  let foundSchema = null;
  foundSchema = findSingletonSchemaForKey(key, schemasByKeyType.Singleton);
  if (foundSchema) {
    return foundSchema;
  }
  foundSchema = findArraySchemaForKey(key, schemasByKeyType.Array);
  if (foundSchema) {
    return foundSchema;
  }
  foundSchema = findMappingSchemaForKey(key, schemasByKeyType.Mapping);
  if (foundSchema) {
    return foundSchema;
  }
  foundSchema = findMappingWithGroupingSchemaForKey(
    key,
    schemasByKeyType.MappingWithGrouping
  );
  return foundSchema;
}
function getSchema(keyOrKeys, providedSchemas) {
  let fullSchema = schemas_default;
  if (providedSchemas) {
    fullSchema = providedSchemas.concat(fullSchema);
  }
  if (Array.isArray(keyOrKeys)) {
    return keyOrKeys.reduce(
      (acc, key) => {
        acc[key] = schemaParser(key, fullSchema);
        return acc;
      },
      {}
    );
  }
  return schemaParser(keyOrKeys, fullSchema);
}
var MAGIC_VALUE = "0x1626ba7e";
function validateHash(hash) {
  return /^0x([A-Fa-f0-9]{64})$/.test(hash);
}
var isValidSignature = async (messageOrHash, signature, address, wrappedProvider) => {
  const hash = validateHash(messageOrHash) ? messageOrHash : keccak2564(
    stringToHex2(
      `Ethereum Signed Message:
${messageOrHash.length}${messageOrHash}`
    )
  );
  if (signature.length !== 132) {
    throw new Error("Signature length should be 132 (65bytes)");
  }
  try {
    const value = await wrappedProvider.isValidSignature(
      address,
      hash,
      signature
    );
    return value === MAGIC_VALUE;
  } catch {
    throw new Error(
      `Error when checking signature. Is ${address} a valid contract address which supports EIP-1271 standard?`
    );
  }
};
var getDataFromExternalSources = (schemas, dataFromChain, ipfsGateway) => {
  const promises = dataFromChain.map(async (dataEntry) => {
    const schemaElement = schemas.find(
      (schema) => schema.key === dataEntry.key
    );
    if (!schemaElement) {
      return dataEntry;
    }
    if (!["jsonurl", "asseturl", "verifiableuri"].includes(
      schemaElement.valueContent.toLowerCase()
    )) {
      return dataEntry;
    }
    try {
      if (typeof dataEntry.value === "string") {
        throw new Error(
          `Value of key: ${dataEntry.name} (${dataEntry.value}) is string but valueContent is: ${schemaElement.valueContent}. Expected type should be object with url key.`
        );
      }
      if (!dataEntry.value) {
        throw new Error(`Value of key: ${dataEntry.name} is empty`);
      }
      if (Array.isArray(dataEntry.value)) {
        throw new Error(
          `Value of key: ${dataEntry.name} (${dataEntry.value}) is string[] but valueContent is: ${schemaElement.valueContent}. Expected type should be object with url key.`
        );
      }
      const urlDataWithHash = dataEntry.value;
      const { url } = patchIPFSUrlsIfApplicable(
        urlDataWithHash,
        typeof ipfsGateway === "string" ? ipfsGateway : ipfsGateway.ipfsGateway
      );
      let receivedData;
      const [, encoding, data] = url.match(/^data:.*?;(.*?),(.*)$/) || [];
      if (data) {
        receivedData = new TextEncoder().encode(
          encoding === "base64" ? atob(data) : data
        );
      } else {
        if (/[=?/]$/.test(url)) {
          return dataEntry;
        }
        receivedData = await fetch(url).then(async (response) => {
          if (!response.ok) {
            throw new Error(response.statusText);
          }
          return response.arrayBuffer().then((buffer) => new Uint8Array(buffer));
        });
      }
      if (receivedData.length >= 2) {
        try {
          const capture = [];
          capture.push(receivedData[0]);
          if (receivedData.length > 3) {
            capture.push(receivedData[receivedData.length - 3]);
          }
          if (receivedData.length > 2) {
            capture.push(receivedData[receivedData.length - 2]);
          }
          if (receivedData.length > 1) {
            capture.push(receivedData[receivedData.length - 1]);
          }
          const key = String.fromCharCode.apply(null, capture);
          if (/^(\[.*\]|\{.*\})\s*$/.test(key)) {
            const json = new TextDecoder().decode(receivedData);
            const value = JSON.parse(json);
            const mismatchedHashes2 = [];
            if (isDataAuthentic(
              value,
              urlDataWithHash.verification,
              mismatchedHashes2
            )) {
              return { ...dataEntry, value };
            }
            if (isDataAuthentic(
              receivedData,
              urlDataWithHash.verification,
              mismatchedHashes2
            )) {
              return { ...dataEntry, value };
            }
            throw new Error(
              `Hash mismatch, calculated hashes ("${mismatchedHashes2.join(
                '", "'
              )}") are both different from expected hash "${urlDataWithHash.verification.data}"`
            );
          }
        } catch {
        }
      }
      const mismatchedHashes = [];
      if (isDataAuthentic(
        receivedData,
        urlDataWithHash.verification,
        mismatchedHashes
      )) {
        return { ...dataEntry, value: receivedData };
      }
      throw new Error(
        `Hash mismatch, calculated hashes ("${mismatchedHashes.join(
          '", "'
        )}") are both different from expected hash "${urlDataWithHash.verification.data}"`
      );
    } catch (error) {
      error.message = `Value of key: ${dataEntry.name} has an error: ${error.message}`;
      return {
        ...dataEntry,
        value: null,
        error
      };
    }
  });
  return Promise.all(promises);
};
var getArrayValues = async (erc725Options, schema, data) => {
  if (schema.keyType !== "Array") {
    throw new Error(
      `The "getArrayValues" method requires a schema definition with "keyType: Array",
         ${schema}`
    );
  }
  const results = [];
  const value = data[schema.key];
  if (!value || !value.value) {
    return results;
  }
  const arrayLength = await decodeKeyValue(
    "Number",
    "uint128+",
    value.value,
    schema.name
  );
  const arrayElementKeys = [];
  for (let index = 0; index < arrayLength; index++) {
    const arrayElementKey = encodeArrayKey(schema.key, index);
    if (!data[arrayElementKey]) {
      arrayElementKeys.push(arrayElementKey);
    }
  }
  try {
    const arrayElements = await erc725Options.provider?.getAllData(
      erc725Options.address,
      arrayElementKeys
    );
    results.push(...arrayElements);
  } catch {
  }
  return results;
};
var getDataMultiple = async (erc725Options, keyNames) => {
  const schemas = generateSchemasFromDynamicKeys(
    keyNames,
    erc725Options.schemas
  );
  const allKeys = schemas.map((schema) => schema.key);
  const allRawData = await erc725Options.provider?.getAllData(
    erc725Options.address,
    allKeys
  );
  const keyValueMap = allRawData.reduce(
    (accumulator, current) => {
      accumulator[current.key] = current.value;
      return accumulator;
    },
    {}
  );
  const schemasWithValue = schemas.map((schema) => {
    return { ...schema, value: keyValueMap[schema.key] || null };
  });
  const arraySchemas = schemas.filter(
    (e) => e.keyType.toLowerCase() === "array"
  );
  for (const keySchema of arraySchemas) {
    try {
      const dataKeyValue = {
        [keySchema.key]: {
          key: keySchema.key,
          value: keyValueMap[keySchema.key]
        }
      };
      const arrayValues = await getArrayValues(
        erc725Options,
        keySchema,
        dataKeyValue
      );
      if (arrayValues && arrayValues.length > 0) {
        arrayValues.push(dataKeyValue[keySchema.key]);
        schemasWithValue[schemasWithValue.findIndex((schema) => schema.key === keySchema.key)] = { ...keySchema, value: arrayValues };
      }
    } catch (error) {
      console.error(error);
    }
  }
  return decodeData(
    schemasWithValue.map(({ key, value }) => {
      return {
        keyName: key,
        value
        // no need to add dynamic key parts here as the schemas object below already holds the "generated" schemas for the dynamic keys
      };
    }),
    schemas
  );
};
var getData = async (erc725Options, _keyOrKeys) => {
  let keyOrKeys = _keyOrKeys;
  if (!keyOrKeys) {
    keyOrKeys = erc725Options.schemas.map((element) => element.name).filter((key) => !isDynamicKeyName(key));
  }
  if (Array.isArray(keyOrKeys)) {
    return getDataMultiple(erc725Options, keyOrKeys);
  }
  const data = await getDataMultiple(erc725Options, [keyOrKeys]);
  return data[0];
};
var INTERFACE_IDS_0_12_0 = {
  ERC1271: "0x1626ba7e",
  ERC725X: "0x7545acac",
  ERC725Y: "0x629aa694",
  LSP0ERC725Account: "0x24871b3d",
  LSP1UniversalReceiver: "0x6bb56a14",
  LSP1UniversalReceiverDelegate: "0xa245bbda",
  LSP6KeyManager: "0x23f34c62",
  LSP7DigitalAsset: "0xb3c4928f",
  LSP8IdentifiableDigitalAsset: "0x3a271706",
  LSP9Vault: "0x28af17e6",
  LSP11BasicSocialRecovery: "0x049a28f1",
  LSP14Ownable2Step: "0x94be5999",
  LSP17Extendable: "0xa918fa6b",
  LSP17Extension: "0xcee78b40",
  LSP20CallVerification: "0x1a0eb6a5",
  LSP20CallVerifier: "0x0d6ecac7",
  LSP25ExecuteRelayCall: "0x5ac79908"
};
var internalSupportsInterface = async (interfaceIdOrName, options) => {
  let plainInterfaceId;
  if (INTERFACE_IDS_0_12_0[interfaceIdOrName]) {
    plainInterfaceId = INTERFACE_IDS_0_12_0[interfaceIdOrName];
  } else {
    plainInterfaceId = interfaceIdOrName;
  }
  try {
    return await options.provider.supportsInterface(
      options.address,
      plainInterfaceId
    );
  } catch (error) {
    throw new Error(`Error checking the interface: ${error}`);
  }
};
function encodePermissions(permissions) {
  let basePermissions = BigInt(0);
  const keys = Object.keys(permissions).filter(
    (key) => key !== "ALL_PERMISSIONS"
  );
  keys.splice(0, 0, "ALL_PERMISSIONS");
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const permissionValue = hexToBigInt(LSP6_DEFAULT_PERMISSIONS[key], {});
    if (key in permissions) {
      if (permissions[key]) {
        basePermissions |= permissionValue;
      } else {
        basePermissions &= ~permissionValue;
      }
    }
  }
  return pad5(toHex5(basePermissions), { size: 32 });
}
function decodePermissions(permissionHex) {
  const result = {
    CHANGEOWNER: false,
    ADDCONTROLLER: false,
    EDITPERMISSIONS: false,
    ADDEXTENSIONS: false,
    CHANGEEXTENSIONS: false,
    ADDUNIVERSALRECEIVERDELEGATE: false,
    CHANGEUNIVERSALRECEIVERDELEGATE: false,
    REENTRANCY: false,
    SUPER_TRANSFERVALUE: false,
    TRANSFERVALUE: false,
    SUPER_CALL: false,
    CALL: false,
    SUPER_STATICCALL: false,
    STATICCALL: false,
    SUPER_DELEGATECALL: false,
    DELEGATECALL: false,
    DEPLOY: false,
    SUPER_SETDATA: false,
    SETDATA: false,
    ENCRYPT: false,
    DECRYPT: false,
    SIGN: false,
    EXECUTE_RELAY_CALL: false,
    ERC4337_PERMISSION: false,
    ALL_PERMISSIONS: false
  };
  const permissionsToTest = Object.keys(LSP6_DEFAULT_PERMISSIONS);
  const passedPermissionDecimal = permissionHex === "0x" ? 0n : hexToBigInt(permissionHex);
  for (let i = 0; i < permissionsToTest.length; i += 1) {
    const testPermission = permissionsToTest[i];
    const decimalTestPermission = hexToBigInt(
      LSP6_DEFAULT_PERMISSIONS[testPermission]
    );
    const isPermissionIncluded = (passedPermissionDecimal & decimalTestPermission) === decimalTestPermission;
    result[testPermission] = isPermissionIncluded;
  }
  return result;
}
function mapPermission(permission) {
  if (!LSP6_DEFAULT_PERMISSIONS[permission] && !isHex9(permission, { strict: true })) {
    return null;
  }
  return LSP6_DEFAULT_PERMISSIONS[permission] || permission;
}
var checkPermissions = (requiredPermissions, _grantedPermissions) => {
  let grantedPermissions = _grantedPermissions;
  if (grantedPermissions === "0x") {
    grantedPermissions = "0x0";
  }
  if (!isHex9(grantedPermissions, { strict: true })) {
    throw new Error(
      "Invalid grantedPermissions string. It must be a valid 32-byte hex string."
    );
  }
  const requiredPermissionArray = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];
  const mappedPermissionArray = requiredPermissionArray.map(mapPermission);
  return mappedPermissionArray.every(
    (requiredPermission, index) => {
      if (!requiredPermission) {
        throw new Error(
          `Invalid permission string: ${requiredPermissionArray[index]}. It must be a valid 32-byte hex string or a known permission name.`
        );
      }
      const requiredPermissionBigInt = BigInt(requiredPermission);
      const grantedPermissionsBigInt = BigInt(grantedPermissions);
      return (requiredPermissionBigInt & grantedPermissionsBigInt) === requiredPermissionBigInt;
    }
  );
};
function initializeProvider(providerOrRpcUrl, gasInfo) {
  if (!providerOrRpcUrl) return void 0;
  if (typeof providerOrRpcUrl === "string") {
    const client = createPublicClient({
      chain: lukso,
      transport: http(providerOrRpcUrl)
    });
    return new ProviderWrapper(client, gasInfo);
  }
  if (typeof providerOrRpcUrl.request === "function" || typeof providerOrRpcUrl.send === "function")
    return new ProviderWrapper(providerOrRpcUrl, gasInfo);
  throw new Error(`Incorrect or unsupported provider ${providerOrRpcUrl}`);
}
async function supportsInterface(interfaceIdOrName, options) {
  if (!isAddress4(options.address)) {
    throw new Error("Invalid address");
  }
  if (!options.rpcUrl) {
    throw new Error("Missing RPC URL");
  }
  return internalSupportsInterface(interfaceIdOrName, {
    address: options.address,
    provider: options.provider || initializeProvider(
      options.rpcUrl,
      options?.gas ? options?.gas : DEFAULT_GAS_VALUE
    )
  });
}
var ERC725 = class {
  options;
  /**
   * Creates an instance of ERC725.
   * @param {ERC725JSONSchema[]} schema More information available here: [LSP-2-ERC725YJSONSchema](https://github.com/lukso-network/LIPs/blob/master/LSPs/LSP-2-ERC725YJSONSchema.md)
   * @param {string} address Address of the ERC725 contract you want to interact with
   * @param {any} provider
   * @param {ERC725Config} config Configuration object.
   *
   */
  constructor(schemas, address, provider, config) {
    if (!schemas) {
      throw new Error("Missing schema.");
    }
    const defaultConfig = {
      ipfsGateway: "https://api.universalprofile.cloud/ipfs/",
      gas: DEFAULT_GAS_VALUE,
      throwSchemaErrors: false
    };
    const gas = config?.gas ? config?.gas : defaultConfig.gas;
    this.options = {
      schemas: this.validateSchemas(
        schemas.flatMap(
          (schema) => duplicateMultiTypeERC725SchemaEntry(schema)
        ),
        config?.throwSchemaErrors || defaultConfig.throwSchemaErrors
      ),
      address,
      provider: initializeProvider(provider, gas),
      ipfsFetch: config?.ipfsFetch,
      ipfsConvertUrl: config?.ipfsConvertUrl,
      ipfsGateway: config?.ipfsGateway ? convertIPFSGatewayUrl(config?.ipfsGateway) : defaultConfig.ipfsGateway,
      gas
    };
  }
  /**
   * To prevent weird behavior from the lib, we must make sure all the schemas are correct before loading them.
   *
   * @param schemas
   * @returns
   */
  // eslint-disable-next-line class-methods-use-this
  validateSchemas(schemas, doThrow) {
    return schemas.filter((schema) => {
      if (schema.valueContent === "AssetURL" || schema.valueContent === "JSONURL") {
        console.warn(
          `[Deprecation notice] The schema with keyName: ${schema.name} uses deprecated valueContent: ${schema.valueContent}. It has been replaced by VerifiableURI. Decoding is backward compatible but value will be encoded as VerifiableURI.`
        );
      }
      let isKeyValid = null;
      const segments = [];
      const errors = [];
      schema.name.replace(/<(.*?)>/g, (_, item) => {
        if (isKeyValid == null) {
          isKeyValid = true;
        }
        const valid = /bytes\d*|string|bool|address|u?int\d*/.test(item);
        if (!valid) {
          isKeyValid &&= valid;
          errors.push(`invalid dynamic key type: ${item} in name`);
        }
        segments.push(item);
        return "";
      });
      if (isKeyValid === true) {
        let index = 0;
        schema.key.replace(/<(.*?)>/g, (_, item) => {
          if (segments[index] !== item) {
            isKeyValid = false;
            errors.push(`dynamic ${segments[index]} != ${item} in key`);
          }
          index++;
          return "";
        });
      }
      let encodedKeyName = "";
      if (isKeyValid == null) {
        encodedKeyName = encodeKeyName(schema.name);
        if (schema.key !== encodedKeyName) {
          isKeyValid = false;
          errors.push(`key hash ${encodedKeyName} != ${schema.key}`);
        }
      }
      if (isKeyValid === false) {
        const message = `The schema with keyName: ${schema.name} is skipped because ${errors.join(", ")}`;
        if (doThrow) {
          throw new Error(message);
        }
        console.warn(message);
      }
      return isKeyValid !== false;
    });
  }
  getAddressAndProvider() {
    if (!this.options.address || !isAddress4(this.options.address)) {
      throw new Error("Missing ERC725 contract address.");
    }
    if (!this.options.provider) {
      throw new Error("Missing provider.");
    }
    return {
      address: this.options.address,
      provider: this.options.provider
    };
  }
  async getData(keyOrKeys) {
    this.getAddressAndProvider();
    return getData(this.options, keyOrKeys);
  }
  async fetchData(keyOrKeys) {
    let keyNames;
    if (Array.isArray(keyOrKeys)) {
      keyNames = keyOrKeys;
    } else if (!keyOrKeys) {
      keyNames = this.options.schemas.map((element) => element.name).filter((key) => !isDynamicKeyName(key));
    } else {
      keyNames = [keyOrKeys];
    }
    const dataFromChain = await this.getData(keyNames);
    const schemas = generateSchemasFromDynamicKeys(
      keyNames,
      this.options.schemas
    );
    const dataFromExternalSources = await getDataFromExternalSources(
      schemas,
      dataFromChain,
      this.options
    );
    if (keyOrKeys && !Array.isArray(keyOrKeys) && dataFromExternalSources.length > 0) {
      return dataFromExternalSources[0];
    }
    return dataFromExternalSources;
  }
  getSchema(keyOrKeys, providedSchemas) {
    return getSchema(keyOrKeys, providedSchemas || this.options.schemas);
  }
  /**
   * To be able to store your data on the blockchain, you need to encode it according to your {@link ERC725JSONSchema}.
   *
   * @param {{ [key: string]: any }} data An object with one or many properties, containing the data that needs to be encoded.
   * @param schemas Additionnal ERC725JSONSchemas which will be concatenated with the schemas provided on init.
   *
   * @returns An object with hashed keys and encoded values.
   *
   * When encoding JSON it is possible to pass in the JSON object and the URL where it is available publicly.
   * The JSON will be hashed with `keccak256`.
   */
  encodeData(data, schemas) {
    return encodeData(data, schemas || this.options.schemas);
  }
  /**
   * To be able to store your data on the blockchain, you need to encode it according to your {@link ERC725JSONSchema}.
   *
   * @param {{ [key: string]: any }} data An object with one or many properties, containing the data that needs to be encoded.
   * @param schemas ERC725JSONSchemas which will be used to encode the keys.
   *
   * @returns An object with hashed keys and encoded values.
   *
   * When encoding JSON it is possible to pass in the JSON object and the URL where it is available publicly.
   * The JSON will be hashed with `keccak256`.
   */
  static encodeData(data, schemas) {
    return encodeData(data, schemas);
  }
  /**
   * In case you are reading the key-value store from an ERC725 smart-contract key-value store
   * without `@erc725/erc725.js` you can use `decodeData` to do the decoding for you.
   *
   * It is more convenient to use {@link ERC725.fetchData | `fetchData`}.
   * It does the `decoding` and `fetching` of external references for you automatically.
   *
   * @param {{ [key: string]: any }} data An object with one or many properties.
   * @param schemas ERC725JSONSchemas which will be used to encode the keys.
   *
   * @returns Returns decoded data as defined and expected in the schema:
   */
  decodeData(data, schemas, throwExceptions = false) {
    return decodeData(data, schemas || this.options.schemas, throwExceptions);
  }
  /**
   * In case you are reading the key-value store from an ERC725 smart-contract key-value store
   * without `@erc725/erc725.js` you can use `decodeData` to do the decoding for you.
   *
   * It is more convenient to use {@link ERC725.fetchData | `fetchData`}.
   * It does the `decoding` and `fetching` of external references for you automatically.
   *
   * @param {{ [key: string]: any }} data An object with one or many properties.
   * @param schemas ERC725JSONSchemas which will be used to encode the keys.
   *
   * @returns Returns decoded data as defined and expected in the schema:
   */
  static decodeData(data, schemas, throwExceptions = false) {
    return decodeData(data, schemas, throwExceptions);
  }
  /**
   * An added utility method which simply returns the owner of the contract.
   * Not directly related to ERC725 specifications.
   *
   * @param {string} [address]
   * @returns The address of the contract owner as stored in the contract.
   *
   *    This method is not yet supported when using the `graph` provider type.
   *
   * ```javascript title="Example"
   * await myERC725.getOwner();
   * // '0x94933413384997F9402cc07a650e8A34d60F437A'
   *
   * await myERC725.getOwner("0x3000783905Cc7170cCCe49a4112Deda952DDBe24");
   * // '0x7f1b797b2Ba023Da2482654b50724e92EB5a7091'
   * ```
   */
  async getOwner(_address) {
    const { address, provider } = this.getAddressAndProvider();
    return provider.getOwner(_address || address);
  }
  /**
   * A helper function which checks if a signature is valid according to the EIP-1271 standard.
   *
   * @param messageOrHash if it is a 66 chars string with 0x prefix, it will be considered as a hash (keccak256). If not, the message will be wrapped as follows: "\x19Ethereum Signed Message:\n" + message.length + message and hashed.
   * @param signature
   * @returns true if isValidSignature call on the contract returns the magic value. false otherwise
   */
  async isValidSignature(messageOrHash, signature) {
    if (!this.options.address || !isAddress4(this.options.address)) {
      throw new Error("Missing ERC725 contract address.");
    }
    if (!this.options.provider) {
      throw new Error("Missing provider.");
    }
    return isValidSignature(
      messageOrHash,
      signature,
      this.options.address,
      this.options.provider
    );
  }
  /**
   * Hashes a key name for use on an ERC725Y contract according to LSP2 ERC725Y JSONSchema standard.
   *
   * @param {string} keyName The key name you want to encode.
   * @param {DynamicKeyParts} dynamicKeyParts String or Array of String values used to construct the key.
   * @link https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-2-ERC725YJSONSchema.md ERC725YJsonSchema standard.
   * @returns {string} The keccak256 hash of the provided key name. This is the key that must be retrievable from the ERC725Y contract via ERC725Y.getData(bytes32 key).
   */
  static encodeKeyName(keyName, dynamicKeyParts) {
    return encodeKeyName(keyName, dynamicKeyParts);
  }
  /**
   * Hashes a key name for use on an ERC725Y contract according to LSP2 ERC725Y JSONSchema standard.
   *
   * @param {string} keyName The key name you want to encode.
   * @param {DynamicKeyParts} dynamicKeyParts String or Array of String values used to construct the key.
   * @link https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-2-ERC725YJSONSchema.md ERC725YJsonSchema standard.
   * @returns {string} The keccak256 hash of the provided key name. This is the key that must be retrievable from the ERC725Y contract via ERC725Y.getData(bytes32 key).
   */
  encodeKeyName(keyName, dynamicKeyParts) {
    return encodeKeyName(keyName, dynamicKeyParts);
  }
  /**
   * Decodes a hashed key used on an ERC725Y contract according to LSP2 ERC725Y JSONSchema standard.
   *
   * @param {string} keyHash Key hash that needs to be decoded.
   * @param {string | ERC725JSONSchema} keyNameOrSchema Key name following schema specifications or ERC725Y JSON Schema to follow in order to decode the key.
   * @link https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-2-ERC725YJSONSchema.md ERC725YJsonSchema standard.
   * @returns {DynamicKeyPart[]} The Array with all the key decoded dynamic parameters. Each object have an attribute type and value.
   */
  static decodeMappingKey(keyHash, keyNameOrSchema) {
    return decodeMappingKey(keyHash, keyNameOrSchema);
  }
  /**
   * Decodes a hashed key used on an ERC725Y contract according to LSP2 ERC725Y JSONSchema standard.
   *
   * @param {string} keyHash Key hash that needs to be decoded.
   * @param {string | ERC725JSONSchema} keyNameOrSchema Key name following schema specifications or ERC725Y JSON Schema to follow in order to decode the key.
   * @link https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-2-ERC725YJSONSchema.md ERC725YJsonSchema standard.
   * @returns {DynamicKeyPart[]} The Array with all the key decoded dynamic parameters. Each object have an attribute type and value.
   */
  decodeMappingKey(keyHash, keyNameOrSchema) {
    return decodeMappingKey(keyHash, keyNameOrSchema);
  }
  /**
   * Check if the ERC725 object supports
   * a certain interface.
   *
   * @param interfaceIdOrName Interface ID or supported interface name.
   * @returns {Promise<boolean>} if interface is supported.
   */
  async supportsInterface(interfaceIdOrName) {
    const { address, provider } = this.getAddressAndProvider();
    return internalSupportsInterface(interfaceIdOrName, {
      address,
      provider
    });
  }
  /**
   * Check if a smart contract address
   * supports a certain interface.
   *
   * @param {string} interfaceIdOrName Interface ID or supported interface name.
   * @param options Object of address, RPC URL and optional gas.
   * @returns {Promise<boolean>} if interface is supported.
   */
  static async supportsInterface(interfaceIdOrName, options) {
    return supportsInterface(interfaceIdOrName, options);
  }
  // Permissions related functions
  // -----------------------------
  /**
   * Encode permissions into a hexadecimal string as defined by the LSP6 KeyManager Standard.
   *
   * @link https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-6-KeyManager.md LSP6 KeyManager Standard.
   * @param permissions The permissions you want to specify to be included or excluded. Any ommitted permissions will default to false.
   * @returns {*} The permissions encoded as a hexadecimal string as defined by the LSP6 Standard.
   */
  static encodePermissions(permissions) {
    return encodePermissions(permissions);
  }
  /**
   * Encode permissions into a hexadecimal string as defined by the LSP6 KeyManager Standard.
   *
   * @link https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-6-KeyManager.md LSP6 KeyManager Standard.
   * @param permissions The permissions you want to specify to be included or excluded. Any ommitted permissions will default to false.
   * @returns {*} The permissions encoded as a hexadecimal string as defined by the LSP6 Standard.
   */
  encodePermissions(permissions) {
    return encodePermissions(permissions);
  }
  /**
   * Decodes permissions from hexadecimal as defined by the LSP6 KeyManager Standard.
   *
   * @link https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-6-KeyManager.md LSP6 KeyManager Standard.
   * @param permissionHex The permission hexadecimal value to be decoded.
   * @returns Object specifying whether default LSP6 permissions are included in provided hexademical string.
   */
  static decodePermissions(permissionHex) {
    return decodePermissions(permissionHex);
  }
  /**
   * Decodes permissions from hexadecimal as defined by the LSP6 KeyManager Standard.
   *
   * @link https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-6-KeyManager.md LSP6 KeyManager Standard.
   * @param permissionHex The permission hexadecimal value to be decoded.
   * @returns Object specifying whether default LSP6 permissions are included in provided hexademical string.
   */
  decodePermissions(permissionHex) {
    return decodePermissions(permissionHex);
  }
  /**
   * Check if the required permissions are included in the granted permissions as defined by the LSP6 KeyManager Standard.
   *
   * @link https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-6-KeyManager.md LSP6 KeyManager Standard.
   * @param requiredPermissions An array of required permissions or a single required permission.
   * @param grantedPermissions The granted permissions as a 32-byte hex string.
   * @return A boolean value indicating whether the required permissions are included in the granted permissions.
   */
  static checkPermissions(requiredPermissions, grantedPermissions) {
    return checkPermissions(requiredPermissions, grantedPermissions);
  }
  /**
   * Check if the required permissions are included in the granted permissions as defined by the LSP6 KeyManager Standard.
   *
   * @link https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-6-KeyManager.md LSP6 KeyManager Standard.
   * @param requiredPermissions An array of required permissions or a single required permission.
   * @param grantedPermissions The granted permissions as a 32-byte hex string.
   * @return A boolean value indicating whether the required permissions are included in the granted permissions.
   */
  checkPermissions(requiredPermissions, grantedPermissions) {
    return checkPermissions(requiredPermissions, grantedPermissions);
  }
  static mapPermission(permission) {
    return mapPermission(permission);
  }
  mapPermission(permission) {
    return mapPermission(permission);
  }
  // Encoding methods
  // ----------------
  /**
   * @param type The valueType to encode the value as
   * @param value The value to encode
   * @returns The encoded value
   */
  static encodeValueType(type, value) {
    return encodeValueType(type, value);
  }
  encodeValueType(type, value) {
    return encodeValueType(type, value);
  }
  /**
   * @param type The valueType to decode the value as
   * @param data The data to decode
   * @returns The decoded value
   */
  static decodeValueType(type, data) {
    return decodeValueType(type, data);
  }
  decodeValueType(type, data) {
    return decodeValueType(type, data);
  }
  static encodeValueContent(valueContent, value) {
    return encodeValueContent(valueContent, value);
  }
  encodeValueContent(valueContent, value) {
    return encodeValueContent(valueContent, value);
  }
  static decodeValueContent(valueContent, value) {
    return decodeValueContent(valueContent, value);
  }
  decodeValueContent(valueContent, value) {
    return decodeValueContent(valueContent, value);
  }
  // External Data Source utilities (`VerifiableURI` and `JSONURI`)
  // ----------------------------------------------------------------
  encodeDataSourceWithHash(verification, dataSource) {
    return encodeDataSourceWithHash(verification, dataSource);
  }
  static encodeDataSourceWithHash(verification, dataSource) {
    return encodeDataSourceWithHash(verification, dataSource);
  }
  decodeDataSourceWithHash(value) {
    return decodeDataSourceWithHash(value);
  }
  static decodeDataSourceWithHash(value) {
    return decodeDataSourceWithHash(value);
  }
  static getVerificationMethod(nameOrSig) {
    return getVerificationMethod(nameOrSig);
  }
  getVerificationMethod(nameOrSig) {
    return getVerificationMethod(nameOrSig);
  }
  static isDataAuthentic(data, verificationOptions) {
    return isDataAuthentic(data, verificationOptions);
  }
  isDataAuthentic(data, verificationOptions) {
    return isDataAuthentic(data, verificationOptions);
  }
};
var index_default = ERC725;
export {
  ERC725,
  LSP10Schema,
  LSP12Schema,
  LSP17Schema,
  LSP1Schema,
  LSP3Schema,
  LSP4LegacySchema,
  LSP4Schema,
  LSP5Schema,
  LSP6Schema,
  LSP8Schema,
  LSP9Schema,
  SUPPORTED_VERIFICATION_METHOD_STRINGS,
  checkPermissions,
  decodeData,
  decodeDataSourceWithHash,
  decodeMappingKey,
  decodePermissions,
  decodeValueContent,
  decodeValueType,
  index_default as default,
  encodeArrayKey,
  encodeData,
  encodeDataSourceWithHash,
  encodeKeyName,
  encodePermissions,
  encodeValueContent,
  encodeValueType,
  getDataFromExternalSources,
  getSchema,
  getVerificationMethod,
  isDataAuthentic,
  isDynamicKeyName,
  mapPermission,
  patchIPFSUrlsIfApplicable,
  supportsInterface
};
