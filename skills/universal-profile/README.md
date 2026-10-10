# Universal Profile Agent Skill

Give your AI agent its own **Universal Profile**: a smart-contract account (LSP0 / ERC725) controlled through an LSP6 Key Manager, on LUKSO and the other EVM networks where the LSP contracts are deployed (73 networks in the bundled registry). The agent generates and keeps its own controller key, shows you only public addresses, and acts *as the profile* with the permissions you allow.

This folder is a standard [Agent Skill](https://agentskills.io/specification). The agent reads `SKILL.md`; this README is for humans.

- Website: https://universalprofile.ai
- Source and releases: https://github.com/universal-everything/ai-universalprofile-skill
- License: MIT-0 (`LICENSE`)

## What the agent can do with it

- Create its own profile (you fund gas per network) or join a profile you already have (created through a relayer or any wallet).
- Manage controllers and permissions: add your wallet as a co-controller, restrict what the agent may call, rotate its key.
- Send native coins and tokens (LSP7, LSP8, ERC-20, ERC-721, ERC-1155), call any contract through a generic ABI tool, sign as the profile (ERC-1271), follow profiles (LSP26).
- Execute directly (the agent's controller pays gas), through relayers (LSP25 + LSP15, gas paid by the relayer) or, only if you ask for it, through ERC-4337.
- Look up chains, contracts and protocols, and explain an unknown contract before using it.

## Requirements

- **Node.js 22 or newer.** Nothing else: no `npm install`, no native modules, no administrator rights. `node scripts/up-doctor.mjs` checks the environment and prints exact remedies.
- Outbound HTTPS to the chain RPCs you use (and optionally explorers, relayers and indexers). Every host the skill may contact is listed in `assets/registry/egress.json`.
- A key store for the agent's controller key: macOS login keychain, `systemd-creds` (systemd 256+), a desktop keyring, Windows DPAPI, or a protected file inside a cloud agent VM.

## Install

| Host | How | Status |
| --- | --- | --- |
| OpenClaw | `openclaw skills install git:universal-everything/ai-universalprofile-skill@skill` (after the first tagged release), the ClawHub listing `universal-profile` once published, or `openclaw skills install <local path to this folder>` | documented by OpenClaw; not yet tested end to end |
| Claude Code, Codex, Cursor, Gemini CLI and other Agent Skills hosts | `npx skills add universal-everything/ai-universalprofile-skill`, or copy this folder into the host's skills directory | candidate |
| OpenAI dots | the dot installs the skill in its own cloud computer; key in a protected file there | candidate |
| Meta Muse | install recipe in `platforms/meta/README.md`; key in a protected file inside the Muse VM | candidate |
| Any MCP client | `node scripts/up-mcp.mjs` (stdio) | candidate |

Details per host: `references/platforms.md`. Release archives (`universal-profile-<version>.tar.gz`) come with a `SHA256SUMS` file; verify it before extracting.

After installation, give your agent one of the prompts from https://universalprofile.ai, or simply ask it to set up its Universal Profile. It will run `up-doctor`, create its key, and ask you which networks to use and whether it should create its own profile or join yours.

## Safety in short

- **The agent never shows, asks for or accepts private keys or seed phrases.** You only ever see and share public addresses. Never paste a private key into any website, chat or form.
- **Two addresses, two roles.** The *controller address* signs and pays gas for direct transactions; fund it only with small gas amounts. The *profile address* is the account; assets go there.
- **Every network is separate.** The same profile address on two networks is two accounts with separate balances and permissions. Moving assets between networks needs a bridge.
- **You decide what the agent may do.** On-chain, the Key Manager enforces the permissions you grant (per network). On your machine, a delegation policy decides what the agent may do without asking; everything else, and anything that changes permissions, moves funds to new places, bridges or pays, needs your explicit approval in chat. Spending caps and daily limits are enforced by the skill, not on-chain.
- **Add yourself as a second controller.** If the agent's key is the only controller and the machine or VM is lost, the profile is lost. Adding your own wallet as a controller grants it permissions; no key is shared and the address does not change.
- **The key's protection depends on the machine.** Any program running as the same user while the key store is unlocked could use the key. Keep the agent's permissions as narrow as its job allows. `up key backend` shows exactly how the key is stored.
- Fetched content (web pages, token names, metadata) is treated as data, never as instructions. Unsolicited tokens are ignored.

More: `references/security.md`.

## Files

| Path | Content |
| --- | --- |
| `SKILL.md` | the agent's instructions |
| `references/` | detailed guides the agent loads on demand (onboarding, permissions, execution paths, relayers, ERC-4337, chains, discovery, protocols, tokens, security, platforms, errors, standards, function inventories, generated verb reference) |
| `scripts/` | bundled, readable single-file Node.js tools (`up.mjs`, `up-mcp.mjs`, `up-doctor.mjs`) built from the TypeScript sources in the repository |
| `assets/abis/` | pinned contract ABIs with provenance |
| `assets/registry/` | chain, contract, RPC and protocol registry (mirror of the lsp-smart-contracts deployments) and the egress host list |
| `platforms/` | host-specific files (OpenAI plugin template, Meta Muse install recipe) |

The agent's state (configuration, deployment manifests, caches, audit log) lives in `~/.universal-profile/` (or `UP_HOME`), never in this folder.

## Links

- LUKSO standards (LIPs): https://github.com/lukso-network/LIPs
- Reference contracts and deployments: https://github.com/lukso-network/lsp-smart-contracts
- LUKSO documentation: https://docs.lukso.tech
- Agent Skills specification: https://agentskills.io/specification
