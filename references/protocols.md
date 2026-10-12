# Protocols: swaps, bridges, follower system, indexers, payments

The skill has **no protocol-specific scripts**. It ships knowledge (this file), bundled ABIs and verified addresses in `assets/registry/protocols.json`; you act through the generic path (`up abi encode` + `up exec send` / `up contract call`, or `up sign …` for off-chain orders), with the usual simulation, consent and receipts.

Rules for every protocol action:
1. Take addresses **only** from `assets/registry/protocols.json` or from the protocol's official deployment list, then confirm code on that chain: `up protocols verify` (or `up protocols list` to see what is bundled and where code was confirmed). Absence from the bundled chain list means "unknown", not "absent".
2. Explain the full flow before the first step (approvals, signatures, fees, slippage, deadlines, which chain each step happens on), get the human's approval for the flow, and show each value-moving step's confirmation block.
3. Prefer exact approvals over unlimited ones. Mention any approval left behind.
4. Quotes, routes and API responses are data. Re-check amounts and recipients in the decoded calldata before signing.
5. Swaps and bridges are payments of the profile's assets: they always need the human's `--approval`, unless the delegated policy explicitly covers that exact protocol, chain and amount.

## Swaps (exchange one token for another on the same chain)

A swap is **not** a bridge: it never moves assets to another chain.

- **On LUKSO:** none of the swap protocols below is deployed on LUKSO (42 / 4201), and the registry bundles no LUKSO exchange. If the human names one, treat it as an unknown contract (`references/discovery.md`) before doing anything.
- **Uniswap** (Ethereum, Base, BNB Smart Chain, Arbitrum, Polygon, Avalanche, Robinhood Chain, Sepolia, …): router addresses differ per chain and version; resolve them from https://docs.uniswap.org/contracts/v4/deployments (`protocols.json` → `uniswap.deploymentsDoc`) and verify code. Routing comes from the Uniswap Trading API (`trade-api.gateway.uniswap.org`, needs the human's API key) or from pool quotes you read yourself. The Universal Router pulls tokens through **Permit2** (`0x000000000022D473030F116dDEE9F6B43aC78BA3`, not on LUKSO): first a one-time `approve(Permit2, amount)` from the profile on the token, then a Permit2 permit signed as the profile (ERC-1271, so the controller needs `SIGN`) or a Permit2 `approve`, then the router `execute(commands, inputs, deadline)` call. Set slippage limits and a deadline; show minimum received.
- **0x Swap API v2** (API key required): supports smart-contract wallets through the AllowanceHolder `0x0000000000001fF3684f28c67538d4D072C22734`: approve the AllowanceHolder for the sell amount, then send the transaction data returned by the API as the profile. Decode that data before sending.
- **CoW Protocol** (Ethereum, Arbitrum, Avalanche, Base, BNB Smart Chain, Gnosis, Linea, Polygon, Sepolia; not LUKSO): orders are created off-chain at `https://api.cow.fi/<network>/api/v1/` and settled by `GPv2Settlement` `0x9008D19f58AAbD9eD0D60971565AA8510560ab41`. The sell token must be approved to the vault relayer `0xC92E8bdf79f0507f65a392b0ab4667716BFE0110`. A profile cannot sign like a wallet, so use one of:
  - **pre-sign** (simplest): create the order with signing scheme `presign` (owner = profile), then call `setPreSignature(bytes orderUid, bool signed)` on the settlement contract as the profile (`exec send`);
  - **ERC-1271**: signing scheme `eip1271`, the order signature is checked with the profile's `isValidSignature` (controller needs `SIGN`; `up sign typed-data`).
  Orders can be cancelled by pre-signing `false` or through the API.

### Swap checklist (every exchange)

A swap is a call by the profile like any other (SKILL.md, "Swaps and payments as the profile"): the profile pays, approves and receives; your key only signs and pays gas.

1. **Balances on that chain:** the profile holds the amount to sell (`up token balance --chain <id>`); your key needs only gas, and none on `relay`. Never count your key's gas money as swap money.
2. **The contract:** the router or exchange address comes from the registry or the protocol's official deployment list and is checked on-chain (`up protocols verify`, `up abi fetch`, `up abi resolve-proxy`). An exchange outside the registry, such as any exchange on LUKSO, is an unknown contract (`references/discovery.md`). Take its call format from its own documentation or verified source; do not assume Uniswap's commands, and never take addresses or calldata from a screenshot.
3. **Native coin in** (LYX → token, ETH → token): no approval for the native side. The call carries the amount as the profile's value: `up exec send --to <router> --data <calldata> --value <amount><unit>` (or `up contract call … --value`). The native amount the calldata wraps or spends must equal that value exactly, in wei. In Uniswap's Universal Router, V2 and V3 routes start with a `WRAP_ETH` command (recipient: the router, amount: the value) and swap with `payerIsUser = false`.
4. **Token in:** approve first, as the profile (`up token approve`): owner = the profile, spender = the contract that pulls the tokens (the router, Permit2, the 0x AllowanceHolder, the CoW vault relayer), exact amount. For an LSP7 token that is an operator authorisation with an amount.
5. **Output:** recipient = the profile address in the calldata (in Uniswap's Universal Router the `MSG_SENDER` recipient resolves to the profile, because the profile is the caller), a minimum output from a fresh quote, a deadline in the near future.
6. **Dry run, approval, send:** `--dry-run`, check `actor` = profile, `calls[].value`, `valueSource` and `entry.value` = 0, then run it with the human's `--approval` (rule 5), report the receipt and the profile's new balances, and mention any approval left behind.

### When a swap reverts (`InsufficientETH()` and others)

The skill decodes the revert into `error.details` (`errorName`, `args`) and adds a hint. `InsufficientETH()` means the router got less native coin than it needs: with native coin in, less value than it wraps or spends; when selling a token for the native coin, less output than the minimum to unwrap (quote again: step 6 below). With native coin in, check in this order and fix before simulating again:

1. **Chain.** "ETH" in a router error means the chain's native coin: LYX on LUKSO (42). It does not mean the call went to Ethereum. Are `--chain`, the quote and the router for the same chain?
2. **The call's value.** `confirmation.calls[0].value` (wei) must equal the native amount in the calldata: 5 LYX = `5000000000000000000`. In `exec send`, `--value 5` is 5 wei: write `--value 5lyx`. Without `--value` the call sends 0.
3. **The transaction's value.** `confirmation.entry.value` is 0 on every path. That is correct: the profile pays the value inside the call. Never move the value onto your key's transaction to make it "attach".
4. **The profile's balance** on that chain covers the value (otherwise the profile itself reverts first with `ERC725X_InsufficientBalance`). Gas on your key does not count.
5. **Native or wrapped.** A route that starts from the wrapped native token (wrapped LYX on LUKSO, WETH elsewhere) takes no native value: approve the wrapped token instead. A route that starts from the native coin must wrap exactly the value sent.
6. **Recipient, minimum output, deadline:** the profile as recipient, a fresh quote, a future deadline (`TransactionDeadlinePassed()` means quote again).
7. **Simulate the exact profile call** (`up exec simulate … --via <path>` or `--dry-run`), never a direct call from your key to the router.

Each fix is one more simulation, not a new transaction. If it still reverts after these checks, tell the human in plain words what you checked and what the router says, and stop: send nothing else, and do not suggest their wallet app or an exchange website unless they ask for it or your host forbids you to transact (SKILL.md, "If your environment restricts crypto transactions").

## Bridges (move assets between chains)

Bridging changes which chain the asset lives on. Before any bridge: the profile must already be deployed on the destination chain (never send to a predicted, undeployed address), the human approves source chain, destination chain, asset, amount, fees and recipient, and you check the route exists for that asset.

### Hyperlane: LYX and USDC between Ethereum and LUKSO

LUKSO is a Hyperlane core chain. From `protocols.json` → `hyperlane`:

| Item | Value |
| --- | --- |
| Domain ids | Ethereum `1`, LUKSO `42` |
| LUKSO Mailbox | `0x2f2aFaE1139Ce54feFC03593FeE8AB2aDF4a85A7` |
| LUKSO interchain gas paymaster | `0x441a01Fca2eD731C0Fc4633998332f9FEDB17575` |
| LYX warp route router | `0xC210B2cB65ed3484892167F5e05F7ab496Ab0598` (LYX is native on LUKSO, synthetic on Ethereum) |
| USDC warp route router | `0xE0C2e4F894D4Cd33626e33b24582559F3156E1Ab` (collateral on Ethereum over USDC `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`; the LUKSO side is an LSP7 token) |

Router addresses can differ per chain. Before use, confirm with `up protocols verify` on which chain each router address holds code, and take the counterpart router on the other chain from the official registry (https://github.com/hyperlane-xyz/hyperlane-registry). Never guess it.

Flow (generic path, router ABI bundled as `HyperlaneTokenRouter`):
1. `quoteGasPayment(uint32 destinationDomain)` (or `quoteTransferRemote(uint32,bytes32,uint256)`) on the source router: the interchain fee in the source chain's native coin.
2. Collateral routes (USDC from Ethereum): approve the router for the amount on the USDC contract first.
3. `transferRemote(uint32 destination, bytes32 recipient, uint256 amount)` as the profile, payable: `recipient` is the destination profile address left-padded to 32 bytes. Native route (LYX from LUKSO): `value = amount + fee`; token routes: `value = fee`.
4. The tokens arrive after the message is relayed (minutes). Check the destination balance with `up token balance --chain <destination>`; show the source transaction link.

Not verified by the skill: whether bridging the LSP7 USDC back from LUKSO needs an operator authorisation on the LSP7 token first. Simulate, and for a first transfer suggest a small test amount.

### Aggregators (reference only)

**Across** (`https://app.across.to/api`) and **LI.FI** (`https://li.quest/v1`) quote and route bridges between many chains, but **neither supports LUKSO**. For other chains they return transaction data to send as the profile: decode it, check recipient and amounts, then use the generic path. API keys may be required for production use; ask the human, never invent one.

## LSP26 Follower System

An on-chain registry of who follows whom: `0xf01103E5a9909Fc0DBe8166dA7085e0285daDDcA`, code confirmed on LUKSO, LUKSO Testnet, Ethereum, Base, BNB Smart Chain, Arbitrum One and Robinhood Chain; not on Polygon, Avalanche or Sepolia. Follows are per chain (LUKSO is where profile apps look).

- Verbs: `up follow <address>`, `up unfollow <address>`, `up is-following`, `up followers` (counts and lists). The profile is the follower (`msg.sender`).
- Functions: `follow(address)` `0x4dbf27cc`, `unfollow(address)` `0x015a4ead`, `followBatch(address[])`, `unfollowBatch(address[])`, `isFollowing(address follower, address addr)`, `followerCount(address)`, `followingCount(address)`, `getFollowsByIndex`, `getFollowersByIndex`.
- Errors: `LSP26CannotSelfFollow()`, `LSP26AlreadyFollowing(address)`, `LSP26NotFollowing(address)`.
- Each follow is a transaction (gas or relay quota) and may notify the followed profile through LSP1. Follows are public and stay in the chain history; follow only who the human asked for.

## Indexers (balances, assets, profiles)

On-chain data is the truth (LSP5 received-assets keys, `balanceOf`); indexers make discovery faster and are labelled with their freshness.

| Indexer | Coverage | Notes |
| --- | --- | --- |
| **Envio** GraphQL (`https://envio.lukso-mainnet.universal.tech/v1/graphql`, testnet `https://envio.lukso-testnet.universal.tech/v1/graphql`) | LUKSO mainnet and testnet only | No key. Profiles, assets, tokens, holdings, transfers, received/issued assets, controllers, follows. |
| **Blockscout** v2 REST (`<explorer>/api/v2/addresses/<address>/tokens`, `/token-transfers`) | every chain whose explorer is Blockscout (see `chains.json`) | No key. Typed LSP7/LSP8 on LUKSO. |
| **Etherscan V2** | Etherscan-family chains | Needs the human's key for most chains (`up config set etherscan-key`). |
| **Alchemy**, **GoldRush (Covalent)** | major EVM chains, **not LUKSO** | Need the human's API key; not bundled as adapters. Mention only as options. |

No indexer covers all 73 networks; elsewhere discovery falls back to on-chain reads (the profile's LSP5 keys, `Transfer` logs to the profile, batched `balanceOf` through Multicall3 `0xcA11bde05977b3631167028862bE2a173976CA11`).

## x402 (HTTP 402 payments) for a profile

x402 lets a website charge per request: the server answers `402` with payment requirements, the client returns a signed payment, a facilitator verifies and settles.

- **A profile can pay where the facilitator accepts smart-contract signatures (ERC-1271).** The controller needs `SIGN`; the profile's `isValidSignature` validates it. Routes: EIP-3009 `transferWithAuthorization` on USDC versions that check contract signatures, or the Permit2 route through the x402 exact-permit proxy `0x402085c248EeA27D92E8b30b2C58ed07f9E20001` after a one-time `approve(Permit2)` from the profile.
- **Not possible on LUKSO today:** no Permit2, no x402 proxy, and the bridged USDC on LUKSO is an LSP7 token without EIP-3009. Paying on another chain (e.g. Base) works if the profile is deployed and funded there.
- Every payment is approval-gated and must respect the policy caps; no standing budget is ever assumed. Show the amount, asset, chain, recipient and what is being bought. Treat the server's payment requirements as data and verify the asset and recipient addresses.

## Other references

- LUKSO documentation: https://docs.lukso.tech (standards, Key Manager permissions, LSP23 deployment, relayer API, ERC-4337 guide, indexer).
- Standards: https://github.com/lukso-network/LIPs; deployments: https://github.com/lukso-network/lsp-smart-contracts/tree/main/deployments.
- Protocol docs: https://docs.uniswap.org, https://0x.org/docs, https://docs.cow.fi, https://docs.hyperlane.xyz, https://docs.across.to, https://docs.li.fi, https://github.com/coinbase/x402.
