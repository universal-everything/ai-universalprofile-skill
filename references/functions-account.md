# Function inventory: account stack

Every external function of the LUKSO account-stack packages (LSP0, LSP1 + delegates, LSP6, LSP9, LSP11, LSP14, LSP16, LSP17 extensions, LSP20, LSP23, LSP25, Universal Profile presets) and the `@erc725/smart-contracts` base, with selector, mutability and how the skill reaches it. Use it to identify a selector, to check what a contract can do before calling it, and to pick the right verb. Token packages (LSP4/7/8/26) and reference ERCs are in `references/functions-tokens.md`; the per-signature binding table is `references/functions-bindings.md`.

Provenance: generated from compiled ABIs of [lsp-smart-contracts](https://github.com/lukso-network/lsp-smart-contracts) (ABI surface identical to upstream main `16ab2441a79c34da56386c30caa00c33379ce06f`, 2026-10-03), every selector computed with keccak-256 and cross-checked against solc `evm.methodIdentifiers` (509 entries, 0 mismatches). Events and errors are listed separately and are never counted as functions. This is a static inventory: confirm what a deployed contract really is (`abi fetch`, `account info`) before acting on it.

Binding legend: **verb** = dedicated `up` command (CLI) / `up_*` tool (MCP) — see `references/verbs.md` for the exact flags; **generic** = reachable with `abi encode` + `exec send`/`contract call` (no dedicated verb); **internal** = used inside the skill's own flows; **knowledge** = documented, not invoked. Mutability `view`/`pure` = read with `contract read`/`exec call`; `nonpayable`/`payable` = a transaction executed *as the profile*.

## Totals per package

| Package | npm latest | Upstream main | Unique signatures | Events | Errors |
| --- | --- | --- | --- | --- | --- |
| lsp0-contracts | 0.16.3 | 0.16.3 | 19 | 9 | 19 |
| lsp1-contracts | 0.16.3 | 0.16.3 | 2 | 1 | 0 |
| lsp1delegate-contracts | 0.16.3 | 0.16.3 | 3 | 0 | 1 |
| lsp2-contracts | 0.16.2 | 0.16.2 | 0 | 0 | 0 |
| lsp3-contracts | 0.17.3 | 0.17.3 | 0 | 0 | 0 |
| lsp5-contracts | 0.16.3 | 0.16.3 | 0 | 0 | 0 |
| lsp6-contracts | 0.16.3 | 0.16.3 | 12 | 2 | 27 |
| lsp9-contracts | 0.16.3 | 0.16.3 | 18 | 9 | 17 |
| lsp10-contracts | 0.16.3 | 0.16.3 | 0 | 0 | 0 |
| lsp11-contracts | 0.1.7 | 0.2.3 | 27 | 9 | 24 |
| lsp12-contracts | 0.16.3 | 0.16.3 | 0 | 0 | 0 |
| lsp14-contracts | 0.16.3 | 0.16.3 | 7 | 4 | 5 |
| lsp16-contracts | 0.16.2 | 0.16.2 | 7 | 1 | 2 |
| lsp17-contracts | 0.17.3 | 0.17.3 | 10 | 0 | 0 |
| lsp17contractextension-contracts | 0.17.2 | 0.17.2 | 2 | 1 | 0 |
| lsp20-contracts | 0.16.2 | 0.16.2 | 2 | 0 | 0 |
| lsp23-contracts | 0.16.3 | 0.16.3 | 25 | 11 | 22 |
| lsp25-contracts | 0.15.5 | 0.16.2 | 3 | 0 | 0 |
| universalprofile-contracts | 0.15.5 | 0.16.3 | 19 | 9 | 19 |
| lsp-smart-contracts | 0.17.4 | 0.17.4 | 0 | 0 | 0 |
| @erc725/smart-contracts | 8.0.1 | n/a | 11 | 5 | 14 |

**Global unique external signatures across all packages above (non-mock, incl. @erc725): 71.** Global overloads (same name, different signature): `execute` → `execute(bytes)`, `execute(uint256,address,uint256,bytes)`; `executeBatch` → `executeBatch(uint256[],address[],uint256[],bytes[])`, `executeBatch(uint256[],bytes[])`.

Packages with **zero deployable contracts**: lsp1-contracts (interfaces + library), lsp2-contracts (library + 1 mock), lsp3-contracts (no artifacts at all; TS types + data keys), lsp5-contracts (library), lsp10-contracts (library), lsp12-contracts (no artifacts at all; data keys), lsp14-contracts (abstract + interface), lsp17contractextension-contracts (abstracts + library), lsp20-contracts (abstract + interface), lsp25-contracts (abstract + interface + 1 mock), lsp-smart-contracts umbrella (re-export shims + 95 mocks).

## All unique signatures (71)

| Selector | Signature | Mutability | Defined by | Binding |
| --- | --- | --- | --- | --- |
| 0x79ba5097 | `acceptOwnership()` | nonpayable | ILSP14Ownable2Step | verb `ownership accept` |
| 0xc6845210 | `addGuardian(address,address)` | nonpayable | ILSP11SocialRecovery | generic (LSP11 is not deployed with a UP by default) |
| 0x6963d438 | `batchCalls(bytes[])` | nonpayable | ILSP0ERC725Account | verb `exec batch` (via lsp0) (advanced) |
| 0x1ce59666 | `cancelRecoveryProcess(address)` | nonpayable | ILSP11SocialRecovery | generic |
| 0xb79336ee | `COMMITMEMT_DELAY()` | view | LSP11SocialRecovery | generic |
| 0xa9e3b276 | `commitToRecover(address,address,bytes32)` | nonpayable | ILSP11SocialRecovery | generic |
| 0x3b315680 | `computeAddress(bytes32,bytes32,bool,bytes)` | view | LSP16UniversalFactory | knowledge |
| 0xdd5940f3 | `computeAddresses((bytes32,uint256,bytes),(uint256,bytes,bool,bytes),address,bytes)` | view | ILSP23LinkedContractsFactory | internal (`account precompute` (mode full)) |
| 0xe888edcb | `computeERC1167Address(address,bytes32,bool,bytes)` | view | LSP16UniversalFactory | knowledge |
| 0x72b19d36 | `computeERC1167Addresses((bytes32,uint256,address,bytes),(uint256,address,bytes,bool,bytes),address,bytes)` | view | ILSP23LinkedContractsFactory | verb `account precompute` |
| 0x8bc0ab75 | `DEFAULT_RECOVERY_DELAY()` | view | LSP11SocialRecovery | generic |
| 0x754b86b5 | `deployContracts((bytes32,uint256,bytes),(uint256,bytes,bool,bytes),address,bytes)` | payable | ILSP23LinkedContractsFactory | verb `account deploy` (mode full) |
| 0x26736355 | `deployCreate2(bytes,bytes32)` | payable | LSP16UniversalFactory | generic |
| 0xcdbd473a | `deployCreate2AndInitialize(bytes,bytes32,bytes,uint256,uint256)` | payable | LSP16UniversalFactory | generic |
| 0x6a66a753 | `deployERC1167Proxies((bytes32,uint256,address,bytes),(uint256,address,bytes,bool,bytes),address,bytes)` | payable | ILSP23LinkedContractsFactory | verb `account deploy` (default) |
| 0x49d8abed | `deployERC1167Proxy(address,bytes32)` | nonpayable | LSP16UniversalFactory | generic |
| 0x5340165f | `deployERC1167ProxyAndInitialize(address,bytes32,bytes)` | payable | LSP16UniversalFactory | generic |
| 0xb0d691fe | `entryPoint()` | view | Extension4337 | verb `account info` (4337 section) |
| 0x09c5eabe | `execute(bytes)` | payable | ILSP6KeyManager | verb `exec send` (direct KM path) |
| 0x44c028fe | `execute(uint256,address,uint256,bytes)` | payable | IERC725X | verb `exec send` (via lsp0) + payload builder for all paths |
| 0x31858452 | `executeBatch(uint256[],address[],uint256[],bytes[])` | payable | IERC725X | verb `exec batch` (via lsp0) |
| 0xbf0176ff | `executeBatch(uint256[],bytes[])` | payable | ILSP6KeyManager | verb `exec batch` (KM) |
| 0x28c4d14e | `executePostDeployment(address,address,bytes)` | nonpayable | IPostDeploymentModule | internal (called by factory) |
| 0x4c8a4e74 | `executeRelayCall(bytes,uint256,uint256,bytes)` | payable | ILSP25ExecuteRelayCall | verb `exec relay` |
| 0xa20856a5 | `executeRelayCallBatch(bytes[],uint256[],uint256[],uint256[],bytes[])` | payable | ILSP25ExecuteRelayCall | verb `exec relay` (batch) |
| 0x1a17ccbf | `generateSalt(bytes32,bool,bytes)` | pure | LSP16UniversalFactory | knowledge |
| 0x6289a163 | `getCommitmentInfoOf(address,uint256,address)` | view | ILSP11SocialRecovery | generic |
| 0x54f6127f | `getData(bytes32)` | view | IERC725Y | verb `account data get` |
| 0xdedff9c6 | `getDataBatch(bytes32[])` | view | IERC725Y | verb `account data get` (multi) |
| 0x88095527 | `getFirstRecoveryTimestampOf(address,uint256)` | view | ILSP11SocialRecovery | generic |
| 0x8ca4aaaf | `getGuardiansOf(address)` | view | ILSP11SocialRecovery | generic |
| 0xdbd119bd | `getGuardiansThresholdOf(address)` | view | ILSP11SocialRecovery | generic |
| 0xb44581d9 | `getNonce(address,uint128)` | view | ILSP25ExecuteRelayCall | verb `nonce` (+ internal) |
| 0xcee79d45 | `getRecoveryCounterOf(address)` | view | ILSP11SocialRecovery | generic |
| 0x02543bff | `getRecoveryDelayOf(address)` | view | ILSP11SocialRecovery | generic |
| 0x06fe1738 | `getSecretHashOf(address)` | view | ILSP11SocialRecovery | generic |
| 0x506d1a0f | `getVotedAddressByGuardian(address,uint256,address)` | view | ILSP11SocialRecovery | generic |
| 0xa65068b6 | `getVotesOfGuardianVotedAddress(address,uint256,address)` | view | ILSP11SocialRecovery | generic |
| 0xd617b890 | `hasReachedThreshold(address,uint256,address)` | view | ILSP11SocialRecovery | generic |
| 0xc4d66de8 | `initialize(address)` | payable | LSP0ERC725AccountInit | internal (proxy init via LSP23 calldata) |
| 0x769e54df | `isGuardianOf(address,address)` | view | ILSP11SocialRecovery | generic |
| 0x1626ba7e | `isValidSignature(bytes32,bytes)` | view | IERC1271 | verb `verify-1271`; internal for CoW/x402/off-chain auth |
| 0xde928f14 | `lsp20VerifyCall(address,address,address,uint256,bytes)` | nonpayable | ILSP20CallVerifier | internal (dry-run permission checks; 4337 validation) |
| 0xd3fc45d3 | `lsp20VerifyCallResult(bytes32,bytes)` | nonpayable | ILSP20CallVerifier | internal |
| 0x06fdde03 | `name()` | view | ERC20MetadataCompatibilityExtension | knowledge |
| 0xbc197c81 | `onERC1155BatchReceived(address,address,uint256[],uint256[],bytes)` | nonpayable | IERC1155Receiver | internal check (`token transfer` warns if missing) |
| 0xf23a6e61 | `onERC1155Received(address,address,uint256,uint256,bytes)` | nonpayable | IERC1155Receiver | internal check (`token transfer` warns if missing) |
| 0x150b7a02 | `onERC721Received(address,address,uint256,bytes)` | nonpayable | IERC721Receiver | internal check (`token transfer` warns if missing) |
| 0x8da5cb5b | `owner()` | view | OwnableUnset | verb `account info` |
| 0xe30c3978 | `pendingOwner()` | view | ILSP14Ownable2Step | verb `account info` |
| 0xf3b3c785 | `recoverAccess(address,address,bytes32,bytes32,bytes)` | payable | ILSP11SocialRecovery | generic |
| 0x9b27a90e | `removeGuardian(address,address)` | nonpayable | ILSP11SocialRecovery | generic |
| 0xead3fbdf | `RENOUNCE_OWNERSHIP_CONFIRMATION_DELAY()` | view | LSP14Ownable2Step | knowledge |
| 0x01bfba61 | `RENOUNCE_OWNERSHIP_CONFIRMATION_PERIOD()` | view | LSP14Ownable2Step | knowledge |
| 0x715018a6 | `renounceOwnership()` | nonpayable | ILSP14Ownable2Step | verb `ownership renounce` (double confirmation) |
| 0x7f23690c | `setData(bytes32,bytes)` | payable | IERC725Y | verb `account data set` (+ permission/controller/extension/URD verbs) |
| 0x4f04d60a | `setDataAndTransferOwnership(bytes32[],bytes[],address)` | payable | UniversalProfileInitPostDeploymentModule | internal (deployment calldata) |
| 0x97902421 | `setDataBatch(bytes32[],bytes[])` | payable | IERC725Y | verb `account data set` (multi), `controller add/edit/remove` |
| 0x639cea19 | `setGuardiansThreshold(address,uint256)` | nonpayable | ILSP11SocialRecovery | generic |
| 0xa219b404 | `setRecoveryDelay(address,uint256)` | nonpayable | ILSP11SocialRecovery | generic |
| 0x78f84ebd | `setRecoverySecretHash(address,bytes32)` | nonpayable | ILSP11SocialRecovery | generic |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view | IERC165 | internal (`abi fetch`, token standard detection) |
| 0x95d89b41 | `symbol()` | view | ERC20MetadataCompatibilityExtension | knowledge |
| 0xd4b83992 | `target()` | view | ILSP6KeyManager | verb `account info` (KM → UP link check) |
| 0x0023de29 | `tokensReceived(address,address,address,uint256,bytes,bytes)` | nonpayable | IERC777Recipient | knowledge |
| 0xf2fde38b | `transferOwnership(address)` | nonpayable | ILSP14Ownable2Step | verb `ownership transfer` |
| 0x6bb56a14 | `universalReceiver(bytes32,bytes)` | payable | ILSP1UniversalReceiver | generic; internal for LSP5 bookkeeping tests |
| 0xa245bbda | `universalReceiverDelegate(address,uint256,bytes32,bytes)` | nonpayable | ILSP1UniversalReceiverDelegate | knowledge (called by the UP) |
| 0x3a871cdd | `validateUserOp((address,uint256,bytes,bytes,uint256,uint256,uint256,uint256,uint256,bytes,bytes),bytes32,uint256)` | nonpayable | IAccount | internal (`exec userop`; registration via `account 4337 enable`) |
| 0xffa1ad74 | `VERSION()` | view | Version | verb `account info` |
| 0xfa04a7f1 | `voteForRecovery(address,address,address)` | nonpayable | ILSP11SocialRecovery | generic |

## lsp0-contracts

npm `@lukso/lsp0-contracts` latest 0.16.3; upstream main 0.16.3.

| Contract | Kind | Functions | Events | Errors | fallback / receive |
| --- | --- | --- | --- | --- | --- |
| ILSP0ERC725Account | interface | 1 | 0 | 0 | - / - |
| LSP0ERC725Account | deployable | 18 | 8 | 19 | fallback(payable) / receive |
| LSP0ERC725AccountCore | abstract | 17 | 8 | 19 | fallback(payable) / receive |
| LSP0ERC725AccountInit | init | 19 | 9 | 19 | fallback(payable) / receive |
| LSP0ERC725AccountInitAbstract | abstract | 17 | 9 | 19 | fallback(payable) / receive |
| Version | abstract | 1 | 0 | 0 | - / - |

### ILSP0ERC725Account (interface)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x6963d438 | `batchCalls(bytes[])` | nonpayable |

### LSP0ERC725Account (deployable)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x79ba5097 | `acceptOwnership()` | nonpayable |
| 0x6963d438 | `batchCalls(bytes[])` | nonpayable |
| 0x44c028fe | `execute(uint256,address,uint256,bytes)` | payable |
| 0x31858452 | `executeBatch(uint256[],address[],uint256[],bytes[])` | payable |
| 0x54f6127f | `getData(bytes32)` | view |
| 0xdedff9c6 | `getDataBatch(bytes32[])` | view |
| 0x1626ba7e | `isValidSignature(bytes32,bytes)` | view |
| 0x8da5cb5b | `owner()` | view |
| 0xe30c3978 | `pendingOwner()` | view |
| 0xead3fbdf | `RENOUNCE_OWNERSHIP_CONFIRMATION_DELAY()` | view |
| 0x01bfba61 | `RENOUNCE_OWNERSHIP_CONFIRMATION_PERIOD()` | view |
| 0x715018a6 | `renounceOwnership()` | nonpayable |
| 0x7f23690c | `setData(bytes32,bytes)` | payable |
| 0x97902421 | `setDataBatch(bytes32[],bytes[])` | payable |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view |
| 0xf2fde38b | `transferOwnership(address)` | nonpayable |
| 0x6bb56a14 | `universalReceiver(bytes32,bytes)` | payable |
| 0xffa1ad74 | `VERSION()` | view |

Events: `ContractCreated(uint256,address,uint256,bytes32)`, `DataChanged(bytes32,bytes)`, `Executed(uint256,address,uint256,bytes4)`, `OwnershipRenounced()`, `OwnershipTransferStarted(address,address)`, `OwnershipTransferred(address,address)`, `RenounceOwnershipStarted()`, `UniversalReceiver(address,uint256,bytes32,bytes,bytes)`

Errors: `ERC725X_ContractDeploymentFailed()`, `ERC725X_CreateOperationsRequireEmptyRecipientAddress()`, `ERC725X_ExecuteParametersEmptyArray()`, `ERC725X_ExecuteParametersLengthMismatch()`, `ERC725X_InsufficientBalance(uint256,uint256)`, `ERC725X_MsgValueDisallowedInDelegateCall()`, `ERC725X_MsgValueDisallowedInStaticCall()`, `ERC725X_NoContractBytecodeProvided()`, `ERC725X_UnknownOperationType(uint256)`, `ERC725Y_DataKeysValuesEmptyArray()`, `ERC725Y_DataKeysValuesLengthMismatch()`, `LSP14CallerNotPendingOwner(address)`, `LSP14CannotTransferOwnershipToSelf()`, `LSP14MustAcceptOwnershipInSeparateTransaction()`, `LSP14NotInRenounceOwnershipInterval(uint256,uint256)`, `LSP20CallVerificationFailed(bool,bytes4)`, `LSP20CallingVerifierFailed(bool)`, `LSP20EOACannotVerifyCall(address)`, `NoExtensionFoundForFunctionSelector(bytes4)`

### LSP0ERC725AccountInit (init)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x79ba5097 | `acceptOwnership()` | nonpayable |
| 0x6963d438 | `batchCalls(bytes[])` | nonpayable |
| 0x44c028fe | `execute(uint256,address,uint256,bytes)` | payable |
| 0x31858452 | `executeBatch(uint256[],address[],uint256[],bytes[])` | payable |
| 0x54f6127f | `getData(bytes32)` | view |
| 0xdedff9c6 | `getDataBatch(bytes32[])` | view |
| 0xc4d66de8 | `initialize(address)` | payable |
| 0x1626ba7e | `isValidSignature(bytes32,bytes)` | view |
| 0x8da5cb5b | `owner()` | view |
| 0xe30c3978 | `pendingOwner()` | view |
| 0xead3fbdf | `RENOUNCE_OWNERSHIP_CONFIRMATION_DELAY()` | view |
| 0x01bfba61 | `RENOUNCE_OWNERSHIP_CONFIRMATION_PERIOD()` | view |
| 0x715018a6 | `renounceOwnership()` | nonpayable |
| 0x7f23690c | `setData(bytes32,bytes)` | payable |
| 0x97902421 | `setDataBatch(bytes32[],bytes[])` | payable |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view |
| 0xf2fde38b | `transferOwnership(address)` | nonpayable |
| 0x6bb56a14 | `universalReceiver(bytes32,bytes)` | payable |
| 0xffa1ad74 | `VERSION()` | view |

Events: `ContractCreated(uint256,address,uint256,bytes32)`, `DataChanged(bytes32,bytes)`, `Executed(uint256,address,uint256,bytes4)`, `Initialized(uint8)`, `OwnershipRenounced()`, `OwnershipTransferStarted(address,address)`, `OwnershipTransferred(address,address)`, `RenounceOwnershipStarted()`, `UniversalReceiver(address,uint256,bytes32,bytes,bytes)`

Errors: `ERC725X_ContractDeploymentFailed()`, `ERC725X_CreateOperationsRequireEmptyRecipientAddress()`, `ERC725X_ExecuteParametersEmptyArray()`, `ERC725X_ExecuteParametersLengthMismatch()`, `ERC725X_InsufficientBalance(uint256,uint256)`, `ERC725X_MsgValueDisallowedInDelegateCall()`, `ERC725X_MsgValueDisallowedInStaticCall()`, `ERC725X_NoContractBytecodeProvided()`, `ERC725X_UnknownOperationType(uint256)`, `ERC725Y_DataKeysValuesEmptyArray()`, `ERC725Y_DataKeysValuesLengthMismatch()`, `LSP14CallerNotPendingOwner(address)`, `LSP14CannotTransferOwnershipToSelf()`, `LSP14MustAcceptOwnershipInSeparateTransaction()`, `LSP14NotInRenounceOwnershipInterval(uint256,uint256)`, `LSP20CallVerificationFailed(bool,bytes4)`, `LSP20CallingVerifierFailed(bool)`, `LSP20EOACannotVerifyCall(address)`, `NoExtensionFoundForFunctionSelector(bytes4)`

Upstream delta vs main: external function surface changed: **false**.

## lsp1-contracts

npm `@lukso/lsp1-contracts` latest 0.16.3; upstream main 0.16.3.

| Contract | Kind | Functions | Events | Errors | fallback / receive |
| --- | --- | --- | --- | --- | --- |
| ILSP1UniversalReceiver | interface | 1 | 1 | 0 | - / - |
| ILSP1UniversalReceiverDelegate | interface | 1 | 0 | 0 | - / - |
| LSP1Utils | library | 0 | 0 | 0 | - / - |

Libraries (no external entrypoints; all functions `internal`): `LSP1Utils`.

### ILSP1UniversalReceiver (interface)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x6bb56a14 | `universalReceiver(bytes32,bytes)` | payable |

Events: `UniversalReceiver(address,uint256,bytes32,bytes,bytes)`

### ILSP1UniversalReceiverDelegate (interface)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0xa245bbda | `universalReceiverDelegate(address,uint256,bytes32,bytes)` | nonpayable |

Unique events: `UniversalReceiver(address,uint256,bytes32,bytes,bytes)`

Upstream delta vs main: external function surface changed: **false**.

## lsp1delegate-contracts

npm `@lukso/lsp1delegate-contracts` latest 0.16.3; upstream main 0.16.3.

| Contract | Kind | Functions | Events | Errors | fallback / receive |
| --- | --- | --- | --- | --- | --- |
| LSP1UniversalReceiverDelegateUP | deployable | 3 | 0 | 1 | - / - |
| LSP1UniversalReceiverDelegateVault | deployable | 3 | 0 | 1 | - / - |
| Version | abstract | 1 | 0 | 0 | - / - |

### LSP1UniversalReceiverDelegateUP (deployable)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view |
| 0xa245bbda | `universalReceiverDelegate(address,uint256,bytes32,bytes)` | nonpayable |
| 0xffa1ad74 | `VERSION()` | view |

Errors: `CannotRegisterEOAsAsAssets(address)`

### LSP1UniversalReceiverDelegateVault (deployable)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view |
| 0xa245bbda | `universalReceiverDelegate(address,uint256,bytes32,bytes)` | nonpayable |
| 0xffa1ad74 | `VERSION()` | view |

Errors: `CannotRegisterEOAsAsAssets(address)`

Upstream delta vs main: external function surface changed: **false**.

## lsp2-contracts

npm `@lukso/lsp2-contracts` latest 0.16.2; upstream main 0.16.2.

| Contract | Kind | Functions | Events | Errors | fallback / receive |
| --- | --- | --- | --- | --- | --- |
| LSP2Utils | library | 0 | 0 | 0 | - / - |

Libraries (no external entrypoints; all functions `internal`): `LSP2Utils`.

Upstream delta vs main: external function surface changed: **false**.

## lsp3-contracts

npm `@lukso/lsp3-contracts` latest 0.17.3; upstream main 0.17.3.

No compiled contracts: this package defines data keys and TypeScript types only (see the spec constants section below).

Upstream delta vs main: external function surface changed: **false**.

## lsp5-contracts

npm `@lukso/lsp5-contracts` latest 0.16.3; upstream main 0.16.3.

| Contract | Kind | Functions | Events | Errors | fallback / receive |
| --- | --- | --- | --- | --- | --- |
| LSP5Utils | library | 0 | 0 | 0 | - / - |

Libraries (no external entrypoints; all functions `internal`): `LSP5Utils`.

Upstream delta vs main: external function surface changed: **false**.

## lsp6-contracts

npm `@lukso/lsp6-contracts` latest 0.16.3; upstream main 0.16.3.

| Contract | Kind | Functions | Events | Errors | fallback / receive |
| --- | --- | --- | --- | --- | --- |
| ILSP6KeyManager | interface | 4 | 1 | 0 | - / - |
| LSP6KeyManager | deployable | 11 | 1 | 27 | - / - |
| LSP6KeyManagerCore | abstract | 10 | 1 | 26 | - / - |
| LSP6KeyManagerInit | init | 12 | 2 | 27 | - / - |
| LSP6KeyManagerInitAbstract | abstract | 10 | 2 | 26 | - / - |
| LSP6ExecuteModule | abstract | 0 | 0 | 0 | - / - |
| LSP6ExecuteRelayCallModule | abstract | 0 | 0 | 0 | - / - |
| LSP6OwnershipModule | abstract | 0 | 0 | 0 | - / - |
| LSP6SetDataModule | abstract | 0 | 0 | 0 | - / - |
| LSP6Utils | library | 0 | 0 | 0 | - / - |
| Version | abstract | 1 | 0 | 0 | - / - |

Libraries (no external entrypoints; all functions `internal`): `LSP6Utils`.

### ILSP6KeyManager (interface)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x09c5eabe | `execute(bytes)` | payable |
| 0xbf0176ff | `executeBatch(uint256[],bytes[])` | payable |
| 0x1626ba7e | `isValidSignature(bytes32,bytes)` | view |
| 0xd4b83992 | `target()` | view |

Events: `PermissionsVerified(address,uint256,bytes4)`

### LSP6KeyManager (deployable)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x09c5eabe | `execute(bytes)` | payable |
| 0xbf0176ff | `executeBatch(uint256[],bytes[])` | payable |
| 0x4c8a4e74 | `executeRelayCall(bytes,uint256,uint256,bytes)` | payable |
| 0xa20856a5 | `executeRelayCallBatch(bytes[],uint256[],uint256[],uint256[],bytes[])` | payable |
| 0xb44581d9 | `getNonce(address,uint128)` | view |
| 0x1626ba7e | `isValidSignature(bytes32,bytes)` | view |
| 0xde928f14 | `lsp20VerifyCall(address,address,address,uint256,bytes)` | nonpayable |
| 0xd3fc45d3 | `lsp20VerifyCallResult(bytes32,bytes)` | nonpayable |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view |
| 0xd4b83992 | `target()` | view |
| 0xffa1ad74 | `VERSION()` | view |

Events: `PermissionsVerified(address,uint256,bytes4)`

Errors: `BatchExecuteParamsLengthMismatch()`, `BatchExecuteRelayCallParamsLengthMismatch()`, `CallingKeyManagerNotAllowed()`, `DelegateCallDisallowedViaKeyManager()`, `ERC725X_ExecuteParametersEmptyArray()`, `ERC725X_ExecuteParametersLengthMismatch()`, `ERC725Y_DataKeysValuesLengthMismatch()`, `InvalidDataValuesForDataKeys(bytes32,bytes)`, `InvalidERC725Function(bytes4)`, `InvalidEncodedAllowedCalls(bytes)`, `InvalidEncodedAllowedERC725YDataKeys(bytes,string)`, `InvalidLSP6Target()`, `InvalidPayload(bytes)`, `InvalidRelayNonce(address,uint256,bytes)`, `InvalidWhitelistedCall(address)`, `KeyManagerCannotBeSetAsExtensionForLSP20Functions()`, `LSP6BatchExcessiveValueSent(uint256,uint256)`, `LSP6BatchInsufficientValueSent(uint256,uint256)`, `NoCallsAllowed(address)`, `NoERC725YDataKeysAllowed(address)`, `NoPermissionsSet(address)`, `NotAllowedCall(address,address,bytes4)`, `NotAllowedERC725YDataKey(address,bytes32)`, `NotAuthorised(address,string)`, `NotRecognisedPermissionKey(bytes32)`, `RelayCallBeforeStartTime()`, `RelayCallExpired()`

### LSP6KeyManagerInit (init)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x09c5eabe | `execute(bytes)` | payable |
| 0xbf0176ff | `executeBatch(uint256[],bytes[])` | payable |
| 0x4c8a4e74 | `executeRelayCall(bytes,uint256,uint256,bytes)` | payable |
| 0xa20856a5 | `executeRelayCallBatch(bytes[],uint256[],uint256[],uint256[],bytes[])` | payable |
| 0xb44581d9 | `getNonce(address,uint128)` | view |
| 0xc4d66de8 | `initialize(address)` | nonpayable |
| 0x1626ba7e | `isValidSignature(bytes32,bytes)` | view |
| 0xde928f14 | `lsp20VerifyCall(address,address,address,uint256,bytes)` | nonpayable |
| 0xd3fc45d3 | `lsp20VerifyCallResult(bytes32,bytes)` | nonpayable |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view |
| 0xd4b83992 | `target()` | view |
| 0xffa1ad74 | `VERSION()` | view |

Events: `Initialized(uint8)`, `PermissionsVerified(address,uint256,bytes4)`

Errors: `BatchExecuteParamsLengthMismatch()`, `BatchExecuteRelayCallParamsLengthMismatch()`, `CallingKeyManagerNotAllowed()`, `DelegateCallDisallowedViaKeyManager()`, `ERC725X_ExecuteParametersEmptyArray()`, `ERC725X_ExecuteParametersLengthMismatch()`, `ERC725Y_DataKeysValuesLengthMismatch()`, `InvalidDataValuesForDataKeys(bytes32,bytes)`, `InvalidERC725Function(bytes4)`, `InvalidEncodedAllowedCalls(bytes)`, `InvalidEncodedAllowedERC725YDataKeys(bytes,string)`, `InvalidLSP6Target()`, `InvalidPayload(bytes)`, `InvalidRelayNonce(address,uint256,bytes)`, `InvalidWhitelistedCall(address)`, `KeyManagerCannotBeSetAsExtensionForLSP20Functions()`, `LSP6BatchExcessiveValueSent(uint256,uint256)`, `LSP6BatchInsufficientValueSent(uint256,uint256)`, `NoCallsAllowed(address)`, `NoERC725YDataKeysAllowed(address)`, `NoPermissionsSet(address)`, `NotAllowedCall(address,address,bytes4)`, `NotAllowedERC725YDataKey(address,bytes32)`, `NotAuthorised(address,string)`, `NotRecognisedPermissionKey(bytes32)`, `RelayCallBeforeStartTime()`, `RelayCallExpired()`

Upstream delta vs main: external function surface changed: **false**.

## lsp9-contracts

npm `@lukso/lsp9-contracts` latest 0.16.3; upstream main 0.16.3.

| Contract | Kind | Functions | Events | Errors | fallback / receive |
| --- | --- | --- | --- | --- | --- |
| ILSP9Vault | interface | 1 | 0 | 0 | - / - |
| LSP9Vault | deployable | 17 | 8 | 17 | fallback(payable) / receive |
| LSP9VaultCore | deployable | 16 | 8 | 17 | fallback(payable) / receive |
| LSP9VaultInit | init | 18 | 9 | 17 | fallback(payable) / receive |
| LSP9VaultInitAbstract | abstract | 16 | 9 | 17 | fallback(payable) / receive |
| Version | abstract | 1 | 0 | 0 | - / - |

### ILSP9Vault (interface)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x6963d438 | `batchCalls(bytes[])` | nonpayable |

### LSP9Vault (deployable)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x79ba5097 | `acceptOwnership()` | nonpayable |
| 0x6963d438 | `batchCalls(bytes[])` | nonpayable |
| 0x44c028fe | `execute(uint256,address,uint256,bytes)` | payable |
| 0x31858452 | `executeBatch(uint256[],address[],uint256[],bytes[])` | payable |
| 0x54f6127f | `getData(bytes32)` | view |
| 0xdedff9c6 | `getDataBatch(bytes32[])` | view |
| 0x8da5cb5b | `owner()` | view |
| 0xe30c3978 | `pendingOwner()` | view |
| 0xead3fbdf | `RENOUNCE_OWNERSHIP_CONFIRMATION_DELAY()` | view |
| 0x01bfba61 | `RENOUNCE_OWNERSHIP_CONFIRMATION_PERIOD()` | view |
| 0x715018a6 | `renounceOwnership()` | nonpayable |
| 0x7f23690c | `setData(bytes32,bytes)` | payable |
| 0x97902421 | `setDataBatch(bytes32[],bytes[])` | payable |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view |
| 0xf2fde38b | `transferOwnership(address)` | nonpayable |
| 0x6bb56a14 | `universalReceiver(bytes32,bytes)` | payable |
| 0xffa1ad74 | `VERSION()` | view |

Events: `ContractCreated(uint256,address,uint256,bytes32)`, `DataChanged(bytes32,bytes)`, `Executed(uint256,address,uint256,bytes4)`, `OwnershipRenounced()`, `OwnershipTransferStarted(address,address)`, `OwnershipTransferred(address,address)`, `RenounceOwnershipStarted()`, `UniversalReceiver(address,uint256,bytes32,bytes,bytes)`

Errors: `ERC725X_ContractDeploymentFailed()`, `ERC725X_CreateOperationsRequireEmptyRecipientAddress()`, `ERC725X_ExecuteParametersEmptyArray()`, `ERC725X_ExecuteParametersLengthMismatch()`, `ERC725X_InsufficientBalance(uint256,uint256)`, `ERC725X_MsgValueDisallowedInStaticCall()`, `ERC725X_NoContractBytecodeProvided()`, `ERC725X_UnknownOperationType(uint256)`, `ERC725Y_DataKeysValuesLengthMismatch()`, `ERC725Y_MsgValueDisallowed()`, `LSP14CallerNotPendingOwner(address)`, `LSP14CannotTransferOwnershipToSelf()`, `LSP14MustAcceptOwnershipInSeparateTransaction()`, `LSP14NotInRenounceOwnershipInterval(uint256,uint256)`, `LSP1DelegateNotAllowedToSetDataKey(bytes32)`, `NoExtensionFoundForFunctionSelector(bytes4)`, `OwnableCallerNotTheOwner(address)`

### LSP9VaultCore (deployable)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x79ba5097 | `acceptOwnership()` | nonpayable |
| 0x6963d438 | `batchCalls(bytes[])` | nonpayable |
| 0x44c028fe | `execute(uint256,address,uint256,bytes)` | payable |
| 0x31858452 | `executeBatch(uint256[],address[],uint256[],bytes[])` | payable |
| 0x54f6127f | `getData(bytes32)` | view |
| 0xdedff9c6 | `getDataBatch(bytes32[])` | view |
| 0x8da5cb5b | `owner()` | view |
| 0xe30c3978 | `pendingOwner()` | view |
| 0xead3fbdf | `RENOUNCE_OWNERSHIP_CONFIRMATION_DELAY()` | view |
| 0x01bfba61 | `RENOUNCE_OWNERSHIP_CONFIRMATION_PERIOD()` | view |
| 0x715018a6 | `renounceOwnership()` | nonpayable |
| 0x7f23690c | `setData(bytes32,bytes)` | payable |
| 0x97902421 | `setDataBatch(bytes32[],bytes[])` | payable |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view |
| 0xf2fde38b | `transferOwnership(address)` | nonpayable |
| 0x6bb56a14 | `universalReceiver(bytes32,bytes)` | payable |

Events: `ContractCreated(uint256,address,uint256,bytes32)`, `DataChanged(bytes32,bytes)`, `Executed(uint256,address,uint256,bytes4)`, `OwnershipRenounced()`, `OwnershipTransferStarted(address,address)`, `OwnershipTransferred(address,address)`, `RenounceOwnershipStarted()`, `UniversalReceiver(address,uint256,bytes32,bytes,bytes)`

Errors: `ERC725X_ContractDeploymentFailed()`, `ERC725X_CreateOperationsRequireEmptyRecipientAddress()`, `ERC725X_ExecuteParametersEmptyArray()`, `ERC725X_ExecuteParametersLengthMismatch()`, `ERC725X_InsufficientBalance(uint256,uint256)`, `ERC725X_MsgValueDisallowedInStaticCall()`, `ERC725X_NoContractBytecodeProvided()`, `ERC725X_UnknownOperationType(uint256)`, `ERC725Y_DataKeysValuesLengthMismatch()`, `ERC725Y_MsgValueDisallowed()`, `LSP14CallerNotPendingOwner(address)`, `LSP14CannotTransferOwnershipToSelf()`, `LSP14MustAcceptOwnershipInSeparateTransaction()`, `LSP14NotInRenounceOwnershipInterval(uint256,uint256)`, `LSP1DelegateNotAllowedToSetDataKey(bytes32)`, `NoExtensionFoundForFunctionSelector(bytes4)`, `OwnableCallerNotTheOwner(address)`

### LSP9VaultInit (init)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x79ba5097 | `acceptOwnership()` | nonpayable |
| 0x6963d438 | `batchCalls(bytes[])` | nonpayable |
| 0x44c028fe | `execute(uint256,address,uint256,bytes)` | payable |
| 0x31858452 | `executeBatch(uint256[],address[],uint256[],bytes[])` | payable |
| 0x54f6127f | `getData(bytes32)` | view |
| 0xdedff9c6 | `getDataBatch(bytes32[])` | view |
| 0xc4d66de8 | `initialize(address)` | payable |
| 0x8da5cb5b | `owner()` | view |
| 0xe30c3978 | `pendingOwner()` | view |
| 0xead3fbdf | `RENOUNCE_OWNERSHIP_CONFIRMATION_DELAY()` | view |
| 0x01bfba61 | `RENOUNCE_OWNERSHIP_CONFIRMATION_PERIOD()` | view |
| 0x715018a6 | `renounceOwnership()` | nonpayable |
| 0x7f23690c | `setData(bytes32,bytes)` | payable |
| 0x97902421 | `setDataBatch(bytes32[],bytes[])` | payable |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view |
| 0xf2fde38b | `transferOwnership(address)` | nonpayable |
| 0x6bb56a14 | `universalReceiver(bytes32,bytes)` | payable |
| 0xffa1ad74 | `VERSION()` | view |

Events: `ContractCreated(uint256,address,uint256,bytes32)`, `DataChanged(bytes32,bytes)`, `Executed(uint256,address,uint256,bytes4)`, `Initialized(uint8)`, `OwnershipRenounced()`, `OwnershipTransferStarted(address,address)`, `OwnershipTransferred(address,address)`, `RenounceOwnershipStarted()`, `UniversalReceiver(address,uint256,bytes32,bytes,bytes)`

Errors: `ERC725X_ContractDeploymentFailed()`, `ERC725X_CreateOperationsRequireEmptyRecipientAddress()`, `ERC725X_ExecuteParametersEmptyArray()`, `ERC725X_ExecuteParametersLengthMismatch()`, `ERC725X_InsufficientBalance(uint256,uint256)`, `ERC725X_MsgValueDisallowedInStaticCall()`, `ERC725X_NoContractBytecodeProvided()`, `ERC725X_UnknownOperationType(uint256)`, `ERC725Y_DataKeysValuesLengthMismatch()`, `ERC725Y_MsgValueDisallowed()`, `LSP14CallerNotPendingOwner(address)`, `LSP14CannotTransferOwnershipToSelf()`, `LSP14MustAcceptOwnershipInSeparateTransaction()`, `LSP14NotInRenounceOwnershipInterval(uint256,uint256)`, `LSP1DelegateNotAllowedToSetDataKey(bytes32)`, `NoExtensionFoundForFunctionSelector(bytes4)`, `OwnableCallerNotTheOwner(address)`

Upstream delta vs main: external function surface changed: **false**.

## lsp10-contracts

npm `@lukso/lsp10-contracts` latest 0.16.3; upstream main 0.16.3.

| Contract | Kind | Functions | Events | Errors | fallback / receive |
| --- | --- | --- | --- | --- | --- |
| LSP10Utils | library | 0 | 0 | 0 | - / - |

Libraries (no external entrypoints; all functions `internal`): `LSP10Utils`.

Upstream delta vs main: external function surface changed: **false**.

## lsp11-contracts

npm `@lukso/lsp11-contracts` latest 0.1.7; upstream main 0.2.3.

| Contract | Kind | Functions | Events | Errors | fallback / receive |
| --- | --- | --- | --- | --- | --- |
| ILSP11SocialRecovery | interface | 20 | 9 | 0 | - / - |
| LSP11SocialRecovery | deployable | 27 | 9 | 24 | - / - |

### ILSP11SocialRecovery (interface)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0xc6845210 | `addGuardian(address,address)` | nonpayable |
| 0x1ce59666 | `cancelRecoveryProcess(address)` | nonpayable |
| 0xa9e3b276 | `commitToRecover(address,address,bytes32)` | nonpayable |
| 0x6289a163 | `getCommitmentInfoOf(address,uint256,address)` | view |
| 0x88095527 | `getFirstRecoveryTimestampOf(address,uint256)` | view |
| 0x8ca4aaaf | `getGuardiansOf(address)` | view |
| 0xdbd119bd | `getGuardiansThresholdOf(address)` | view |
| 0xcee79d45 | `getRecoveryCounterOf(address)` | view |
| 0x02543bff | `getRecoveryDelayOf(address)` | view |
| 0x06fe1738 | `getSecretHashOf(address)` | view |
| 0x506d1a0f | `getVotedAddressByGuardian(address,uint256,address)` | view |
| 0xa65068b6 | `getVotesOfGuardianVotedAddress(address,uint256,address)` | view |
| 0xd617b890 | `hasReachedThreshold(address,uint256,address)` | view |
| 0x769e54df | `isGuardianOf(address,address)` | view |
| 0xf3b3c785 | `recoverAccess(address,address,bytes32,bytes32,bytes)` | payable |
| 0x9b27a90e | `removeGuardian(address,address)` | nonpayable |
| 0x639cea19 | `setGuardiansThreshold(address,uint256)` | nonpayable |
| 0xa219b404 | `setRecoveryDelay(address,uint256)` | nonpayable |
| 0x78f84ebd | `setRecoverySecretHash(address,bytes32)` | nonpayable |
| 0xfa04a7f1 | `voteForRecovery(address,address,address)` | nonpayable |

Events: `GuardianAdded(address,address)`, `GuardianRemoved(address,address)`, `GuardianVotedFor(address,uint256,address,address)`, `GuardiansThresholdChanged(address,uint256)`, `RecoveryCancelled(address,uint256)`, `RecoveryDelayChanged(address,uint256)`, `RecoveryProcessSuccessful(address,uint256,address,bytes)`, `SecretHashChanged(address,bytes32)`, `SecretHashCommitted(address,uint256,address,bytes32)`

### LSP11SocialRecovery (deployable)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0xc6845210 | `addGuardian(address,address)` | nonpayable |
| 0x6963d438 | `batchCalls(bytes[])` | nonpayable |
| 0x1ce59666 | `cancelRecoveryProcess(address)` | nonpayable |
| 0xb79336ee | `COMMITMEMT_DELAY()` | view |
| 0xa9e3b276 | `commitToRecover(address,address,bytes32)` | nonpayable |
| 0x8bc0ab75 | `DEFAULT_RECOVERY_DELAY()` | view |
| 0x4c8a4e74 | `executeRelayCall(bytes,uint256,uint256,bytes)` | payable |
| 0xa20856a5 | `executeRelayCallBatch(bytes[],uint256[],uint256[],uint256[],bytes[])` | payable |
| 0x6289a163 | `getCommitmentInfoOf(address,uint256,address)` | view |
| 0x88095527 | `getFirstRecoveryTimestampOf(address,uint256)` | view |
| 0x8ca4aaaf | `getGuardiansOf(address)` | view |
| 0xdbd119bd | `getGuardiansThresholdOf(address)` | view |
| 0xb44581d9 | `getNonce(address,uint128)` | view |
| 0xcee79d45 | `getRecoveryCounterOf(address)` | view |
| 0x02543bff | `getRecoveryDelayOf(address)` | view |
| 0x06fe1738 | `getSecretHashOf(address)` | view |
| 0x506d1a0f | `getVotedAddressByGuardian(address,uint256,address)` | view |
| 0xa65068b6 | `getVotesOfGuardianVotedAddress(address,uint256,address)` | view |
| 0xd617b890 | `hasReachedThreshold(address,uint256,address)` | view |
| 0x769e54df | `isGuardianOf(address,address)` | view |
| 0xf3b3c785 | `recoverAccess(address,address,bytes32,bytes32,bytes)` | payable |
| 0x9b27a90e | `removeGuardian(address,address)` | nonpayable |
| 0x639cea19 | `setGuardiansThreshold(address,uint256)` | nonpayable |
| 0xa219b404 | `setRecoveryDelay(address,uint256)` | nonpayable |
| 0x78f84ebd | `setRecoverySecretHash(address,bytes32)` | nonpayable |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view |
| 0xfa04a7f1 | `voteForRecovery(address,address,address)` | nonpayable |

Events: `GuardianAdded(address,address)`, `GuardianRemoved(address,address)`, `GuardianVotedFor(address,uint256,address,address)`, `GuardiansThresholdChanged(address,uint256)`, `RecoveryCancelled(address,uint256)`, `RecoveryDelayChanged(address,uint256)`, `RecoveryProcessSuccessful(address,uint256,address,bytes)`, `SecretHashChanged(address,bytes32)`, `SecretHashCommitted(address,uint256,address,bytes32)`

Errors: `AccountNotSetupYet()`, `BatchCallsFailed(uint256)`, `BatchExecuteRelayCallParamsLengthMismatch()`, `CallerIsNotGuardian(address,address)`, `CallerIsNotTheAccount(address,address)`, `CallerIsNotVotedAddress(address,address)`, `CallerVotesHaveNotReachedThreshold(address,address)`, `CannotRecoverAfterDirectCommit(address,address)`, `CannotRecoverBeforeDelay(address,uint256)`, `CannotVoteToAddressTwice(address,address,address)`, `GuardianAlreadyExists(address,address)`, `GuardianNotFound(address,address)`, `GuardianNumberCannotGoBelowThreshold(address,uint256)`, `InvalidCommitment(address,address)`, `InvalidRelayNonce(address,uint256,bytes)`, `InvalidSecretHash(address,bytes32)`, `LSP11BatchExcessiveValueSent(uint256,uint256)`, `LSP11BatchInsufficientValueSent(uint256,uint256)`, `NotAGuardianOfTheAccount(address,address)`, `RelayCallBeforeStartTime()`, `RelayCallExpired()`, `RelayCallNotSupported(bytes4)`, `SignerIsNotVotedAddress(address,address)`, `ThresholdExceedsGuardianNumber(address,uint256)`

Unique errors: `AccountNotSetupYet()`, `BatchCallsFailed(uint256)`, `BatchExecuteRelayCallParamsLengthMismatch()`, `CallerIsNotGuardian(address,address)`, `CallerIsNotTheAccount(address,address)`, `CallerIsNotVotedAddress(address,address)`, `CallerVotesHaveNotReachedThreshold(address,address)`, `CannotRecoverAfterDirectCommit(address,address)`, `CannotRecoverBeforeDelay(address,uint256)`, `CannotVoteToAddressTwice(address,address,address)`, `GuardianAlreadyExists(address,address)`, `GuardianNotFound(address,address)`, `GuardianNumberCannotGoBelowThreshold(address,uint256)`, `InvalidCommitment(address,address)`, `InvalidRelayNonce(address,uint256,bytes)`, `InvalidSecretHash(address,bytes32)`, `LSP11BatchExcessiveValueSent(uint256,uint256)`, `LSP11BatchInsufficientValueSent(uint256,uint256)`, `NotAGuardianOfTheAccount(address,address)`, `RelayCallBeforeStartTime()`, `RelayCallExpired()`, `RelayCallNotSupported(bytes4)`, `SignerIsNotVotedAddress(address,address)`, `ThresholdExceedsGuardianNumber(address,uint256)`

Unique events: `GuardianAdded(address,address)`, `GuardianRemoved(address,address)`, `GuardianVotedFor(address,uint256,address,address)`, `GuardiansThresholdChanged(address,uint256)`, `RecoveryCancelled(address,uint256)`, `RecoveryDelayChanged(address,uint256)`, `RecoveryProcessSuccessful(address,uint256,address,bytes)`, `SecretHashChanged(address,bytes32)`, `SecretHashCommitted(address,uint256,address,bytes32)`

Upstream delta vs main: external function surface changed: **false**.

## lsp12-contracts

npm `@lukso/lsp12-contracts` latest 0.16.3; upstream main 0.16.3.

No compiled contracts: this package defines data keys and TypeScript types only (see the spec constants section below).

Upstream delta vs main: external function surface changed: **false**.

## lsp14-contracts

npm `@lukso/lsp14-contracts` latest 0.16.3; upstream main 0.16.3.

| Contract | Kind | Functions | Events | Errors | fallback / receive |
| --- | --- | --- | --- | --- | --- |
| ILSP14Ownable2Step | interface | 4 | 3 | 0 | - / - |
| LSP14Ownable2Step | abstract | 7 | 4 | 5 | - / - |

### ILSP14Ownable2Step (interface)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x79ba5097 | `acceptOwnership()` | nonpayable |
| 0xe30c3978 | `pendingOwner()` | view |
| 0x715018a6 | `renounceOwnership()` | nonpayable |
| 0xf2fde38b | `transferOwnership(address)` | nonpayable |

Events: `OwnershipRenounced()`, `OwnershipTransferStarted(address,address)`, `RenounceOwnershipStarted()`

Upstream delta vs main: external function surface changed: **false**.

## lsp16-contracts

npm `@lukso/lsp16-contracts` latest 0.16.2; upstream main 0.16.2.

| Contract | Kind | Functions | Events | Errors | fallback / receive |
| --- | --- | --- | --- | --- | --- |
| LSP16UniversalFactory | deployable | 7 | 1 | 2 | - / - |

### LSP16UniversalFactory (deployable)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x3b315680 | `computeAddress(bytes32,bytes32,bool,bytes)` | view |
| 0xe888edcb | `computeERC1167Address(address,bytes32,bool,bytes)` | view |
| 0x26736355 | `deployCreate2(bytes,bytes32)` | payable |
| 0xcdbd473a | `deployCreate2AndInitialize(bytes,bytes32,bytes,uint256,uint256)` | payable |
| 0x49d8abed | `deployERC1167Proxy(address,bytes32)` | nonpayable |
| 0x5340165f | `deployERC1167ProxyAndInitialize(address,bytes32,bytes)` | payable |
| 0x1a17ccbf | `generateSalt(bytes32,bool,bytes)` | pure |

Events: `ContractCreated(address,bytes32,bytes32,bool,bytes)`

Errors: `ContractInitializationFailed()`, `InvalidValueSum()`

Unique errors: `ContractInitializationFailed()`, `InvalidValueSum()`

Unique events: `ContractCreated(address,bytes32,bytes32,bool,bytes)`

Upstream delta vs main: external function surface changed: **false**.

## lsp17-contracts

npm `@lukso/lsp17-contracts` latest 0.17.3; upstream main 0.17.3.

| Contract | Kind | Functions | Events | Errors | fallback / receive |
| --- | --- | --- | --- | --- | --- |
| ERC20MetadataCompatibilityExtension | deployable | 4 | 0 | 0 | - / - |
| ERCTokenCallbacks | deployable | 6 | 0 | 0 | - / - |
| Extension4337 | deployable | 4 | 0 | 0 | - / - |
| OnERC721ReceivedExtension | deployable | 3 | 0 | 0 | - / - |

### ERC20MetadataCompatibilityExtension (deployable)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x06fdde03 | `name()` | view |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view |
| 0x95d89b41 | `symbol()` | view |
| 0xffa1ad74 | `VERSION()` | view |

### ERCTokenCallbacks (deployable)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0xbc197c81 | `onERC1155BatchReceived(address,address,uint256[],uint256[],bytes)` | nonpayable |
| 0xf23a6e61 | `onERC1155Received(address,address,uint256,uint256,bytes)` | nonpayable |
| 0x150b7a02 | `onERC721Received(address,address,uint256,bytes)` | nonpayable |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view |
| 0x0023de29 | `tokensReceived(address,address,address,uint256,bytes,bytes)` | nonpayable |
| 0xffa1ad74 | `VERSION()` | view |

### Extension4337 (deployable)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0xb0d691fe | `entryPoint()` | view |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view |
| 0x3a871cdd | `validateUserOp((address,uint256,bytes,bytes,uint256,uint256,uint256,uint256,uint256,bytes,bytes),bytes32,uint256)` | nonpayable |
| 0xffa1ad74 | `VERSION()` | view |

### OnERC721ReceivedExtension (deployable)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x150b7a02 | `onERC721Received(address,address,uint256,bytes)` | nonpayable |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view |
| 0xffa1ad74 | `VERSION()` | view |

Upstream delta vs main: external function surface changed: **false**.

## lsp17contractextension-contracts

npm `@lukso/lsp17contractextension-contracts` latest 0.17.2; upstream main 0.17.2.

| Contract | Kind | Functions | Events | Errors | fallback / receive |
| --- | --- | --- | --- | --- | --- |
| LSP17Extendable | abstract | 1 | 0 | 0 | - / - |
| LSP17ExtendableInitAbstract | abstract | 1 | 1 | 0 | - / - |
| LSP17Extension | abstract | 2 | 0 | 0 | - / - |
| LSP17ExtensionInitAbstract | abstract | 2 | 1 | 0 | - / - |
| LSP17Utils | library | 0 | 0 | 0 | - / - |
| Version | abstract | 1 | 0 | 0 | - / - |

Libraries (no external entrypoints; all functions `internal`): `LSP17Utils`.

### LSP17Extendable (abstract)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view |

### LSP17ExtendableInitAbstract (abstract)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view |

Events: `Initialized(uint8)`

### LSP17Extension (abstract)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view |
| 0xffa1ad74 | `VERSION()` | view |

### LSP17ExtensionInitAbstract (abstract)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view |
| 0xffa1ad74 | `VERSION()` | view |

Events: `Initialized(uint8)`

Upstream delta vs main: external function surface changed: **false**.

## lsp20-contracts

npm `@lukso/lsp20-contracts` latest 0.16.2; upstream main 0.16.2.

| Contract | Kind | Functions | Events | Errors | fallback / receive |
| --- | --- | --- | --- | --- | --- |
| ILSP20CallVerifier | interface | 2 | 0 | 0 | - / - |
| LSP20CallVerification | abstract | 0 | 0 | 0 | - / - |

### ILSP20CallVerifier (interface)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0xde928f14 | `lsp20VerifyCall(address,address,address,uint256,bytes)` | nonpayable |
| 0xd3fc45d3 | `lsp20VerifyCallResult(bytes32,bytes)` | nonpayable |

Upstream delta vs main: external function surface changed: **false**.

## lsp23-contracts

npm `@lukso/lsp23-contracts` latest 0.16.3; upstream main 0.16.3.

| Contract | Kind | Functions | Events | Errors | fallback / receive |
| --- | --- | --- | --- | --- | --- |
| ILSP23LinkedContractsFactory | interface | 4 | 2 | 0 | - / - |
| IPostDeploymentModule | interface | 1 | 0 | 0 | - / - |
| LSP23LinkedContractsFactory | deployable | 4 | 2 | 3 | - / - |
| UniversalProfileInitPostDeploymentModule | deployable | 21 | 9 | 19 | fallback(payable) / receive |
| UniversalProfilePostDeploymentModule | deployable | 20 | 8 | 19 | fallback(payable) / receive |

### ILSP23LinkedContractsFactory (interface)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0xdd5940f3 | `computeAddresses((bytes32,uint256,bytes),(uint256,bytes,bool,bytes),address,bytes)` | view |
| 0x72b19d36 | `computeERC1167Addresses((bytes32,uint256,address,bytes),(uint256,address,bytes,bool,bytes),address,bytes)` | view |
| 0x754b86b5 | `deployContracts((bytes32,uint256,bytes),(uint256,bytes,bool,bytes),address,bytes)` | payable |
| 0x6a66a753 | `deployERC1167Proxies((bytes32,uint256,address,bytes),(uint256,address,bytes,bool,bytes),address,bytes)` | payable |

Events: `DeployedContracts(address,address,(bytes32,uint256,bytes),(uint256,bytes,bool,bytes),address,bytes)`, `DeployedERC1167Proxies(address,address,(bytes32,uint256,address,bytes),(uint256,address,bytes,bool,bytes),address,bytes)`

### IPostDeploymentModule (interface)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x28c4d14e | `executePostDeployment(address,address,bytes)` | nonpayable |

### LSP23LinkedContractsFactory (deployable)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0xdd5940f3 | `computeAddresses((bytes32,uint256,bytes),(uint256,bytes,bool,bytes),address,bytes)` | view |
| 0x72b19d36 | `computeERC1167Addresses((bytes32,uint256,address,bytes),(uint256,address,bytes,bool,bytes),address,bytes)` | view |
| 0x754b86b5 | `deployContracts((bytes32,uint256,bytes),(uint256,bytes,bool,bytes),address,bytes)` | payable |
| 0x6a66a753 | `deployERC1167Proxies((bytes32,uint256,address,bytes),(uint256,address,bytes,bool,bytes),address,bytes)` | payable |

Events: `DeployedContracts(address,address,(bytes32,uint256,bytes),(uint256,bytes,bool,bytes),address,bytes)`, `DeployedERC1167Proxies(address,address,(bytes32,uint256,address,bytes),(uint256,address,bytes,bool,bytes),address,bytes)`

Errors: `InvalidValueSum()`, `PrimaryContractProxyInitFailureError(bytes)`, `SecondaryContractProxyInitFailureError(bytes)`

### UniversalProfileInitPostDeploymentModule (deployable)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x79ba5097 | `acceptOwnership()` | nonpayable |
| 0x6963d438 | `batchCalls(bytes[])` | nonpayable |
| 0x44c028fe | `execute(uint256,address,uint256,bytes)` | payable |
| 0x31858452 | `executeBatch(uint256[],address[],uint256[],bytes[])` | payable |
| 0x28c4d14e | `executePostDeployment(address,address,bytes)` | nonpayable |
| 0x54f6127f | `getData(bytes32)` | view |
| 0xdedff9c6 | `getDataBatch(bytes32[])` | view |
| 0xc4d66de8 | `initialize(address)` | payable |
| 0x1626ba7e | `isValidSignature(bytes32,bytes)` | view |
| 0x8da5cb5b | `owner()` | view |
| 0xe30c3978 | `pendingOwner()` | view |
| 0xead3fbdf | `RENOUNCE_OWNERSHIP_CONFIRMATION_DELAY()` | view |
| 0x01bfba61 | `RENOUNCE_OWNERSHIP_CONFIRMATION_PERIOD()` | view |
| 0x715018a6 | `renounceOwnership()` | nonpayable |
| 0x7f23690c | `setData(bytes32,bytes)` | payable |
| 0x4f04d60a | `setDataAndTransferOwnership(bytes32[],bytes[],address)` | payable |
| 0x97902421 | `setDataBatch(bytes32[],bytes[])` | payable |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view |
| 0xf2fde38b | `transferOwnership(address)` | nonpayable |
| 0x6bb56a14 | `universalReceiver(bytes32,bytes)` | payable |
| 0xffa1ad74 | `VERSION()` | view |

Events: `ContractCreated(uint256,address,uint256,bytes32)`, `DataChanged(bytes32,bytes)`, `Executed(uint256,address,uint256,bytes4)`, `Initialized(uint8)`, `OwnershipRenounced()`, `OwnershipTransferStarted(address,address)`, `OwnershipTransferred(address,address)`, `RenounceOwnershipStarted()`, `UniversalReceiver(address,uint256,bytes32,bytes,bytes)`

Errors: `ERC725X_ContractDeploymentFailed()`, `ERC725X_CreateOperationsRequireEmptyRecipientAddress()`, `ERC725X_ExecuteParametersEmptyArray()`, `ERC725X_ExecuteParametersLengthMismatch()`, `ERC725X_InsufficientBalance(uint256,uint256)`, `ERC725X_MsgValueDisallowedInDelegateCall()`, `ERC725X_MsgValueDisallowedInStaticCall()`, `ERC725X_NoContractBytecodeProvided()`, `ERC725X_UnknownOperationType(uint256)`, `ERC725Y_DataKeysValuesEmptyArray()`, `ERC725Y_DataKeysValuesLengthMismatch()`, `LSP14CallerNotPendingOwner(address)`, `LSP14CannotTransferOwnershipToSelf()`, `LSP14MustAcceptOwnershipInSeparateTransaction()`, `LSP14NotInRenounceOwnershipInterval(uint256,uint256)`, `LSP20CallVerificationFailed(bool,bytes4)`, `LSP20CallingVerifierFailed(bool)`, `LSP20EOACannotVerifyCall(address)`, `NoExtensionFoundForFunctionSelector(bytes4)`

### UniversalProfilePostDeploymentModule (deployable)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x79ba5097 | `acceptOwnership()` | nonpayable |
| 0x6963d438 | `batchCalls(bytes[])` | nonpayable |
| 0x44c028fe | `execute(uint256,address,uint256,bytes)` | payable |
| 0x31858452 | `executeBatch(uint256[],address[],uint256[],bytes[])` | payable |
| 0x28c4d14e | `executePostDeployment(address,address,bytes)` | nonpayable |
| 0x54f6127f | `getData(bytes32)` | view |
| 0xdedff9c6 | `getDataBatch(bytes32[])` | view |
| 0x1626ba7e | `isValidSignature(bytes32,bytes)` | view |
| 0x8da5cb5b | `owner()` | view |
| 0xe30c3978 | `pendingOwner()` | view |
| 0xead3fbdf | `RENOUNCE_OWNERSHIP_CONFIRMATION_DELAY()` | view |
| 0x01bfba61 | `RENOUNCE_OWNERSHIP_CONFIRMATION_PERIOD()` | view |
| 0x715018a6 | `renounceOwnership()` | nonpayable |
| 0x7f23690c | `setData(bytes32,bytes)` | payable |
| 0x4f04d60a | `setDataAndTransferOwnership(bytes32[],bytes[],address)` | payable |
| 0x97902421 | `setDataBatch(bytes32[],bytes[])` | payable |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view |
| 0xf2fde38b | `transferOwnership(address)` | nonpayable |
| 0x6bb56a14 | `universalReceiver(bytes32,bytes)` | payable |
| 0xffa1ad74 | `VERSION()` | view |

Events: `ContractCreated(uint256,address,uint256,bytes32)`, `DataChanged(bytes32,bytes)`, `Executed(uint256,address,uint256,bytes4)`, `OwnershipRenounced()`, `OwnershipTransferStarted(address,address)`, `OwnershipTransferred(address,address)`, `RenounceOwnershipStarted()`, `UniversalReceiver(address,uint256,bytes32,bytes,bytes)`

Errors: `ERC725X_ContractDeploymentFailed()`, `ERC725X_CreateOperationsRequireEmptyRecipientAddress()`, `ERC725X_ExecuteParametersEmptyArray()`, `ERC725X_ExecuteParametersLengthMismatch()`, `ERC725X_InsufficientBalance(uint256,uint256)`, `ERC725X_MsgValueDisallowedInDelegateCall()`, `ERC725X_MsgValueDisallowedInStaticCall()`, `ERC725X_NoContractBytecodeProvided()`, `ERC725X_UnknownOperationType(uint256)`, `ERC725Y_DataKeysValuesEmptyArray()`, `ERC725Y_DataKeysValuesLengthMismatch()`, `LSP14CallerNotPendingOwner(address)`, `LSP14CannotTransferOwnershipToSelf()`, `LSP14MustAcceptOwnershipInSeparateTransaction()`, `LSP14NotInRenounceOwnershipInterval(uint256,uint256)`, `LSP20CallVerificationFailed(bool,bytes4)`, `LSP20CallingVerifierFailed(bool)`, `LSP20EOACannotVerifyCall(address)`, `NoExtensionFoundForFunctionSelector(bytes4)`

Unique errors: `ERC725X_ContractDeploymentFailed()`, `ERC725X_CreateOperationsRequireEmptyRecipientAddress()`, `ERC725X_ExecuteParametersEmptyArray()`, `ERC725X_ExecuteParametersLengthMismatch()`, `ERC725X_InsufficientBalance(uint256,uint256)`, `ERC725X_MsgValueDisallowedInDelegateCall()`, `ERC725X_MsgValueDisallowedInStaticCall()`, `ERC725X_NoContractBytecodeProvided()`, `ERC725X_UnknownOperationType(uint256)`, `ERC725Y_DataKeysValuesEmptyArray()`, `ERC725Y_DataKeysValuesLengthMismatch()`, `InvalidValueSum()`, `LSP14CallerNotPendingOwner(address)`, `LSP14CannotTransferOwnershipToSelf()`, `LSP14MustAcceptOwnershipInSeparateTransaction()`, `LSP14NotInRenounceOwnershipInterval(uint256,uint256)`, `LSP20CallVerificationFailed(bool,bytes4)`, `LSP20CallingVerifierFailed(bool)`, `LSP20EOACannotVerifyCall(address)`, `NoExtensionFoundForFunctionSelector(bytes4)`, `PrimaryContractProxyInitFailureError(bytes)`, `SecondaryContractProxyInitFailureError(bytes)`

Unique events: `ContractCreated(uint256,address,uint256,bytes32)`, `DataChanged(bytes32,bytes)`, `DeployedContracts(address,address,(bytes32,uint256,bytes),(uint256,bytes,bool,bytes),address,bytes)`, `DeployedERC1167Proxies(address,address,(bytes32,uint256,address,bytes),(uint256,address,bytes,bool,bytes),address,bytes)`, `Executed(uint256,address,uint256,bytes4)`, `Initialized(uint8)`, `OwnershipRenounced()`, `OwnershipTransferStarted(address,address)`, `OwnershipTransferred(address,address)`, `RenounceOwnershipStarted()`, `UniversalReceiver(address,uint256,bytes32,bytes,bytes)`

Upstream delta vs main: external function surface changed: **false**.

## lsp25-contracts

npm `@lukso/lsp25-contracts` latest 0.15.5; upstream main 0.16.2.

| Contract | Kind | Functions | Events | Errors | fallback / receive |
| --- | --- | --- | --- | --- | --- |
| ILSP25ExecuteRelayCall | interface | 3 | 0 | 0 | - / - |
| LSP25MultiChannelNonce | abstract | 0 | 0 | 0 | - / - |

### ILSP25ExecuteRelayCall (interface)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x4c8a4e74 | `executeRelayCall(bytes,uint256,uint256,bytes)` | payable |
| 0xa20856a5 | `executeRelayCallBatch(bytes[],uint256[],uint256[],uint256[],bytes[])` | payable |
| 0xb44581d9 | `getNonce(address,uint128)` | view |

Upstream delta vs main: external function surface changed: **false**.

## universalprofile-contracts

npm `@lukso/universalprofile-contracts` latest 0.15.5; upstream main 0.16.3.

| Contract | Kind | Functions | Events | Errors | fallback / receive |
| --- | --- | --- | --- | --- | --- |
| UniversalProfile | deployable | 18 | 8 | 19 | fallback(payable) / receive |
| UniversalProfileInit | init | 19 | 9 | 19 | fallback(payable) / receive |
| UniversalProfileInitAbstract | abstract | 17 | 9 | 19 | fallback(payable) / receive |
| Version | abstract | 1 | 0 | 0 | - / - |

### UniversalProfile (deployable)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x79ba5097 | `acceptOwnership()` | nonpayable |
| 0x6963d438 | `batchCalls(bytes[])` | nonpayable |
| 0x44c028fe | `execute(uint256,address,uint256,bytes)` | payable |
| 0x31858452 | `executeBatch(uint256[],address[],uint256[],bytes[])` | payable |
| 0x54f6127f | `getData(bytes32)` | view |
| 0xdedff9c6 | `getDataBatch(bytes32[])` | view |
| 0x1626ba7e | `isValidSignature(bytes32,bytes)` | view |
| 0x8da5cb5b | `owner()` | view |
| 0xe30c3978 | `pendingOwner()` | view |
| 0xead3fbdf | `RENOUNCE_OWNERSHIP_CONFIRMATION_DELAY()` | view |
| 0x01bfba61 | `RENOUNCE_OWNERSHIP_CONFIRMATION_PERIOD()` | view |
| 0x715018a6 | `renounceOwnership()` | nonpayable |
| 0x7f23690c | `setData(bytes32,bytes)` | payable |
| 0x97902421 | `setDataBatch(bytes32[],bytes[])` | payable |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view |
| 0xf2fde38b | `transferOwnership(address)` | nonpayable |
| 0x6bb56a14 | `universalReceiver(bytes32,bytes)` | payable |
| 0xffa1ad74 | `VERSION()` | view |

Events: `ContractCreated(uint256,address,uint256,bytes32)`, `DataChanged(bytes32,bytes)`, `Executed(uint256,address,uint256,bytes4)`, `OwnershipRenounced()`, `OwnershipTransferStarted(address,address)`, `OwnershipTransferred(address,address)`, `RenounceOwnershipStarted()`, `UniversalReceiver(address,uint256,bytes32,bytes,bytes)`

Errors: `ERC725X_ContractDeploymentFailed()`, `ERC725X_CreateOperationsRequireEmptyRecipientAddress()`, `ERC725X_ExecuteParametersEmptyArray()`, `ERC725X_ExecuteParametersLengthMismatch()`, `ERC725X_InsufficientBalance(uint256,uint256)`, `ERC725X_MsgValueDisallowedInDelegateCall()`, `ERC725X_MsgValueDisallowedInStaticCall()`, `ERC725X_NoContractBytecodeProvided()`, `ERC725X_UnknownOperationType(uint256)`, `ERC725Y_DataKeysValuesEmptyArray()`, `ERC725Y_DataKeysValuesLengthMismatch()`, `LSP14CallerNotPendingOwner(address)`, `LSP14CannotTransferOwnershipToSelf()`, `LSP14MustAcceptOwnershipInSeparateTransaction()`, `LSP14NotInRenounceOwnershipInterval(uint256,uint256)`, `LSP20CallVerificationFailed(bool,bytes4)`, `LSP20CallingVerifierFailed(bool)`, `LSP20EOACannotVerifyCall(address)`, `NoExtensionFoundForFunctionSelector(bytes4)`

### UniversalProfileInit (init)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x79ba5097 | `acceptOwnership()` | nonpayable |
| 0x6963d438 | `batchCalls(bytes[])` | nonpayable |
| 0x44c028fe | `execute(uint256,address,uint256,bytes)` | payable |
| 0x31858452 | `executeBatch(uint256[],address[],uint256[],bytes[])` | payable |
| 0x54f6127f | `getData(bytes32)` | view |
| 0xdedff9c6 | `getDataBatch(bytes32[])` | view |
| 0xc4d66de8 | `initialize(address)` | payable |
| 0x1626ba7e | `isValidSignature(bytes32,bytes)` | view |
| 0x8da5cb5b | `owner()` | view |
| 0xe30c3978 | `pendingOwner()` | view |
| 0xead3fbdf | `RENOUNCE_OWNERSHIP_CONFIRMATION_DELAY()` | view |
| 0x01bfba61 | `RENOUNCE_OWNERSHIP_CONFIRMATION_PERIOD()` | view |
| 0x715018a6 | `renounceOwnership()` | nonpayable |
| 0x7f23690c | `setData(bytes32,bytes)` | payable |
| 0x97902421 | `setDataBatch(bytes32[],bytes[])` | payable |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view |
| 0xf2fde38b | `transferOwnership(address)` | nonpayable |
| 0x6bb56a14 | `universalReceiver(bytes32,bytes)` | payable |
| 0xffa1ad74 | `VERSION()` | view |

Events: `ContractCreated(uint256,address,uint256,bytes32)`, `DataChanged(bytes32,bytes)`, `Executed(uint256,address,uint256,bytes4)`, `Initialized(uint8)`, `OwnershipRenounced()`, `OwnershipTransferStarted(address,address)`, `OwnershipTransferred(address,address)`, `RenounceOwnershipStarted()`, `UniversalReceiver(address,uint256,bytes32,bytes,bytes)`

Errors: `ERC725X_ContractDeploymentFailed()`, `ERC725X_CreateOperationsRequireEmptyRecipientAddress()`, `ERC725X_ExecuteParametersEmptyArray()`, `ERC725X_ExecuteParametersLengthMismatch()`, `ERC725X_InsufficientBalance(uint256,uint256)`, `ERC725X_MsgValueDisallowedInDelegateCall()`, `ERC725X_MsgValueDisallowedInStaticCall()`, `ERC725X_NoContractBytecodeProvided()`, `ERC725X_UnknownOperationType(uint256)`, `ERC725Y_DataKeysValuesEmptyArray()`, `ERC725Y_DataKeysValuesLengthMismatch()`, `LSP14CallerNotPendingOwner(address)`, `LSP14CannotTransferOwnershipToSelf()`, `LSP14MustAcceptOwnershipInSeparateTransaction()`, `LSP14NotInRenounceOwnershipInterval(uint256,uint256)`, `LSP20CallVerificationFailed(bool,bytes4)`, `LSP20CallingVerifierFailed(bool)`, `LSP20EOACannotVerifyCall(address)`, `NoExtensionFoundForFunctionSelector(bytes4)`

Upstream delta vs main: external function surface changed: **false**.

## lsp-smart-contracts

npm `@lukso/lsp-smart-contracts` latest 0.17.4; upstream main 0.17.4.

Umbrella package: re-export shims of the per-LSP packages, the TypeScript constants (`PERMISSIONS`, `ERC725YDataKeys`, `INTERFACE_IDS`, `LSP1_TYPE_IDS`, …) and test mocks. No production function surface of its own.

## @erc725/smart-contracts

npm `@erc725/smart-contracts` 7.0.0 is what the LSP packages compile against (npm latest 8.x removed ERC725XCore/ERC725YCore and is not inventoried).

| Contract | Kind | Functions | Events | Errors | fallback / receive |
| --- | --- | --- | --- | --- | --- |
| ERC725 | deployable | 10 | 4 | 14 | - / - |
| ERC725Init | init | 11 | 5 | 14 | - / - |
| ERC725X | deployable | 6 | 3 | 11 | - / - |
| ERC725XInit | init | 7 | 4 | 11 | - / - |
| ERC725Y | deployable | 8 | 2 | 5 | - / - |
| ERC725YInit | init | 9 | 3 | 5 | - / - |

### ERC725 (deployable)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x44c028fe | `execute(uint256,address,uint256,bytes)` | payable |
| 0x31858452 | `executeBatch(uint256[],address[],uint256[],bytes[])` | payable |
| 0x54f6127f | `getData(bytes32)` | view |
| 0xdedff9c6 | `getDataBatch(bytes32[])` | view |
| 0x8da5cb5b | `owner()` | view |
| 0x715018a6 | `renounceOwnership()` | nonpayable |
| 0x7f23690c | `setData(bytes32,bytes)` | payable |
| 0x97902421 | `setDataBatch(bytes32[],bytes[])` | payable |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view |
| 0xf2fde38b | `transferOwnership(address)` | nonpayable |

Events: `ContractCreated(uint256,address,uint256,bytes32)`, `DataChanged(bytes32,bytes)`, `Executed(uint256,address,uint256,bytes4)`, `OwnershipTransferred(address,address)`

Errors: `ERC725X_ContractDeploymentFailed()`, `ERC725X_CreateOperationsRequireEmptyRecipientAddress()`, `ERC725X_ExecuteParametersEmptyArray()`, `ERC725X_ExecuteParametersLengthMismatch()`, `ERC725X_InsufficientBalance(uint256,uint256)`, `ERC725X_MsgValueDisallowedInDelegateCall()`, `ERC725X_MsgValueDisallowedInStaticCall()`, `ERC725X_NoContractBytecodeProvided()`, `ERC725X_UnknownOperationType(uint256)`, `ERC725Y_DataKeysValuesEmptyArray()`, `ERC725Y_DataKeysValuesLengthMismatch()`, `ERC725Y_MsgValueDisallowed()`, `OwnableCallerNotTheOwner(address)`, `OwnableCannotSetZeroAddressAsOwner()`

### ERC725Init (init)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x44c028fe | `execute(uint256,address,uint256,bytes)` | payable |
| 0x31858452 | `executeBatch(uint256[],address[],uint256[],bytes[])` | payable |
| 0x54f6127f | `getData(bytes32)` | view |
| 0xdedff9c6 | `getDataBatch(bytes32[])` | view |
| 0xc4d66de8 | `initialize(address)` | payable |
| 0x8da5cb5b | `owner()` | view |
| 0x715018a6 | `renounceOwnership()` | nonpayable |
| 0x7f23690c | `setData(bytes32,bytes)` | payable |
| 0x97902421 | `setDataBatch(bytes32[],bytes[])` | payable |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view |
| 0xf2fde38b | `transferOwnership(address)` | nonpayable |

Events: `ContractCreated(uint256,address,uint256,bytes32)`, `DataChanged(bytes32,bytes)`, `Executed(uint256,address,uint256,bytes4)`, `Initialized(uint8)`, `OwnershipTransferred(address,address)`

Errors: `ERC725X_ContractDeploymentFailed()`, `ERC725X_CreateOperationsRequireEmptyRecipientAddress()`, `ERC725X_ExecuteParametersEmptyArray()`, `ERC725X_ExecuteParametersLengthMismatch()`, `ERC725X_InsufficientBalance(uint256,uint256)`, `ERC725X_MsgValueDisallowedInDelegateCall()`, `ERC725X_MsgValueDisallowedInStaticCall()`, `ERC725X_NoContractBytecodeProvided()`, `ERC725X_UnknownOperationType(uint256)`, `ERC725Y_DataKeysValuesEmptyArray()`, `ERC725Y_DataKeysValuesLengthMismatch()`, `ERC725Y_MsgValueDisallowed()`, `OwnableCallerNotTheOwner(address)`, `OwnableCannotSetZeroAddressAsOwner()`

### ERC725X (deployable)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x44c028fe | `execute(uint256,address,uint256,bytes)` | payable |
| 0x31858452 | `executeBatch(uint256[],address[],uint256[],bytes[])` | payable |
| 0x8da5cb5b | `owner()` | view |
| 0x715018a6 | `renounceOwnership()` | nonpayable |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view |
| 0xf2fde38b | `transferOwnership(address)` | nonpayable |

Events: `ContractCreated(uint256,address,uint256,bytes32)`, `Executed(uint256,address,uint256,bytes4)`, `OwnershipTransferred(address,address)`

Errors: `ERC725X_ContractDeploymentFailed()`, `ERC725X_CreateOperationsRequireEmptyRecipientAddress()`, `ERC725X_ExecuteParametersEmptyArray()`, `ERC725X_ExecuteParametersLengthMismatch()`, `ERC725X_InsufficientBalance(uint256,uint256)`, `ERC725X_MsgValueDisallowedInDelegateCall()`, `ERC725X_MsgValueDisallowedInStaticCall()`, `ERC725X_NoContractBytecodeProvided()`, `ERC725X_UnknownOperationType(uint256)`, `OwnableCallerNotTheOwner(address)`, `OwnableCannotSetZeroAddressAsOwner()`

### ERC725XInit (init)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x44c028fe | `execute(uint256,address,uint256,bytes)` | payable |
| 0x31858452 | `executeBatch(uint256[],address[],uint256[],bytes[])` | payable |
| 0xc4d66de8 | `initialize(address)` | payable |
| 0x8da5cb5b | `owner()` | view |
| 0x715018a6 | `renounceOwnership()` | nonpayable |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view |
| 0xf2fde38b | `transferOwnership(address)` | nonpayable |

Events: `ContractCreated(uint256,address,uint256,bytes32)`, `Executed(uint256,address,uint256,bytes4)`, `Initialized(uint8)`, `OwnershipTransferred(address,address)`

Errors: `ERC725X_ContractDeploymentFailed()`, `ERC725X_CreateOperationsRequireEmptyRecipientAddress()`, `ERC725X_ExecuteParametersEmptyArray()`, `ERC725X_ExecuteParametersLengthMismatch()`, `ERC725X_InsufficientBalance(uint256,uint256)`, `ERC725X_MsgValueDisallowedInDelegateCall()`, `ERC725X_MsgValueDisallowedInStaticCall()`, `ERC725X_NoContractBytecodeProvided()`, `ERC725X_UnknownOperationType(uint256)`, `OwnableCallerNotTheOwner(address)`, `OwnableCannotSetZeroAddressAsOwner()`

### ERC725Y (deployable)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x54f6127f | `getData(bytes32)` | view |
| 0xdedff9c6 | `getDataBatch(bytes32[])` | view |
| 0x8da5cb5b | `owner()` | view |
| 0x715018a6 | `renounceOwnership()` | nonpayable |
| 0x7f23690c | `setData(bytes32,bytes)` | payable |
| 0x97902421 | `setDataBatch(bytes32[],bytes[])` | payable |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view |
| 0xf2fde38b | `transferOwnership(address)` | nonpayable |

Events: `DataChanged(bytes32,bytes)`, `OwnershipTransferred(address,address)`

Errors: `ERC725Y_DataKeysValuesEmptyArray()`, `ERC725Y_DataKeysValuesLengthMismatch()`, `ERC725Y_MsgValueDisallowed()`, `OwnableCallerNotTheOwner(address)`, `OwnableCannotSetZeroAddressAsOwner()`

### ERC725YInit (init)

| Selector | Signature | Mutability |
| --- | --- | --- |
| 0x54f6127f | `getData(bytes32)` | view |
| 0xdedff9c6 | `getDataBatch(bytes32[])` | view |
| 0xc4d66de8 | `initialize(address)` | payable |
| 0x8da5cb5b | `owner()` | view |
| 0x715018a6 | `renounceOwnership()` | nonpayable |
| 0x7f23690c | `setData(bytes32,bytes)` | payable |
| 0x97902421 | `setDataBatch(bytes32[],bytes[])` | payable |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view |
| 0xf2fde38b | `transferOwnership(address)` | nonpayable |

Events: `DataChanged(bytes32,bytes)`, `Initialized(uint8)`, `OwnershipTransferred(address,address)`

Errors: `ERC725Y_DataKeysValuesEmptyArray()`, `ERC725Y_DataKeysValuesLengthMismatch()`, `ERC725Y_MsgValueDisallowed()`, `OwnableCallerNotTheOwner(address)`, `OwnableCannotSetZeroAddressAsOwner()`

Unique errors: `ERC725X_ContractDeploymentFailed()`, `ERC725X_CreateOperationsRequireEmptyRecipientAddress()`, `ERC725X_ExecuteParametersEmptyArray()`, `ERC725X_ExecuteParametersLengthMismatch()`, `ERC725X_InsufficientBalance(uint256,uint256)`, `ERC725X_MsgValueDisallowedInDelegateCall()`, `ERC725X_MsgValueDisallowedInStaticCall()`, `ERC725X_NoContractBytecodeProvided()`, `ERC725X_UnknownOperationType(uint256)`, `ERC725Y_DataKeysValuesEmptyArray()`, `ERC725Y_DataKeysValuesLengthMismatch()`, `ERC725Y_MsgValueDisallowed()`, `OwnableCallerNotTheOwner(address)`, `OwnableCannotSetZeroAddressAsOwner()`

Unique events: `ContractCreated(uint256,address,uint256,bytes32)`, `DataChanged(bytes32,bytes)`, `Executed(uint256,address,uint256,bytes4)`, `Initialized(uint8)`, `OwnershipTransferred(address,address)`

Upstream monorepo main still depends on @erc725/smart-contracts ^7.0.0 (all 11 dependents). npm latest 8.0.1 (v8.0.0 removed ERC725XCore/ERC725YCore and OwnableUnset, switching to OZ OwnableUpgradeable per GitHub release notes) is NOT what the LSP packages compile against; its ABI was not inventoried.

## Spec constants and data keys (knowledge, not callable)

Parsed from the packages' `constants.ts` and `*Constants.sol` (identical to upstream main `16ab2441`).

### ERC165 interface IDs

| Name | Interface ID |
| --- | --- |
| ERC165 | 0x01ffc9a7 |
| ERC725X | 0x7545acac |
| ERC725Y | 0x629aa694 |
| ERC1271 | 0x1626ba7e |
| INTERFACE_ID_LSP0 | 0x24871b3d |
| INTERFACE_ID_LSP1 | 0x6bb56a14 |
| INTERFACE_ID_LSP1DELEGATE | 0xa245bbda |
| INTERFACE_ID_LSP6 | 0x23f34c62 |
| INTERFACE_ID_LSP9 | 0x28af17e6 |
| INTERFACE_ID_LSP11 | 0x23a45ef0 |
| INTERFACE_ID_LSP14 | 0x94be5999 |
| INTERFACE_ID_LSP17Extension | 0xcee78b40 |
| INTERFACE_ID_LSP17Extendable | 0xa918fa6b |
| INTERFACE_ID_LSP20CallVerification | 0x1a0eb6a5 |
| INTERFACE_ID_LSP20CallVerifier | 0x0d6ecac7 |
| INTERFACE_ID_LSP25 | 0x5ac79908 |

### LSP6 permission bit table (packages/lsp6-contracts/constants.ts PERMISSIONS)

| Permission | bytes32 value | bit |
| --- | --- | --- |
| CHANGEOWNER | 0x0000000000000000000000000000000000000000000000000000000000000001 | 0 |
| ADDCONTROLLER | 0x0000000000000000000000000000000000000000000000000000000000000002 | 1 |
| EDITPERMISSIONS | 0x0000000000000000000000000000000000000000000000000000000000000004 | 2 |
| ADDEXTENSIONS | 0x0000000000000000000000000000000000000000000000000000000000000008 | 3 |
| CHANGEEXTENSIONS | 0x0000000000000000000000000000000000000000000000000000000000000010 | 4 |
| ADDUNIVERSALRECEIVERDELEGATE | 0x0000000000000000000000000000000000000000000000000000000000000020 | 5 |
| CHANGEUNIVERSALRECEIVERDELEGATE | 0x0000000000000000000000000000000000000000000000000000000000000040 | 6 |
| REENTRANCY | 0x0000000000000000000000000000000000000000000000000000000000000080 | 7 |
| SUPER_TRANSFERVALUE | 0x0000000000000000000000000000000000000000000000000000000000000100 | 8 |
| TRANSFERVALUE | 0x0000000000000000000000000000000000000000000000000000000000000200 | 9 |
| SUPER_CALL | 0x0000000000000000000000000000000000000000000000000000000000000400 | 10 |
| CALL | 0x0000000000000000000000000000000000000000000000000000000000000800 | 11 |
| SUPER_STATICCALL | 0x0000000000000000000000000000000000000000000000000000000000001000 | 12 |
| STATICCALL | 0x0000000000000000000000000000000000000000000000000000000000002000 | 13 |
| SUPER_DELEGATECALL | 0x0000000000000000000000000000000000000000000000000000000000004000 | 14 |
| DELEGATECALL | 0x0000000000000000000000000000000000000000000000000000000000008000 | 15 |
| DEPLOY | 0x0000000000000000000000000000000000000000000000000000000000010000 | 16 |
| SUPER_SETDATA | 0x0000000000000000000000000000000000000000000000000000000000020000 | 17 |
| SETDATA | 0x0000000000000000000000000000000000000000000000000000000000040000 | 18 |
| ENCRYPT | 0x0000000000000000000000000000000000000000000000000000000000080000 | 19 |
| DECRYPT | 0x0000000000000000000000000000000000000000000000000000000000100000 | 20 |
| SIGN | 0x0000000000000000000000000000000000000000000000000000000000200000 | 21 |
| EXECUTE_RELAY_CALL | 0x0000000000000000000000000000000000000000000000000000000000400000 | 22 |

ALL_PERMISSIONS = `0x00000000000000000000000000000000000000000000000000000000007f3f7f` (all permissions except REENTRANCY, DELEGATECALL, SUPER_DELEGATECALL). _4337_PERMISSION = `0x0000000000000000000000000000000000000000000000000000000000800000` (bit 23; packages/lsp17-contracts/contracts/Extension4337.sol (internal constant; NOT in any constants.ts)). CALLTYPE: VALUE=0x00000001, CALL=0x00000002, STATICCALL=0x00000004, DELEGATECALL=0x00000008.

### ERC725Y data keys per standard

| Standard | Key name | Value |
| --- | --- | --- |
| LSP1 | LSP1UniversalReceiverDelegatePrefix | 0x0cfc51aec37c55a4d0b10000 |
| LSP1 | LSP1UniversalReceiverDelegate | 0x0cfc51aec37c55a4d0b1a65c6255c4bf2fbdf6277f3cc0730c45b828b6db8b47 |
| LSP3 | SupportedStandards_LSP3 | LSP3SupportedStandard.key |
| LSP3 | LSP3Profile | 0x5ef83ad9559033e6e941db7d7c495acdce616347d28e90c7ce47cbfcfcad3bc5 |
| LSP3 | SupportedStandards:LSP3Profile value | 0x5ef83ad9 |
| LSP5 | LSP5ReceivedAssetsMap | 0x812c4334633eb816c80d0000 |
| LSP5 | LSP5ReceivedAssets[] | length=0x6460ee3c0aac563ccbf76d6e1d07bada78e3a9514e6382b736ed3f478ab7b90b ; index=0x6460ee3c0aac563ccbf76d6e1d07bada |
| LSP6 | AddressPermissions[] | length=0xdf30dba06db6a30e65354d9a64c609861f089545ca58c6b4dbe31a5f338cb0e3 ; index=0xdf30dba06db6a30e65354d9a64c60986 |
| LSP6 | AddressPermissionsPrefix | 0x4b80742de2bf |
| LSP6 | AddressPermissions:Permissions | 0x4b80742de2bf82acb3630000 |
| LSP6 | AddressPermissions:AllowedERC725YDataKeys | 0x4b80742de2bf866c29110000 |
| LSP6 | AddressPermissions:AllowedCalls | 0x4b80742de2bf393a64c70000 |
| LSP9 | SupportedStandards_LSP9 | LSP9SupportedStandard.key |
| LSP9 | SupportedStandards:LSP9Vault value | 0x7c0334a1 |
| LSP10 | LSP10VaultsMap | 0x192448c3c0f88c7f238c0000 |
| LSP10 | LSP10Vaults[] | length=0x55482936e01da86729a45d2b87a6b1d3bc582bea0ec00e38bdb340e3af6f9f06 ; index=0x55482936e01da86729a45d2b87a6b1d3 |
| LSP12 | LSP12IssuedAssetsMap | 0x74ac2555c10b9349e78f0000 |
| LSP12 | LSP12IssuedAssets[] | length=0x7c8c3416d6cda87cd42c71ea1843df28ac4850354f988d55ee2eaa47b6dc05cd ; index=0x7c8c3416d6cda87cd42c71ea1843df28 |
| LSP17 | LSP17ExtensionPrefix | 0xcee78b4094da860110960000 |

### LSP1 type IDs

| Type ID name | bytes32 |
| --- | --- |
| LSP0ValueReceived | 0x9c4705229491d365fb5434052e12a386d6771d976bea61070a8c694e8affea3d |
| LSP0OwnershipTransferStarted | 0xe17117c9d2665d1dbeb479ed8058bbebde3c50ac50e2e65619f60006caac6926 |
| LSP0OwnershipTransferred_SenderNotification | 0xa4e59c931d14f7c8a7a35027f92ee40b5f2886b9fdcdb78f30bc5ecce5a2f814 |
| LSP0OwnershipTransferred_RecipientNotification | 0xceca317f109c43507871523e82dc2a3cc64dfa18f12da0b6db14f6e23f995538 |
| LSP9ValueReceived | 0x468cd1581d7bc001c3b685513d2b929b55437be34700410383d58f3aa1ea0abc |
| LSP9OwnershipTransferStarted | 0xaefd43f45fed1bcd8992f23c803b6f4ec45cf6b62b0d404d565f290a471e763f |
| LSP9OwnershipTransferred_SenderNotification | 0x0c622e58e6b7089ae35f1af1c86d997be92fcdd8c9509652022d41aa65169471 |
| LSP9OwnershipTransferred_RecipientNotification | 0x79855c97dbc259ce395421d933d7bc0699b0f1561f988f09a9e8633fd542fe5c |
| LSP14OwnershipTransferStarted | 0xee9a7c0924f740a2ca33d59b7f0c2929821ea9837ce043ce91c1823e9c4e52c0 |
| LSP14OwnershipTransferred_SenderNotification | 0xa124442e1cc7b52d8e2ede2787d43527dc1f3ae0de87f50dd03e27a71834f74c |
| LSP14OwnershipTransferred_RecipientNotification | 0xe32c7debcb817925ba4883fdbfc52797187f28f73f860641dab1a68d9b32902c |
| LSP7Tokens_SenderNotification | 0x429ac7a06903dbc9c13dfcb3c9d11df8194581fa047c96d7a4171fc7402958ea |
| LSP7Tokens_RecipientNotification | 0x20804611b3e2ea21c480dc465142210acf4a2485947541770ec1fb87dee4a55c |
| LSP7Tokens_OperatorNotification | 0x386072cc5a58e61263b434c722725f21031cd06e7c552cfaa06db5de8a320dbc |
| LSP7Tokens_VotesDelegatorNotification | 0x6117a486162c4ba8e38d646ef52b1e0e1be6bef05a980c041e232eba8c95e16f |
| LSP7Tokens_VotesDelegateeNotification | 0x72cad372b29cde295ff0839b7b194597766b88f5fad4f7d6aef013e0c55dc492 |
| LSP8Tokens_SenderNotification | 0xb23eae7e6d1564b295b4c3e3be402d9a2f0776c57bdf365903496f6fa481ab00 |
| LSP8Tokens_RecipientNotification | 0x0b084a55ebf70fd3c06fd755269dac2212c4d3f0f4d09079780bfa50c1b2984d |
| LSP8Tokens_OperatorNotification | 0x8a1c15a8799f71b547e08e2bcb2e85257e81b0a07eee2ce6712549eef1f00970 |
| LSP8Tokens_VotesDelegateeNotification | 0x19419598f788eae88574bbb83ec563ad0cb43cd7ddbbc88857b2efa2d8faa8eb |
| LSP8Tokens_VotesDelegatorNotification | 0x2f6d3f668c2e57dbae4c255f2d9e0b69d47a8848d69a2251cce137529e34743e |

Type IDs handled by **LSP1UniversalReceiverDelegateUP**: LSP7Tokens_SenderNotification, LSP7Tokens_RecipientNotification, LSP8Tokens_SenderNotification, LSP8Tokens_RecipientNotification, LSP9OwnershipTransferred_SenderNotification, LSP9OwnershipTransferred_RecipientNotification (writes LSP5ReceivedAssets[] / LSP5ReceivedAssetsMap and LSP10Vaults[] / LSP10VaultsMap). By **LSP1UniversalReceiverDelegateVault**: LSP7Tokens_SenderNotification, LSP7Tokens_RecipientNotification, LSP8Tokens_SenderNotification, LSP8Tokens_RecipientNotification.

### Other spec items

- **LSP2**: LSP2 ERC725Y JSON Schema: {name, key (bytes32), keyType: Singleton|Array|Mapping|MappingWithGrouping, valueType, valueContent}. Package ships only a library (LSP2Utils, internal functions, no ABI entrypoint) and TS types Verification{method,data,source?} and LSP2ArrayKey{length,index}. Solidity constants (LSP2Constants.sol): _KECCAK256_UTF8=0x6f357c6a, _KECCAK256_BYTES=0x8019f9b1, _KECCAK256_ECDSA=0xac75a10e (verification method ids).

- **LSP3**: LSP3ProfileMetadataJSON = { LSP3Profile: { name, description, links?[{title,url}], tags?[], profileImage?[ImageMetadata], backgroundImage?[ImageMetadata], avatar?[FileAsset|ContractAsset] } } (TS types only; no contracts/ABI in this package). SupportedStandards:LSP3Profile key `0xeafec4d89fa9619884b600005ef83ad9559033e6e941db7d7c495acdce616347` value `0x5ef83ad9`.

- **LSP0**: ERC1271_VALUES {"SUCCESS_VALUE":"0x1626ba7e","FAIL_VALUE":"0xffffffff"}; OPERATION_TYPES {"CALL":"0","CREATE":"1","CREATE2":"2","STATICCALL":"3","DELEGATECALL":"4"}.

- **LSP16**: standardized deployment {"address":"0x1600016e23e25D20CA8759338BfB8A8d11563C4e","salt":"0xfaee762dee0012026f5380724e9744bdc5dd26ecd8f584fe9d72a4170d01c049","via":"Nick's Factory 0x4e59b44847b379578588920cA78FbF26c0B4956C","source":"LIP-16 (LSPs/LSP-16-UniversalFactory.md)"}.

- **LSP17**: _LSP17_EXTENSION_PREFIX = 0xcee78b4094da86011096 (bytes10) — extension lookup key = prefix + bytes2(0) + bytes4 selector + bytes16(0); _INTERFACEID_LSP17_EXTENDABLE=0xa918fa6b, _INTERFACEID_LSP17_EXTENSION=0xcee78b40.

- **LSP20**: success values {"VERIFY_CALL":{"NO_POST_VERIFICATION":"0xde928f00","WITH_POST_VERIFICATION":"0xde928f01"},"VERIFY_CALL_RESULT":"0xd3fc45d3"} (LSP20_SUCCESS_VALUES in lsp20-contracts/constants.ts).

- **LSP23**: {"LSP23LinkedContractsFactory":{"address":"0x2300000A84D25dF63081feAa37ba6b62C4c89a30","salt":"0x12a6712f113536d8b01d99f72ce168c7e1090124db54cd16f03c20000022178c"},"UniversalProfilePostDeploymentModule":{"address":"0x0000005aD606bcFEF9Ea6D0BbE5b79847054BcD7","salt":"0x42ff55d7957589c62da54a4368b10a2bc549f2038bbb6880ec6b3e0ecae2ba58"},"UniversalProfileInitPostDeploymentModule":{"address":"0x000000000066093407b6704B89793beFfD0D8F00","salt":"0x12a6712f113536d8b01d99f72ce168c7e10901240d73e80eeb821d01aa4c2b1a"},"via":"Nick's Factory 0x4e59b44847b379578588920cA78FbF26c0B4956C","source":"lsp23-contracts deployment modules + LIP-23"}.

- **LSP25**: LSP25_VERSION = 25. EIP-191 v0 signed message layout: 0x19 0x00 || keyManagerAddress || LSP25_VERSION || chainId || nonce || validityTimestamps || msg.value || payload (see ILSP25ExecuteRelayCall natspec).

- **@erc725/smart-contracts 7.0.0**: INTERFACE_ID ERC725X=0x7545acac, ERC725Y=0x629aa694; OPERATION_TYPE CALL=0 CREATE=1 CREATE2=2 STATICCALL=3 DELEGATECALL=4 (@erc725/smart-contracts constants).

## LIPs ↔ package map

Directory listing of https://github.com/lukso-network/LIPs/tree/main/LSPs at commit `4fec5e2ff863ca44358718d8be7cf7dd0ebeeccd` (2026-02-20T14:50:05Z); 24 LSP files present.

| LSP | File | Package in monorepo | Kind |
| --- | --- | --- | --- |
| 0 | LSP-0-ERC725Account.md | lsp0-contracts | contract standard |
| 1 | LSP-1-UniversalReceiver.md | lsp1-contracts (+ lsp1delegate-contracts implementations) | contract standard |
| 2 | LSP-2-ERC725YJSONSchema.md | lsp2-contracts | data-format standard (ERC725Y JSON schema; library only) |
| 3 | LSP-3-Profile-Metadata.md | lsp3-contracts | data-format standard (metadata JSON + data keys; no ABI) |
| 4 | LSP-4-DigitalAsset-Metadata.md | lsp4-contracts (see functions-tokens.md) | data-format standard |
| 5 | LSP-5-ReceivedAssets.md | lsp5-contracts | data keys + library |
| 6 | LSP-6-KeyManager.md | lsp6-contracts | contract standard |
| 7 | LSP-7-DigitalAsset.md | lsp7-contracts (see functions-tokens.md) | contract standard |
| 8 | LSP-8-IdentifiableDigitalAsset.md | lsp8-contracts (see functions-tokens.md) | contract standard |
| 9 | LSP-9-Vault.md | lsp9-contracts | contract standard |
| 10 | LSP-10-ReceivedVaults.md | lsp10-contracts | data keys + library |
| 11 | LSP-11-BasicSocialRecovery.md | lsp11-contracts | contract standard |
| 12 | LSP-12-IssuedAssets.md | lsp12-contracts | data keys only |
| 14 | LSP-14-Ownable2Step.md | lsp14-contracts | contract standard (abstract + interface) |
| 15 | LSP-15-TransactionRelayServiceAPI.md | — (none) | spec-only (Transaction Relay Service API; off-chain) |
| 16 | LSP-16-UniversalFactory.md | lsp16-contracts | contract standard |
| 17 | LSP-17-ContractExtension.md | lsp17contractextension-contracts (+ lsp17-contracts extensions) | contract standard |
| 18 | LSP-18-Royalties.md | — (none) | spec-only (Royalties data keys; no package in monorepo) |
| 20 | LSP-20-CallVerification.md | lsp20-contracts | contract standard (abstract + interface) |
| 23 | LSP-23-LinkedContractsFactory.md | lsp23-contracts | contract standard |
| 25 | LSP-25-ExecuteRelayCall.md | lsp25-contracts | contract standard (abstract + interface) |
| 26 | LSP-26-FollowerSystem.md | lsp26-contracts (see functions-tokens.md) | contract standard |
| 28 | LSP-28-TheGrid.md | — (none) | spec-only (The Grid; data format) |
| 30 | LSP-30-ERC725AccountBackupFile.md | — (none) | spec-only (ERC725Account Backup File; data format) |

LSP numbers absent from the LIPs directory: 13, 19, 21, 22, 24, 27, 29 (no files). LSP15, LSP18, LSP28, LSP30 have no package in the monorepo at either commit.
