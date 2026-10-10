# Architecture

The repository has two branches: `main` is exactly the shipped skill (`SKILL.md` at the root, what every installer fetches), and `source` (this branch) contains:

1. **The shipped Agent Skill** in [`skills/universal-profile/`](../skills/universal-profile) — `SKILL.md`, `references/`, `assets/` (ABIs, registry, bytecode) and the pre-built, unminified tools in `scripts/`. This folder is what users and catalogues install; `build/publish-main.mjs` publishes it as the tree of `main` (one commit per publish, no history rewrite). It needs only Node.js ≥ 22; it has no `node_modules`.
2. **The source** in `src/` (TypeScript), the generators in `build/`, and the tests in `test/`. `npm ci && npm run build` reproduces `skills/universal-profile/scripts/` byte-for-byte (checked in CI).

## Runtime layout (shipped)

```
scripts/up.mjs          CLI           node scripts/up.mjs <verb> [args] [--options]
scripts/up-mcp.mjs      MCP (stdio)   every verb is a tool named up_<verb_words>
scripts/up-doctor.mjs   doctor        environment + signer + RPC checks
scripts/lib/app.mjs     application code (all modules below)
scripts/lib/vendor-*.mjs viem, erc725.js, qrcode — separate files so each stays < 1 MiB
```

## Source modules

| Module | Responsibility |
| --- | --- |
| `src/core/` | Shared contracts (`types.ts`), verb registry (one definition → CLI command + MCP tool), argv parsing, consent/delegation policy, state dir (`$UP_HOME`, 0700/0600, atomic writes), profile records (`profile-record.ts`: the shared per-profile file, linked per-chain addresses), JSON/redaction, output envelope, errors with stable codes |
| `src/chain/` | Registry (bundled mirror of lsp-smart-contracts `deployments/` + local overlay), RPC manager (ranked endpoints, `eth_chainId` verification, freshness, failover, health cache), Chainlist discovery + remote registry refresh, transaction pipeline (simulate → estimate → fees → sign locally → send → receipt), revert decoding with all LSP/ERC725/EntryPoint errors |
| `src/signer/` | Signer backends: macOS login keychain via `/usr/bin/security`, Linux `systemd-creds`, Secret Service, Windows DPAPI (and WSL2 bridge), protected file (owner-approved inside agent VMs), remote signer interface; key selection per chain (`select.ts`: default key plus optional chain-specific keys); key lifecycle verbs |
| `src/lsp/` | LSP constants, permissions/AllowedCalls/AllowedERC725YDataKeys, profile state, LSP23 precompute/deploy + manifests, LSP25 signatures, controllers, ownership, ERC725Y data; LSP3 profile metadata (`lsp3.ts`: document, merge rules, VerifiableURI; `metadata.ts`: the LUKSO-mainnet default chain, image loading, LSP3Profile write check, current-metadata read; `profile-url.ts`: profile.link / universaleverything.io; verbs `profile metadata show|set`, `profile url` in `verbs-metadata.ts`); one profile across chains (`multichain.ts`: per-chain status, the per-chain preflight used by every write path, per-chain error hints; verbs `profile status` / `profile link`) |
| `src/ipfs/` | IPFS for profile metadata: upload providers behind one interface (`providers.ts`: Universal Profile IPFS API with an HS256 upload token from `jwt.ts`, Pinata, Kubo; credentials from env, then config; the marked hook for a default key), gateway reads, fetch-back verification and VerifiableURI target checks (`gateway.ts`) |
| `src/exec/` | Execution transports behind one interface (`transport.ts`): direct Key Manager, direct LSP0/LSP20, LSP25 relay; `executeAsProfile()` is the only way any module acts as the profile (it loads the agent's key for the request's chain and runs the chain preflight first) |
| `src/relayer/` | LSP15 client (execute + quota with top-level `chainId`, signed-message quota auth), LUKSO live-relayer profile |
| `src/erc4337/` | Opt-in ERC-4337: EntryPoint v0.6 deployment via Nick's factory, Extension4337 deploy/link, UserOperations, bundler client or self-bundling; registers the `userop` transport |
| `src/abi/` | Generic ABI codec, ABI discovery trust ladder for every chain (Blockscout / Sourcify / Etherscan V2 / Routescan → proxy → selector DBs), standard detection, generic `contract read/call`, protocol knowledge |
| `src/tokens/` | LSP7/LSP8/ERC-20/721/1155 balance, metadata, transfer, approvals/operators, asset discovery (LSP5, Envio, Blockscout, log scan) |
| `src/social/` | LSP26 follower system |
| `src/display/` | Blockies identicon PNG (port of the algorithm LUKSO uses), QR codes (plain address + EIP-681), funding/address cards, image header parsing for profile pictures (`image-info.ts`: PNG/JPEG/GIF/WebP size in pure JS, SVG refused) |
| `src/knowledge/` | `docs`, `standards list` |

## Data generation

| Script | Output | Source |
| --- | --- | --- |
| `build/gen-registry.mjs` | `assets/registry/**` | lsp-smart-contracts `deployments/` at a pinned commit (mirrored verbatim; `contracts.json` split losslessly), Chainlist RPC snapshot, `build/protocols.source.json` |
| `build/gen-abis.mjs --lsp-repo <checkout>` | `assets/abis/**`, `test/fixtures/bytecode/**` | compiled lsp-smart-contracts artifacts (ABI only shipped), viem reference ABIs |
| `build/gen-4337-bytecode.mjs` | `assets/bytecode/**` | EntryPoint v0.6 + Extension4337 creation code (deterministic deployment) |
| `build/gen-verb-docs.mjs` | `references/verbs.md` | the verb registry in the built bundle |
| `build/verify-skill.mjs` | — | release gate: spec, sizes, text-only, no local paths/secrets, manifest hashes |

## Tests

- `test/unit/**` — pure logic, mocked network.
- `test/chain/**` — an in-process EVM (Hardhat/EDR, dev-only) exposed over a real HTTP JSON-RPC endpoint, with Nick's factory and the canonical LSP stack deployed at the real mainnet addresses using the upstream salts and creation bytecode. Every execution path, deployment, permission change and token flow runs against the real contracts. `test/chain/multichain.test.ts` adds a second, independent in-process chain (different chain id, same canonical stack) to test one profile across two chains. `test/chain/metadata.test.ts` runs profile metadata end to end against a local mock IPFS node (`test/support/mock-ipfs.ts`: Kubo API, Universal Profile API, Pinata and a gateway); the metadata default chain (LUKSO mainnet in the product) is pointed at the local chain through a test hook, and any request to a non-local host fails the suite.
