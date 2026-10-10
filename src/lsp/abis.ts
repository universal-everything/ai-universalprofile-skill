// Small human-readable ABI fragments for the hot paths. Each fragment is checked
// against the bundled upstream ABIs (assets/abis/lsp/*.json) in
// test/unit/lsp/abis.test.ts so a typo can never silently change a selector.
import { parseAbi } from "viem";

export const UP_ABI = parseAbi([
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function VERSION() view returns (string)",
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
  "function getData(bytes32 dataKey) view returns (bytes)",
  "function getDataBatch(bytes32[] dataKeys) view returns (bytes[])",
  "function setData(bytes32 dataKey, bytes dataValue) payable",
  "function setDataBatch(bytes32[] dataKeys, bytes[] dataValues) payable",
  "function execute(uint256 operationType, address target, uint256 value, bytes data) payable returns (bytes)",
  "function executeBatch(uint256[] operationsType, address[] targets, uint256[] values, bytes[] datas) payable returns (bytes[])",
  "function transferOwnership(address newOwner)",
  "function acceptOwnership()",
  "function renounceOwnership()",
  "function isValidSignature(bytes32 dataHash, bytes signature) view returns (bytes4)",
  "function batchCalls(bytes[] data) returns (bytes[] results)",
  "function RENOUNCE_OWNERSHIP_CONFIRMATION_DELAY() view returns (uint256)",
  "function RENOUNCE_OWNERSHIP_CONFIRMATION_PERIOD() view returns (uint256)",
  "event DataChanged(bytes32 indexed dataKey, bytes dataValue)",
  "event Executed(uint256 indexed operationType, address indexed target, uint256 value, bytes4 indexed selector)",
  "event ContractCreated(uint256 indexed operationType, address indexed contractAddress, uint256 value, bytes32 indexed salt)",
  "event UniversalReceiver(address indexed from, uint256 indexed value, bytes32 indexed typeId, bytes receivedData, bytes returnedValue)",
  "event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner)",
  "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)",
  "event RenounceOwnershipStarted()",
  "event OwnershipRenounced()",
]);

export const KM_ABI = parseAbi([
  "function target() view returns (address)",
  "function VERSION() view returns (string)",
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
  "function getNonce(address from, uint128 channelId) view returns (uint256)",
  "function execute(bytes payload) payable returns (bytes)",
  "function executeBatch(uint256[] values, bytes[] payloads) payable returns (bytes[])",
  "function executeRelayCall(bytes signature, uint256 nonce, uint256 validityTimestamps, bytes payload) payable returns (bytes)",
  "function executeRelayCallBatch(bytes[] signatures, uint256[] nonces, uint256[] validityTimestamps, uint256[] values, bytes[] payloads) payable returns (bytes[])",
  "function isValidSignature(bytes32 dataHash, bytes signature) view returns (bytes4)",
  "function lsp20VerifyCall(address requestor, address targetContract, address caller, uint256 value, bytes callData) returns (bytes4)",
  "event PermissionsVerified(address indexed signer, uint256 indexed value, bytes4 indexed selector)",
]);

export const LSP23_ABI = parseAbi([
  "struct PrimaryContractDeploymentInit { bytes32 salt; uint256 fundingAmount; address implementationContract; bytes initializationCalldata; }",
  "struct SecondaryContractDeploymentInit { uint256 fundingAmount; address implementationContract; bytes initializationCalldata; bool addPrimaryContractAddress; bytes extraInitializationParams; }",
  "function deployERC1167Proxies(PrimaryContractDeploymentInit primaryContractDeploymentInit, SecondaryContractDeploymentInit secondaryContractDeploymentInit, address postDeploymentModule, bytes postDeploymentModuleCalldata) payable returns (address primaryContractAddress, address secondaryContractAddress)",
  "function computeERC1167Addresses(PrimaryContractDeploymentInit primaryContractDeploymentInit, SecondaryContractDeploymentInit secondaryContractDeploymentInit, address postDeploymentModule, bytes postDeploymentModuleCalldata) view returns (address primaryContractAddress, address secondaryContractAddress)",
  "event DeployedERC1167Proxies(address indexed primaryContract, address indexed secondaryContract, PrimaryContractDeploymentInit primaryContractDeploymentInit, SecondaryContractDeploymentInit secondaryContractDeploymentInit, address postDeploymentModule, bytes postDeploymentModuleCalldata)",
]);

export const UP_INIT_ABI = parseAbi(["function initialize(address newOwner) payable"]);
export const KM_INIT_ABI = parseAbi(["function initialize(address target_)"]);

export const POST_DEPLOYMENT_MODULE_ABI = parseAbi([
  "function setDataAndTransferOwnership(bytes32[] dataKeys, bytes[] dataValues, address newOwner) payable",
  "function executePostDeployment(address universalProfile, address keyManager, bytes setDataBatchBytes)",
]);

export const ERC165_ABI = parseAbi(["function supportsInterface(bytes4 interfaceId) view returns (bool)"]);
export const ERC1271_ABI = parseAbi(["function isValidSignature(bytes32 dataHash, bytes signature) view returns (bytes4)"]);
