# Universal Profile Agent Skill

**Give your AI agent a real account of its own: a smart account that you stay in control of, on LUKSO and 70+ other EVM networks.**

Most "crypto skills" for AI agents hand the agent a raw private key. Whoever holds that key can do *everything*, and if the key leaks or the agent makes a mistake, there is no undo and no limit. This skill takes a different approach. The agent gets a **Universal Profile**, a smart-contract account built on [ERC-725](https://github.com/ERC725Alliance/ERC725) and the LUKSO standards. The account itself decides what the agent's key may do, through the **LSP6 Key Manager** at its core.

- 🌐 Website: https://universalprofile.ai (coming soon)
- 🧩 Skill folder: [`skills/universal-profile/`](skills/universal-profile). This is what you install. The agent reads [`SKILL.md`](skills/universal-profile/SKILL.md).
- ⚙️ Runtime: Node.js 22 or newer. Nothing else.
- 📜 License: [MIT-0](LICENSE)

---

## Why this skill is different

**🏦 An account, not just a key.** Think of a Universal Profile as a bank account and the agent's key as a debit card. The card can be limited, blocked or replaced, and the account and everything in it stays the same. With a plain wallet, the card *is* the account.

**🛂 You decide what the agent may do, and the blockchain enforces it.** The Key Manager ([LSP6](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-6-KeyManager.md)) checks every action against the permissions you granted. For example: "may transfer tokens, but only to these contracts and only these functions", "may update the profile's data but not add new controllers", or "may sign messages but not move funds". These limits live on-chain, so a confused or manipulated agent cannot step outside them.

**🤝 You can always step in.** Add your own wallet as a second controller and you can change permissions, rotate the agent's key or take over the profile at any time. The address stays the same. No key is ever shared.

**🔐 The agent never sees or shares a private key.** The skill generates the agent's key itself and keeps it in the operating system's key store: macOS Keychain, Linux `systemd-creds` or a desktop keyring, Windows DPAPI, or a protected file inside a cloud agent VM. There is no command that exports it. Humans only ever see public addresses.

**✋ Nothing risky happens without you.** Reading is free. Anything that moves value, changes permissions or signs typed data runs as a dry run first. It then needs either a delegation policy you set up (with spending caps and daily limits) or your explicit approval in chat. Every approved action is written to a local audit log.

**⛽ Gas can be someone else's problem.** Besides normal transactions, the agent can send *signed relay calls* ([LSP25](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-25-ExecuteRelayCall.md)) through any relayer that speaks the [LSP15](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-15-TransactionRelayServiceAPI.md) API, so a relayer pays the gas. [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337) UserOperations are available too, if you switch them on.

**🌍 One identity across many chains.** The LUKSO contracts are deployed on 73 networks, including LUKSO, Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain and Avalanche. Because profiles are deployed deterministically, the agent can usually get the same profile address on every one of them. Every network is still a separate account with its own balances and permissions, and the skill always says which chain it means.

**🧰 It can talk to any contract.** A generic ABI layer finds a contract's interface through Blockscout, Etherscan V2 or Sourcify, labels how trustworthy that interface is, explains the contract before using it, and then calls it *as the profile*. Tokens (LSP7, LSP8, ERC-20, ERC-721, ERC-1155), the LSP26 follower system and ERC-1271 signatures are built in.

**📱 Made for chat.** The agent can show its address as a QR code you scan straight into MetaMask to fund it. It can also show the same identicon (blockies image) you see in LUKSO apps, so you can recognise the right profile at a glance.

**🩺 It keeps itself working.** Public RPC endpoints go stale. The skill ships a ranked list for every network, checks endpoints, demotes dead ones and finds working replacements through [Chainlist](https://chainlist.org), storing them locally.

**🪶 It runs almost anywhere.** It's plain JavaScript in readable single-file bundles. There's no `npm install`, no native modules and no admin rights. The same folder works as an Agent Skill (OpenClaw, Claude Code, Codex, Cursor, Gemini CLI and others), as a command-line tool and as an [MCP](https://modelcontextprotocol.io) server.

---

## What your agent can do with it

- **Set up:** create its own profile (you fund a little gas) or join a profile you already have, then show the address, identicon and funding QR code.
- **Manage control:** add or remove controllers, grant or narrow permissions, limit which contracts and functions it may call ("AllowedCalls") and which data it may write, and rotate its key or hand over ownership.
- **Hold and move value:** send native coins and tokens, receive assets, and list what the profile owns.
- **Use any contract:** read, encode, simulate and call any function on any of the supported chains, with decoded results, errors and events.
- **Sign as the profile:** produce ERC-1271 signatures that apps and other contracts can verify against the profile address.
- **Be social:** follow and unfollow profiles, and read followers ([LSP26](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-26-FollowerSystem.md)).
- **Choose how to execute:** directly through the Key Manager, directly on the account, via relayers (gasless), or via ERC-4337.

The skill has 100 commands in total. Each is both a CLI command and an MCP tool. Full reference: [`skills/universal-profile/references/verbs.md`](skills/universal-profile/references/verbs.md).

## How it fits together

```
 you (chat) ──approves──▶  AI agent
                              │ signs with its controller key (never leaves the key store)
                              ▼
                    LSP6 Key Manager ── checks permissions, AllowedCalls, allowed data keys
                              │
                              ▼
              Universal Profile (LSP0 / ERC-725 account) ── the identity; holds the assets
                              │ acts as the profile
                              ▼
          any contract on any supported EVM chain (tokens, apps, other profiles …)
```

Ways to submit a transaction: **direct** (the controller pays gas), **LSP25 relay call** through an LSP15 relayer (the relayer pays), or **ERC-4337** UserOperation (opt-in). See [`execution-paths.md`](skills/universal-profile/references/execution-paths.md).

## Install

Tell your agent to install the skill, or run one of these:

```bash
# OpenClaw (the release workflow publishes the skill folder on the `skill` branch, because Git installs need SKILL.md at the root)
openclaw skills install git:universal-everything/ai-universalprofile-skill@skill
# OpenClaw via skills.sh, or ClawHub once published (slug: universal-profile)
openclaw skills install skills-sh:universal-everything/ai-universalprofile-skill/universal-profile
# Any Agent Skills host (Claude Code, Codex, Cursor, Gemini CLI, …)
npx skills add universal-everything/ai-universalprofile-skill
# Manual / cloud VMs: release tarball + SHA256SUMS from GitHub Releases, or
git clone --depth 1 https://github.com/universal-everything/ai-universalprofile-skill && cp -r ai-universalprofile-skill/skills/universal-profile <your-skills-dir>/
```

Then ask your agent to set up its Universal Profile. It runs `node scripts/up-doctor.mjs` to check the machine, creates its key with `node scripts/up.mjs init`, and asks you which networks to use and whether to create a new profile or join yours. MCP clients can start `node scripts/up-mcp.mjs` (stdio).

Per-host details, including OpenAI dots and Meta Muse: [`references/platforms.md`](skills/universal-profile/references/platforms.md).

## The standards behind it

All LUKSO Standard Proposals (LSPs) are specified in the [LIPs repository, `LSPs/` folder](https://github.com/lukso-network/LIPs/tree/main/LSPs). The reference contracts and the deployment list for every network are in [lsp-smart-contracts](https://github.com/lukso-network/lsp-smart-contracts) ([`deployments/`](https://github.com/lukso-network/lsp-smart-contracts/tree/main/deployments)). A bundled copy of the deployment data ships inside the skill.

### The account

| Standard | In plain words | Spec | Docs |
| --- | --- | --- | --- |
| ERC-725 | A contract that can *execute* calls and *store* key/value data: the base of every profile | [ERC725 repo](https://github.com/ERC725Alliance/ERC725) | [docs](https://docs.lukso.tech/standards/erc725/) |
| LSP0 ERC725Account | The Universal Profile contract itself | [LSP-0](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-0-ERC725Account.md) | [docs](https://docs.lukso.tech/standards/accounts/lsp0-erc725account/) |
| LSP6 Key Manager | The gatekeeper: which key may do what | [LSP-6](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-6-KeyManager.md) | [docs](https://docs.lukso.tech/standards/access-control/lsp6-key-manager/) |
| LSP20 Call Verification | Lets a controller call the profile directly while the Key Manager still checks it | [LSP-20](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-20-CallVerification.md) | [docs](https://docs.lukso.tech/standards/accounts/lsp20-call-verification/) |
| LSP25 Execute Relay Call | Signed "please do this for me" messages that someone else submits and pays for | [LSP-25](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-25-ExecuteRelayCall.md) | [docs](https://docs.lukso.tech/standards/accounts/lsp25-execute-relay-call/) |
| LSP15 Transaction Relay Service API | The HTTP API relayers offer (`/execute`, `/quota`) | [LSP-15](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-15-TransactionRelayServiceAPI.md) | [docs](https://docs.lukso.tech/standards/accounts/lsp15-transaction-relayer-api/) |
| LSP14 Ownable 2-Step | Safe two-step ownership hand-over | [LSP-14](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-14-Ownable2Step.md) | [docs](https://docs.lukso.tech/standards/access-control/lsp14-ownable-2-step/) |
| LSP1 Universal Receiver | A notification hook when the profile receives assets or value | [LSP-1](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-1-UniversalReceiver.md) | [docs](https://docs.lukso.tech/standards/accounts/lsp1-universal-receiver/) |
| LSP17 Contract Extension | Adds new functions to a profile later (used for ERC-721/1155 callbacks and ERC-4337) | [LSP-17](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-17-ContractExtension.md) | [docs](https://docs.lukso.tech/standards/accounts/lsp17-contract-extension/) |
| LSP23 Linked Contracts Factory | Deploys profile + Key Manager in one transaction at an address known in advance | [LSP-23](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-23-LinkedContractsFactory.md) | [docs](https://docs.lukso.tech/standards/factories/lsp23-linked-contracts-factory/) |
| LSP16 Universal Factory | Same-address deployments across chains | [LSP-16](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-16-UniversalFactory.md) | [docs](https://docs.lukso.tech/standards/factories/lsp16-universal-factory/) |
| LSP9 Vault | A sub-account a profile can own | [LSP-9](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-9-Vault.md) | [docs](https://docs.lukso.tech/standards/accounts/lsp9-vault/) |
| LSP11 Basic Social Recovery | Guardian-based recovery (optional) | [LSP-11](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-11-BasicSocialRecovery.md) | n/a |

### Profile data

| Standard | In plain words | Spec | Docs |
| --- | --- | --- | --- |
| LSP2 ERC725Y JSON Schema | How data keys are named and values encoded | [LSP-2](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-2-ERC725YJSONSchema.md) | [docs](https://docs.lukso.tech/standards/metadata/lsp2-json-schema/) |
| LSP3 Profile Metadata | Name, description, links and pictures of a profile | [LSP-3](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-3-Profile-Metadata.md) | [docs](https://docs.lukso.tech/standards/metadata/lsp3-profile-metadata/) |
| LSP5 Received Assets | The list of assets a profile holds | [LSP-5](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-5-ReceivedAssets.md) | [docs](https://docs.lukso.tech/standards/metadata/lsp5-received-assets/) |
| LSP10 Received Vaults | The list of vaults a profile owns | [LSP-10](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-10-ReceivedVaults.md) | [docs](https://docs.lukso.tech/standards/metadata/lsp10-received-vaults/) |
| LSP12 Issued Assets | The list of assets a profile created | [LSP-12](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-12-IssuedAssets.md) | [docs](https://docs.lukso.tech/standards/metadata/lsp12-issued-assets/) |

### Tokens and social

| Standard | In plain words | Spec | Docs |
| --- | --- | --- | --- |
| LSP4 Digital Asset Metadata | Name, symbol and metadata of a token or NFT collection | [LSP-4](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-4-DigitalAsset-Metadata.md) | [docs](https://docs.lukso.tech/standards/tokens/LSP4-Digital-Asset-Metadata/) |
| LSP7 Digital Asset | Fungible tokens that notify the receiver | [LSP-7](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-7-DigitalAsset.md) | [docs](https://docs.lukso.tech/standards/tokens/LSP7-Digital-Asset/) |
| LSP8 Identifiable Digital Asset | NFTs with flexible token ids and per-token data | [LSP-8](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-8-IdentifiableDigitalAsset.md) | [docs](https://docs.lukso.tech/standards/tokens/LSP8-Identifiable-Digital-Asset/) |
| LSP18 Royalties | Royalty information for assets | [LSP-18](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-18-Royalties.md) | n/a |
| LSP26 Follower System | An on-chain "follow" registry | [LSP-26](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-26-FollowerSystem.md) | [docs](https://docs.lukso.tech/standards/accounts/lsp26-follower-system/) |

### Ethereum standards

[ERC-20](https://eips.ethereum.org/EIPS/eip-20), [ERC-721](https://eips.ethereum.org/EIPS/eip-721) and [ERC-1155](https://eips.ethereum.org/EIPS/eip-1155) tokens · [ERC-165](https://eips.ethereum.org/EIPS/eip-165) interface detection · [ERC-1271](https://eips.ethereum.org/EIPS/eip-1271) contract signatures · [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337) account abstraction (opt-in) · [EIP-191](https://eips.ethereum.org/EIPS/eip-191) and [EIP-712](https://eips.ethereum.org/EIPS/eip-712) signing · [EIP-681](https://eips.ethereum.org/EIPS/eip-681) payment links in QR codes · [ERC-1967](https://eips.ethereum.org/EIPS/eip-1967) and [ERC-1167](https://eips.ethereum.org/EIPS/eip-1167) proxies.

For each standard, the full map of what the skill uses and how (function by function) is in [`references/standards.md`](skills/universal-profile/references/standards.md).

## Learn more

- **LUKSO docs:** start at [Standards overview](https://docs.lukso.tech/standards/introduction/), [Benefits of the LUKSO standards](https://docs.lukso.tech/learn/benefits-lukso-standards/) and [Grant permissions](https://docs.lukso.tech/learn/universal-profile/key-manager/grant-permissions/). The main site is https://docs.lukso.tech.
- **Relay calls:** [Execute relay transactions](https://docs.lukso.tech/learn/universal-profile/key-manager/execute-relay-transactions/)
- **Specifications:** [LIPs / LSPs](https://github.com/lukso-network/LIPs/tree/main/LSPs)
- **Contracts and deployed networks:** [lsp-smart-contracts](https://github.com/lukso-network/lsp-smart-contracts) and [its `deployments/` folder](https://github.com/lukso-network/lsp-smart-contracts/tree/main/deployments)
- **RPC endpoints:** [Chainlist](https://chainlist.org)
- **Agent Skills format:** [agentskills.io specification](https://agentskills.io/specification)
- **Safety model:** [`references/security.md`](skills/universal-profile/references/security.md)

## Status

Version 0.1.0, not yet released. The full test suite runs against the real LUKSO contracts on a local chain. It includes an end-to-end run of the shipped bundle as CLI and MCP processes, and the macOS Keychain backend has been verified live. Still to come before the first release: live trials inside OpenAI dots and Meta Muse, real Linux and Windows key-store runs, testnet runs with a relayer, and catalogue listings.

## Develop

```bash
npm ci
npm run typecheck
npm test                 # unit + local-chain tests (in-process EVM with the canonical LSP stack)
npm run build            # rebuilds skills/universal-profile/scripts (unminified, < 1 MiB per file)
node build/gen-verb-docs.mjs
npm run verify:skill     # release gate
```

Module map and data generators: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Every requirement mapped to code and tests: [docs/REQUIREMENTS-COVERAGE.md](docs/REQUIREMENTS-COVERAGE.md).

## License

[MIT-0](LICENSE): use it however you like, no attribution required.
