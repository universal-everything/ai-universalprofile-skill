# Requirements coverage

Maps every requirement of the task definition (Obsidian note *Universal Profile skill - mcp* and its row map *skill-mcp-requirement-coverage*: A = dictated prose, B = dictated bullets, C = binding website/brief decisions) and every owner decision of 9 October 2026 (*skill-implementation-plan* §6, items 1–15) to the implementation: verbs, tests and shipped references. "doc" means the requirement is about knowledge or behaviour guidance and is satisfied by a shipped reference file. Test paths are relative to `test/`.

## A. Dictated requirements (prose)

| # | Requirement | Implementation | Evidence |
| --- | --- | --- | --- |
| A1 | Runs locally on Windows, Linux, macOS | Node ≥ 22 bundle, no native modules; signer backends per OS (`src/signer/*`) | `unit/signer/*` (all backends, mocked per OS), live macOS Keychain test, CI matrix ubuntu/macos/windows |
| A2 | Runs in OpenAI dots and Meta Muse VMs | in-VM install recipe, `vm-protected-file` signer, egress list | `references/platforms.md`, `platforms/meta/README.md`, `unit/signer/choose-backend.test.ts`; live host trials pending (phase P7) |
| A3 | Generic skill any agent can install | standard Agent Skill folder, CLI + MCP from one verb registry | `build/verify-skill.mjs`, `skills-ref validate`, `e2e/bundle.test.ts` |
| A4 | Compatible with the skills catalogues | resolved: ClawHub, Agensi, SkillsMP, SkillsLLM — packaging rules enforced; listing is phase P9 | `build/verify-skill.mjs` (text-only, ≤ 1 MiB/file, ≤ 256 files, unminified) |
| A5 | Works specifically with Dot, Muse, OpenClaw | OpenClaw verified install paths; dots/Muse in-VM path | `references/platforms.md`; `.github/workflows/release.yml` publishes `skill` branch (SKILL.md at root, required by OpenClaw Git installs) |
| A6 | All ways to interact with a UP / ERC725 account | 100 verbs; generic `exec send`/`contract call` reach every function | `unit/coverage/functions.test.ts` (every LSP selector classified, every verb-bound function implemented) |
| A7 | Understand LSP6, LSP0, URD, basics | `src/lsp/*`, `account info`, `permissions *`, `account urd set` | `chain/account.test.ts`, `chain/permissions.test.ts`, `references/permissions.md` |
| A8 | Execute directly via KM and/or LSP0 | transports `km`, `lsp0` | `chain/exec-transports.test.ts`, `e2e/bundle.test.ts` |
| A9 | executeRelayCall for the relayer subscription | transport `relay`, `exec relay`, LSP25 signing | `chain/relay.test.ts`, `unit/lsp/lsp25.test.ts` |
| A10 | Any LSP15 relayer: execute + quota | `src/relayer/client.ts`, `relayer add/list/quota/execute` | `unit/relayer/client.test.ts`, `chain/relay.test.ts` (mock LSP15 relayer) |
| A11 | chainId routing in the relay API | top-level `chainId` on `/execute` and `/quota`; binding check vs signed digest | `unit/relayer/client.test.ts`, `references/relayer.md` |
| A12 | Bundled minimal ABI encoder, call any function | `src/abi/codec.ts`, `abi encode/decode*`, `contract read/call` | `unit/abi/codec.test.ts`, `chain/abi.test.ts` |
| A13 | No per-protocol scripts except core account actions | protocols are knowledge (`protocols list/verify`, `references/protocols.md`); actions go through the generic path | code review; `references/protocols.md` |
| A14 | LSP7, LSP8, ERC-20/721/1155 references | bundled ABIs + `token *` verbs | `chain/tokens.test.ts`, `references/tokens.md`, `references/functions-tokens.md` |
| A15 | Swaps vs bridges (Uniswap, CoW, bridges) | knowledge + verified addresses; CoW `setPreSignature`/ERC-1271 path; Hyperlane routes | `assets/registry/protocols.json`, `references/protocols.md` |
| A16–A18 | DeFi/address knowledge bases, look up unknowns | `protocols list/verify`, `abi fetch/functions`, registry `sources.json` | `unit/abi/discovery.test.ts`, `references/discovery.md` |
| A19–A21 | Generic smart-account tool for any EVM chain incl. LUKSO + testnets | 75-chain registry (73 LSP-deployed), `chains add` for any other chain | `unit/core/core.test.ts` (registry), live `chains verify` on LUKSO and Base |
| A22 | Upgrade permissions, add/remove keys | `controller add/edit/remove`, `allowed-calls/keys set`, `key rotate-plan` | `chain/permissions.test.ts` |
| A23–A24 | Analysis of all standards; smallest generic encoder | `references/standards.md`, `functions-*.md`; viem-based codec | `unit/coverage/functions.test.ts` |
| A25 | Core token ABIs stored locally | `assets/abis/lsp/*`, `assets/abis/reference/*` | `assets/abis/PROVENANCE.json` |
| A26–A27 | Look up new contracts; 4byte dictionary | discovery ladder; `abi selector` (bundled → Sourcify 4byte → 4byte.directory, collisions shown, never auto-signed) | `unit/abi/selectors.test.ts` |
| A28 | Clear onboarding steps | `references/onboarding.md`, SKILL.md first-run checklist | `e2e/bundle.test.ts` (doctor → init → precompute → display → deploy) |
| A29–A30 | Self-funded and relayer prompts/flows | J1 (`account precompute/deploy`), J2 (`profile join`, `permissions recommend`) | `chain/account.test.ts`, `chain/permissions.test.ts` |
| A31 | Deploy via LSP23 across the deployed chains | `account deploy` (manifest replay on any chain) | `chain/account.test.ts` (address == precompute == factory computation; replay) |
| A32 | Ask for funds on the deployer/initial-controller key | `display address`/`qr` for the controller EOA; insufficient-balance hint | `unit/display/*`, `chain/tx` path |
| A33 | QR code to scan, copyable address | `qr`, `display address` (plain address QR + EIP-681) | `unit/display/qr.test.ts` |
| A34 | Choose among precomputed addresses with official identicons | `account precompute --count`, `identicon`, `display address` (blockies port) | `unit/display/blockies.test.ts` (reference vectors) |
| A35 | Text UI with QR, identicon, addresses | media files + UTF-8 fallbacks in every display verb | `unit/display/verbs.test.ts` |

## B. Dictated bullets

| # | Requirement | Implementation | Evidence |
| --- | --- | --- | --- |
| B1 | Generate a key in the keychain | `init` → macOS Keychain via `/usr/bin/security`, DPAPI, systemd-creds, Secret Service, VM protected file | `unit/signer/*`, live Keychain test |
| B2 | QR code | `qr` | `unit/display/qr.test.ts` |
| B3 | Deploy via LSP factory | `account deploy` (LSP23 + UP Init post-deployment module) | `chain/account.test.ts` |
| B4 | Execute every function on a profile or a token | dedicated verbs + generic path | `unit/coverage/functions.test.ts` |
| B5 | Relayer on multiple chains | relayer config per chain, `chainId` extension | `chain/relay.test.ts` |
| B6 | Token ownership on all networks | `token list` (LSP5, Envio, Blockscout, log scan) with source labels | `chain/tokens.test.ts`, `unit/tokens/*` |
| B7 | JWT or API key from relay account | **superseded by owner decision 5**: no JWT/API key; execute = LSP25 signature, quota = LSP15 signed message | `unit/relayer/client.test.ts` |
| B8–B9 | Relayer MCP for profile creation / subscription | **superseded**: no relayer MCP; profiles created in the relayer dashboard; skill never sells | `references/relayer.md` |
| B10 | 0x402 (x402) | knowledge + feasibility (ERC-1271 path, Permit2 absent on LUKSO) | `references/protocols.md` |
| B11 | Hyperlane LYX and USDC Ethereum↔LUKSO | verified routers in `protocols.json`, `HyperlaneTokenRouter` ABI; callable via `contract call` | `references/protocols.md` |
| B12 | CLI as MCP for all functions of all LSPs, tested | one registry → CLI + MCP; function coverage gate | `unit/core/mcp.test.ts`, `unit/coverage/functions.test.ts`, `e2e/bundle.test.ts` |
| B13 | ERC-20/721/1155/4337 support; missing popular standards | token verbs; opt-in 4337 module; ERC-4626, WETH9, Permit2, Multicall3 ABIs bundled | `chain/erc4337.test.ts`, `chain/tokens.test.ts` |
| B14 | Execute relay call + direct execute; everything routes through the UP | `executeAsProfile()` is the only action path | `chain/exec-transports.test.ts` (target sees msg.sender = profile on all paths), `chain/erc4337.test.ts` |

## C. Binding decisions from the brief and website notes

| # | Requirement | Implementation / evidence |
| --- | --- | --- |
| C1 | Open source, no company membership | MIT-0; no hosted service |
| C2 | 73 networks; deployments ≠ tested | registry counts asserted in `unit/core/core.test.ts`; conformance matrix is phase P8 |
| C3 | Initial relayer scope | relayer coverage per chain in `chains.json` (data, not a promise) |
| C4 | Pricing only on relayer site | skill reads quota only; `references/relayer.md` |
| C5–C7 | Manual onboarding, per-chain funding, precompute rules | J1 flow + manifests (`chain/account.test.ts`) |
| C8 | Relay onboarding human-first, no forced admin transfer | `profile join` lists other controllers, never removes them |
| C9 | Per-chain state, bridging required | `references/chains.md`, SKILL.md golden rules |
| C10–C11 | Bounded autonomy; new permissions/funding/payments need approval | `src/core/policy.ts` (`unit/core/core.test.ts` consent tests) |
| C12 | Correct funding destination | confirmation blocks name the gas payer; `display address --label` |
| C13 | Key loss consequences, no implied recovery | `references/security.md`, `key rotate-plan`, last-admin guard (`chain/permissions.test.ts`) |
| C14–C15 | Adding a human = granting permissions to an address, per chain | `controller add`, `permissions recommend`, `profile join --chains` |
| C16 | Never paste a private key into a website | no key export verb; `key backup` encrypted, human-run only |
| C17 | Don't promise unenforced limits | policy labelled skill-side vs on-chain LSP6 limits |
| C18 | Only advertise completable journeys | docs mark candidate host paths honestly |
| C19 | Existing-profile onboarding | **decided (owner 9)**: `profile join` for any existing profile |

## D. Owner decisions (9 Oct 2026)

| # | Decision | Implementation |
| --- | --- | --- |
| 1 | MIT-0 | `LICENSE`, SKILL.md `license: MIT-0` |
| 2 | Repo universal-everything/ai-universalprofile-mcp | this repository; release workflow |
| 3 | Key file inside dots/Muse VM is fine, no lecture | `vm-protected-file` backend (0600/0700, never logged), plain one-line protection note |
| 4 | No hosted MCP | none; knowledge bundled + links |
| 5 | Order API = quota; no JWT/API key | `src/relayer/client.ts` |
| 6 | 4337 opt-in; skill deploys EntryPoint/extension on request | `src/erc4337/*`; never auto-selected (`--via auto` excludes userop) |
| 7 | Presets: full for agent-deployed; recommended set for relayer/existing | `PRESETS` `agent-owner` / `agent-operator`; `permissions recommend` |
| 8 | Catalogues later | packaging gate now, listings phase P9 |
| 9 | Join any existing profile | `profile join` |
| 10 | Identicon generated by the skill (blockies), no web component | `src/display/blockies.ts` + PNG encoder |
| 11 | ABI discovery generic for all chains; deployments bundled + remote | per-chain explorer family selection; `assets/registry/lsp-deployments/` mirror + `chains refresh` |
| 12 | RPCs bundled + Chainlist self-healing | `src/chain/rpc.ts`, `chains rpc find` (`unit/core/mcp.test.ts`, live run on LUKSO Testnet) |
| 13 | Reuse ClawHub slug `universal-profile` | SKILL.md `name: universal-profile` |
| 14 | Bundled lightweight QR for funding addresses | `src/display/qr.ts` (plain address + EIP-681) |
| 15 | Node only, no Python | entire runtime is Node ≥ 22 ES modules |

## Known open items (engineering dependencies, not scope cuts)

- Live host trials inside OpenAI dots and Meta Muse (runtime, persistence, egress) — phase P7.
- Fresh-machine custody runs on Linux (systemd-creds) and Windows (DPAPI) — mocked here, live in CI matrix and P2.
- Testnet (LUKSO Testnet 4201) runs with funded keys and the Universal Relayer once its endpoint exists — phase P4/P8.
- Catalogue listings (ClawHub, Agensi, SkillsMP, SkillsLLM) — phase P9.
