# Function bindings: how the skill reaches every LUKSO signature

Every unique external signature of the LUKSO packages, classified by how the agent reaches it: **verb** = dedicated `up` command / `up_*` MCP tool (exact flags in `references/verbs.md` or `up <verb> --help`); **generic** = `abi encode` + `exec send` / `contract call` (no dedicated verb, same safety rules); **internal** = used inside the skill's own flows; **knowledge** = documented only. Test classes (what the skill's test suite exercises): V = view/pure; W = state-changing on all applicable paths with negative permission tests; P = payable value; O = two-step ownership; R = relay; A = ERC-4337; F = factory determinism; T = token flow (force flag, receiver hooks, operators). Counts are classifications, not a statement that every path has been tested on every chain.

## A. Account stack (71 unique signatures)

| Selector | Signature | Standard / defined by | Binding | Test |
| --- | --- | --- | --- | --- |
| 0x79ba5097 | `acceptOwnership()` | LSP14 | verb `ownership accept` | O |
| 0xc6845210 | `addGuardian(address,address)` | LSP11 | generic (LSP11 is not deployed with a UP by default) | W |
| 0x6963d438 | `batchCalls(bytes[])` | LSP0 (also LSP7/LSP8/LSP9/LSP11) | verb `exec batch` (via lsp0) (advanced) | W |
| 0x1ce59666 | `cancelRecoveryProcess(address)` | LSP11 | generic | W |
| 0xb79336ee | `COMMITMEMT_DELAY()` | LSP11 (typo verbatim) | generic | V |
| 0xa9e3b276 | `commitToRecover(address,address,bytes32)` | LSP11 | generic | W |
| 0x3b315680 | `computeAddress(bytes32,bytes32,bool,bytes)` | LSP16 | knowledge | V |
| 0xdd5940f3 | `computeAddresses((bytes32,uint256,bytes),(uint256,bytes,bool,bytes),address,bytes)` | LSP23 (non-proxy) | internal (`account precompute` (mode full)) | V,F |
| 0xe888edcb | `computeERC1167Address(address,bytes32,bool,bytes)` | LSP16 | knowledge | V |
| 0x72b19d36 | `computeERC1167Addresses((bytes32,uint256,address,bytes),(uint256,address,bytes,bool,bytes),address,bytes)` | LSP23 | verb `account precompute` | V,F |
| 0x8bc0ab75 | `DEFAULT_RECOVERY_DELAY()` | LSP11 | generic | V |
| 0x754b86b5 | `deployContracts((bytes32,uint256,bytes),(uint256,bytes,bool,bytes),address,bytes)` | LSP23 | verb `account deploy` (mode full) | W,P,F |
| 0x26736355 | `deployCreate2(bytes,bytes32)` | LSP16 | generic | W,P |
| 0xcdbd473a | `deployCreate2AndInitialize(bytes,bytes32,bytes,uint256,uint256)` | LSP16 | generic | W,P |
| 0x6a66a753 | `deployERC1167Proxies((bytes32,uint256,address,bytes),(uint256,address,bytes,bool,bytes),address,bytes)` | LSP23 | verb `account deploy` (default) | W,P,F |
| 0x49d8abed | `deployERC1167Proxy(address,bytes32)` | LSP16 | generic | W |
| 0x5340165f | `deployERC1167ProxyAndInitialize(address,bytes32,bytes)` | LSP16 | generic | W,P |
| 0xb0d691fe | `entryPoint()` | Extension4337 | verb `account info` (4337 section) | V,A |
| 0x09c5eabe | `execute(bytes)` | LSP6 | verb `exec send` (direct KM path) | W,P |
| 0x44c028fe | `execute(uint256,address,uint256,bytes)` | ERC725X (LSP0/LSP9) | verb `exec send` (via lsp0) + payload builder for all paths | W,P |
| 0x31858452 | `executeBatch(uint256[],address[],uint256[],bytes[])` | ERC725X | verb `exec batch` (via lsp0) | W,P |
| 0xbf0176ff | `executeBatch(uint256[],bytes[])` | LSP6 | verb `exec batch` (KM) | W,P |
| 0x28c4d14e | `executePostDeployment(address,address,bytes)` | LSP23 module | internal (called by factory) | W |
| 0x4c8a4e74 | `executeRelayCall(bytes,uint256,uint256,bytes)` | LSP25 (on KM) | verb `exec relay` | W,P,R |
| 0xa20856a5 | `executeRelayCallBatch(bytes[],uint256[],uint256[],uint256[],bytes[])` | LSP25 | internal: library only (`signRelayBatch`); no verb sends it — `exec batch --via relay` signs one `executeRelayCall` with a `UP.executeBatch` payload | W,P,R |
| 0x1a17ccbf | `generateSalt(bytes32,bool,bytes)` | LSP16 | knowledge | V |
| 0x6289a163 | `getCommitmentInfoOf(address,uint256,address)` | LSP11 | generic | V |
| 0x54f6127f | `getData(bytes32)` | ERC725Y | verb `account data get` | V |
| 0xdedff9c6 | `getDataBatch(bytes32[])` | ERC725Y | verb `account data get` (multi) | V |
| 0x88095527 | `getFirstRecoveryTimestampOf(address,uint256)` | LSP11 | generic | V |
| 0x8ca4aaaf | `getGuardiansOf(address)` | LSP11 | generic | V |
| 0xdbd119bd | `getGuardiansThresholdOf(address)` | LSP11 | generic | V |
| 0xb44581d9 | `getNonce(address,uint128)` | LSP25 | verb `nonce` (+ internal) | V,R |
| 0xcee79d45 | `getRecoveryCounterOf(address)` | LSP11 | generic | V |
| 0x02543bff | `getRecoveryDelayOf(address)` | LSP11 | generic | V |
| 0x06fe1738 | `getSecretHashOf(address)` | LSP11 | generic | V |
| 0x506d1a0f | `getVotedAddressByGuardian(address,uint256,address)` | LSP11 | generic | V |
| 0xa65068b6 | `getVotesOfGuardianVotedAddress(address,uint256,address)` | LSP11 | generic | V |
| 0xd617b890 | `hasReachedThreshold(address,uint256,address)` | LSP11 | generic | V |
| 0xc4d66de8 | `initialize(address)` | Init variants (LSP0/LSP6/LSP9/ERC725) | internal (proxy init via LSP23 calldata) | W |
| 0x769e54df | `isGuardianOf(address,address)` | LSP11 | generic | V |
| 0x1626ba7e | `isValidSignature(bytes32,bytes)` | ERC1271 (LSP0, LSP6) | verb `verify-1271`; internal for CoW/x402/off-chain auth | V |
| 0xde928f14 | `lsp20VerifyCall(address,address,address,uint256,bytes)` | LSP20 (KM) | internal (dry-run permission checks; 4337 validation) | simulate |
| 0xd3fc45d3 | `lsp20VerifyCallResult(bytes32,bytes)` | LSP20 | internal | — |
| 0x06fdde03 | `name()` | ERC20MetadataCompatibilityExtension | knowledge | V |
| 0xbc197c81 | `onERC1155BatchReceived(address,address,uint256[],uint256[],bytes)` | ERCTokenCallbacks (LSP17 ext.) | internal check (`token transfer` warns if missing) | V |
| 0xf23a6e61 | `onERC1155Received(address,address,uint256,uint256,bytes)` | ERCTokenCallbacks | internal check (`token transfer` warns if missing) | V |
| 0x150b7a02 | `onERC721Received(address,address,uint256,bytes)` | ERCTokenCallbacks / OnERC721ReceivedExtension | internal check (`token transfer` warns if missing) | V |
| 0x8da5cb5b | `owner()` | OwnableUnset | verb `account info` | V |
| 0xe30c3978 | `pendingOwner()` | LSP14 | verb `account info` | V |
| 0xf3b3c785 | `recoverAccess(address,address,bytes32,bytes32,bytes)` | LSP11 | generic | W,P |
| 0x9b27a90e | `removeGuardian(address,address)` | LSP11 | generic | W |
| 0xead3fbdf | `RENOUNCE_OWNERSHIP_CONFIRMATION_DELAY()` | LSP14 | knowledge | V |
| 0x01bfba61 | `RENOUNCE_OWNERSHIP_CONFIRMATION_PERIOD()` | LSP14 | knowledge | V |
| 0x715018a6 | `renounceOwnership()` | LSP14 | verb `ownership renounce` (double confirmation) | O |
| 0x7f23690c | `setData(bytes32,bytes)` | ERC725Y | verb `account data set` (+ permission/controller/extension/URD verbs) | W,P |
| 0x4f04d60a | `setDataAndTransferOwnership(bytes32[],bytes[],address)` | LSP23 UP Init post-deployment module | internal (deployment calldata) | W |
| 0x97902421 | `setDataBatch(bytes32[],bytes[])` | ERC725Y | verb `account data set` (multi), `controller add/edit/remove` | W,P |
| 0x639cea19 | `setGuardiansThreshold(address,uint256)` | LSP11 | generic | W |
| 0xa219b404 | `setRecoveryDelay(address,uint256)` | LSP11 | generic | W |
| 0x78f84ebd | `setRecoverySecretHash(address,bytes32)` | LSP11 | generic | W |
| 0x01ffc9a7 | `supportsInterface(bytes4)` | ERC165 | internal (`abi fetch`, token standard detection) | V |
| 0x95d89b41 | `symbol()` | ERC20MetadataCompatibilityExtension | knowledge | V |
| 0xd4b83992 | `target()` | LSP6 | verb `account info` (KM → UP link check) | V |
| 0x0023de29 | `tokensReceived(address,address,address,uint256,bytes,bytes)` | ERCTokenCallbacks (ERC777) | knowledge | V |
| 0xf2fde38b | `transferOwnership(address)` | LSP14 | verb `ownership transfer` | O |
| 0x6bb56a14 | `universalReceiver(bytes32,bytes)` | LSP1 (LSP0) | generic; internal for LSP5 bookkeeping tests | W,P |
| 0xa245bbda | `universalReceiverDelegate(address,uint256,bytes32,bytes)` | LSP1 delegate | knowledge (called by the UP) | — |
| 0x3a871cdd | `validateUserOp((address,uint256,bytes,bytes,uint256,uint256,uint256,uint256,uint256,bytes,bytes),bytes32,uint256)` | IAccount v0.6 via Extension4337 | internal (`exec userop`; registration via `account 4337 enable`) | A |
| 0xffa1ad74 | `VERSION()` | Version | verb `account info` | V |
| 0xfa04a7f1 | `voteForRecovery(address,address,address)` | LSP11 | generic | W |

Account-stack counts: 71 → 23 verbs · 12 internal · 27 generic (LSP11, LSP16, misc) · 9 knowledge.

## B. Token and social packages (93 unique signatures across lsp4/lsp7/lsp8/lsp26)

### B1. LSP7 core (ILSP7DigitalAsset, 12) and LSP8 core (ILSP8IdentifiableDigitalAsset, 15)

| Selector | Signature | Std | Binding | Test |
| --- | --- | --- | --- | --- |
| 0x70a08231 | `balanceOf(address)` | LSP7/LSP8 | verb `token balance` | V |
| 0x18160ddd | `totalSupply()` | LSP7/LSP8 | verb `token metadata` | V |
| 0x313ce567 | `decimals()` | LSP7 | verb `token metadata` | V |
| 0x760d9bba | `transfer(address,address,uint256,bool,bytes)` | LSP7 | verb `token transfer` (force + receiver-hook warnings) | W,T |
| 0x2d7667c9 | `transferBatch(address[],address[],uint256[],bool[],bytes[])` | LSP7 | verb `token transfer` (batch) | W,T |
| 0xb49506fd | `authorizeOperator(address,uint256,bytes)` | LSP7 | verb `token approve` | W,T |
| 0x30d0dc37 | `revokeOperator(address,address,bool,bytes)` | LSP7 | verb `token approve` (revoke) | W,T |
| 0x2bc1da82 | `increaseAllowance(address,uint256,bytes)` | LSP7 | verb `token approve` (increase) | W |
| 0x78381670 | `decreaseAllowance(address,address,uint256,bytes)` | LSP7 | verb `token approve` (decrease) | W |
| 0x65aeaa95 | `authorizedAmountFor(address,address)` | LSP7 | verb `token operators` | V |
| 0xd72fc29a | `getOperatorsOf(address)` | LSP7 | verb `token operators` | V |
| 0x6963d438 | `batchCalls(bytes[])` | LSP7/LSP8 | generic | W |
| 0x511b6952 | `transfer(address,address,bytes32,bool,bytes)` | LSP8 | verb `token transfer` (tokenId) | W,T |
| 0x7e87632c | `transferBatch(address[],address[],bytes32[],bool[],bytes[])` | LSP8 | verb `token transfer` (batch) | W,T |
| 0x86a10ddd | `authorizeOperator(address,bytes32,bytes)` | LSP8 | verb `token approve` | W,T |
| 0xdb8c9663 | `revokeOperator(address,bytes32,bool,bytes)` | LSP8 | verb `token approve` (revoke) | W,T |
| 0x2a3654a4 | `isOperatorFor(address,bytes32)` | LSP8 | verb `token operators` | V |
| 0x49a6078d | `getOperatorsOf(bytes32)` | LSP8 | verb `token operators` | V |
| 0xa3b261f2 | `tokenIdsOf(address)` | LSP8 | verb `token list` | V |
| 0x217b2270 | `tokenOwnerOf(bytes32)` | LSP8 | verb `token metadata` (token-id) | V |
| 0x16e023b3 | `getDataForTokenId(bytes32,bytes32)` | LSP8 | verb `token metadata` (token-id) (read via eth_call) | V |
| 0x1d26fce6 | `getDataBatchForTokenIds(bytes32[],bytes32[])` | LSP8 | verb `token metadata` (token-id) (multi) | V |
| 0xd6c1407c | `setDataForTokenId(bytes32,bytes32,bytes)` | LSP8 | generic (issuer action) | W |
| 0xbe9f0e6f | `setDataBatchForTokenIds(bytes32[],bytes32[],bytes[])` | LSP8 | generic (issuer action) | W |

### B2. Shared metadata / ownership / introspection (LSP4 base + ERC725Y + Ownable + ERC165; 9 signatures, also counted in A)
`getData` `0x54f6127f`, `getDataBatch` `0xdedff9c6` → verb `token metadata` (LSP4 keys: TokenName/Symbol/Type/Metadata/Creators) · `setData` `0x7f23690c`, `setDataBatch` `0x97902421` → generic (issuer) · `owner` `0x8da5cb5b`, `transferOwnership` `0xf2fde38b`, `renounceOwnership` `0x715018a6` → generic (issuer; OZ single-step Ownable on tokens, **not** LSP14) · `supportsInterface` `0x01ffc9a7` → internal detection · `toLSP4MetadataJSON(...)` `0x4821954f` (LSP4Utils library external) → knowledge (metadata JSON builder reference). Test: V / W.

### B3. LSP7/LSP8 extensions and presets (issuer-side; all **generic**, bundled ABIs, labelled by extension)

| Group | Signatures (LSP7 selector / LSP8 selector where different) | Binding | Test |
| --- | --- | --- | --- |
| Mintable | `mint(address,uint256,bool,bytes)` 0x7580d920 / `mint(address,bytes32,bool,bytes)` 0xaf255b61; `disableMinting()` 0x7e5cd5c1; `isMintable()` 0x46b45af7; `MINTER_ROLE()` 0xd5391393 | generic | W,T / V |
| Burnable | `burn(address,uint256,bytes)` 0x44d17187 / `burn(bytes32,bytes)` 0x6c79b70b | generic | W |
| CappedSupply / CappedBalance | `tokenSupplyCap()` 0x52058d8a; `tokenBalanceCap()` 0xd1ca0188; `UNCAPPED_BALANCE_ROLE()` 0x94187753 | generic | V |
| NonTransferable | `isTransferable()` 0x2121dc75; `makeTransferable()` 0x696fd68c; `updateTransferLockPeriod(uint256,uint256)` 0x45e14c46; `transferLockStart()` 0xe6fc6098; `transferLockEnd()` 0x8fb05730; `transferLockEnabled()` 0xecff3a0c (→ upstream 0.18: `nonTransferabilityEnabled()` 0x34ac6823); `NON_TRANSFERABLE_BYPASS_ROLE()` 0x12318ac4 | generic (the `token transfer` verb reads transferability first) | V / W |
| Revokable | `revoke(address,address,uint256,bytes)` 0xf5fb0b0c / `revoke(address,address,bytes32,bytes)` 0x84bfc8eb; `isRevokable()` 0x9e045773; `disableRevokable()` 0xc282ca78; `REVOKER_ROLE()` 0x7c4acabf | generic | W / V |
| Votes (ERC-5805/6372/5267) | `delegate(address)` 0x5c19a95c; `delegateBySig(...)` 0xc3cda520; `delegates(address)` 0x587cde1e; `getVotes(address)` 0x9ab24eb0; `getPastVotes(address,uint256)` 0x3a46b1a8; `getPastTotalSupply(uint256)` 0x8e539e8c; `checkpoints(address,uint32)` 0xf1127ed8 (LSP7); `numCheckpoints(address)` 0x6fcfff45 (LSP7); `nonces(address)` 0x7ecebe00; `clock()` 0x91ddadf4; `CLOCK_MODE()` 0x4bf5d7e9; `DOMAIN_SEPARATOR()` 0x3644e515; `eip712Domain()` 0x84b0196e | generic (governance) | W / V |
| AccessControlExtended (OZ AccessControl + enumeration) | `hasRole` 0x91d14854; `grantRole` 0x2f2ff15d; `revokeRole` 0xd547741f; `renounceRole` 0x36568abe; `getRoleAdmin` 0x248a9ca3; `setRoleAdmin(bytes32,bytes32)` 0x1e4e0091; `getRoleMember(bytes32,uint256)` 0x9010d07c; `getRoleMemberCount(bytes32)` 0xca15c873; `getRoleMembers(bytes32)` 0xa3246ad3; `rolesOf(address)` 0x2de94807; `DEFAULT_ADMIN_ROLE()` 0xa217fddf | generic | W / V |
| Enumerable (LSP8) | `tokenAt(uint256)` 0x92a91a3a | generic | V |
| Preset initializers | `initialize(string,string,address,uint256,bool)` 0x04689a81, `initialize(string,string,address,uint256,bool,(bool,uint256),(uint256,uint256),(uint256,uint256),(bool))` 0x15f71630 (LSP7); `initialize(string,string,address,uint256,uint256)` 0x74823132, `initialize(string,string,address,uint256,uint256,(bool,bytes32[]),(uint256,uint256),(uint256,uint256),(bool))` 0x48c4f93e (LSP8) | internal (only if a `token deploy` verb is added later; otherwise generic) | W |

### B4. LSP26 Follower System (9)
`follow(address)` 0x4dbf27cc, `unfollow(address)` 0x015a4ead, `followBatch(address[])` 0xcf8711c8, `unfollowBatch(address[])` 0x8dd1e47e → verbs `follow`/`unfollow` (W,T) · `isFollowing(address,address)` 0x99ec3a42, `followerCount(address)` 0x30b3a890, `followingCount(address)` 0x64548707, `getFollowsByIndex(address,uint256,uint256)` 0x5a39c581, `getFollowersByIndex(address,uint256,uint256)` 0xb2a8d069 → verb `followers` (V).

Token/social counts: 93 → 25 verbs (token/follow surface) · ~6 internal · ~60 generic (issuer, extension, governance, access-control) · 2 knowledge.

## C. Reference standards (bundled ABIs; bindings)
- ERC-20/721/1155 transfer/approve/balance/metadata/receiver → `token *` verbs (standard auto-detected) with receiver-hook warnings for 721/1155 safe transfers into a UP (needs ERCTokenCallbacks registered); ERC-2612 `permit` → `sign typed-data` + generic; ERC-165/1271 → internal.
- ERC-4337 EntryPoint v0.6 (`handleOps` 0x1fad948c, `getUserOpHash`, `getNonce`, `depositTo`, `balanceOf`, `withdrawTo`, `simulateValidation`, `simulateHandleOp`, …) → internal to `exec userop` / `account 4337 *`; v0.7–v0.9 → knowledge until an extension variant exists.
- Multicall3 (`aggregate3` etc.) → internal batched reads. Permit2 (`approve`, `permit`, `allowance`, `transferFrom`, …) → generic + `sign typed-data` (ERC-1271). WETH9 (`deposit`/`withdraw`) → generic. Universal Router `execute` overloads → generic (swap knowledge). CoW `setPreSignature` → generic (order flow knowledge).

## D. Coverage summary
| Set | Unique signatures | verb | internal | generic | knowledge |
| --- | --- | --- | --- | --- | --- |
| Account stack | 71 | 24 | 13 | 25 | 9 |
| Token/social | 93 | 25 | ~6 | ~60 | 2 |
| Reference standards | ~190 (incl. 4 EntryPoint versions) | via `token *`/`sign` | 4337 v0.6, Multicall3, ERC-165/1271 | most | v0.7–v0.9 |

Every row is reachable; counts are classifications, not implementation status.
