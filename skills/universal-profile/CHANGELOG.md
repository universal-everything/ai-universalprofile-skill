# Changelog

All notable changes to the Universal Profile Agent Skill. Versions follow Semantic Versioning; breaking changes to verb names, arguments or JSON output bump the major version. The bundled data (ABIs, chain and contract registry) carries its own `data-version` in the `SKILL.md` metadata.

## [0.1.0] — Unreleased

First version of the skill.

### Added
- Agent Skill package `universal-profile`: `SKILL.md`, reference documents (`references/`), bundled ABIs and registry data (`assets/`), single-file Node.js tools (`scripts/up.mjs`, `scripts/up-mcp.mjs`, `scripts/up-doctor.mjs`), MIT-0 license.
- Controller key generated inside the skill and stored in the strongest available key store: macOS login keychain, `systemd-creds`, desktop keyring, Windows DPAPI (also from WSL2), or a protected key file inside cloud agent VMs; fail-closed status reporting; key rotation with candidate keys; encrypted keystore backup run by the human only.
- Journeys J1 (agent deploys its own profile through LSP23 at a precomputed address, with identicons and QR funding requests) and J2 (agent joins any existing profile with a recommended permission set).
- Execution as the profile through the Key Manager, directly through the profile (LSP20), through LSP25 relay calls via LSP15 relayers (with a `chainId` extension for multichain relayers), and through an opt-in ERC-4337 module (EntryPoint v0.6 + `Extension4337`, including deterministic EntryPoint and extension deployment on request).
- Permissions and controllers: all LSP6 permission bits including `EXECUTE_RELAY_CALL` and the ERC-4337 bit 23, AllowedCalls and AllowedERC725YDataKeys encoding, presets, last-controller protection, two-step ownership.
- Tokens: LSP7, LSP8, ERC-20, ERC-721 and ERC-1155 balances, metadata, transfers and approvals with receiver-hook and `force` handling.
- Generic contract interaction on every registry chain: ABI encode/decode, ABI discovery with trust labels (bundled, Blockscout, Sourcify, Etherscan-compatible explorers, proxies, selector databases).
- Registry of the 73 networks with deployed LSP contracts (mirror of lsp-smart-contracts `deployments/` at `16ab2441`), ranked seed RPCs with health checks, failover and Chainlist discovery, protocol addresses, and an egress host list.
- Delegated-autonomy policy with consent levels (`--yes` within policy, `--approval` with the human's words), dry runs and a local audit log.
- LSP26 follower system, ERC-1271 signing as the profile, QR codes (plain address and EIP-681) and blockies identicons generated locally.
- Stdio MCP server exposing every verb as an `up_*` tool and the documents as resources.
- Knowledge verbs `docs` and `standards list`; function inventories of every LSP package and the reference standards.

### Known limitations
- No host has a recorded end-to-end pass on a fresh installation yet; OpenAI dots, Meta Muse and generic Agent Skills hosts are candidates (`references/platforms.md`).
- The optional home-signer bridge (HTTP MCP with OAuth) and the remote-signer backend are not included.
- The `chainId` relay extension is a proposal; relayers that do not implement it are used in legacy mode.
