# Standards the skill covers

LUKSO Standard Proposals (LSPs) are specified in https://github.com/lukso-network/LIPs (folder `LSPs/`); the reference implementation is https://github.com/lukso-network/lsp-smart-contracts. `up standards list [filter]` prints the same overview as data. Function-level detail (every signature, selector, mutability and how the skill reaches it) is in:

- `references/functions-account.md`: LSP0, LSP1, LSP6, LSP9, LSP11, LSP14, LSP16, LSP17, LSP20, LSP23, LSP25, Universal Profile presets, ERC725; plus interface ids, permission bits, data keys, LSP1 type ids and spec constants;
- `references/functions-tokens.md`: LSP4, LSP7, LSP8, LSP26 and the reference ERCs (20, 2612, 721, 1155, 165, 1271, 777, 4337 EntryPoints, 1967/1167 proxies, Multicall3, Permit2, WETH9, Uniswap Universal Router, CoW settlement);
- `references/functions-bindings.md`: every LUKSO signature classified as verb / generic / internal / knowledge.

## The account (what a Universal Profile is made of)

| Standard | What it is | How the skill uses it | Spec |
| --- | --- | --- | --- |
| ERC-725 (X + Y) | `execute` (CALL, CREATE, CREATE2, STATICCALL, DELEGATECALL) and a key/value store (`getData`/`setData`) | every action is an `execute`/`setData` payload | https://eips.ethereum.org/EIPS/eip-725 |
| LSP0 ERC725Account | the profile contract: ERC725 + LSP1 + LSP14 + LSP17 + LSP20 + ERC-1271; interface id `0x24871b3d` | the on-chain actor; `account info`, `account data` | https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-0-ERC725Account.md |
| LSP6 KeyManager | owner of the profile; checks controller permissions, AllowedCalls, AllowedERC725YDataKeys; id `0x23f34c62` | `permissions`, `controller`, `allowed-calls`, `allowed-keys`; `km` path | https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-6-KeyManager.md |
| LSP20 CallVerification | lets controllers call the profile directly; the profile asks the Key Manager | `lsp0` path; permission dry-runs | https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-20-CallVerification.md |
| LSP25 ExecuteRelayCall | signed meta-transactions with multi-channel nonces and validity windows; id `0x5ac79908` | `relay` path, `nonce` | https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-25-ExecuteRelayCall.md |
| LSP14 Ownable2Step | two-step ownership transfer; time-windowed renounce | `ownership transfer/accept/renounce` | https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-14-Ownable2Step.md |
| LSP1 UniversalReceiver | notification hook on received tokens/value; delegate (URD) maintains asset lists | token flows, LSP5 bookkeeping | https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-1-UniversalReceiver.md |
| LSP17 ContractExtension | adds functions to the profile per selector (ERCTokenCallbacks, Extension4337) | extension checks, ERC-4337 enable | https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-17-ContractExtension.md |
| LSP23 LinkedContractsFactory | deploys profile + Key Manager + setup in one transaction at a precomputable address | `account precompute`, `account deploy` | https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-23-LinkedContractsFactory.md |
| LSP2 ERC725YJSONSchema | how data keys are named and values encoded (Singleton, Array, Mapping, VerifiableURI) | `account data get/set` decoding | https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-2-ERC725YJSONSchema.md |
| LSP3 Profile Metadata | the profile's public name, description, links, images (`LSP3Profile` key) | `account data` | https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-3-Profile-Metadata.md |
| LSP5 ReceivedAssets | list of assets the profile received | `token list` | https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-5-ReceivedAssets.md |
| LSP10 ReceivedVaults | list of vaults the profile owns | knowledge | https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-10-ReceivedVaults.md |
| LSP12 IssuedAssets | list of assets the profile issued | knowledge, `account data` | https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-12-IssuedAssets.md |
| LSP9 Vault | a sub-account owned by a profile | generic ABI path | https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-9-Vault.md |
| LSP11 BasicSocialRecovery | guardian-based recovery contract (not part of a default deployment) | generic ABI path | https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-11-BasicSocialRecovery.md |
| LSP16 UniversalFactory | deterministic CREATE2 factory for same-address deployments | knowledge, generic | https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-16-UniversalFactory.md |

## Assets and social

| Standard | What it is | Skill | Spec |
| --- | --- | --- | --- |
| LSP4 DigitalAsset Metadata | token name, symbol, type, metadata, creators as data keys | `token metadata` | https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-4-DigitalAsset-Metadata.md |
| LSP7 DigitalAsset | fungible token with `force`, LSP1 hooks, operators; id `0xc52d6008` | `token *` | https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-7-DigitalAsset.md |
| LSP8 IdentifiableDigitalAsset | NFT with `bytes32` ids, per-token data; id `0x3a271706` | `token *` | https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-8-IdentifiableDigitalAsset.md |
| LSP18 Royalties | royalty data keys | knowledge | https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-18-Royalties.md |
| LSP26 FollowerSystem | on-chain follow registry; id `0x2b299cea` | `follow`, `unfollow`, `is-following`, `followers` | https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-26-FollowerSystem.md |

## Off-chain API

| Standard | What it is | Skill | Spec |
| --- | --- | --- | --- |
| LSP15 Transaction Relay Service API | relayer HTTP API (`/execute`, `/quota`); the skill adds a `chainId` extension for multichain relayers | `relayer *`, `relay` path | https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-15-TransactionRelayServiceAPI.md |

## Ethereum standards

| Standard | Skill use | Spec |
| --- | --- | --- |
| ERC-20 | fungible tokens on every chain | https://eips.ethereum.org/EIPS/eip-20 |
| ERC-721 | NFTs; safe transfers into a profile need ERCTokenCallbacks | https://eips.ethereum.org/EIPS/eip-721 |
| ERC-1155 | multi-tokens; same callback requirement | https://eips.ethereum.org/EIPS/eip-1155 |
| ERC-165 | interface detection | https://eips.ethereum.org/EIPS/eip-165 |
| ERC-1271 | profile signatures (`sign`, `verify-1271`; controller needs `SIGN`) | https://eips.ethereum.org/EIPS/eip-1271 |
| ERC-4337 | opt-in UserOperations via EntryPoint v0.6 and Extension4337 (`references/erc4337.md`) | https://eips.ethereum.org/EIPS/eip-4337 |
| EIP-191 / EIP-712 | message and typed-data signing (LSP25 uses EIP-191 version 0) | https://eips.ethereum.org/EIPS/eip-191, https://eips.ethereum.org/EIPS/eip-712 |
| EIP-681 | payment request URIs in funding QR codes | https://eips.ethereum.org/EIPS/eip-681 |
| ERC-1967 / ERC-1167 | proxy detection in ABI discovery | https://eips.ethereum.org/EIPS/eip-1967, https://eips.ethereum.org/EIPS/eip-1167 |
| ERC-2612, Permit2 | token permits for swaps and x402 | https://eips.ethereum.org/EIPS/eip-2612, https://github.com/Uniswap/permit2 |

## Not covered

LSP28 (The Grid) is a data format the skill does not use. LSP30 (ERC725Account backup file) is used by `up backup` (see `references/security.md`, "Account backups"). LSP numbers 13, 19, 21, 22, 24, 27 and 29 do not exist in the LIPs repository.

LUKSO's developer documentation (guides, permission tables, deployment pages): https://docs.lukso.tech
