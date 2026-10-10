# Chains: registry, RPCs and multi-chain rules

The skill works on every EVM network where the LSP contracts are deployed. Its chain list is a mirror of the official [lsp-smart-contracts `deployments/` folder](https://github.com/lukso-network/lsp-smart-contracts/tree/main/deployments), bundled with the skill and refreshable from GitHub.

## One profile on many chains

Your Universal Profile is **one account**: one identity, normally at the **same address on every chain** (LSP23 replays the same inputs; the address does not depend on the chain). It can be deployed on as many chains as the human wants. What exists **per chain**:

| Per chain | Why it matters |
| --- | --- |
| Deployment | Deploying on one chain deploys nothing elsewhere. Before deployment the address is only a prediction there. |
| Balances, tokens, NFTs | Assets sent to the profile on chain A are not available on chain B. Moving them needs an explicit bridge. |
| Controllers and permissions | A controller added or a permission granted on one chain grants nothing on another. |
| Nonces, relayer quota | Counted separately on each chain. |
| The agent's key | One default key everywhere, unless a chain has its own key (see below). |
| The address (rarely) | A profile created with other inputs on some chain has another address there; link it (see below). |
| Profile metadata (LSP3) | Name, description and pictures are ERC725Y data, so they are per chain too. LUKSO apps show the LUKSO mainnet metadata, so `up profile metadata …` and `up profile url` use LUKSO mainnet unless the human explicitly asks for another chain (`--chain`); see `references/profile-metadata.md`. |

How to talk about it: *"your profile on Base"*, *"on LUKSO your profile already allows me to send LYX; on Base it is not deployed yet"*. Never call the deployments "separate accounts" or "your other account", and always name the chain (name and id) when you talk about balances, addresses, funding or transactions.

Safety stays the same: assets never move between chains by themselves; bridging is explicit, approved by the human and checked for the asset and both chains (`references/protocols.md`); never send or request funds for the profile address on a chain where it is not deployed; verify the state per chain before relying on it.

### The cross-chain overview: `up profile status`

`up profile status` checks every configured chain (plus chains where the profile is known to exist: linked, deployed by this agent, or found deployed by `up profile join`; `--chains 42,8453` or `--chain base` to choose) in parallel. A chain whose RPC is down is reported with its own fix; the other chains are still checked. Per chain it reports:

- the profile's address there (`linked` when it differs) and whether it is deployed (code + LSP0 interface), its owner and Key Manager;
- which key of the agent applies there (default or chain-specific), whether it is a controller there, its permissions, and whether AllowedCalls / AllowedERC725YDataKeys limit it;
- native balance of the profile and of the agent's key (gas for direct execution and deployment), relayer coverage (quota is not checked here because that needs a signature: `up relayer quota --chain <id>`);
- the next step, for example:

```
Your Universal Profile 0x9a3…F1 — one account on 3 chains; each chain has its own deployment, controllers, permissions and balances (agent key 0x5c1…07):
- LUKSO (42): deployed (UP 0.14.0); the agent can act with all permissions; profile balance 12.5 LYX; agent key gas 0.4 LYX; relayer lukso-public
  → ready: the agent can act as your profile on LUKSO gaslessly through the relayer lukso-public (check quota: up relayer quota --chain lukso) or directly
- Base (8453): not deployed yet
  → deploy your profile on Base (8453) at the same address: up account deploy --chain base --dry-run, then with the human's approval (replays the saved deployment manifest; the agent's key pays the gas)
  → do not send assets to 0x9a3…F1 on Base until your profile is deployed there
- Ethereum (1): deployed (UP 0.14.0); this agent's key 0x5c1…07 is not a controller here yet; profile balance 0 ETH; agent key gas 0.01 ETH
  → ask the human to authorise this agent's key 0x5c1…07 on Ethereum (1) (permissions are per chain; a grant on another chain does not count here): up permissions recommend --chain ethereum prints the recommended set to hand over
Ready on: LUKSO.
```

The result is also stored in the local profile record as the last known state per chain (only its own `status` entry, merged under the record lock, so a link or deployment written at the same time is never overwritten). It is a snapshot: re-check before acting.

### Acting on a chain

When the human asks for something on a particular chain:

1. **Resolve the chain** from their words (`up chains list [filter]`); ask if it is ambiguous (e.g. "Base" vs "Base Sepolia").
2. **Check the profile there**: `up profile status --chain <id>`.
3. **If something is missing, explain and offer the fix** — do not build the action yet:
   - *Not deployed, agent has the manifest* (J1 profiles): *"Your profile isn't deployed on Base yet. I can deploy it there at the same address 0x…; that needs about <amount> ETH on Base for gas on my key 0x…."* Then `up account deploy --chain base --dry-run`, the funding request if needed, and the deployment with the human's approval. After a replay the profile's first controller on the new chain is the one in the manifest; if the agent signs on that chain with a different key, that key must be added there.
   - *Not deployed, no manifest* (J2 profiles): ask the human to deploy the profile on that chain with the same inputs (through the app or relayer that created it), or, if it already exists there at another address, to confirm that address so you can link it.
   - *Deployed, agent's key not a controller there*: *"On Base your profile doesn't let me act yet. Please add my key 0x… there with these permissions: …"* (`up permissions recommend --chain base`). If another local key of the agent already is a controller there, `profile status` says so (`up key activate <that key> --chain base` with the human's approval).
   - *Permission missing* (e.g. `NotAuthorised(…, "TRANSFERVALUE")`): ask for exactly that permission on that chain (`up controller edit <key> --add TRANSFERVALUE --chain base`).
   - *No gas and no relayer*: funding request for that chain (`up display address <key> --chain base`), or a relayer the human names.
4. **Act**: `--dry-run`, consent, run with `--chain <id>`, report with the chain name and explorer link.

The write verbs enforce step 2 themselves: before building any action they check that the profile is deployed on the chain, owned by a Key Manager, and that the agent's key for that chain is a controller there. Failures are `NOT_DEPLOYED` / `NOT_SUPPORTED` / `NOT_AUTHORISED` with the fix for that chain in `error.hint` (and `details.next` / `details.recommendation`); permission and gas errors raised by the chain also get a hint that names the chain. Nothing is signed or sent when the preflight fails.

### A separate key on some chains

By default the agent signs with one key on every chain. A chain can get its own key, for example to keep a low-value chain's key apart from the main one:

1. `up key new-candidate` creates an additional key (not used yet) and shows its address.
2. The human authorises that address on the chain (`up permissions recommend --chain <id>` for the set).
3. `up key activate <address> --chain <id>` (human approval) makes it the agent's key on that chain only. Every signature for that chain (transactions, relay calls, relayer quota logins, UserOperations, ERC-1271 signatures, deployments) then uses it; other chains keep theirs. EIP-712 typed data that names a chain (`domain.chainId`) is always signed for that chain, with its key and (as the profile) verified there; a different explicit `--chain` is refused.

`up key address` shows the default key and every chain-specific key (`--chain <id>`: the key used there); `up profile status` shows which key applies per chain. `up key activate <default key address> --chain <id>` returns a chain to the default key. Switching never deletes a key: the previous key stays in its store and listed (keys are permanent, `references/security.md`). New profile addresses are always derived from the default key, so they stay the same on every chain.

### A different address on some chain

Rarely a profile exists on some chain at another address (created by another factory or with another salt). After the human confirms it is theirs, `up profile link <address> --chain <id> --approval "<their words>"` links it (linking and unlinking always need the human's own words; a delegated policy with `allowAdmin` does not cover them): on that chain every verb acts as, and shows, the linked address; other chains keep the usual one. The skill checks that the address is a deployed Universal Profile owned by a Key Manager on that chain and warns when the agent's key is not a controller there. `up profile link --unlink --chain <id>` removes the link. Recipients and other counterparties are never re-mapped.

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
