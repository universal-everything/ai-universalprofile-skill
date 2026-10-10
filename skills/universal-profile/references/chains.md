# Chains: registry, RPCs and multi-chain rules

The skill works on every EVM network where the LSP contracts are deployed. Its chain list is a mirror of the official [lsp-smart-contracts `deployments/` folder](https://github.com/lukso-network/lsp-smart-contracts/tree/main/deployments), bundled with the skill and refreshable from GitHub.

## Same address, separate accounts

- A profile deployed with the same inputs has the **same address on every chain**. It is still a **separate account on each chain**: separate deployment, balances, tokens, controllers, permissions, nonces and relayer quota.
- Deploying on one chain does not deploy on another. Granting a permission on one chain grants nothing elsewhere. Sending assets to the profile address on chain A does not make them available on chain B.
- Moving assets between chains needs an explicit bridge (`references/protocols.md`), an approval from the human, and a check that the route exists for that asset and both chains.
- Always name the chain (name and id) when you talk about balances, addresses, funding or transactions.

## The registry

| File (under `assets/registry/`) | Content |
| --- | --- |
| `lsp-deployments/` | Verbatim copy of the upstream `deployments/` files at commit `16ab2441a79c34da56386c30caa00c33379ce06f`: `DEPLOYED_CHAINS.md` (all networks with explorer links), `chains-mainnet.json`, `chains-testnet.json`, deployed-contract lists, ABIs, with sha256 in `PROVENANCE.json` |
| `chains.json` | Derived per chain: id, name, slug, native symbol, testnet flag, ranked RPCs, explorers (family + API base), LSP contract versions present, known relayers, Sourcify support, freshness and confirmation hints |
| `contracts.json` | Canonical LSP contract addresses (same on every chain where deployed) with versions and salts |
| `rpcs.json` | Ranked seed RPC endpoints per chain (LUKSO repository endpoint + Chainlist snapshot with tracking labels) |
| `protocols.json` | Well-known protocol addresses (Multicall3, Permit2, LSP26, EntryPoint v0.6, Nick's factory, Hyperlane, CoW, …) with the chains where code was confirmed |
| `sources.json` | Remote URLs used by `chains refresh` and `chains rpc find` |
| `egress.json` | Every HTTPS host the skill may contact, by category (for egress allowlists) |

Facts in the bundle:
- **73 networks with deployed LSP contracts: 66 mainnets and 7 testnets** (Arbitrum Sepolia 421614, Base Sepolia 84532, Ethereum Hoodi 560048, Ethereum Sepolia 11155111, LUKSO Testnet 4201, Polygon Amoy 80002, zkSync Sepolia 300). Two more are configured upstream but not deployed: Astar EVM (592) and WEMIX3.0 (1111).
- Every deployed network has the LSP23 factory, both post-deployment modules and the v0.14.0 profile, Key Manager and Universal Receiver Delegate implementations. Some also list v0.12.1. `ERCTokenCallbacks` (needed for safe ERC-721/1155 receipts) is missing on COTI (2632500) and Kava EVM (2222).
- The registry is a **seed, not proof**. The skill checks contract code at runtime before relying on it (`up chains verify <chain>`), and so should you before telling a human a chain "works".

Useful commands: `up chains list [filter]`, `up chains list --testnets`, `up chains verify <chain>`.

## Contract addresses (same on every chain where deployed)

| Contract | Address |
| --- | --- |
| LSP23 Linked Contracts Factory | `0x2300000A84D25dF63081feAa37ba6b62C4c89a30` |
| Universal Profile Init post-deployment module | `0x000000000066093407b6704B89793beFfD0D8F00` |
| UniversalProfileInit v0.14.0 | `0x3024D38EA2434BA6635003Dc1BDC0daB5882ED4F` |
| LSP6KeyManagerInit v0.14.0 | `0x2Fe3AeD98684E7351aD2D408A43cE09a738BF8a4` |
| LSP1UniversalReceiverDelegateUP v0.14.0 | `0x7870C5B8BC9572A8001C3f96f7ff59961B23500D` |
| ERCTokenCallbacks (LSP17 extension) | `0x082d49D8487d2ed2527440c7879C66d850daaBc5` |

Older versions, token presets and salts are in `assets/registry/contracts.json`; protocol contracts in `assets/registry/protocols.json`.

## Refreshing from upstream

`up chains refresh` fetches the current `deployments/` files from the lsp-smart-contracts main branch, compares them with the bundle (new chains, removed chains, changed RPCs or explorers) and stores the differences as a **local overlay** labelled `remote-unpinned`. It never overwrites the bundled files. Run it when a chain the human wants is missing, or when a deployment looks newer than the bundle.

## Chains outside the registry

`up chains add <chainId>` adds any EVM chain from Chainlist (name, native symbol, explorers, working RPCs). The LSP contracts are usually **not** deployed there: check with `up chains verify <chainId>` before promising anything. Without the LSP23 factory and implementations, a profile cannot be deployed on that chain by this skill.

## RPC endpoints

The skill signs and sends transactions itself, so a working RPC per chain is essential.

- **Ranking:** your own endpoints (`up chains rpc set <chain> <url,…>`) → endpoints that recently passed health checks → the LUKSO repository endpoint → Chainlist endpoints labelled "no tracking" → others. Endpoints that need API keys or use WebSockets are not used by default.
- **Health check before use:** `eth_chainId` must equal the expected chain id (protects against a wrong or malicious endpoint), the latest block must be recent, latency is measured. Results are cached in the state directory.
- **Automatic failover:** on timeouts, 5xx/429 answers or a stale head, the next endpoint is tried.
- **When everything fails** (`RPC_UNAVAILABLE`) or a chain has no endpoint: `up chains rpc find <chainId>` fetches the live lists from https://chainlist.org (`/rpcs.json`) and https://chainid.network (`/chains.json`), probes every candidate with the same health check and stores the working ones locally (label `remote-discovered`). Then retry the original command. If still nothing works, ask the human for an RPC URL (their own provider) and pin it with `up chains rpc set`.
- `up chains rpc list <chain>` shows the ranking; `up chains rpc verify <chain>` re-checks all endpoints.
- An RPC can lie. The skill never treats one endpoint's answer about a receipt as final beyond the confirmation rules, and the chain id check runs on every endpoint.
- Where to look manually: https://chainlist.org for fresh public endpoints; the `rpcUrl` fields in the lsp-smart-contracts `deployments/` files for the endpoint LUKSO lists.

## Explorers

Every chain in the registry has at least one explorer link from the upstream list; `chains.json` labels its family:
- **Blockscout** (LUKSO, Ethereum, Base, Gnosis, Optimism, Robinhood Chain and many others): keyless REST API at `<explorer>/api/v2/…` for verified contracts and token lists.
- **Etherscan family** (Etherscan, Basescan, Arbiscan, BscScan, Polygonscan, Snowscan, …): ABIs through the Etherscan V2 multichain API; an API key is optional and set with `up config set etherscan-key <key>` only if the human provides one.
- **Routescan** and others: links for humans; ABI discovery falls back to Sourcify and selector databases (`references/discovery.md`).

Give humans explorer links for every transaction and address (`data.explorerUrl` in results).

## Native coins and funding

Each chain has its own native coin (LYX on LUKSO, LYXt on LUKSO Testnet, ETH on Ethereum and most rollups, BNB, POL, AVAX, …; `up chains list` shows the symbol). Gas on direct paths is paid in that coin by the controller address on that chain. Funding requests always name the chain, the coin, the amount and the destination role (`references/onboarding.md`). Testnet coins have no value; get them from the chain's faucet, never buy them.

## Initial relayer networks

The Universal Relayer's intended initial set: LUKSO (42), Ethereum (1), Base (8453), BNB Smart Chain (56), Arbitrum One (42161), Robinhood Chain (4663), Polygon (137), Avalanche C-Chain (43114), LUKSO Testnet (4201), Ethereum Sepolia (11155111). All ten have the full LSP stack deployed. Relayer coverage is data, not a promise: `up relayer quota --chain <id>` is the test.

## Finality

LUKSO and Ethereum produce a block about every 12 seconds and finalise after about two epochs (around 13 minutes). Rollups and sidechains differ. Report "included" after the receipt and "final" only when the chain says so; for large amounts wait for finality before telling the human the funds are safe to rely on elsewhere.
