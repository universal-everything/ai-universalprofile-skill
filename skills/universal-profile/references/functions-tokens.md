# Function inventory: tokens, follower system and reference standards

Every external function of the LUKSO token and social packages (LSP4 metadata, LSP7 fungible tokens, LSP8 NFTs, LSP26 follower system) and of the generic Ethereum standards the skill bundles ABIs for (ERC-20/2612/721/1155/165/1271/777, ERC-4337 EntryPoint v0.6–v0.9 and the bundler RPC, ERC-1967/1167 proxies, Multicall3, Permit2, WETH9, Uniswap Universal Router, CoW GPv2Settlement). Account-stack functions are in `references/functions-account.md`; bindings per signature in `references/functions-bindings.md`.

Provenance: LUKSO packages from compiled ABIs (identical in function surface to upstream main `16ab2441a79c34da56386c30caa00c33379ce06f` except the deltas noted per package); reference standards from the ERC texts and pinned sources (OpenZeppelin v5.7.0, eth-infinitism release tags, the Uniswap, CoW, Multicall3 and Permit2 repositories). ERC-165 interface ids were recomputed as XOR of selectors and all match. Protocol addresses are **not** listed here — use `assets/registry/protocols.json` and verify code on-chain before value moves.

Binding legend: **verb** = dedicated `up` command (CLI) / `up_*` tool (MCP) — see `references/verbs.md` for the exact flags; **generic** = reachable with `abi encode` + `exec send`/`contract call` (no dedicated verb); **internal** = used inside the skill's own flows; **knowledge** = documented, not invoked. Mutability `view`/`pure` = read with `contract read`/`exec call`; `nonpayable`/`payable` = a transaction executed *as the profile*.

## ERC-165 interface ids (recomputed, all match the declared ids)

| Interface | Id | Note |
|---|---|---|
| ERC725Y (4 fns) | 0x629aa694 |  |
| LSP17Extendable | 0xa918fa6b | bytes4(keccak256("LSP17Extendable")) per LIP-17 line 45 |
| ILSP7DigitalAsset (12 fns) ^ ERC725Y ^ LSP17 | 0xc52d6008 | LIP-7 line 58: XOR of the LSP7 cheat-sheet interface (which includes ERC725Y getData/setData/getDataBatch/setDataBatch) and the LSP17 Extendable id. XOR of the 12 ILSP7DigitalAsset ABI functions alone = 0x0eaf3cf7 |
| ILSP8IdentifiableDigitalAsset (15 fns) ^ ERC725Y ^ LSP17 | 0x3a271706 | LIP-8 line 62, same construction. XOR of the 15 ILSP8 ABI functions alone = 0xf1a54bf9 |
| ILSP26FollowerSystem (9 fns) | 0x2b299cea |  |
| IAccessControlExtended (3 directly-declared fns) | 0x90832245 | Solidity type(I).interfaceId excludes functions inherited from IAccessControlEnumerable/IAccessControl |
| IAccessControl (OZ) | 0x7965db0b |  |
| IAccessControlEnumerable (OZ) | 0x5a05180f |  |
| IERC165 | 0x01ffc9a7 |  |
| IERC721 | 0x80ac58cd |  |
| IERC721Metadata | 0x5b5e139f |  |
| IERC721Enumerable | 0x780e9d63 |  |
| IERC721Receiver | 0x150b7a02 |  |
| IERC1155 | 0xd9b67a26 |  |
| IERC1155TokenReceiver | 0x4e2312e0 |  |
| IERC1155MetadataURI | 0x0e89341c |  |
| IERC1271 | 0x1626ba7e |  |

## lsp4-contracts (`@lukso/lsp4-contracts`)

npm latest 0.17.3; upstream main 0.17.3.

### Contracts

| Contract | Group | Kind | Deployable |
|---|---|---|---|
| LSP4DigitalAssetMetadata | core | abstract | no |
| LSP4DigitalAssetMetadataInitAbstract | core | init-abstract | no |
| LSP4Utils | core | library | yes |

Kinds: `interface` = ABI only; `abstract`/`init-abstract` = base contract, not deployable; `deployable`/`init(deployable)` = concrete preset (Init = proxy implementation); test mocks omitted.

### Functions: 9

| Selector | Signature | Mutability | Defined by | Binding |
|---|---|---|---|---|
| 0x54f6127f | `getData(bytes32)` | view | ERC725Y (IERC725Y) | verb `token metadata` (LSP4 keys) |
| 0xdedff9c6 | `getDataBatch(bytes32[])` | view | ERC725Y (IERC725Y) | verb `token metadata` (LSP4 keys) |
| 0x8da5cb5b | `owner()` | view | Ownable (OZ, via LSP4DigitalAssetMetadata/ERC725Y) | generic (issuer; single-step Ownable, not LSP14) |
| 0x715018a6 | `renounceOwnership()` | nonpayable | Ownable (OZ, via LSP4DigitalAssetMetadata/ERC725Y) | generic (issuer; single-step Ownable, not LSP14) |
| 0x7f23690c | `setData(bytes32,bytes)` | payable | ERC725Y (IERC725Y) | generic (issuer) |
| 0x97902421 | `setDataBatch(bytes32[],bytes[])` | payable | ERC725Y (IERC725Y) | generic (issuer) |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view | ERC165 (IERC165) | internal (standard detection) |
| 0x4821954f | `toLSP4MetadataJSON(string,string,(string,string)[],(string,string,string)[],((uint256,uint256,string,(string,bytes32))[],(address)[],(address,bytes32)[]),(((uint256,uint256,string,(string,bytes32))[],(address)[],(address,bytes32)[])[]),((string,string,(string,bytes32))[],(address)[],(address,bytes32)[]))` | pure | LSP4Utils (library external function) | knowledge (LSP4 metadata JSON builder reference) |
| 0xf2fde38b | `transferOwnership(address)` | nonpayable | Ownable (OZ, via LSP4DigitalAssetMetadata/ERC725Y) | generic (issuer; single-step Ownable, not LSP14) |

### Events (unique, non-mock): 3

| topic0 | Event signature |
|---|---|
| 0xece574603820d07bc9b91f2a932baadf4628aabcb8afba49776529c14a6104b2 | `DataChanged(bytes32,bytes)` |
| 0x7f26b83ff96e1f2b6a682f133852f6798a09c465da95921460cefb3847402498 | `Initialized(uint8)` |
| 0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0 | `OwnershipTransferred(address,address)` |

### Custom errors (unique, non-mock): 7

| Selector | Error signature |
|---|---|
| 0x97da5f95 | `ERC725Y_DataKeysValuesEmptyArray()` |
| 0x3bcc8979 | `ERC725Y_DataKeysValuesLengthMismatch()` |
| 0xf36ba737 | `ERC725Y_MsgValueDisallowed()` |
| 0x85c169bd | `LSP4TokenNameNotEditable()` |
| 0x76755b38 | `LSP4TokenSymbolNotEditable()` |
| 0x4ef6d7fb | `LSP4TokenTypeNotEditable()` |
| 0x1ad8836c | `OwnableCannotSetZeroAddressAsOwner()` |

### Upstream delta (already included in the bundled ABIs)

Note: Upstream 0.17.x releases are build/tooling only (Hardhat v3, hardhat-packager, dependency bumps). No ABI change.

### Constants

```json
{
  "LSP4SupportedStandard": {
    "key": "0xeafec4d89fa9619884b60000a4d96624a38f7ac2d8d9a604ecf07c12c77e480c",
    "value": "0xa4d96624"
  },
  "dataKeys": {
    "LSP4TokenName": "0xdeba1e292f8ba88238e10ab3c7f88bd4be4fac56cad5194b6ecceaf653468af1",
    "LSP4TokenSymbol": "0x2f0a68ab07768e01943a599e73362a0e17a63a72e94dd2e384d2c1d4db932756",
    "LSP4TokenType": "0xe0261fa95db2eb3b5439bd033cda66d56b96f92f243a8228fd87550ed7bdfdb3",
    "LSP4Metadata": "0x9afb95cacc9f95858ec44aa8c3b685511002e30ae54415823f406128b85b238e",
    "LSP4CreatorsMap": "0x6de85eaf5d982b4e5da00000",
    "LSP4Creators[]": {
      "length": "0x114bd03b3a46d48759680d81ebb2b414fda7d030a7105a851867accf1c2352e7",
      "index": "0x114bd03b3a46d48759680d81ebb2b414"
    }
  },
  "LSP4_TOKEN_TYPES": {
    "TOKEN": 0,
    "NFT": 1,
    "COLLECTION": 2
  }
}
```

## lsp7-contracts (`@lukso/lsp7-contracts`)

npm latest 0.18.1; upstream main 0.18.1.

### Contracts

| Contract | Group | Kind | Deployable |
|---|---|---|---|
| ILSP7DigitalAsset | core | interface | no |
| LSP7DigitalAsset | core | abstract | no |
| LSP7DigitalAssetInitAbstract | core | init-abstract | no |
| AccessControlExtendedAbstract | extensions | abstract | no |
| AccessControlExtendedInitAbstract | extensions | init-abstract | no |
| IAccessControlExtended | extensions | interface | no |
| LSP7Burnable | extensions | abstract | no |
| LSP7BurnableInitAbstract | extensions | init-abstract | no |
| ILSP7CappedBalance | extensions | interface | no |
| LSP7CappedBalanceAbstract | extensions | abstract | no |
| LSP7CappedBalanceInitAbstract | extensions | init-abstract | no |
| ILSP7CappedSupply | extensions | interface | no |
| LSP7CappedSupplyAbstract | extensions | abstract | no |
| LSP7CappedSupplyInitAbstract | extensions | init-abstract | no |
| ILSP7Mintable | extensions | interface | no |
| LSP7MintableAbstract | extensions | abstract | no |
| LSP7MintableInitAbstract | extensions | init-abstract | no |
| ILSP7NonTransferable | extensions | interface | no |
| LSP7NonTransferableAbstract | extensions | abstract | no |
| LSP7NonTransferableInitAbstract | extensions | init-abstract | no |
| ILSP7Revokable | extensions | interface | no |
| LSP7RevokableAbstract | extensions | abstract | no |
| LSP7RevokableInitAbstract | extensions | init-abstract | no |
| LSP7Votes | extensions | abstract | no |
| LSP7VotesInitAbstract | extensions | init-abstract | no |
| LSP7CustomizableToken | presets | deployable | yes |
| LSP7CustomizableTokenInit | presets | init(deployable) | yes |
| LSP7Mintable | presets | deployable | yes |
| LSP7MintableInit | presets | init(deployable) | yes |

Kinds: `interface` = ABI only; `abstract`/`init-abstract` = base contract, not deployable; `deployable`/`init(deployable)` = concrete preset (Init = proxy implementation); test mocks omitted.

### Functions: 65

| Selector | Signature | Mutability | Defined by | Binding |
|---|---|---|---|---|
| 0x4bf5d7e9 | `CLOCK_MODE()` | view | ERC-6372 (IERC6372) | generic (issuer / extension) |
| 0xa217fddf | `DEFAULT_ADMIN_ROLE()` | view | AccessControl (OZ IAccessControl) | generic (issuer / extension) |
| 0x3644e515 | `DOMAIN_SEPARATOR()` | view | Votes (OZ v4.9 governance/utils/Votes.sol) | generic (issuer / extension) |
| 0xd5391393 | `MINTER_ROLE()` | view | Role constant getters (extension public constants) | generic (issuer / extension) |
| 0x12318ac4 | `NON_TRANSFERABLE_BYPASS_ROLE()` | view | Role constant getters (extension public constants) | generic (issuer / extension) |
| 0x7c4acabf | `REVOKER_ROLE()` | view | Role constant getters (extension public constants) | generic (issuer / extension) |
| 0x94187753 | `UNCAPPED_BALANCE_ROLE()` | view | Role constant getters (extension public constants) | generic (issuer / extension) |
| 0xb49506fd | `authorizeOperator(address,uint256,bytes)` | nonpayable | ILSP7DigitalAsset | verb `token approve` |
| 0x65aeaa95 | `authorizedAmountFor(address,address)` | view | ILSP7DigitalAsset | verb `token operators` |
| 0x70a08231 | `balanceOf(address)` | view | ILSP7DigitalAsset | verb `token balance` |
| 0x6963d438 | `batchCalls(bytes[])` | nonpayable | ILSP7DigitalAsset | generic |
| 0x44d17187 | `burn(address,uint256,bytes)` | nonpayable | LSP7Burnable (extension) | generic (issuer / extension) |
| 0xf1127ed8 | `checkpoints(address,uint32)` | view | Votes (OZ v4.9 governance/utils/Votes.sol) | generic (issuer / extension) |
| 0x91ddadf4 | `clock()` | view | ERC-6372 (IERC6372) | generic (issuer / extension) |
| 0x313ce567 | `decimals()` | view | ILSP7DigitalAsset | verb `token metadata` |
| 0x78381670 | `decreaseAllowance(address,address,uint256,bytes)` | nonpayable | ILSP7DigitalAsset | verb `token approve` (decrease) |
| 0x5c19a95c | `delegate(address)` | nonpayable | IVotes (OZ) / ERC-5805 | generic (issuer / extension) |
| 0xc3cda520 | `delegateBySig(address,uint256,uint256,uint8,bytes32,bytes32)` | nonpayable | IVotes (OZ) / ERC-5805 | generic (issuer / extension) |
| 0x587cde1e | `delegates(address)` | view | IVotes (OZ) / ERC-5805 | generic (issuer / extension) |
| 0x7e5cd5c1 | `disableMinting()` | nonpayable | ILSP7Mintable (extension) | generic (issuer / extension) |
| 0xc282ca78 | `disableRevokable()` | nonpayable | ILSP7Revokable (extension) | generic (issuer / extension) |
| 0x84b0196e | `eip712Domain()` | view | ERC-5267 (IERC5267) | generic (issuer / extension) |
| 0x54f6127f | `getData(bytes32)` | view | ERC725Y (IERC725Y) | verb `token metadata` (LSP4 keys) |
| 0xdedff9c6 | `getDataBatch(bytes32[])` | view | ERC725Y (IERC725Y) | verb `token metadata` (LSP4 keys) |
| 0xd72fc29a | `getOperatorsOf(address)` | view | ILSP7DigitalAsset | verb `token operators` |
| 0x8e539e8c | `getPastTotalSupply(uint256)` | view | IVotes (OZ) / ERC-5805 | generic (issuer / extension) |
| 0x3a46b1a8 | `getPastVotes(address,uint256)` | view | IVotes (OZ) / ERC-5805 | generic (issuer / extension) |
| 0x248a9ca3 | `getRoleAdmin(bytes32)` | view | AccessControl (OZ IAccessControl) | generic (issuer / extension) |
| 0x9010d07c | `getRoleMember(bytes32,uint256)` | view | IAccessControlExtended (extension) | generic (issuer / extension) |
| 0xca15c873 | `getRoleMemberCount(bytes32)` | view | IAccessControlExtended (extension) | generic (issuer / extension) |
| 0xa3246ad3 | `getRoleMembers(bytes32)` | view | IAccessControlExtended (extension) | generic (issuer / extension) |
| 0x9ab24eb0 | `getVotes(address)` | view | IVotes (OZ) / ERC-5805 | generic (issuer / extension) |
| 0x2f2ff15d | `grantRole(bytes32,address)` | nonpayable | AccessControl (OZ IAccessControl) | generic (issuer / extension) |
| 0x91d14854 | `hasRole(bytes32,address)` | view | AccessControl (OZ IAccessControl) | generic (issuer / extension) |
| 0x2bc1da82 | `increaseAllowance(address,uint256,bytes)` | nonpayable | ILSP7DigitalAsset | verb `token approve` (increase) |
| 0x04689a81 | `initialize(string,string,address,uint256,bool)` | nonpayable | Preset initializer (proxy/Init variant) | generic (issuer / extension) |
| 0x15f71630 | `initialize(string,string,address,uint256,bool,(bool,uint256),(uint256,uint256),(uint256,uint256),(bool))` | nonpayable | Preset initializer (proxy/Init variant) | generic (issuer / extension) |
| 0x46b45af7 | `isMintable()` | view | ILSP7Mintable (extension) | generic (issuer / extension) |
| 0x9e045773 | `isRevokable()` | view | ILSP7Revokable (extension) | generic (issuer / extension) |
| 0x2121dc75 | `isTransferable()` | view | ILSP7NonTransferable (extension) | generic (issuer / extension) |
| 0x696fd68c | `makeTransferable()` | nonpayable | ILSP7NonTransferable (extension) | generic (issuer / extension) |
| 0x7580d920 | `mint(address,uint256,bool,bytes)` | nonpayable | ILSP7Mintable (extension) | generic (issuer / extension) |
| 0x7ecebe00 | `nonces(address)` | view | Votes (OZ v4.9 governance/utils/Votes.sol) | generic (issuer / extension) |
| 0x6fcfff45 | `numCheckpoints(address)` | view | Votes (OZ v4.9 governance/utils/Votes.sol) | generic (issuer / extension) |
| 0x8da5cb5b | `owner()` | view | Ownable (OZ, via LSP4DigitalAssetMetadata/ERC725Y) | generic (issuer; single-step Ownable, not LSP14) |
| 0x715018a6 | `renounceOwnership()` | nonpayable | Ownable (OZ, via LSP4DigitalAssetMetadata/ERC725Y) | generic (issuer; single-step Ownable, not LSP14) |
| 0x36568abe | `renounceRole(bytes32,address)` | nonpayable | AccessControl (OZ IAccessControl) | generic (issuer / extension) |
| 0xf5fb0b0c | `revoke(address,address,uint256,bytes)` | nonpayable | ILSP7Revokable (extension) | generic (issuer / extension) |
| 0x30d0dc37 | `revokeOperator(address,address,bool,bytes)` | nonpayable | ILSP7DigitalAsset | verb `token approve` (revoke) |
| 0xd547741f | `revokeRole(bytes32,address)` | nonpayable | AccessControl (OZ IAccessControl) | generic (issuer / extension) |
| 0x2de94807 | `rolesOf(address)` | view | IAccessControlExtended (extension) | generic (issuer / extension) |
| 0x7f23690c | `setData(bytes32,bytes)` | payable | ERC725Y (IERC725Y) | generic (issuer) |
| 0x97902421 | `setDataBatch(bytes32[],bytes[])` | payable | ERC725Y (IERC725Y) | generic (issuer) |
| 0x1e4e0091 | `setRoleAdmin(bytes32,bytes32)` | nonpayable | IAccessControlExtended (extension) | generic (issuer / extension) |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view | ERC165 (IERC165) | internal (standard detection) |
| 0xd1ca0188 | `tokenBalanceCap()` | view | ILSP7CappedBalance / ILSP8CappedBalance (extension) | generic (issuer / extension) |
| 0x52058d8a | `tokenSupplyCap()` | view | ILSP7CappedSupply / ILSP8CappedSupply (extension) | generic (issuer / extension) |
| 0x18160ddd | `totalSupply()` | view | ILSP7DigitalAsset | verb `token metadata` |
| 0x760d9bba | `transfer(address,address,uint256,bool,bytes)` | nonpayable | ILSP7DigitalAsset | verb `token transfer` (force + receiver-hook warnings) |
| 0x2d7667c9 | `transferBatch(address[],address[],uint256[],bool[],bytes[])` | nonpayable | ILSP7DigitalAsset | verb `token transfer` (batch) |
| 0xecff3a0c | `transferLockEnabled()` | view | ILSP7NonTransferable (extension) | generic (issuer / extension) |
| 0x8fb05730 | `transferLockEnd()` | view | ILSP7NonTransferable (extension) | generic (issuer / extension) |
| 0xe6fc6098 | `transferLockStart()` | view | ILSP7NonTransferable (extension) | generic (issuer / extension) |
| 0xf2fde38b | `transferOwnership(address)` | nonpayable | Ownable (OZ, via LSP4DigitalAssetMetadata/ERC725Y) | generic (issuer; single-step Ownable, not LSP14) |
| 0x45e14c46 | `updateTransferLockPeriod(uint256,uint256)` | nonpayable | ILSP7NonTransferable (extension) | generic (issuer / extension) |

### Overloads (same name, different signature) within the package

- `initialize`: `initialize(string,string,address,uint256,bool)` vs `initialize(string,string,address,uint256,bool,(bool,uint256),(uint256,uint256),(uint256,uint256),(bool))`

### Events (unique, non-mock): 15

| topic0 | Event signature |
|---|---|
| 0xece574603820d07bc9b91f2a932baadf4628aabcb8afba49776529c14a6104b2 | `DataChanged(bytes32,bytes)` |
| 0x3134e8a2e6d97e929a7e54011ea5485d7d196dd5f0ba4d4ef95803e8e3fc257f | `DelegateChanged(address,address,address)` |
| 0xdec2bacdd2f05b59de34da9b523dff8be42e5e38e818c82fdb0bae774387a724 | `DelegateVotesChanged(address,uint256,uint256)` |
| 0x0a6387c9ea3628b88a633bb4f3b151770f70085117a15f9bf3787cda53f13d31 | `EIP712DomainChanged()` |
| 0x7f26b83ff96e1f2b6a682f133852f6798a09c465da95921460cefb3847402498 | `Initialized(uint8)` |
| 0x41f386d449eec03c1c3b75bbba9c18df70aa19779ff47f68eab4b6a66fb399d4 | `MintingStatusChanged(bool)` |
| 0xf772a43bfdf4729b196e3fb54a818b91a2ca6c49d10b2e16278752f9f515c25d | `OperatorAuthorizationChanged(address,address,uint256,bytes)` |
| 0x0ebf5762d8855cbe012d2ca42fb33a81175e17c8a8751f8859931ba453bd4167 | `OperatorRevoked(address,address,bool,bytes)` |
| 0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0 | `OwnershipTransferred(address,address)` |
| 0x67e25b3c9018f015458c04997debf5769d7c1727a0918c43acfe4daf80ac7017 | `RevokableStatusChanged(bool)` |
| 0xbd79b86ffe0ab8e8776151514217cd7cacd52c909f66475c3af44e129f0b00ff | `RoleAdminChanged(bytes32,bytes32,bytes32)` |
| 0x2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d | `RoleGranted(bytes32,address,address)` |
| 0xf6391f5c32d9c69d2a47ea670b442974b53935d1edc7fd64eb21e047a839171b | `RoleRevoked(bytes32,address,address)` |
| 0x3997e418d2cef0b3b0e907b1e39605c3f7d32dbd061e82ea5b4a770d46a160a6 | `Transfer(address,address,address,uint256,bool,bytes)` |
| 0x938e6c55d25d181f86d200da26970f962ec97adb02dfa0452811fb9073573ebe | `TransferLockPeriodChanged(uint256,uint256)` |

### Custom errors (unique, non-mock): 42

| Selector | Error signature |
|---|---|
| 0x6697b232 | `AccessControlBadConfirmation()` |
| 0xd0dc904b | `AccessControlCannotSetAdminForDefaultAdminRole()` |
| 0xe2517d3f | `AccessControlUnauthorizedAccount(address,bytes32)` |
| 0x97da5f95 | `ERC725Y_DataKeysValuesEmptyArray()` |
| 0x3bcc8979 | `ERC725Y_DataKeysValuesLengthMismatch()` |
| 0xf36ba737 | `ERC725Y_MsgValueDisallowed()` |
| 0x42bfe79f | `InvalidExtensionAddress(bytes)` |
| 0xe5099ee3 | `InvalidFunctionSelector(bytes)` |
| 0xb3512b0c | `InvalidShortString()` |
| 0x85c169bd | `LSP4TokenNameNotEditable()` |
| 0x76755b38 | `LSP4TokenSymbolNotEditable()` |
| 0x4ef6d7fb | `LSP4TokenTypeNotEditable()` |
| 0xf3a6b691 | `LSP7AmountExceedsAuthorizedAmount(address,uint256,address,uint256)` |
| 0x08d47949 | `LSP7AmountExceedsBalance(uint256,address,uint256)` |
| 0xb774c284 | `LSP7BatchCallFailed(uint256)` |
| 0xd2d5ec30 | `LSP7CannotSendWithAddressZero()` |
| 0x2561c3fe | `LSP7CannotUpdateTransferLockPeriod()` |
| 0x6355e766 | `LSP7CannotUseAddressZeroAsOperator()` |
| 0x8eb9dd52 | `LSP7CappedBalanceExceeded(address,uint256,uint256,uint256)` |
| 0xeacbf0d1 | `LSP7CappedSupplyCannotMintOverCap()` |
| 0x98ce2945 | `LSP7DecreaseAllowanceNotAuthorized(address,address,address)` |
| 0x0ef76c35 | `LSP7DecreasedAllowanceBelowZero()` |
| 0x263eee8d | `LSP7InvalidTransferBatch()` |
| 0xd41cc2a8 | `LSP7InvalidTransferLockPeriod()` |
| 0xe6334421 | `LSP7MintDisabled()` |
| 0xa608fbb6 | `LSP7NotifyTokenReceiverContractMissingLSP1Interface(address)` |
| 0x26c247f4 | `LSP7NotifyTokenReceiverIsEOA(address)` |
| 0x3aeb5e9f | `LSP7RevokableFeatureDisabled()` |
| 0x1a525b32 | `LSP7RevokeOperatorNotAuthorized(address,address,address)` |
| 0xc99ae814 | `LSP7TokenAlreadyTransferable()` |
| 0x388f5adc | `LSP7TokenContractCannotHoldValue()` |
| 0xdab75047 | `LSP7TokenOwnerCannotBeOperator()` |
| 0x2077e686 | `LSP7TransferDisabled()` |
| 0x631ceb64 | `LSP7VotesBrokenClockMode()` |
| 0xdac920f1 | `LSP7VotesExceededSafeSupply(uint256,uint256)` |
| 0x824ef7b7 | `LSP7VotesFutureLookup(uint256)` |
| 0x308d5651 | `LSP7VotesInvalidNonce(address,uint256)` |
| 0x6441b62a | `LSP7VotesSignatureExpired(uint256)` |
| 0xbb370b2b | `NoExtensionFoundForFunctionSelector(bytes4)` |
| 0xcba6e977 | `OperatorAllowanceCannotBeIncreasedFromZero(address)` |
| 0x1ad8836c | `OwnableCannotSetZeroAddressAsOwner()` |
| 0x305a27a9 | `StringTooLong(string)` |

### Upstream delta (already included in the bundled ABIs)

| Change | Selector | Signature | Mutability | Where | Release / provenance |
|---|---|---|---|---|---|
| removed in 0.18.0 | 0xecff3a0c | `transferLockEnabled()` | view | ILSP7NonTransferable + NonTransferable abstracts + LSP7CustomizableToken(Init) | 0.18.0 (BREAKING, commit 3b851ef) |
| added upstream | 0x34ac6823 | `nonTransferabilityEnabled()` | view | ILSP7NonTransferable + NonTransferable abstracts + LSP7CustomizableToken(Init) | 0.18.0 (rename of transferLockEnabled()) |
| added upstream | 0x44d17187 | `burn(address,uint256,bytes)` | nonpayable | LSP7Mintable and LSP7MintableInit presets now also inherit LSP7Burnable | upstream main (after 0.18.0; CHANGELOG entry not found for this change — observed only in source diff) |

| Event | Before 0.18 | Upstream main | topic0 before | topic0 upstream |
|---|---|---|---|---|
| TransferLockPeriodChanged | `TransferLockPeriodChanged(uint256 indexed start,uint256 indexed end)` | `TransferLockPeriodChanged(bool indexed nonTransferabilityEnabled,uint256 indexed start,uint256 indexed end)` | 0x938e6c55d25d181f86d200da26970f962ec97adb02dfa0452811fb9073573ebe | 0x425e44dd36676a155d17433393a65b24c8fbb83d07ee2fa66bb951209797ff86 |
| TokenRevoked | (absent) | `TokenRevoked(address indexed revoker,address indexed from,address indexed to,uint256 amount,bytes data)` | - | 0xc79ed966fe53e80f30edef56e9886c915a5998e4d6657f8bce72164709670388 |

Note: upstream 0.17.0 also changed compiler settings (solc 0.8.28, prague). The ILSP7DigitalAsset core surface is unchanged upstream.

### Constants

```json
{
  "INTERFACE_ID_LSP7": "0xc52d6008",
  "INTERFACE_ID_LSP7_PREVIOUS": {
    "v0.14.0": "0xb3c4928f",
    "v0.12.0": "0xdaa746b7"
  },
  "INTERFACE_ID_ACCESS_CONTROL_EXTENDED": "0x90832245",
  "ROLES": {
    "MINTER": "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6",
    "UNCAPPED_BALANCE": "0x975773d1e0a917a74b57f36a377f439ffff6271648aebdbff75a52ab58eb7bad",
    "NON_TRANSFERABLE_BYPASS": "0xb4b3a36d7c2b72add3151898671aaed843238e580f7d6d4bc5077ce2023b0659",
    "REVOKER": "0xce3f34913921da558f105cefb578d87278debbbd073a8d552b5de0d168deee30"
  },
  "LSP7_TYPE_IDS": {
    "LSP7Tokens_SenderNotification": "0x429ac7a06903dbc9c13dfcb3c9d11df8194581fa047c96d7a4171fc7402958ea",
    "LSP7Tokens_RecipientNotification": "0x20804611b3e2ea21c480dc465142210acf4a2485947541770ec1fb87dee4a55c",
    "LSP7Tokens_OperatorNotification": "0x386072cc5a58e61263b434c722725f21031cd06e7c552cfaa06db5de8a320dbc",
    "LSP7Tokens_VotesDelegatorNotification": "0x6117a486162c4ba8e38d646ef52b1e0e1be6bef05a980c041e232eba8c95e16f",
    "LSP7Tokens_VotesDelegateeNotification": "0x72cad372b29cde295ff0839b7b194597766b88f5fad4f7d6aef013e0c55dc492"
  },
  "legacyUnusedSolidityConstants": {
    "_TYPEID_LSP7_DELEGATOR": "0x997bd66a7e7823b09383ec7ce65fc306af29b8f82a45627f8efc0408475de016",
    "_TYPEID_LSP7_DELEGATEE": "0x03fae98a28026f93c23e2c9438c2ef0faa101585127a89919d18f067d907b319",
    "note": "Defined in LSP7Constants.sol lines 14/17 but referenced nowhere else in contracts/; LSP7Votes uses _TYPEID_LSP7_VOTESDELEGATOR/-DELEGATEE from LSP7VotesConstants.sol which match constants.ts."
  }
}
```

## lsp8-contracts (`@lukso/lsp8-contracts`)

npm latest 0.18.1; upstream main 0.18.1.

### Contracts

| Contract | Group | Kind | Deployable |
|---|---|---|---|
| ILSP8IdentifiableDigitalAsset | core | interface | no |
| LSP8IdentifiableDigitalAsset | core | abstract | no |
| LSP8IdentifiableDigitalAssetInitAbstract | core | init-abstract | no |
| AccessControlExtendedAbstract | extensions | abstract | no |
| AccessControlExtendedInitAbstract | extensions | init-abstract | no |
| IAccessControlExtended | extensions | interface | no |
| LSP8Burnable | extensions | abstract | no |
| LSP8BurnableInitAbstract | extensions | init-abstract | no |
| ILSP8CappedBalance | extensions | interface | no |
| LSP8CappedBalanceAbstract | extensions | abstract | no |
| LSP8CappedBalanceInitAbstract | extensions | init-abstract | no |
| ILSP8CappedSupply | extensions | interface | no |
| LSP8CappedSupplyAbstract | extensions | abstract | no |
| LSP8CappedSupplyInitAbstract | extensions | init-abstract | no |
| LSP8Enumerable | extensions | abstract | no |
| LSP8EnumerableInitAbstract | extensions | init-abstract | no |
| ILSP8Mintable | extensions | interface | no |
| LSP8MintableAbstract | extensions | abstract | no |
| LSP8MintableInitAbstract | extensions | init-abstract | no |
| ILSP8NonTransferable | extensions | interface | no |
| LSP8NonTransferableAbstract | extensions | abstract | no |
| LSP8NonTransferableInitAbstract | extensions | init-abstract | no |
| ILSP8Revokable | extensions | interface | no |
| LSP8RevokableAbstract | extensions | abstract | no |
| LSP8RevokableInitAbstract | extensions | init-abstract | no |
| LSP8Votes | extensions | abstract | no |
| LSP8VotesInitAbstract | extensions | init-abstract | no |
| LSP8CustomizableToken | presets | deployable | yes |
| LSP8CustomizableTokenInit | presets | init(deployable) | yes |
| LSP8Mintable | presets | deployable | yes |
| LSP8MintableInit | presets | init(deployable) | yes |

Kinds: `interface` = ABI only; `abstract`/`init-abstract` = base contract, not deployable; `deployable`/`init(deployable)` = concrete preset (Init = proxy implementation); test mocks omitted.

### Functions: 67

| Selector | Signature | Mutability | Defined by | Binding |
|---|---|---|---|---|
| 0x4bf5d7e9 | `CLOCK_MODE()` | view | ERC-6372 (IERC6372) | generic (issuer / extension) |
| 0xa217fddf | `DEFAULT_ADMIN_ROLE()` | view | AccessControl (OZ IAccessControl) | generic (issuer / extension) |
| 0x3644e515 | `DOMAIN_SEPARATOR()` | view | Votes (OZ v4.9 governance/utils/Votes.sol) | generic (issuer / extension) |
| 0xd5391393 | `MINTER_ROLE()` | view | Role constant getters (extension public constants) | generic (issuer / extension) |
| 0x12318ac4 | `NON_TRANSFERABLE_BYPASS_ROLE()` | view | Role constant getters (extension public constants) | generic (issuer / extension) |
| 0x7c4acabf | `REVOKER_ROLE()` | view | Role constant getters (extension public constants) | generic (issuer / extension) |
| 0x94187753 | `UNCAPPED_BALANCE_ROLE()` | view | Role constant getters (extension public constants) | generic (issuer / extension) |
| 0x86a10ddd | `authorizeOperator(address,bytes32,bytes)` | nonpayable | ILSP8IdentifiableDigitalAsset | verb `token approve` |
| 0x70a08231 | `balanceOf(address)` | view | ILSP8IdentifiableDigitalAsset | verb `token balance` |
| 0x6963d438 | `batchCalls(bytes[])` | nonpayable | ILSP8IdentifiableDigitalAsset | generic |
| 0x6c79b70b | `burn(bytes32,bytes)` | nonpayable | LSP8Burnable (extension) | generic (issuer / extension) |
| 0x91ddadf4 | `clock()` | view | ERC-6372 (IERC6372) | generic (issuer / extension) |
| 0x5c19a95c | `delegate(address)` | nonpayable | IVotes (OZ) / ERC-5805 | generic (issuer / extension) |
| 0xc3cda520 | `delegateBySig(address,uint256,uint256,uint8,bytes32,bytes32)` | nonpayable | IVotes (OZ) / ERC-5805 | generic (issuer / extension) |
| 0x587cde1e | `delegates(address)` | view | IVotes (OZ) / ERC-5805 | generic (issuer / extension) |
| 0x7e5cd5c1 | `disableMinting()` | nonpayable | ILSP8Mintable (extension) | generic (issuer / extension) |
| 0xc282ca78 | `disableRevokable()` | nonpayable | ILSP8Revokable (extension) | generic (issuer / extension) |
| 0x84b0196e | `eip712Domain()` | view | ERC-5267 (IERC5267) | generic (issuer / extension) |
| 0x54f6127f | `getData(bytes32)` | view | ERC725Y (IERC725Y) | verb `token metadata` (LSP4 keys) |
| 0xdedff9c6 | `getDataBatch(bytes32[])` | view | ERC725Y (IERC725Y) | verb `token metadata` (LSP4 keys) |
| 0x1d26fce6 | `getDataBatchForTokenIds(bytes32[],bytes32[])` | nonpayable | ILSP8IdentifiableDigitalAsset | verb `token metadata` (token-id) (multi) |
| 0x16e023b3 | `getDataForTokenId(bytes32,bytes32)` | nonpayable | ILSP8IdentifiableDigitalAsset | verb `token metadata` (token-id) (read via eth_call) |
| 0x49a6078d | `getOperatorsOf(bytes32)` | view | ILSP8IdentifiableDigitalAsset | verb `token operators` |
| 0x8e539e8c | `getPastTotalSupply(uint256)` | view | IVotes (OZ) / ERC-5805 | generic (issuer / extension) |
| 0x3a46b1a8 | `getPastVotes(address,uint256)` | view | IVotes (OZ) / ERC-5805 | generic (issuer / extension) |
| 0x248a9ca3 | `getRoleAdmin(bytes32)` | view | AccessControl (OZ IAccessControl) | generic (issuer / extension) |
| 0x9010d07c | `getRoleMember(bytes32,uint256)` | view | IAccessControlExtended (extension) | generic (issuer / extension) |
| 0xca15c873 | `getRoleMemberCount(bytes32)` | view | IAccessControlExtended (extension) | generic (issuer / extension) |
| 0xa3246ad3 | `getRoleMembers(bytes32)` | view | IAccessControlExtended (extension) | generic (issuer / extension) |
| 0x9ab24eb0 | `getVotes(address)` | view | IVotes (OZ) / ERC-5805 | generic (issuer / extension) |
| 0x2f2ff15d | `grantRole(bytes32,address)` | nonpayable | AccessControl (OZ IAccessControl) | generic (issuer / extension) |
| 0x91d14854 | `hasRole(bytes32,address)` | view | AccessControl (OZ IAccessControl) | generic (issuer / extension) |
| 0x74823132 | `initialize(string,string,address,uint256,uint256)` | nonpayable | Preset initializer (proxy/Init variant) | generic (issuer / extension) |
| 0x48c4f93e | `initialize(string,string,address,uint256,uint256,(bool,bytes32[]),(uint256,uint256),(uint256,uint256),(bool))` | nonpayable | Preset initializer (proxy/Init variant) | generic (issuer / extension) |
| 0x46b45af7 | `isMintable()` | view | ILSP8Mintable (extension) | generic (issuer / extension) |
| 0x2a3654a4 | `isOperatorFor(address,bytes32)` | view | ILSP8IdentifiableDigitalAsset | verb `token operators` |
| 0x9e045773 | `isRevokable()` | view | ILSP8Revokable (extension) | generic (issuer / extension) |
| 0x2121dc75 | `isTransferable()` | view | ILSP8NonTransferable (extension) | generic (issuer / extension) |
| 0x696fd68c | `makeTransferable()` | nonpayable | ILSP8NonTransferable (extension) | generic (issuer / extension) |
| 0xaf255b61 | `mint(address,bytes32,bool,bytes)` | nonpayable | ILSP8Mintable (extension) | generic (issuer / extension) |
| 0x7ecebe00 | `nonces(address)` | view | Votes (OZ v4.9 governance/utils/Votes.sol) | generic (issuer / extension) |
| 0x8da5cb5b | `owner()` | view | Ownable (OZ, via LSP4DigitalAssetMetadata/ERC725Y) | generic (issuer; single-step Ownable, not LSP14) |
| 0x715018a6 | `renounceOwnership()` | nonpayable | Ownable (OZ, via LSP4DigitalAssetMetadata/ERC725Y) | generic (issuer; single-step Ownable, not LSP14) |
| 0x36568abe | `renounceRole(bytes32,address)` | nonpayable | AccessControl (OZ IAccessControl) | generic (issuer / extension) |
| 0x84bfc8eb | `revoke(address,address,bytes32,bytes)` | nonpayable | ILSP8Revokable (extension) | generic (issuer / extension) |
| 0xdb8c9663 | `revokeOperator(address,bytes32,bool,bytes)` | nonpayable | ILSP8IdentifiableDigitalAsset | verb `token approve` (revoke) |
| 0xd547741f | `revokeRole(bytes32,address)` | nonpayable | AccessControl (OZ IAccessControl) | generic (issuer / extension) |
| 0x2de94807 | `rolesOf(address)` | view | IAccessControlExtended (extension) | generic (issuer / extension) |
| 0x7f23690c | `setData(bytes32,bytes)` | payable | ERC725Y (IERC725Y) | generic (issuer) |
| 0x97902421 | `setDataBatch(bytes32[],bytes[])` | payable | ERC725Y (IERC725Y) | generic (issuer) |
| 0xbe9f0e6f | `setDataBatchForTokenIds(bytes32[],bytes32[],bytes[])` | nonpayable | ILSP8IdentifiableDigitalAsset | generic (issuer action) |
| 0xd6c1407c | `setDataForTokenId(bytes32,bytes32,bytes)` | nonpayable | ILSP8IdentifiableDigitalAsset | generic (issuer action) |
| 0x1e4e0091 | `setRoleAdmin(bytes32,bytes32)` | nonpayable | IAccessControlExtended (extension) | generic (issuer / extension) |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view | ERC165 (IERC165) | internal (standard detection) |
| 0x92a91a3a | `tokenAt(uint256)` | view | LSP8Enumerable (extension) | generic (issuer / extension) |
| 0xd1ca0188 | `tokenBalanceCap()` | view | ILSP7CappedBalance / ILSP8CappedBalance (extension) | generic (issuer / extension) |
| 0xa3b261f2 | `tokenIdsOf(address)` | view | ILSP8IdentifiableDigitalAsset | verb `token list` |
| 0x217b2270 | `tokenOwnerOf(bytes32)` | view | ILSP8IdentifiableDigitalAsset | verb `token metadata` (token-id) |
| 0x52058d8a | `tokenSupplyCap()` | view | ILSP7CappedSupply / ILSP8CappedSupply (extension) | generic (issuer / extension) |
| 0x18160ddd | `totalSupply()` | view | ILSP8IdentifiableDigitalAsset | verb `token metadata` |
| 0x511b6952 | `transfer(address,address,bytes32,bool,bytes)` | nonpayable | ILSP8IdentifiableDigitalAsset | verb `token transfer` (tokenId) |
| 0x7e87632c | `transferBatch(address[],address[],bytes32[],bool[],bytes[])` | nonpayable | ILSP8IdentifiableDigitalAsset | verb `token transfer` (batch) |
| 0xecff3a0c | `transferLockEnabled()` | view | ILSP8NonTransferable (extension) | generic (issuer / extension) |
| 0x8fb05730 | `transferLockEnd()` | view | ILSP8NonTransferable (extension) | generic (issuer / extension) |
| 0xe6fc6098 | `transferLockStart()` | view | ILSP8NonTransferable (extension) | generic (issuer / extension) |
| 0xf2fde38b | `transferOwnership(address)` | nonpayable | Ownable (OZ, via LSP4DigitalAssetMetadata/ERC725Y) | generic (issuer; single-step Ownable, not LSP14) |
| 0x45e14c46 | `updateTransferLockPeriod(uint256,uint256)` | nonpayable | ILSP8NonTransferable (extension) | generic (issuer / extension) |

### Overloads (same name, different signature) within the package

- `initialize`: `initialize(string,string,address,uint256,uint256)` vs `initialize(string,string,address,uint256,uint256,(bool,bytes32[]),(uint256,uint256),(uint256,uint256),(bool))`

### Events (unique, non-mock): 16

| topic0 | Event signature |
|---|---|
| 0xece574603820d07bc9b91f2a932baadf4628aabcb8afba49776529c14a6104b2 | `DataChanged(bytes32,bytes)` |
| 0x3134e8a2e6d97e929a7e54011ea5485d7d196dd5f0ba4d4ef95803e8e3fc257f | `DelegateChanged(address,address,address)` |
| 0xdec2bacdd2f05b59de34da9b523dff8be42e5e38e818c82fdb0bae774387a724 | `DelegateVotesChanged(address,uint256,uint256)` |
| 0x0a6387c9ea3628b88a633bb4f3b151770f70085117a15f9bf3787cda53f13d31 | `EIP712DomainChanged()` |
| 0x7f26b83ff96e1f2b6a682f133852f6798a09c465da95921460cefb3847402498 | `Initialized(uint8)` |
| 0x41f386d449eec03c1c3b75bbba9c18df70aa19779ff47f68eab4b6a66fb399d4 | `MintingStatusChanged(bool)` |
| 0x1b1b58aa2ec0cec2228b2d37124556d41f5a1f7b12f089171f896cc236671215 | `OperatorAuthorizationChanged(address,address,bytes32,bytes)` |
| 0xc78cd419d6136f9f1c1c6aec1d3fae098cffaf8bc86314a8f2685e32fe574e3c | `OperatorRevoked(address,address,bytes32,bool,bytes)` |
| 0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0 | `OwnershipTransferred(address,address)` |
| 0x67e25b3c9018f015458c04997debf5769d7c1727a0918c43acfe4daf80ac7017 | `RevokableStatusChanged(bool)` |
| 0xbd79b86ffe0ab8e8776151514217cd7cacd52c909f66475c3af44e129f0b00ff | `RoleAdminChanged(bytes32,bytes32,bytes32)` |
| 0x2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d | `RoleGranted(bytes32,address,address)` |
| 0xf6391f5c32d9c69d2a47ea670b442974b53935d1edc7fd64eb21e047a839171b | `RoleRevoked(bytes32,address,address)` |
| 0xa6e4251f855f750545fe414f120db91c76b88def14d120969e5bb2d3f05debbb | `TokenIdDataChanged(bytes32,bytes32,bytes)` |
| 0xb333c813a7426a7a11e2b190cad52c44119421594b47f6f32ace6d8c7207b2bf | `Transfer(address,address,address,bytes32,bool,bytes)` |
| 0x938e6c55d25d181f86d200da26970f962ec97adb02dfa0452811fb9073573ebe | `TransferLockPeriodChanged(uint256,uint256)` |

### Custom errors (unique, non-mock): 42

| Selector | Error signature |
|---|---|
| 0x6697b232 | `AccessControlBadConfirmation()` |
| 0xd0dc904b | `AccessControlCannotSetAdminForDefaultAdminRole()` |
| 0xe2517d3f | `AccessControlUnauthorizedAccount(address,bytes32)` |
| 0x97da5f95 | `ERC725Y_DataKeysValuesEmptyArray()` |
| 0x3bcc8979 | `ERC725Y_DataKeysValuesLengthMismatch()` |
| 0xf36ba737 | `ERC725Y_MsgValueDisallowed()` |
| 0x42bfe79f | `InvalidExtensionAddress(bytes)` |
| 0xe5099ee3 | `InvalidFunctionSelector(bytes)` |
| 0xb3512b0c | `InvalidShortString()` |
| 0x85c169bd | `LSP4TokenNameNotEditable()` |
| 0x76755b38 | `LSP4TokenSymbolNotEditable()` |
| 0x4ef6d7fb | `LSP4TokenTypeNotEditable()` |
| 0x234eb819 | `LSP8BatchCallFailed(uint256)` |
| 0x24ecef4d | `LSP8CannotSendToAddressZero()` |
| 0x18d504ce | `LSP8CannotUpdateTransferLockPeriod()` |
| 0x9577b8b3 | `LSP8CannotUseAddressZeroAsOperator()` |
| 0xe6bf112c | `LSP8CappedBalanceExceeded(address,uint256,uint256)` |
| 0xe8ba2291 | `LSP8CappedSupplyCannotMintOverCap()` |
| 0x93a83119 | `LSP8InvalidTransferBatch()` |
| 0x9e33937e | `LSP8InvalidTransferLockPeriod()` |
| 0x4d8af03d | `LSP8MintDisabled()` |
| 0xae8f9a36 | `LSP8NonExistentTokenId(bytes32)` |
| 0x4aa31a8c | `LSP8NonExistingOperator(address,bytes32)` |
| 0x1294d2a9 | `LSP8NotTokenOperator(bytes32,address)` |
| 0x5b271ea2 | `LSP8NotTokenOwner(address,bytes32,address)` |
| 0x4349776d | `LSP8NotifyTokenReceiverContractMissingLSP1Interface(address)` |
| 0x03173137 | `LSP8NotifyTokenReceiverIsEOA(address)` |
| 0xa7626b68 | `LSP8OperatorAlreadyAuthorized(address,bytes32)` |
| 0x973495bf | `LSP8RevokableFeatureDisabled()` |
| 0x760b5acd | `LSP8RevokeOperatorNotAuthorized(address,address,bytes32)` |
| 0xe8587b0b | `LSP8TokenAlreadyTransferable()` |
| 0x61f49442 | `LSP8TokenContractCannotHoldValue()` |
| 0x34c7b511 | `LSP8TokenIdAlreadyMinted(bytes32)` |
| 0x3664800a | `LSP8TokenIdFormatNotEditable()` |
| 0x80c98305 | `LSP8TokenIdsDataEmptyArray()` |
| 0x2fa71dfe | `LSP8TokenIdsDataLengthMismatch()` |
| 0x89fdad62 | `LSP8TokenOwnerCannotBeOperator()` |
| 0x5a9c31d3 | `LSP8TokenOwnerChanged(bytes32,address,address)` |
| 0x9ade4142 | `LSP8TransferDisabled()` |
| 0xbb370b2b | `NoExtensionFoundForFunctionSelector(bytes4)` |
| 0x1ad8836c | `OwnableCannotSetZeroAddressAsOwner()` |
| 0x305a27a9 | `StringTooLong(string)` |

### Upstream delta (already included in the bundled ABIs)

| Change | Selector | Signature | Mutability | Where | Release / provenance |
|---|---|---|---|---|---|
| removed in 0.18.0 | 0xecff3a0c | `transferLockEnabled()` | view | ILSP8NonTransferable + NonTransferable abstracts + LSP8CustomizableToken(Init) | 0.18.0 (BREAKING, commit 3b851ef) |
| added upstream | 0x34ac6823 | `nonTransferabilityEnabled()` | view | ILSP8NonTransferable + NonTransferable abstracts + LSP8CustomizableToken(Init) | 0.18.0 (rename of transferLockEnabled()) |
| added upstream | 0x6c79b70b | `burn(bytes32,bytes)` | nonpayable | LSP8Mintable and LSP8MintableInit presets now also inherit LSP8Burnable | upstream main (after 0.18.0; CHANGELOG entry not found for this change — observed only in source diff) |

| Event | Before 0.18 | Upstream main | topic0 before | topic0 upstream |
|---|---|---|---|---|
| TransferLockPeriodChanged | `TransferLockPeriodChanged(uint256 indexed start,uint256 indexed end)` | `TransferLockPeriodChanged(bool indexed nonTransferabilityEnabled,uint256 indexed start,uint256 indexed end)` | 0x938e6c55d25d181f86d200da26970f962ec97adb02dfa0452811fb9073573ebe | 0x425e44dd36676a155d17433393a65b24c8fbb83d07ee2fa66bb951209797ff86 |
| TokenRevoked | (absent) | `TokenRevoked(address indexed revoker,address indexed from,address indexed to,bytes32 tokenId,bytes data)` | - | 0xa0e44189cd74cca42b38714145390a2883cea7e03e260877ac743db0b43eb7df |

Note: the ILSP8IdentifiableDigitalAsset core surface is unchanged upstream.

### Constants

```json
{
  "INTERFACE_ID_LSP8": "0x3a271706",
  "INTERFACE_ID_LSP8_PREVIOUS": {
    "v0.14.0": "0xecad9f75",
    "v0.12.0": "0x30dc5278"
  },
  "INTERFACE_ID_ACCESS_CONTROL_EXTENDED": "0x90832245",
  "ROLES": {
    "MINTER": "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6",
    "UNCAPPED_BALANCE": "0x975773d1e0a917a74b57f36a377f439ffff6271648aebdbff75a52ab58eb7bad",
    "NON_TRANSFERABLE_BYPASS": "0xb4b3a36d7c2b72add3151898671aaed843238e580f7d6d4bc5077ce2023b0659",
    "REVOKER": "0xce3f34913921da558f105cefb578d87278debbbd073a8d552b5de0d168deee30"
  },
  "LSP8DataKeys": {
    "LSP8TokenIdFormat": "0xf675e9361af1c1664c1868cfa3eb97672d6b1a513aa5b81dec34c9ee330e818d",
    "LSP8TokenMetadataBaseURI": "0x1a7628600c3bac7101f53697f48df381ddc36b9015e7d7c9c5633d1252aa2843",
    "LSP8ReferenceContract": "0x708e7b881795f2e6b6c2752108c177ec89248458de3bf69d0d43480b3e5034e6"
  },
  "LSP8_TYPE_IDS": {
    "LSP8Tokens_SenderNotification": "0xb23eae7e6d1564b295b4c3e3be402d9a2f0776c57bdf365903496f6fa481ab00",
    "LSP8Tokens_RecipientNotification": "0x0b084a55ebf70fd3c06fd755269dac2212c4d3f0f4d09079780bfa50c1b2984d",
    "LSP8Tokens_OperatorNotification": "0x8a1c15a8799f71b547e08e2bcb2e85257e81b0a07eee2ce6712549eef1f00970",
    "LSP8Tokens_VotesDelegateeNotification": "0x19419598f788eae88574bbb83ec563ad0cb43cd7ddbbc88857b2efa2d8faa8eb",
    "LSP8Tokens_VotesDelegatorNotification": "0x2f6d3f668c2e57dbae4c255f2d9e0b69d47a8848d69a2251cce137529e34743e"
  },
  "LSP8_TOKEN_ID_FORMAT": {
    "NUMBER": 0,
    "STRING": 1,
    "ADDRESS": 2,
    "UNIQUE_ID": 3,
    "HASH": 4,
    "MIXED_DEFAULT_NUMBER": 100,
    "MIXED_DEFAULT_STRING": 101,
    "MIXED_DEFAULT_ADDRESS": 102,
    "MIXED_DEFAULT_UNIQUE_ID": 103,
    "MIXED_DEFAULT_HASH": 104
  }
}
```

## lsp26-contracts (`@lukso/lsp26-contracts`)

npm latest 0.1.7; upstream main 0.2.3.

### Contracts

| Contract | Group | Kind | Deployable |
|---|---|---|---|
| ILSP26FollowerSystem | core | interface | no |
| LSP26FollowerSystem | core | deployable | yes |

Kinds: `interface` = ABI only; `abstract`/`init-abstract` = base contract, not deployable; `deployable`/`init(deployable)` = concrete preset (Init = proxy implementation); test mocks omitted.

### Functions: 9

| Selector | Signature | Mutability | Defined by | Binding |
|---|---|---|---|---|
| 0x4dbf27cc | `follow(address)` | nonpayable | ILSP26FollowerSystem | verb `follow` |
| 0xcf8711c8 | `followBatch(address[])` | nonpayable | ILSP26FollowerSystem | verb `follow` (batch) |
| 0x30b3a890 | `followerCount(address)` | view | ILSP26FollowerSystem | verb `followers` |
| 0x64548707 | `followingCount(address)` | view | ILSP26FollowerSystem | verb `followers` |
| 0xb2a8d069 | `getFollowersByIndex(address,uint256,uint256)` | view | ILSP26FollowerSystem | verb `followers` |
| 0x5a39c581 | `getFollowsByIndex(address,uint256,uint256)` | view | ILSP26FollowerSystem | verb `followers` |
| 0x99ec3a42 | `isFollowing(address,address)` | view | ILSP26FollowerSystem | verb `is-following` |
| 0x015a4ead | `unfollow(address)` | nonpayable | ILSP26FollowerSystem | verb `unfollow` |
| 0x8dd1e47e | `unfollowBatch(address[])` | nonpayable | ILSP26FollowerSystem | verb `unfollow` (batch) |

### Events (unique, non-mock): 2

| topic0 | Event signature |
|---|---|
| 0xbccc71dc7842b86291138666aa18e133ee6d41aa71e6d7c650debad1a0576635 | `Follow(address,address)` |
| 0x083700fd0d85112c9d8c5823585c7542e8fadb693c9902e5bc590ab367f7a15e | `Unfollow(address,address)` |

### Custom errors (unique, non-mock): 3

| Selector | Error signature |
|---|---|
| 0x6feacbf6 | `LSP26AlreadyFollowing(address)` |
| 0xea619542 | `LSP26CannotSelfFollow()` |
| 0xc70bad4e | `LSP26NotFollowing(address)` |

### Upstream delta (already included in the bundled ABIs)

Note: Upstream package.json is 0.2.3 but npm dist-tags.latest is still 0.1.7 (0.2.x not published to npm as of query time). No ABI change.

### Constants

```json
{
  "INTERFACE_ID_LSP26": "0x2b299cea",
  "LSP26_TYPE_IDS": {
    "LSP26FollowerSystem_FollowNotification": "0x71e02f9f05bcd5816ec4f3134aa2e5a916669537ec6c77fe66ea595fabc2d51a",
    "LSP26FollowerSystem_UnfollowNotification": "0x9d3c0b4012b69658977b099bdaa51eff0f0460f421fba96d15669506c00d1c4f"
  }
}
```

## Reference standards (scope B)

Signatures were extracted from the fetched EIP/ERC markdown and canonical GitHub sources listed per table; selectors are recomputed here. Mutability is as declared in the cited source.

### ERC-20

Spec: ERC-20 Token Standard (Final)  
Sources: <https://github.com/ethereum/ERCs/blob/f4df3d0537d54d05dc428ff10243171ba26073a8/ERCS/erc-20.md>, <https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.7.0/contracts/token/ERC20/IERC20.sol>

Functions (6):

| Selector | Signature | Mutability | Returns | Note |
|---|---|---|---|---|
| 0x18160ddd | `totalSupply()` | view | `uint256` |  |
| 0x70a08231 | `balanceOf(address)` | view | `uint256` |  |
| 0xa9059cbb | `transfer(address,uint256)` | nonpayable | `bool` |  |
| 0xdd62ed3e | `allowance(address,address)` | view | `uint256` |  |
| 0x095ea7b3 | `approve(address,uint256)` | nonpayable | `bool` |  |
| 0x23b872dd | `transferFrom(address,address,uint256)` | nonpayable | `bool` |  |

Events:

| topic0 | Signature | Note |
|---|---|---|
| 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef | `Transfer(address,address,uint256)` |  |
| 0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925 | `Approval(address,address,uint256)` |  |

Note: ERC-20 defines no ERC-165 id. name()/symbol()/decimals() are OPTIONAL in the EIP; OZ IERC20Metadata groups them.

### ERC-20 Metadata (optional)

Spec: ERC-20 optional methods  
Sources: <https://github.com/ethereum/ERCs/blob/f4df3d0537d54d05dc428ff10243171ba26073a8/ERCS/erc-20.md>, <https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.7.0/contracts/token/ERC20/extensions/IERC20Metadata.sol>

Functions (3):

| Selector | Signature | Mutability | Returns | Note |
|---|---|---|---|---|
| 0x06fdde03 | `name()` | view | `string` |  |
| 0x95d89b41 | `symbol()` | view | `string` |  |
| 0x313ce567 | `decimals()` | view | `uint8` |  |

### ERC-2612 Permit

Spec: ERC-2612 Permit Extension for EIP-20 Signed Approvals (Final)  
Sources: <https://github.com/ethereum/ERCs/blob/f4df3d0537d54d05dc428ff10243171ba26073a8/ERCS/erc-2612.md#L44>, <https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.7.0/contracts/token/ERC20/extensions/IERC20Permit.sol>

Type hash:

```json
{
  "PERMIT_TYPEHASH": "0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9"
}
```

Functions (3):

| Selector | Signature | Mutability | Returns | Note |
|---|---|---|---|---|
| 0xd505accf | `permit(address,address,uint256,uint256,uint8,bytes32,bytes32)` | nonpayable |  |  |
| 0x7ecebe00 | `nonces(address)` | view | `uint256` |  |
| 0x3644e515 | `DOMAIN_SEPARATOR()` | view | `bytes32` |  |

### ERC-721

Spec: ERC-721 Non-Fungible Token Standard (Final)  
Sources: <https://github.com/ethereum/ERCs/blob/f4df3d0537d54d05dc428ff10243171ba26073a8/ERCS/erc-721.md#L48>, <https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.7.0/contracts/token/ERC721/IERC721.sol>
ERC-165 interface id: `0x80ac58cd`

Functions (9):

| Selector | Signature | Mutability | Returns | Note |
|---|---|---|---|---|
| 0x70a08231 | `balanceOf(address)` | view | `uint256` |  |
| 0x6352211e | `ownerOf(uint256)` | view | `address` |  |
| 0xb88d4fde | `safeTransferFrom(address,address,uint256,bytes)` | payable |  |  |
| 0x42842e0e | `safeTransferFrom(address,address,uint256)` | payable |  |  |
| 0x23b872dd | `transferFrom(address,address,uint256)` | payable |  |  |
| 0x095ea7b3 | `approve(address,uint256)` | payable |  |  |
| 0xa22cb465 | `setApprovalForAll(address,bool)` | nonpayable |  |  |
| 0x081812fc | `getApproved(uint256)` | view | `address` |  |
| 0xe985e9c5 | `isApprovedForAll(address,address)` | view | `bool` |  |

Events:

| topic0 | Signature | Note |
|---|---|---|
| 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef | `Transfer(address,address,uint256)` |  |
| 0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925 | `Approval(address,address,uint256)` |  |
| 0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31 | `ApprovalForAll(address,address,bool)` |  |

Overloads: `safeTransferFrom(address,address,uint256,bytes)`, `safeTransferFrom(address,address,uint256)`

Note: EIP declares transfer/approve functions `payable`; OZ v5 IERC721 declares them non-payable (selectors identical; mutability affects only ABI encoding of value).

### ERC-721 Metadata

Spec: ERC-721 optional metadata extension  
Sources: <https://github.com/ethereum/ERCs/blob/f4df3d0537d54d05dc428ff10243171ba26073a8/ERCS/erc-721.md#L181>, <https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.7.0/contracts/token/ERC721/extensions/IERC721Metadata.sol>
ERC-165 interface id: `0x5b5e139f`

Functions (3):

| Selector | Signature | Mutability | Returns | Note |
|---|---|---|---|---|
| 0x06fdde03 | `name()` | view | `string` |  |
| 0x95d89b41 | `symbol()` | view | `string` |  |
| 0xc87b56dd | `tokenURI(uint256)` | view | `string` |  |

### ERC-721 Enumerable

Spec: ERC-721 optional enumeration extension  
Sources: <https://github.com/ethereum/ERCs/blob/f4df3d0537d54d05dc428ff10243171ba26073a8/ERCS/erc-721.md#L225>, <https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.7.0/contracts/token/ERC721/extensions/IERC721Enumerable.sol>
ERC-165 interface id: `0x780e9d63`

Functions (3):

| Selector | Signature | Mutability | Returns | Note |
|---|---|---|---|---|
| 0x18160ddd | `totalSupply()` | view | `uint256` |  |
| 0x4f6ccce7 | `tokenByIndex(uint256)` | view | `uint256` |  |
| 0x2f745c59 | `tokenOfOwnerByIndex(address,uint256)` | view | `uint256` |  |

### ERC-721 TokenReceiver

Spec: ERC721TokenReceiver  
Sources: <https://github.com/ethereum/ERCs/blob/f4df3d0537d54d05dc428ff10243171ba26073a8/ERCS/erc-721.md#L158>, <https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.7.0/contracts/token/ERC721/IERC721Receiver.sol>
ERC-165 interface id: `0x150b7a02`

Functions (1):

| Selector | Signature | Mutability | Returns | Note |
|---|---|---|---|---|
| 0x150b7a02 | `onERC721Received(address,address,uint256,bytes)` | nonpayable | `bytes4` | MUST return 0x150b7a02 (its own selector) to accept |

### ERC-1155

Spec: ERC-1155 Multi Token Standard (Final)  
Sources: <https://github.com/ethereum/ERCs/blob/f4df3d0537d54d05dc428ff10243171ba26073a8/ERCS/erc-1155.md#L43>, <https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.7.0/contracts/token/ERC1155/IERC1155.sol>
ERC-165 interface id: `0xd9b67a26`

Functions (6):

| Selector | Signature | Mutability | Returns | Note |
|---|---|---|---|---|
| 0xf242432a | `safeTransferFrom(address,address,uint256,uint256,bytes)` | nonpayable |  |  |
| 0x2eb2c2d6 | `safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)` | nonpayable |  |  |
| 0x00fdd58e | `balanceOf(address,uint256)` | view | `uint256` |  |
| 0x4e1273f4 | `balanceOfBatch(address[],uint256[])` | view | `uint256[]` |  |
| 0xa22cb465 | `setApprovalForAll(address,bool)` | nonpayable |  |  |
| 0xe985e9c5 | `isApprovedForAll(address,address)` | view | `bool` |  |

Events:

| topic0 | Signature | Note |
|---|---|---|
| 0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62 | `TransferSingle(address,address,address,uint256,uint256)` |  |
| 0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb | `TransferBatch(address,address,address,uint256[],uint256[])` |  |
| 0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31 | `ApprovalForAll(address,address,bool)` |  |
| 0x6bb7ff708619ba0610cba295a58592e0451dee2622938c8755667688daf3529b | `URI(string,uint256)` |  |

### ERC-1155 Metadata URI

Spec: ERC1155Metadata_URI (optional)  
Sources: <https://github.com/ethereum/ERCs/blob/f4df3d0537d54d05dc428ff10243171ba26073a8/ERCS/erc-1155.md>, <https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.7.0/contracts/token/ERC1155/extensions/IERC1155MetadataURI.sol>
ERC-165 interface id: `0x0e89341c`

Functions (1):

| Selector | Signature | Mutability | Returns | Note |
|---|---|---|---|---|
| 0x0e89341c | `uri(uint256)` | view | `string` |  |

### ERC-1155 TokenReceiver

Spec: ERC1155TokenReceiver  
Sources: <https://github.com/ethereum/ERCs/blob/f4df3d0537d54d05dc428ff10243171ba26073a8/ERCS/erc-1155.md#L160>, <https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.7.0/contracts/token/ERC1155/IERC1155Receiver.sol>
ERC-165 interface id: `0x4e2312e0`

Functions (2):

| Selector | Signature | Mutability | Returns | Note |
|---|---|---|---|---|
| 0xf23a6e61 | `onERC1155Received(address,address,uint256,uint256,bytes)` | nonpayable | `bytes4` | MUST return 0xf23a6e61 to accept |
| 0xbc197c81 | `onERC1155BatchReceived(address,address,uint256[],uint256[],bytes)` | nonpayable | `bytes4` | MUST return 0xbc197c81 to accept |

### ERC-165

Spec: ERC-165 Standard Interface Detection (Final)  
Sources: <https://github.com/ethereum/ERCs/blob/f4df3d0537d54d05dc428ff10243171ba26073a8/ERCS/erc-165.md#L73>, <https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.7.0/contracts/utils/introspection/IERC165.sol>
ERC-165 interface id: `0x01ffc9a7`

Functions (1):

| Selector | Signature | Mutability | Returns | Note |
|---|---|---|---|---|
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view | `bool` | MUST return true for 0x01ffc9a7 and false for 0xffffffff; gas limit 30,000 |

### ERC-1271

Spec: ERC-1271 Standard Signature Validation Method for Contracts (Final)  
Sources: <https://github.com/ethereum/ERCs/blob/f4df3d0537d54d05dc428ff10243171ba26073a8/ERCS/erc-1271.md#L32>, <https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.7.0/contracts/interfaces/IERC1271.sol>
ERC-165 interface id: `0x1626ba7e`

Functions (1):

| Selector | Signature | Mutability | Returns | Note |
|---|---|---|---|---|
| 0x1626ba7e | `isValidSignature(bytes32,bytes)` | view | `bytes4` | MAGICVALUE 0x1626ba7e == selector |

### ERC-777 (note only)

Spec: ERC-777 Token Standard (Final; uses ERC-1820 registry hooks)  
Sources: <https://github.com/ethereum/ERCs/blob/f4df3d0537d54d05dc428ff10243171ba26073a8/ERCS/erc-777.md#L884>, <https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.7.0/contracts/interfaces/IERC777Recipient.sol>

Functions (1):

| Selector | Signature | Mutability | Returns | Note |
|---|---|---|---|---|
| 0x0023de29 | `tokensReceived(address,address,address,uint256,bytes,bytes)` | nonpayable |  | ERC777TokensRecipient hook; dispatched via ERC-1820 registry lookup, not ERC-165 |

Note: Noted for receiver behaviour only; ERC-777 is not bundled as an action target.

### ERC-4337 EntryPoint v0.6

Spec: eth-infinitism/account-abstraction v0.6.0 (UserOperation struct)  
Sources: <https://github.com/eth-infinitism/account-abstraction/blob/v0.6.0/contracts/interfaces/IEntryPoint.sol>, <https://github.com/eth-infinitism/account-abstraction/blob/v0.6.0/contracts/interfaces/IStakeManager.sol>, <https://github.com/eth-infinitism/account-abstraction/blob/v0.6.0/contracts/interfaces/INonceManager.sol>, <https://github.com/eth-infinitism/account-abstraction/blob/v0.6.0/contracts/interfaces/UserOperation.sol>, <https://github.com/eth-infinitism/account-abstraction/releases/tag/v0.6.0>

Canonical address: `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` (bundled in `assets/registry/protocols.json`; verify code on the chain before use).

Struct:

```json
{
  "UserOperation": [
    "address sender",
    "uint256 nonce",
    "bytes initCode",
    "bytes callData",
    "uint256 callGasLimit",
    "uint256 verificationGasLimit",
    "uint256 preVerificationGas",
    "uint256 maxFeePerGas",
    "uint256 maxPriorityFeePerGas",
    "bytes paymasterAndData",
    "bytes signature"
  ],
  "canonical": "(address,uint256,bytes,bytes,uint256,uint256,uint256,uint256,uint256,bytes,bytes)"
}
```

Functions (15):

| Selector | Signature | Mutability | Returns | Note |
|---|---|---|---|---|
| 0x1fad948c | `handleOps((address,uint256,bytes,bytes,uint256,uint256,uint256,uint256,uint256,bytes,bytes)[],address)` | nonpayable |  |  |
| 0x4b1d7cf5 | `handleAggregatedOps(((address,uint256,bytes,bytes,uint256,uint256,uint256,uint256,uint256,bytes,bytes)[],address,bytes)[],address)` | nonpayable |  |  |
| 0xa6193531 | `getUserOpHash((address,uint256,bytes,bytes,uint256,uint256,uint256,uint256,uint256,bytes,bytes))` | view | `bytes32` |  |
| 0xee219423 | `simulateValidation((address,uint256,bytes,bytes,uint256,uint256,uint256,uint256,uint256,bytes,bytes))` | nonpayable |  | v0.6 ONLY on-chain; always reverts with ValidationResult/ValidationResultWithAggregation |
| 0xd6383f94 | `simulateHandleOp((address,uint256,bytes,bytes,uint256,uint256,uint256,uint256,uint256,bytes,bytes),address,bytes)` | nonpayable |  | v0.6 ONLY on-chain; reverts with ExecutionResult |
| 0x9b249f69 | `getSenderAddress(bytes)` | nonpayable |  | reverts with SenderAddressResult(address) |
| 0x5287ce12 | `getDepositInfo(address)` | view | `(uint112 deposit,bool staked,uint112 stake,uint32 unstakeDelaySec,uint48 withdrawTime)` |  |
| 0x70a08231 | `balanceOf(address)` | view | `uint256` |  |
| 0xb760faf9 | `depositTo(address)` | payable |  |  |
| 0x0396cb60 | `addStake(uint32)` | payable |  |  |
| 0xbb9fe6bf | `unlockStake()` | nonpayable |  |  |
| 0xc23a5cea | `withdrawStake(address)` | nonpayable |  |  |
| 0x205c2878 | `withdrawTo(address,uint256)` | nonpayable |  |  |
| 0x35567e1a | `getNonce(address,uint192)` | view | `uint256` |  |
| 0x0bd28e3b | `incrementNonce(uint192)` | nonpayable |  |  |

IAccount / IAccountExecute (1):

| Selector | Signature | Mutability | Returns | Note |
|---|---|---|---|---|
| 0x3a871cdd | `validateUserOp((address,uint256,bytes,bytes,uint256,uint256,uint256,uint256,uint256,bytes,bytes),bytes32,uint256)` | nonpayable | `uint256 validationData` |  |

IPaymaster (2):

| Selector | Signature | Mutability | Returns | Note |
|---|---|---|---|---|
| 0xf465c77e | `validatePaymasterUserOp((address,uint256,bytes,bytes,uint256,uint256,uint256,uint256,uint256,bytes,bytes),bytes32,uint256)` | nonpayable | `(bytes context,uint256 validationData)` |  |
| 0xa9a23409 | `postOp(uint8,bytes,uint256)` | nonpayable |  | PostOpMode enum -> uint8 |

IAggregator (3):

| Selector | Signature | Mutability | Returns | Note |
|---|---|---|---|---|
| 0xe3563a4f | `validateSignatures((address,uint256,bytes,bytes,uint256,uint256,uint256,uint256,uint256,bytes,bytes)[],bytes)` | view |  |  |
| 0x64c530cd | `validateUserOpSignature((address,uint256,bytes,bytes,uint256,uint256,uint256,uint256,uint256,bytes,bytes))` | view | `bytes` |  |
| 0x275e2d79 | `aggregateSignatures((address,uint256,bytes,bytes,uint256,uint256,uint256,uint256,uint256,bytes,bytes)[])` | view | `bytes` |  |

Events:

| topic0 | Signature | Note |
|---|---|---|
| 0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f | `UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)` |  |
| 0xd51a9c61267aa6196961883ecf5ff2da6619c37dac0fa92122513fb32c032d2d | `AccountDeployed(bytes32,address,address,address)` |  |
| 0x1c4fada7374c0a9ee8841fc38afe82932dc0f8e69012e927f061a8bae611a201 | `UserOperationRevertReason(bytes32,address,uint256,bytes)` |  |
| 0xbb47ee3e183a558b1a2ff0874b079f3fc5478b7454eacf2bfc5af2ff5878f972 | `BeforeExecution()` |  |
| 0x575ff3acadd5ab348fe1855e217e0f3678f8d767d7494c9f9fefbee2e17cca4d | `SignatureAggregatorChanged(address)` |  |
| 0x2da466a7b24304f47e87fa2e1e5a81b9831ce54fec19055ce277ca2f39ba42c4 | `Deposited(address,uint256)` |  |
| 0xd1c19fbcd4551a5edfb66d43d2e337c04837afda3482b42bdf569a8fccdae5fb | `Withdrawn(address,address,uint256)` |  |
| 0xa5ae833d0bb1dcd632d98a8b70973e8516812898e19bf27b70071ebc8dc52c01 | `StakeLocked(address,uint256,uint256)` |  |
| 0xfa9b3c14cc825c412c9ed81b3ba365a5b459439403f18829e572ed53a4180f0a | `StakeUnlocked(address,uint256)` |  |
| 0xb7c918e0e249f999e965cafeb6c664271b3f4317d296461500e71da39f0cbda3 | `StakeWithdrawn(address,address,uint256)` |  |

Errors:

| Selector | Signature | Note |
|---|---|---|
| 0x220266b6 | `FailedOp(uint256,string)` |  |
| 0x86a9f750 | `SignatureValidationFailed(address)` |  |
| 0xe0cff05f | `ValidationResult((uint256,uint256,bool,uint48,uint48,bytes),(uint256,uint256),(uint256,uint256),(uint256,uint256))` |  |
| 0xfaecb4e4 | `ValidationResultWithAggregation((uint256,uint256,bool,uint48,uint48,bytes),(uint256,uint256),(uint256,uint256),(uint256,uint256),(address,(uint256,uint256)))` |  |
| 0x6ca7b806 | `SenderAddressResult(address)` |  |
| 0x8b7ac980 | `ExecutionResult(uint256,uint256,uint48,uint48,bool,bytes)` |  |

### ERC-4337 EntryPoint v0.7

Spec: eth-infinitism/account-abstraction v0.7.0 (PackedUserOperation struct)  
Sources: <https://github.com/eth-infinitism/account-abstraction/blob/v0.7.0/contracts/interfaces/IEntryPoint.sol>, <https://github.com/eth-infinitism/account-abstraction/blob/v0.7.0/contracts/interfaces/PackedUserOperation.sol>, <https://github.com/eth-infinitism/account-abstraction/blob/v0.7.0/contracts/interfaces/IEntryPointSimulations.sol>, <https://github.com/eth-infinitism/account-abstraction/releases/tag/v0.7.0>

Canonical address: not bundled — take it from the source links above and verify code on the chain before use.

Struct:

```json
{
  "PackedUserOperation": [
    "address sender",
    "uint256 nonce",
    "bytes initCode",
    "bytes callData",
    "bytes32 accountGasLimits (verificationGasLimit<<128 | callGasLimit)",
    "uint256 preVerificationGas",
    "bytes32 gasFees (maxPriorityFeePerGas<<128 | maxFeePerGas)",
    "bytes paymasterAndData (paymaster(20)|paymasterVerificationGasLimit(16)|paymasterPostOpGasLimit(16)|paymasterData)",
    "bytes signature"
  ],
  "canonical": "(address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)"
}
```

Functions (15):

| Selector | Signature | Mutability | Returns | Note |
|---|---|---|---|---|
| 0x765e827f | `handleOps((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)[],address)` | nonpayable |  |  |
| 0xdbed18e0 | `handleAggregatedOps(((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)[],address,bytes)[],address)` | nonpayable |  |  |
| 0x22cdde4c | `getUserOpHash((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes))` | view | `bytes32` |  |
| 0x9b249f69 | `getSenderAddress(bytes)` | nonpayable |  |  |
| 0x850aaf62 | `delegateAndRevert(address,bytes)` | nonpayable |  | new in v0.7; reverts with DelegateAndRevert(bool,bytes) |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view | `bool` | ERC-165 added in v0.7 (EntryPoint.sol) |
| 0x5287ce12 | `getDepositInfo(address)` | view | `(uint256 deposit,bool staked,uint112 stake,uint32 unstakeDelaySec,uint48 withdrawTime)` |  |
| 0x70a08231 | `balanceOf(address)` | view | `uint256` |  |
| 0xb760faf9 | `depositTo(address)` | payable |  |  |
| 0x0396cb60 | `addStake(uint32)` | payable |  |  |
| 0xbb9fe6bf | `unlockStake()` | nonpayable |  |  |
| 0xc23a5cea | `withdrawStake(address)` | nonpayable |  |  |
| 0x205c2878 | `withdrawTo(address,uint256)` | nonpayable |  |  |
| 0x35567e1a | `getNonce(address,uint192)` | view | `uint256` |  |
| 0x0bd28e3b | `incrementNonce(uint192)` | nonpayable |  |  |

IAccount / IAccountExecute (2):

| Selector | Signature | Mutability | Returns | Note |
|---|---|---|---|---|
| 0x19822f7c | `validateUserOp((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes),bytes32,uint256)` | nonpayable | `uint256 validationData` |  |
| 0x8dd7712f | `executeUserOp((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes),bytes32)` | nonpayable |  | IAccountExecute (optional, dispatched when callData selector == executeUserOp) |

IPaymaster (2):

| Selector | Signature | Mutability | Returns | Note |
|---|---|---|---|---|
| 0x52b7512c | `validatePaymasterUserOp((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes),bytes32,uint256)` | nonpayable | `(bytes context,uint256 validationData)` |  |
| 0x7c627b21 | `postOp(uint8,bytes,uint256,uint256)` | nonpayable |  | v0.7 adds actualUserOpFeePerGas parameter |

IAggregator (3):

| Selector | Signature | Mutability | Returns | Note |
|---|---|---|---|---|
| 0x2dd81133 | `validateSignatures((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)[],bytes)` | view |  |  |
| 0x062a422b | `validateUserOpSignature((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes))` | view | `bytes` |  |
| 0xae574a43 | `aggregateSignatures((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)[])` | view | `bytes` |  |

IEntryPointSimulations (off-chain helper, not in canonical EntryPoint) (2):

| Selector | Signature | Mutability | Returns | Note |
|---|---|---|---|---|
| 0xc3bce009 | `simulateValidation((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes))` | nonpayable | `ValidationResult` | IEntryPointSimulations — NOT deployed in the canonical EntryPoint since v0.7; bundlers use state-override / EntryPointSimulations helper |
| 0x97b2dcb9 | `simulateHandleOp((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes),address,bytes)` | nonpayable | `ExecutionResult` | IEntryPointSimulations only |

Events:

| topic0 | Signature | Note |
|---|---|---|
| 0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f | `UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)` |  |
| 0xd51a9c61267aa6196961883ecf5ff2da6619c37dac0fa92122513fb32c032d2d | `AccountDeployed(bytes32,address,address,address)` |  |
| 0x1c4fada7374c0a9ee8841fc38afe82932dc0f8e69012e927f061a8bae611a201 | `UserOperationRevertReason(bytes32,address,uint256,bytes)` |  |
| 0xf62676f440ff169a3a9afdbf812e89e7f95975ee8e5c31214ffdef631c5f4792 | `PostOpRevertReason(bytes32,address,uint256,bytes)` |  |
| 0x67b4fa9642f42120bf031f3051d1824b0fe25627945b27b8a6a65d5761d5482e | `UserOperationPrefundTooLow(bytes32,address,uint256)` |  |
| 0xbb47ee3e183a558b1a2ff0874b079f3fc5478b7454eacf2bfc5af2ff5878f972 | `BeforeExecution()` |  |
| 0x575ff3acadd5ab348fe1855e217e0f3678f8d767d7494c9f9fefbee2e17cca4d | `SignatureAggregatorChanged(address)` |  |
| 0x2da466a7b24304f47e87fa2e1e5a81b9831ce54fec19055ce277ca2f39ba42c4 | `Deposited(address,uint256)` |  |
| 0xd1c19fbcd4551a5edfb66d43d2e337c04837afda3482b42bdf569a8fccdae5fb | `Withdrawn(address,address,uint256)` |  |
| 0xa5ae833d0bb1dcd632d98a8b70973e8516812898e19bf27b70071ebc8dc52c01 | `StakeLocked(address,uint256,uint256)` |  |
| 0xfa9b3c14cc825c412c9ed81b3ba365a5b459439403f18829e572ed53a4180f0a | `StakeUnlocked(address,uint256)` |  |
| 0xb7c918e0e249f999e965cafeb6c664271b3f4317d296461500e71da39f0cbda3 | `StakeWithdrawn(address,address,uint256)` |  |

Errors:

| Selector | Signature | Note |
|---|---|---|
| 0x220266b6 | `FailedOp(uint256,string)` |  |
| 0x65c8fd4d | `FailedOpWithRevert(uint256,string,bytes)` |  |
| 0xad7954bc | `PostOpReverted(bytes)` |  |
| 0x86a9f750 | `SignatureValidationFailed(address)` |  |
| 0x6ca7b806 | `SenderAddressResult(address)` |  |
| 0x99410554 | `DelegateAndRevert(bool,bytes)` |  |

### ERC-4337 EntryPoint v0.8

Spec: eth-infinitism/account-abstraction v0.8.0 (PackedUserOperation; EIP-712 userOpHash; native EIP-7702)  
Sources: <https://github.com/eth-infinitism/account-abstraction/blob/v0.8.0/contracts/interfaces/IEntryPoint.sol>, <https://github.com/eth-infinitism/account-abstraction/blob/v0.8.0/contracts/core/EntryPoint.sol>, <https://github.com/eth-infinitism/account-abstraction/releases/tag/v0.8.0>

Canonical address: not bundled — take it from the source links above and verify code on the chain before use.

Struct:

```json
{
  "PackedUserOperation": "identical to v0.7 (same 9 fields); userOpHash is now an EIP-712 typed-data hash (domain name \"ERC4337\", version \"1\") instead of keccak(abi.encode(hash(userOp), entryPoint, chainId))",
  "canonical": "(address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)"
}
```

Functions (18):

| Selector | Signature | Mutability | Returns | Note |
|---|---|---|---|---|
| 0x765e827f | `handleOps((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)[],address)` | nonpayable |  |  |
| 0xdbed18e0 | `handleAggregatedOps(((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)[],address,bytes)[],address)` | nonpayable |  |  |
| 0x22cdde4c | `getUserOpHash((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes))` | view | `bytes32` |  |
| 0x9b249f69 | `getSenderAddress(bytes)` | nonpayable |  |  |
| 0x850aaf62 | `delegateAndRevert(address,bytes)` | nonpayable |  |  |
| 0x09ccb880 | `senderCreator()` | view | `address` | new in v0.8 (ISenderCreator); factories SHOULD require msg.sender == entryPoint.senderCreator() |
| 0x154e58dc | `getPackedUserOpTypeHash()` | pure | `bytes32` | EntryPoint.sol v0.8 |
| 0x13c65a6e | `getDomainSeparatorV4()` | view | `bytes32` | EntryPoint.sol v0.8 |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | view | `bool` |  |
| 0x5287ce12 | `getDepositInfo(address)` | view | `(uint256,bool,uint112,uint32,uint48)` |  |
| 0x70a08231 | `balanceOf(address)` | view | `uint256` |  |
| 0xb760faf9 | `depositTo(address)` | payable |  |  |
| 0x0396cb60 | `addStake(uint32)` | payable |  |  |
| 0xbb9fe6bf | `unlockStake()` | nonpayable |  |  |
| 0xc23a5cea | `withdrawStake(address)` | nonpayable |  |  |
| 0x205c2878 | `withdrawTo(address,uint256)` | nonpayable |  |  |
| 0x35567e1a | `getNonce(address,uint192)` | view | `uint256` |  |
| 0x0bd28e3b | `incrementNonce(uint192)` | nonpayable |  |  |

IAccount / IAccountExecute (2):

| Selector | Signature | Mutability | Returns | Note |
|---|---|---|---|---|
| 0x19822f7c | `validateUserOp((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes),bytes32,uint256)` | nonpayable | `uint256` |  |
| 0x8dd7712f | `executeUserOp((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes),bytes32)` | nonpayable |  |  |

IPaymaster (2):

| Selector | Signature | Mutability | Returns | Note |
|---|---|---|---|---|
| 0x52b7512c | `validatePaymasterUserOp((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes),bytes32,uint256)` | nonpayable | `(bytes,uint256)` |  |
| 0x7c627b21 | `postOp(uint8,bytes,uint256,uint256)` | nonpayable |  |  |

Note: Release notes: "All interface selectors unchanged vs v0.7"; adds Simple7702Account, rejects explicit zero-address paymaster, SenderCreator must be called from EntryPoint.

### ERC-4337 EntryPoint v0.9

Spec: eth-infinitism/account-abstraction v0.9.0 (released 2025-11-16; ABI-compatible with v0.8 + getCurrentUserOpHash)  
Sources: <https://github.com/eth-infinitism/account-abstraction/blob/v0.9.0/contracts/interfaces/IEntryPoint.sol>, <https://github.com/eth-infinitism/account-abstraction/releases/tag/v0.9.0>

Canonical address: not bundled — take it from the source links above and verify code on the chain before use.

Functions (2):

| Selector | Signature | Mutability | Returns | Note |
|---|---|---|---|---|
| 0xb0a398d1 | `getCurrentUserOpHash()` | view | `bytes32` | new in v0.9 |
| 0x09ccb880 | `senderCreator()` | view | `address` |  |

Events:

| topic0 | Signature | Note |
|---|---|---|
| 0x7c9f9ade6a03a0bba484e52df872467a270e798ffc1adab9dfaa8d0e627f0544 | `EIP7702AccountInitialized(bytes32,address,address)` | IEntryPoint v0.9 line 71: (bytes32 indexed userOpHash, address indexed sender, address indexed delegate) |
| 0xa39bcda08ffd11bafb11c4f170ef24fc6dc1a9d1b0394d90dbd19e0b919050e9 | `IgnoredInitCode(bytes32,address,address)` | new in v0.9: (bytes32 indexed userOpHash, address indexed sender, address unusedFactory) |

Errors:

| Selector | Signature | Note |
|---|---|---|
| 0x1a3b45fd | `InvalidBeneficiary(address)` | new custom errors in v0.9 (IEntryPoint/IStakeManager) |
| 0x40848e61 | `FailedSendToBeneficiary(address,uint256,bytes)` | new custom errors in v0.9 (IEntryPoint/IStakeManager) |
| 0x9fbdaa09 | `InternalFunction()` | new custom errors in v0.9 (IEntryPoint/IStakeManager) |
| 0x120aaab5 | `InvalidPaymasterData(uint256)` | new custom errors in v0.9 (IEntryPoint/IStakeManager) |
| 0xd8ccb292 | `InvalidPaymaster(address)` | new custom errors in v0.9 (IEntryPoint/IStakeManager) |
| 0xe1823bce | `InvalidUnstakeDelay(uint256,uint256)` | new custom errors in v0.9 (IEntryPoint/IStakeManager) |
| 0x0e10009c | `InvalidStake(uint256,uint256)` | new custom errors in v0.9 (IEntryPoint/IStakeManager) |
| 0x8421e8e5 | `NotStaked(uint256,uint256,bool)` | new custom errors in v0.9 (IEntryPoint/IStakeManager) |
| 0x25c3f46e | `InsufficientDeposit(uint256,uint256)` | new custom errors in v0.9 (IEntryPoint/IStakeManager) |
| 0xfbd021d6 | `StakeNotUnlocked(uint256,uint256)` | new custom errors in v0.9 (IEntryPoint/IStakeManager) |
| 0x561d3312 | `WithdrawalNotDue(uint256,uint256)` | new custom errors in v0.9 (IEntryPoint/IStakeManager) |
| 0x0dcf087c | `StakeWithdrawalFailed(address,address,uint256,bytes)` | new custom errors in v0.9 (IEntryPoint/IStakeManager) |
| 0x9f3d6933 | `DepositWithdrawalFailed(address,address,uint256,bytes)` | new custom errors in v0.9 (IEntryPoint/IStakeManager) |

Note: Release notes state no breaking ABI change vs v0.8. validAfter/validUntil high bit now selects block-number validity range.

### ERC-4337 bundler JSON-RPC (ERC-7769)

Spec: ERC-7769 JSON-RPC API for ERC-4337 (Draft); ERC-4337 itself says the RPC definition is out of scope and only names eth_sendUserOperation / eth_getUserOperationReceipt  
Sources: <https://github.com/ethereum/ERCs/blob/f4df3d0537d54d05dc428ff10243171ba26073a8/ERCS/erc-4337.md#L261>, <https://github.com/ethereum/ERCs/blob/f4df3d0537d54d05dc428ff10243171ba26073a8/ERCS/erc-7769.md>

JSON-RPC methods: `eth_sendUserOperation`, `eth_estimateUserOperationGas`, `eth_getUserOperationByHash`, `eth_getUserOperationReceipt`, `eth_supportedEntryPoints`, `eth_chainId`, `debug_bundler_clearState`, `debug_bundler_dumpMempool`, `debug_bundler_sendBundleNow`, `debug_bundler_setBundlingMode`, `debug_bundler_setReputation`, `debug_bundler_dumpReputation`, `debug_bundler_addUserOps`

UserOperation RPC fields: `sender`, `nonce`, `factory`, `factoryData`, `callData`, `callGasLimit`, `verificationGasLimit`, `preVerificationGas`, `maxFeePerGas`, `maxPriorityFeePerGas`, `paymaster`, `paymasterVerificationGasLimit`, `paymasterPostOpGasLimit`, `paymasterData`, `signature`, `eip7702Auth (optional tuple, EIP-7702 chains)`

### ERC-1967 proxy storage slots

Spec: ERC-1967 Proxy Storage Slots (Final)  
Sources: <https://github.com/ethereum/ERCs/blob/f4df3d0537d54d05dc428ff10243171ba26073a8/ERCS/erc-1967.md#L36>, <https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.7.0/contracts/proxy/ERC1967/ERC1967Utils.sol#L21>, <https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.7.0/contracts/interfaces/IERC1967.sol>

Slots:

```json
{
  "IMPLEMENTATION_SLOT": {
    "value": "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
    "derivation": "bytes32(uint256(keccak256('eip1967.proxy.implementation')) - 1)",
    "computed": "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
  },
  "ADMIN_SLOT": {
    "value": "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
    "derivation": "bytes32(uint256(keccak256('eip1967.proxy.admin')) - 1)",
    "computed": "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103"
  },
  "BEACON_SLOT": {
    "value": "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
    "derivation": "bytes32(uint256(keccak256('eip1967.proxy.beacon')) - 1)",
    "computed": "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50"
  }
}
```

Events:

| topic0 | Signature | Note |
|---|---|---|
| 0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b | `Upgraded(address)` |  |
| 0x7e644d79422f17c01e4894b5f4f588d331ebfa28653d42ae832dc59e38c9798f | `AdminChanged(address,address)` |  |
| 0x1cf3b03a6cf19fa2baba4df148e9dcabedea7f8a5c07840e207e5c089be95d3e | `BeaconUpgraded(address)` |  |

### ERC-1167 minimal proxy

Spec: ERC-1167 Minimal Proxy Contract (Final)  
Sources: <https://github.com/ethereum/ERCs/blob/f4df3d0537d54d05dc428ff10243171ba26073a8/ERCS/erc-1167.md#L22>, <https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.7.0/contracts/proxy/Clones.sol#L54>

Runtime bytecode pattern: `363d3d373d3d3d363d73<20-byte implementation>5af43d82803e903d91602b57fd5bf3`; creation-code prefix `3d602d80600a3d3981f3`. runtime code length 45 bytes; bytes [10..29] = implementation address; compare prefix 363d3d373d3d3d363d73 and suffix 5af43d82803e903d91602b57fd5bf3 (OZ Clones.sol lines 54/56 use the same constants)

### Multicall3

Spec: mds1/multicall src/Multicall3.sol @ main b667d67ecfa5361a81e8f110234ce242613b0012 (2026-01-23)  
Sources: <https://github.com/mds1/multicall/blob/b667d67ecfa5361a81e8f110234ce242613b0012/src/Multicall3.sol>, <https://github.com/mds1/multicall/blob/b667d67ecfa5361a81e8f110234ce242613b0012/README.md>, <https://github.com/mds1/multicall/blob/b667d67ecfa5361a81e8f110234ce242613b0012/deployments.json>

Canonical address: `0xcA11bde05977b3631167028862bE2a173976CA11` (bundled in `assets/registry/protocols.json`; verify code on the chain before use).

Functions (16):

| Selector | Signature | Mutability | Returns | Note |
|---|---|---|---|---|
| 0x252dba42 | `aggregate((address,bytes)[])` | payable | `(uint256 blockNumber,bytes[] returnData)` |  |
| 0xbce38bd7 | `tryAggregate(bool,(address,bytes)[])` | payable | `(bool,bytes)[]` |  |
| 0x399542e9 | `tryBlockAndAggregate(bool,(address,bytes)[])` | payable | `(uint256,bytes32,(bool,bytes)[])` |  |
| 0xc3077fa9 | `blockAndAggregate((address,bytes)[])` | payable | `(uint256,bytes32,(bool,bytes)[])` |  |
| 0x82ad56cb | `aggregate3((address,bool,bytes)[])` | payable | `(bool,bytes)[]` |  |
| 0x174dea71 | `aggregate3Value((address,bool,uint256,bytes)[])` | payable | `(bool,bytes)[]` |  |
| 0xee82ac5e | `getBlockHash(uint256)` | view | `bytes32` |  |
| 0x42cbb15c | `getBlockNumber()` | view | `uint256` |  |
| 0xa8b0574e | `getCurrentBlockCoinbase()` | view | `address` |  |
| 0x72425d9d | `getCurrentBlockDifficulty()` | view | `uint256` |  |
| 0x86d516e8 | `getCurrentBlockGasLimit()` | view | `uint256` |  |
| 0x0f28c97d | `getCurrentBlockTimestamp()` | view | `uint256` |  |
| 0x4d2301cc | `getEthBalance(address)` | view | `uint256` |  |
| 0x27e86d6e | `getLastBlockHash()` | view | `bytes32` |  |
| 0x3e64a696 | `getBasefee()` | view | `uint256` |  |
| 0x3408e470 | `getChainId()` | view | `uint256` |  |

### Permit2

Spec: Uniswap/permit2 src/interfaces @ main cc56ad0f3439c502c246fc5cfcc3db92bb8b7219 (2023-09-29)  
Sources: <https://github.com/Uniswap/permit2/blob/cc56ad0f3439c502c246fc5cfcc3db92bb8b7219/src/interfaces/ISignatureTransfer.sol>, <https://github.com/Uniswap/permit2/blob/cc56ad0f3439c502c246fc5cfcc3db92bb8b7219/src/interfaces/IAllowanceTransfer.sol>, <https://github.com/Uniswap/permit2/blob/cc56ad0f3439c502c246fc5cfcc3db92bb8b7219/src/interfaces/IEIP712.sol>

Canonical address: `0x000000000022D473030F116dDEE9F6B43aC78BA3` (bundled in `assets/registry/protocols.json`; verify code on the chain before use).

Functions (15):

| Selector | Signature | Mutability | Returns | Note |
|---|---|---|---|---|
| 0x30f28b7a | `permitTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes)` | nonpayable |  | ISignatureTransfer single |
| 0x137c29fe | `permitWitnessTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes32,string,bytes)` | nonpayable |  |  |
| 0xedd9444b | `permitTransferFrom(((address,uint256)[],uint256,uint256),(address,uint256)[],address,bytes)` | nonpayable |  | ISignatureTransfer batch (overload) |
| 0xfe8ec1a7 | `permitWitnessTransferFrom(((address,uint256)[],uint256,uint256),(address,uint256)[],address,bytes32,string,bytes)` | nonpayable |  | batch overload |
| 0x4fe02b44 | `nonceBitmap(address,uint256)` | view | `uint256` |  |
| 0x3ff9dcb1 | `invalidateUnorderedNonces(uint256,uint256)` | nonpayable |  |  |
| 0x927da105 | `allowance(address,address,address)` | view | `(uint160 amount,uint48 expiration,uint48 nonce)` | IAllowanceTransfer |
| 0x87517c45 | `approve(address,address,uint160,uint48)` | nonpayable |  |  |
| 0x2b67b570 | `permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)` | nonpayable |  | PermitSingle |
| 0x2a2d80d1 | `permit(address,((address,uint160,uint48,uint48)[],address,uint256),bytes)` | nonpayable |  | PermitBatch (overload) |
| 0x36c78516 | `transferFrom(address,address,uint160,address)` | nonpayable |  |  |
| 0x0d58b1db | `transferFrom((address,address,uint160,address)[])` | nonpayable |  | overload |
| 0xcc53287f | `lockdown((address,address)[])` | nonpayable |  |  |
| 0x65d9723c | `invalidateNonces(address,address,uint48)` | nonpayable |  |  |
| 0x3644e515 | `DOMAIN_SEPARATOR()` | view | `bytes32` | IEIP712 |

Overloads: `permitTransferFrom`, `permitWitnessTransferFrom`, `permit`, `transferFrom`

### WETH9

Spec: gnosis/canonical-weth contracts/WETH9.sol @ master 0dd1ea3e295eef916d0c6223ec63141137d22d67  
Sources: <https://github.com/gnosis/canonical-weth/blob/0dd1ea3e295eef916d0c6223ec63141137d22d67/contracts/WETH9.sol>, <https://github.com/gnosis/canonical-weth/blob/0dd1ea3e295eef916d0c6223ec63141137d22d67/README.md>

Canonical address: not bundled — take it from the source links above and verify code on the chain before use.

Functions (11):

| Selector | Signature | Mutability | Returns | Note |
|---|---|---|---|---|
| 0xd0e30db0 | `deposit()` | payable |  |  |
| 0x2e1a7d4d | `withdraw(uint256)` | nonpayable |  |  |
| 0x18160ddd | `totalSupply()` | view | `uint256` |  |
| 0x095ea7b3 | `approve(address,uint256)` | nonpayable | `bool` |  |
| 0xa9059cbb | `transfer(address,uint256)` | nonpayable | `bool` |  |
| 0x23b872dd | `transferFrom(address,address,uint256)` | nonpayable | `bool` |  |
| 0x70a08231 | `balanceOf(address)` | view | `uint256` | public mapping getter |
| 0xdd62ed3e | `allowance(address,address)` | view | `uint256` | public mapping getter |
| 0x06fdde03 | `name()` | view | `string` |  |
| 0x95d89b41 | `symbol()` | view | `string` |  |
| 0x313ce567 | `decimals()` | view | `uint8` |  |

Events:

| topic0 | Signature | Note |
|---|---|---|
| 0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c | `Deposit(address,uint256)` |  |
| 0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65 | `Withdrawal(address,uint256)` |  |
| 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef | `Transfer(address,address,uint256)` |  |
| 0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925 | `Approval(address,address,uint256)` |  |

Note: Solidity ^0.4.18; receive handled by `function() external payable { deposit(); }`.

### Uniswap Universal Router

Spec: Uniswap/universal-router @ main 543e1a19d6e21e31ced2512eec5792b50f13a0ba (2026-09-25)  
Sources: <https://github.com/Uniswap/universal-router/blob/543e1a19d6e21e31ced2512eec5792b50f13a0ba/contracts/interfaces/IUniversalRouter.sol>, <https://github.com/Uniswap/universal-router/blob/543e1a19d6e21e31ced2512eec5792b50f13a0ba/contracts/UniversalRouter.sol>, <https://github.com/Uniswap/universal-router/blob/543e1a19d6e21e31ced2512eec5792b50f13a0ba/contracts/libraries/Commands.sol>, <https://github.com/Uniswap/universal-router/tree/543e1a19d6e21e31ced2512eec5792b50f13a0ba/deploy-addresses>

Command bytes (Commands.sol):

```json
{"V3_SWAP_EXACT_IN":"0x00","V3_SWAP_EXACT_OUT":"0x01","PERMIT2_TRANSFER_FROM":"0x02","PERMIT2_PERMIT_BATCH":"0x03","SWEEP":"0x04","TRANSFER":"0x05","PAY_PORTION":"0x06","PAY_PORTION_FULL_PRECISION":"0x07","V2_SWAP_EXACT_IN":"0x08","V2_SWAP_EXACT_OUT":"0x09","PERMIT2_PERMIT":"0x0a","WRAP_ETH":"0x0b","UNWRAP_WETH":"0x0c","PERMIT2_TRANSFER_FROM_BATCH":"0x0d","BALANCE_CHECK_ERC20":"0x0e","V4_SWAP":"0x10","V3_POSITION_MANAGER_PERMIT":"0x11","V3_POSITION_MANAGER_CALL":"0x12","V4_INITIALIZE_POOL":"0x13","V4_POSITION_MANAGER_CALL":"0x14","EXECUTE_SUB_PLAN":"0x21","ACROSS_V4_DEPOSIT_V3":"0x40"}
```

Deploy addresses: differ per chain and per router version; not bundled. Resolve them from the Uniswap `deploy-addresses/` folder or https://docs.uniswap.org/contracts/v4/deployments (see `assets/registry/protocols.json` → `uniswap.deploymentsDoc`) and verify code before use. There is no LUKSO deployment.

Functions (4):

| Selector | Signature | Mutability | Returns | Note |
|---|---|---|---|---|
| 0x3593564c | `execute(bytes,bytes[],uint256)` | payable |  | IUniversalRouter; deadline-checked |
| 0x24856bc3 | `execute(bytes,bytes[])` | payable |  | UniversalRouter.sol only (no deadline) — overload |
| 0x44684dc3 | `executeSigned(bytes,bytes[],bytes32,bytes32,bool,bytes32,bytes,uint256)` | payable |  | EIP-712 signed route (main branch; verify presence on the deployed version you target) |
| 0xd04d79a2 | `signedRouteContext()` | view | `(address signer,bytes32 intent,bytes32 data)` |  |

Errors:

| Selector | Signature | Note |
|---|---|---|
| 0x2c4029e9 | `ExecutionFailed(uint256,bytes)` |  |
| 0x1231ae40 | `ETHNotAccepted()` |  |
| 0x5bf6f916 | `TransactionDeadlinePassed()` |  |
| 0xff633a38 | `LengthMismatch()` |  |
| 0x38bbd576 | `InvalidEthSender()` |  |

Overloads: `execute(bytes,bytes[],uint256)`, `execute(bytes,bytes[])`

### CoW Protocol GPv2Settlement

Spec: cowprotocol/contracts @ main c07a93e3596194c5e3cf331c755a3f9f0e4a17d8 (2026-09-01)  
Sources: <https://github.com/cowprotocol/contracts/blob/c07a93e3596194c5e3cf331c755a3f9f0e4a17d8/src/contracts/GPv2Settlement.sol>, <https://github.com/cowprotocol/contracts/blob/c07a93e3596194c5e3cf331c755a3f9f0e4a17d8/src/contracts/mixins/GPv2Signing.sol>, <https://github.com/cowprotocol/contracts/blob/c07a93e3596194c5e3cf331c755a3f9f0e4a17d8/src/contracts/interfaces/GPv2EIP1271.sol>, <https://github.com/cowprotocol/contracts/blob/c07a93e3596194c5e3cf331c755a3f9f0e4a17d8/networks.json>

Canonical address: `0x9008D19f58AAbD9eD0D60971565AA8510560ab41` (bundled in `assets/registry/protocols.json`; verify code on the chain before use).

Structs:

```json
{
  "GPv2Order.Data": [
    "address sellToken",
    "address buyToken",
    "address receiver",
    "uint256 sellAmount",
    "uint256 buyAmount",
    "uint32 validTo",
    "bytes32 appData",
    "uint256 feeAmount",
    "bytes32 kind",
    "bool partiallyFillable",
    "bytes32 sellTokenBalance",
    "bytes32 buyTokenBalance"
  ],
  "GPv2Trade.Data": [
    "uint256 sellTokenIndex",
    "uint256 buyTokenIndex",
    "address receiver",
    "uint256 sellAmount",
    "uint256 buyAmount",
    "uint32 validTo",
    "bytes32 appData",
    "uint256 feeAmount",
    "uint256 flags",
    "uint256 executedAmount",
    "bytes signature"
  ],
  "GPv2Interaction.Data": [
    "address target",
    "uint256 value",
    "bytes callData"
  ]
}
```

ERC-1271 use: GPv2Signing.recoverEip1271Signer: signature bytes = 20-byte owner address \|\| contract signature; calls EIP1271Verifier(owner).isValidSignature(orderDigest, signature) and requires MAGICVALUE 0x1626ba7e (GPv2EIP1271.sol line 8). orderDigest = EIP-712 hash of GPv2Order.Data with the settlement domainSeparator. Signing schemes: EIP-712 (ECDSA); eth_sign (ECDSA); EIP-1271 (contract); pre-sign (setPreSignature).

Functions (12):

| Selector | Signature | Mutability | Returns | Note |
|---|---|---|---|---|
| 0xec6cb13f | `setPreSignature(bytes,bool)` | nonpayable |  | GPv2Signing — on-chain order approval by the order owner (orderUid = 32B digest\|20B owner\|4B validTo); emits PreSignature |
| 0xd08d33d1 | `preSignature(bytes)` | view | `uint256` | public mapping getter; == PRE_SIGNED constant when signed |
| 0x15337bc0 | `invalidateOrder(bytes)` | nonpayable |  |  |
| 0x2479fb6e | `filledAmount(bytes)` | view | `uint256` |  |
| 0xf698da25 | `domainSeparator()` | view | `bytes32` |  |
| 0xfbfa77cf | `vault()` | view | `address` |  |
| 0x9b552cc2 | `vaultRelayer()` | view | `address` |  |
| 0x2335c76b | `authenticator()` | view | `address` |  |
| 0x13d79a0b | `settle(address[],uint256[],(uint256,uint256,address,uint256,uint256,uint32,bytes32,uint256,uint256,uint256,bytes)[],(address,uint256,bytes)[][3])` | nonpayable |  | onlySolver |
| 0x845a101f | `swap((bytes32,uint256,uint256,uint256,bytes)[],address[],(uint256,uint256,address,uint256,uint256,uint32,bytes32,uint256,uint256,uint256,bytes))` | nonpayable |  | onlySolver |
| 0xed9f35ce | `freeFilledAmountStorage(bytes[])` | nonpayable |  | onlyInteraction |
| 0xa2a7d51b | `freePreSignatureStorage(bytes[])` | nonpayable |  | onlyInteraction |

Events:

| topic0 | Signature | Note |
|---|---|---|
| 0xa07a543ab8a018198e99ca0184c93fe9050a79400a0a723441f84de1d972cc17 | `Trade(address,address,address,uint256,uint256,uint256,bytes)` |  |
| 0xed99827efb37016f2275f98c4bcf71c7551c75d59e9b450f79fa32e60be672c2 | `Interaction(address,uint256,bytes4)` |  |
| 0x40338ce1a7c49204f0099533b1e9a7ee0a3d261f84974ab7af36105b8c4e9db4 | `Settlement(address)` |  |
| 0x875b6cb035bbd4ac6500fabc6d1e4ca5bdc58a3e2b424ccb5c24cdbebeb009a9 | `OrderInvalidated(address,bytes)` |  |
| 0x01bf7c8b0ca55deecbea89d7e58295b7ffbf685fd0d96801034ba8c6ffe1c68d | `PreSignature(address,bytes,bool)` |  |

## Receiver behaviours relevant to a contract account (Universal Profile) as token recipient

| Standard | Behaviour | Citation | Constants |
|---|---|---|---|
| LSP7 | `force` flag on transfer/mint: recipient `to` is checked with ERC165Checker.supportsERC165InterfaceUnchecked(to, _INTERFACEID_LSP1); if supported, `ILSP1(to).universalReceiver(_TYPEID_LSP7_TOKENSRECIPIENT, lsp1Data)` is called; otherwise if `force == false` the call reverts with LSP7NotifyTokenReceiverContractMissingLSP1Interface(to) (contract) or LSP7NotifyTokenReceiverIsEOA(to) (EOA); if `force == true` no notification and no revert. | packages/lsp7-contracts/contracts/LSP7DigitalAsset.sol lines 880-908 (_notifyTokenReceiver), 867-877 (_notifyTokenSender), 848-858 (_notifyTokenOperator); transfer() line 476-487; _mint 589-607; _transfer 730-747 | sender=0x429ac7a06903dbc9c13dfcb3c9d11df8194581fa047c96d7a4171fc7402958ea<br>recipient=0x20804611b3e2ea21c480dc465142210acf4a2485947541770ec1fb87dee4a55c<br>operator=0x386072cc5a58e61263b434c722725f21031cd06e7c552cfaa06db5de8a320dbc |
| LSP8 | Same `force` semantics as LSP7 with bytes32 tokenId: _notifyTokenReceiver checks LSP1 support, calls universalReceiver(_TYPEID_LSP8_TOKENSRECIPIENT, lsp1Data); reverts LSP8NotifyTokenReceiverContractMissingLSP1Interface / LSP8NotifyTokenReceiverIsEOA when force == false. | packages/lsp8-contracts/contracts/LSP8IdentifiableDigitalAsset.sol lines 942-960 (_notifyTokenReceiver), 919-929 (_notifyTokenSender), 900-910 (_notifyTokenOperator); transfer() 540-548; _mint 671-701; _transfer 789-822 | sender=0xb23eae7e6d1564b295b4c3e3be402d9a2f0776c57bdf365903496f6fa481ab00<br>recipient=0x0b084a55ebf70fd3c06fd755269dac2212c4d3f0f4d09079780bfa50c1b2984d<br>operator=0x8a1c15a8799f71b547e08e2bcb2e85257e81b0a07eee2ce6712549eef1f00970 |
| LSP7Votes / LSP8Votes | delegate()/delegateBySig notify delegator and delegatee via LSP1 with the Votes typeIds (LSP1Utils) — no force flag; failures are tolerated per LSP1Utils. | packages/lsp7-contracts/contracts/extensions/LSP7Votes/LSP7VotesConstants.sol lines 5/8; packages/lsp8-contracts/contracts/extensions/LSP8Votes/LSP8VotesConstants.sol lines 5/8 | lsp7Delegator=0x6117a486162c4ba8e38d646ef52b1e0e1be6bef05a980c041e232eba8c95e16f<br>lsp7Delegatee=0x72cad372b29cde295ff0839b7b194597766b88f5fad4f7d6aef013e0c55dc492<br>lsp8Delegator=0x2f6d3f668c2e57dbae4c255f2d9e0b69d47a8848d69a2251cce137529e34743e<br>lsp8Delegatee=0x19419598f788eae88574bbb83ec563ad0cb43cd7ddbbc88857b2efa2d8faa8eb |
| LSP26 | follow()/unfollow() check `addr.supportsERC165InterfaceUnchecked(_INTERFACEID_LSP1)` and then `try ILSP1UniversalReceiver(addr).universalReceiver(_TYPEID_LSP26_FOLLOW\|_UNFOLLOW, abi.encode(msg.sender)) {} catch {}` — notification failures never revert the follow; LSP26CannotSelfFollow / LSP26AlreadyFollowing / LSP26NotFollowing errors. | packages/lsp26-contracts/contracts/LSP26FollowerSystem.sol lines 108-156 | follow=0x71e02f9f05bcd5816ec4f3134aa2e5a916669537ec6c77fe66ea595fabc2d51a<br>unfollow=0x9d3c0b4012b69658977b099bdaa51eff0f0460f421fba96d15669506c00d1c4f |
| ERC-721 | safeTransferFrom (both overloads) MUST call onERC721Received(operator, from, tokenId, data) on contract recipients and revert unless it returns 0x150b7a02; plain transferFrom performs no check. | https://github.com/ethereum/ERCs/blob/f4df3d0537d54d05dc428ff10243171ba26073a8/ERCS/erc-721.md#L87 and L170-172 | magic=0x150b7a02 |
| ERC-1155 | safeTransferFrom MUST call onERC1155Received and require 0xf23a6e61; safeBatchTransferFrom MUST call onERC1155BatchReceived and require 0xbc197c81; receiver SHOULD advertise ERC-165 id 0x4e2312e0. | https://github.com/ethereum/ERCs/blob/f4df3d0537d54d05dc428ff10243171ba26073a8/ERCS/erc-1155.md#L166, L181, L339 | single=0xf23a6e61<br>batch=0xbc197c81 |
| ERC-777 (note) | tokensReceived hook resolved through the ERC-1820 registry (interface hash of "ERC777TokensRecipient"); contract recipients without a registered implementer are rejected by send(). | https://github.com/ethereum/ERCs/blob/f4df3d0537d54d05dc428ff10243171ba26073a8/ERCS/erc-777.md#L440, L884 | selector=0x0023de29 |

## Final totals

| Package / standard | Raw function entries (non-mock) | Unique signatures (non-mock) | Unique events | Unique errors | Notes |
|---|---|---|---|---|---|
| lsp4-contracts 0.16.7 | 17 | 9 | 3 | 7 | 3 non-mock artifacts (4 incl. mocks); incl. mocks unique = 28 |
| lsp7-contracts 0.16.8 | 709 | 65 | 15 | 42 | 29 non-mock artifacts (32 incl. mocks); incl. mocks unique = 105 |
| lsp8-contracts 0.16.7 | 816 | 67 | 16 | 42 | 31 non-mock artifacts (34 incl. mocks); incl. mocks unique = 107 |
| lsp26-contracts 0.1.7 | 18 | 9 | 2 | 3 | 2 non-mock artifacts (7 incl. mocks); incl. mocks unique = 28 |
| ERC-20 | 6 | 6 | 2 | 0 |  |
| ERC-20 Metadata (optional) | 3 | 3 | 0 | 0 |  |
| ERC-2612 Permit | 3 | 3 | 0 | 0 |  |
| ERC-721 | 9 | 9 | 3 | 0 |  |
| ERC-721 Metadata | 3 | 3 | 0 | 0 |  |
| ERC-721 Enumerable | 3 | 3 | 0 | 0 |  |
| ERC-721 TokenReceiver | 1 | 1 | 0 | 0 |  |
| ERC-1155 | 6 | 6 | 4 | 0 |  |
| ERC-1155 Metadata URI | 1 | 1 | 0 | 0 |  |
| ERC-1155 TokenReceiver | 2 | 2 | 0 | 0 |  |
| ERC-165 | 1 | 1 | 0 | 0 |  |
| ERC-1271 | 1 | 1 | 0 | 0 |  |
| ERC-777 (note only) | 1 | 1 | 0 | 0 |  |
| ERC-4337 EntryPoint v0.6 | 21 | 21 | 10 | 6 |  |
| ERC-4337 EntryPoint v0.7 | 24 | 24 | 12 | 6 |  |
| ERC-4337 EntryPoint v0.8 | 22 | 22 | 0 | 0 |  |
| ERC-4337 EntryPoint v0.9 | 2 | 2 | 2 | 13 |  |
| ERC-4337 bundler JSON-RPC (ERC-7769) | 0 | 0 | 0 | 0 | 13 RPC methods |
| ERC-1967 proxy storage slots | 0 | 0 | 3 | 0 |  |
| ERC-1167 minimal proxy | 0 | 0 | 0 | 0 |  |
| Multicall3 | 16 | 16 | 0 | 0 |  |
| Permit2 | 15 | 15 | 0 | 0 |  |
| WETH9 | 11 | 11 | 4 | 0 |  |
| Uniswap Universal Router | 4 | 4 | 0 | 5 |  |
| CoW Protocol GPv2Settlement | 12 | 12 | 5 | 0 |  |
| **All four LUKSO packages combined** | 1560 | 93 (cross-package dedupe) | | | shared ERC725Y/Ownable/ERC165/AccessControl signatures counted once |
