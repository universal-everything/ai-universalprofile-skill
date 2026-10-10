# Changelog

All notable changes to the Universal Profile Agent Skill. Versions follow Semantic Versioning; breaking changes to verb names, arguments or JSON output bump the major version. The bundled data (ABIs, chain and contract registry) carries its own `data-version` in the `SKILL.md` metadata.

## [0.1.0] — Unreleased

First version of the skill.

### Added
- `--admin <wallet>` for `account precompute` / `account deploy`: the human's wallet becomes a full co-controller in the same deployment transaction that the agent's key sends and pays for (the human signs nothing). Onboarding asks for it before computing addresses; SKILL.md: always attach QR images when the human must send, scan or sign, and never tell the human to sign a deployment.
- Guided start (`up start`): one command that silently checks the machine, creates the agent's key if needed (local, no approval), and returns a plain-language opening message (`data.say`) with the onboarding choice, plus agent-only next steps. SKILL.md now starts with conversation rules: take the lead, one question at a time, never mention commands, scripts or internals.
- Funding in onboarding: the controller address is the same on every network, so the agent shows one QR code plus the amount per network (per-network EIP-681 links optional). README: Development section with the `main`/`source` branch model, publishing and porting rules.
- Recommended networks: LUKSO first, then Ethereum, Base, Arbitrum One, BNB Smart Chain and Polygon (★ in `up chains list`, named in `up onboarding options`). `chains list` shows mainnets only unless `--testnets`/`--all`; testnets are used only on the human's explicit request.
- Onboarding choice (`up onboarding options`): own account with the human's gas per network, Universal Relayer (gas included on several networks, separate website; link to be added), or an existing profile. Journeys J1, J2-relayer and J2 in `references/onboarding.md`.
- Distribution: the repository's default branch `main` is exactly this skill with `SKILL.md` at the root (`openclaw skills install git:universal-everything/ai-universalprofile-skill`, `npx skills add universal-everything/ai-universalprofile-skill`, or `git clone` into a skills directory); sources and tests live on branch `source`.
- Agent Skill package `universal-profile`: `SKILL.md`, reference documents (`references/`), bundled ABIs and registry data (`assets/`), single-file Node.js tools (`scripts/up.mjs`, `scripts/up-mcp.mjs`, `scripts/up-doctor.mjs`), MIT-0 license.
- Controller key generated inside the skill and stored in the strongest available key store: macOS login keychain, `systemd-creds`, desktop keyring, Windows DPAPI (also from WSL2), or a protected key file inside cloud agent VMs; fail-closed status reporting; key rotation with candidate keys; encrypted keystore backup run by the human only.
- Journeys J1 (agent deploys its own profile through LSP23 at a precomputed address, with identicons and QR funding requests) and J2 (agent joins any existing profile with a recommended permission set).
- One profile across many chains: `profile status` (per-chain overview with next steps, isolated per chain), a per-chain preflight on every write (deployed there, the agent's key a controller there) with chain-specific fixes in the error hints, optional per-chain controller keys (`key activate <address> --chain <id>`), and `profile link` for a profile that has another address on some chain.
- Execution as the profile through the Key Manager, directly through the profile (LSP20), through LSP25 relay calls via LSP15 relayers (with a `chainId` extension for multichain relayers), and through an opt-in ERC-4337 module (EntryPoint v0.6 + `Extension4337`, including deterministic EntryPoint and extension deployment on request).
- Permissions and controllers: all LSP6 permission bits including `EXECUTE_RELAY_CALL` and the ERC-4337 bit 23, AllowedCalls and AllowedERC725YDataKeys encoding, presets, last-controller protection, two-step ownership.
- Tokens: LSP7, LSP8, ERC-20, ERC-721 and ERC-1155 balances, metadata, transfers and approvals with receiver-hook and `force` handling.
- Generic contract interaction on every registry chain: ABI encode/decode, ABI discovery with trust labels (bundled, Blockscout, Sourcify, Etherscan-compatible explorers, proxies, selector databases).
- Registry of the 73 networks with deployed LSP contracts (mirror of lsp-smart-contracts `deployments/` at `16ab2441`), ranked seed RPCs with health checks, failover and Chainlist discovery, protocol addresses, and an egress host list.
- Delegated-autonomy policy with consent levels (`--yes` within policy, `--approval` with the human's words), dry runs and a local audit log.
- Profile metadata (LSP3): `profile metadata show` (decodes the `LSP3Profile` VerifiableURI, fetches the JSON and verifies its hash, optionally every image), `profile metadata set` (name, description, links, tags, profile/background image, avatar; merge by default, `--remove`, `--replace`; PNG/JPEG/GIF/WebP size read in pure JS, SVG refused, 10 MB limit; uploads to IPFS through a swappable provider — Universal Profile IPFS API with an HS256 upload token, Pinata or a Kubo node — then fetches every upload back through the gateway and re-hashes it before writing, fail closed) and `profile url` (profile.link name link, fallback universaleverything.io). Profile metadata always defaults to LUKSO mainnet; another chain only with an explicit `--chain`. `account deploy` and `profile join` prompt the agent to offer metadata when a profile has none. New config keys `ipfs-provider`, `ipfs-gateway`, `ipfs-upload-key`, `pinata-jwt`, `kubo-url`, `kubo-auth` (credentials redacted in `config get`), error code `IPFS_ERROR`, egress category `profileMetadata`.
- LSP26 follower system, ERC-1271 signing as the profile, QR codes (plain address and EIP-681) and blockies identicons generated locally.
- Stdio MCP server exposing every verb as an `up_*` tool and the documents as resources.
- Knowledge verbs `docs` and `standards list`; function inventories of every LSP package and the reference standards.

### Known limitations
- No host has a recorded end-to-end pass on a fresh installation yet; OpenAI dots, Meta Muse and generic Agent Skills hosts are candidates (`references/platforms.md`).
- The optional home-signer bridge (HTTP MCP with OAuth) and the remote-signer backend are not included.
- The `chainId` relay extension is a proposal; relayers that do not implement it are used in legacy mode.
- Profile pictures are uploaded as a single original-size entry (no resized variants: no image codec is bundled). Uploads work out of the box through the Universal Profile IPFS API with the built-in shared key of the universaleverything.io website; the human can override it with their own key, Pinata or a Kubo node.
