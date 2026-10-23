# Universal Profile 🆙 Agent Skill

**Give your AI agent a real account of its own: a smart account that you stay in control of, on LUKSO, Ethereum and 70+ other EVM networks.**

Most "crypto skills" for AI agents hand the agent a raw private key. Whoever holds that key can do *everything*, and if the key leaks or the agent makes a mistake, there is no undo and no limit. This skill takes a different approach. The agent gets a **Universal Profile**, a smart-contract account built on [ERC725Account](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-0-ERC725Account.md) and the LUKSO standards. The account itself decides what the agent's key may do, through the **LSP6 Key Manager** at its core.

- 🌐 Website: https://universalprofile.ai (coming soon)
- 🧩 This repository *is* the skill: a standard [Agent Skill](https://agentskills.io/specification) with [`SKILL.md`](SKILL.md) at the root (the agent reads that file; this README is for humans).
- ⚙️ Runtime: Node.js 22 or newer. Nothing else.
- 📜 License: [MIT-0](LICENSE)

---

## What you can ask your agent

Give it goals, not just single clicks: social, creative, community or financial. It plans the steps, shows you a preview of anything that spends, and then does the work as your profile:

- 🌐 **"Be my social scout on LUKSO.** Follow interesting creators and builders, read what they post on [Hup](https://www.hup.social) and share on [Forever Moments](https://forevermoments.life), send me a short daily digest of what's happening, and post our own moments with the pictures I send you."
- 💵 **"Put my 1,000 USDC to work.** Find the best stablecoin yield on Ethereum, Base and Arbitrum at established lending markets like Aave or Morpho, move it there, check daily, and switch when another market pays clearly more after gas. Send me a short weekly report of what we earned."
- 🗳️ **"Be my voice in my communities.** Keep track of the proposals in the DAOs and communities I belong to, summarise each one in two lines, vote as my profile the way I'd vote based on what I've told you, and ask me when you're unsure."
- 🎨 **"Collect art and culture I'll love.** Start on LUKSO: watch what the creators and musicians we follow release, collect the NFTs and community tokens that fit my taste, and catch the coolest new drops. Also keep an eye on drops on Ethereum and Base (OpenSea Drops, Zora, Manifold) and mint the best ones straight from their contracts. Stay within $200 a month, skip anything that looks like a scam, and keep a short gallery note on why you chose each piece."

All of this happens on-chain, as your profile: no logins or sign-ups at each app.

<details>
<summary>More ideas</summary>

**Get set up**
- "Set yourself up with your own Universal Profile on LUKSO, give it a name, a picture and a short bio, and show me how to fund it."
- "Add Base and Arbitrum too, with the same profile address, and tell me what it costs."
- "Add my wallet as a co-owner, then only allow yourself to use the contracts we agree on."

**Communities and work**
- "Join the communities I care about, read along, and tell me weekly what was decided and what's coming up."
- "Sign in to apps and forums as your profile, so you can take part for me without passwords."
- "Pay for the data and AI services you need per request (x402) from your profile, within $10 a month, and show me what you used."
- "Run a small paid service: answer questions for my community and accept tips to your profile; send me a monthly summary."

**Creators and culture**
- "Collect the art and music of the creators we follow on LUKSO, within $100 a month, and tell me why you picked each piece."
- "Find the meme coins and community tokens the LUKSO community is excited about, explain each in two lines, and buy a small bag of the ones I like."
- "Also watch the NFT collections I name on Ethereum and Base and mint the next drop as soon as it opens, at most two per drop and $100 in total."
- "Publish my new track on LUKSO (e.g. via upturn), share it with our followers and on Hup, and tell me who collected it."
- "Give your profile a style that matches mine: name, picture, bio and links, and keep it up to date."

**Money**
- "Farm the most promising airdrops for me: research the top upcoming ones on EVM networks, use each protocol the way it rewards, stay within $200 in total, keep a log, and claim what we qualify for."
- "Guard my positions: watch everything my profile holds on all networks, claim and compound rewards, and move funds to safety if a stablecoin loses its peg or a protocol gets exploited."
- "Be my crypto autopilot: buy $50 of ETH every week, keep my portfolio at 60% ETH and 40% stablecoins, take some profit when ETH is up 20%, and earn yield on whatever sits idle."
- "Stake my idle LYX on LUKSO (e.g. via Stakingverse) and tell me what it earns each month."
- "Every Friday, send 5 USDC from your profile to my savings profile and tell me the balance."
- "Swap 20 USDC to ETH on Base, but only if the price impact is under 1%; otherwise wait and try again tomorrow."
- "Move 50 USDC from Ethereum to LUKSO and confirm when it arrives."
- "Lock in a fixed yield on my stablecoins until next March if it's above 6%, and remind me before it matures."
- "Show me what your profile holds on every network, in dollars, and what changed this week."

**LUKSO social**
- "Find the 20 most interesting people on LUKSO for art, music and building, follow them, and tell me why you picked each one."
- "Every evening, tell me what the people we follow posted on Hup today, and draft a reply or two I might like."
- "Post this picture as a moment on Forever Moments with a short caption, and share it with our followers."
- "Who followed us this week? Follow back the real people, skip the bots, and tell me who's worth getting to know."
- "Collect three pieces from artists we follow on Universal Page, under $30 in total, and show me before buying."

**Social and identity**
- "Follow these five creators on LUKSO, and every week follow back new followers who have a profile picture."
- "Sign in to this app as your profile, and pay for this API per request (x402) with a $5 monthly limit."

**Research and safety**
- "Before we touch this contract or token, find out what it does, who deployed it and whether it's verified, and explain it in plain words."
- "Go through the tokens you've received, flag spam and scams, and never interact with them."
- "Show me who controls your profile, what each of them may do, and how much gas you have left on each network."
- "Never spend more than $20 a day without asking me."

</details>

Anything that spends or changes permissions follows the limits you set; outside them, the agent asks you first. Recurring tasks need an agent host that can schedule work. Yields and airdrops are never guaranteed.

## Why this skill is different

**🏦 An account, not just a key.** Think of a Universal Profile as a bank account and the agent's key as a debit card. The card can be limited or blocked, and the account and everything in it stays the same. With a plain wallet, the card *is* the account.

**🛂 You decide what the agent may do, and the blockchain enforces it.** The Key Manager ([LSP6](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-6-KeyManager.md)) checks every action against the permissions you granted. For example: "may transfer tokens, but only to these contracts and only these functions", "may update the profile's data but not add new controllers", or "may sign messages but not move funds". These limits live on-chain, so a confused or manipulated agent cannot step outside them.

**🤝 You can always step in.** Add your own wallet as a second controller and you can change permissions, add keys or take over the profile at any time. The address stays the same. No key is ever shared.

**🔐 The agent never sees or shares a private key.** The skill generates the agent's key itself and keeps it in the operating system's key store: macOS Keychain, Linux `systemd-creds` or a desktop keyring, Windows DPAPI, or a protected file inside a cloud agent VM. There is no command that exports it. Humans only ever see public addresses.

**✋ Nothing risky happens without you.** Reading is free. Anything that moves value, changes permissions or signs typed data runs as a dry run first. It then needs either a delegation policy you set up (with spending caps and daily limits) or your explicit approval in chat. Every approved action is written to a local audit log.

**⛽ Gas can be someone else's problem.** Besides normal transactions, the agent can send *signed relay calls* ([LSP25](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-25-ExecuteRelayCall.md)) through any relayer that speaks the [LSP15](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-15-TransactionRelayServiceAPI.md) API, so a relayer pays the gas. [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337) UserOperations are available too, if you switch them on.

**🌍 One identity across many chains.** The Universal Profiles ([ERC725Account](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-0-ERC725Account.md)) base and factory contracts are deployed on 73 networks, including LUKSO, Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain and Avalanche. A Universal Profile is one account that can be deployed on any of them, usually at the same address, because profiles are deployed deterministically. On each chain it has its own deployment, balances, controllers and permissions, and nothing moves between chains without an explicit bridge. `up profile status` shows the whole picture at once (where the profile is deployed, whether the agent may act there, gas and relayer), every action checks the target chain first and says exactly what is missing there, and the agent can even use a separate key on some chains.

**🧰 It can talk to any contract.** A generic ABI layer finds a contract's interface through Blockscout, Etherscan V2 or Sourcify, labels how trustworthy that interface is, explains the contract before using it, and then calls it *as the profile*. Tokens (LSP7, LSP8, ERC-20, ERC-721, ERC-1155), the LSP26 follower system and ERC-1271 signatures are built in.

**📱 Made for chat.** The agent can show its address as a QR code you scan straight into MetaMask to fund it. It can also show the same identicon (blockies image) you see in LUKSO apps, so you can recognise the right profile at a glance.

**🩺 It keeps itself working.** Public RPC endpoints go stale. The skill ships a ranked list for every network, checks endpoints, demotes dead ones and finds working replacements through [Chainlist](https://chainlist.org), storing them locally.

**🪶 It runs almost anywhere.** It's plain JavaScript in readable single-file bundles. There's no `npm install`, no native modules and no admin rights. The same folder works as an Agent Skill (OpenClaw, Claude Code, Codex, Cursor, Gemini CLI and others), as a command-line tool and as an [MCP](https://modelcontextprotocol.io) server.

---

## What your agent can do with it

- **Set up:** the agent offers three ways to get started: it creates its own account with gas you provide on each network; you create the profile with the Universal Relayer (gas included on LUKSO, Ethereum, Base, BNB Chain, Arbitrum, Robinhood Chain, Polygon and Avalanche, a separate service with its own terms; link coming soon) and authorise the agent (the relayer only forwards what your profile's controllers sign and pays the gas; it never controls your profile); or you let it use a profile you already have. Then it shows the address, identicon and funding QR code.
- **Join a profile you already have:** on LUKSO the agent sends you one link to the official authorization page with its address and only the permissions it needs. You connect your profile with the Universal Profile browser extension or app, untick anything you don't want and approve in your own wallet; the agent then checks the result on-chain. It never needs your keys and never creates a second profile.
- **Manage control:** add or remove controllers, grant or narrow permissions, limit which contracts and functions it may call ("AllowedCalls") and which data it may write, add more keys or hand over ownership.
- **Hold and move value:** send native coins and tokens, receive assets, and list what the profile owns.
- **Use any contract:** read, encode, simulate and call any function on any of the supported chains, with decoded results, errors and events.
- **Sign as the profile:** produce ERC-1271 signatures that apps and other contracts can verify against the profile address.
- **Give the profile a face:** set its name, description, links, tags, profile picture and background image ([LSP3](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-3-Profile-Metadata.md)). Pictures you send in chat are checked, uploaded to IPFS, verified by hash and written on LUKSO after a dry run and your approval; the agent then shares the profile link (`profile.link/<name>`).
- **Be social:** follow and unfollow profiles, and read followers ([LSP26](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-26-FollowerSystem.md)).
- **Choose how to execute:** directly through the Key Manager, directly on the account, via relayers (gasless), or via ERC-4337.

The skill has 117 commands in total. Each is both a CLI command and an MCP tool. Full reference: [`references/verbs.md`](references/verbs.md).

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

Ways to submit a transaction: **direct** (the controller pays gas), **LSP25 relay call** through an LSP15 relayer (the relayer pays), or **ERC-4337** UserOperation (opt-in). See [`execution-paths.md`](references/execution-paths.md).

## Install

Tell your agent to install the skill, or run one of these:

```bash
# OpenClaw (SKILL.md is at the root of the default branch)
openclaw skills install git:universal-everything/ai-universalprofile-skill
# OpenClaw via skills.sh, or ClawHub once published (slug: universal-profile)
openclaw skills install skills-sh:universal-everything/ai-universalprofile-skill/universal-profile
# Any Agent Skills host (Claude Code, Codex, Cursor, Gemini CLI, …)
npx skills add universal-everything/ai-universalprofile-skill
# Manual / cloud VMs (OpenAI dots, Meta Muse, servers): clone it straight into the skills directory
git clone --depth 1 https://github.com/universal-everything/ai-universalprofile-skill <your-skills-dir>/universal-profile
```

Release archives (`universal-profile-<version>.tar.gz`) come with a `SHA256SUMS` file; verify it before extracting.

Then ask your agent to set up its Universal Profile. It runs `node scripts/up-doctor.mjs` to check the machine, creates its key with `node scripts/up.mjs init`, and asks you which networks to use and whether to create a new profile or join yours. MCP clients can start `node scripts/up-mcp.mjs` (stdio).

Per-host details, including OpenAI dots and Meta Muse: [`references/platforms.md`](references/platforms.md).

## The standards behind it

All LUKSO Standard Proposals (LSPs) are specified in the [LIPs repository, `LSPs/` folder](https://github.com/lukso-network/LIPs/tree/main/LSPs). The reference contracts and the deployment list for every network are in [lsp-smart-contracts](https://github.com/lukso-network/lsp-smart-contracts) ([`deployments/`](https://github.com/lukso-network/lsp-smart-contracts/tree/main/deployments)). A bundled copy of the deployment data ships inside the skill.

### The account

| Standard | In plain words | Spec | Docs |
| --- | --- | --- | --- |
| ERC-725 | A contract that can *execute* calls and *store* key/value data: the base of every profile | [ERC725 repo](https://github.com/ERC725Alliance/ERC725) | [docs](https://docs.lukso.tech/standards/erc725/) |
| LSP0 [ERC725Account](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-0-ERC725Account.md) | The Universal Profile contract itself | [LSP-0](https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-0-ERC725Account.md) | [docs](https://docs.lukso.tech/standards/accounts/lsp0-erc725account/) |
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

For each standard, the full map of what the skill uses and how (function by function) is in [`references/standards.md`](references/standards.md).

## Learn more

- **LUKSO docs:** start at [Standards overview](https://docs.lukso.tech/standards/introduction/), [Benefits of the LUKSO standards](https://docs.lukso.tech/learn/benefits-lukso-standards/) and [Grant permissions](https://docs.lukso.tech/learn/universal-profile/key-manager/grant-permissions/). The main site is https://docs.lukso.tech.
- **Relay calls:** [Execute relay transactions](https://docs.lukso.tech/learn/universal-profile/key-manager/execute-relay-transactions/)
- **Specifications:** [LIPs / LSPs](https://github.com/lukso-network/LIPs/tree/main/LSPs)
- **Contracts and deployed networks:** [lsp-smart-contracts](https://github.com/lukso-network/lsp-smart-contracts) and [its `deployments/` folder](https://github.com/lukso-network/lsp-smart-contracts/tree/main/deployments)
- **RPC endpoints:** [Chainlist](https://chainlist.org)
- **Agent Skills format:** [agentskills.io specification](https://agentskills.io/specification)
- **Safety model:** [`references/security.md`](references/security.md)

## Versions

<!-- version:start (generated by build/version.mjs; do not edit by hand) -->
**Version 0.2.0** (released 2026-10-23) · [What's new](CHANGELOG.md) · [How versions work](#versions)
<!-- version:end -->

The skill follows [Semantic Versioning](https://semver.org): a **patch** version (0.2.**1**) fixes something without changing how you use it, a **minor** version (0.**3**.0) adds features and keeps everything that worked, and only a **major** version (**1**.0.0) may change or remove commands, options or results. This holds before 1.0 too: the next breaking change will be 1.0.0. The bundled network and contract data has its own `data-version` in `SKILL.md`.

Release history (details in [`CHANGELOG.md`](CHANGELOG.md)):

- **0.2.0** (2026-10-23): add your agent to a Universal Profile you already have with one link, with only the permissions it needs, approved in your own wallet and checked on-chain afterwards; versions kept consistent automatically.
- **0.1.0** (2026-10-10): the first published version.

**Updating:** install the skill again the same way, or run `git pull` in its folder. The agent's key, profiles and settings live in `~/.universal-profile` and are kept.

**Status:** the full test suite runs against the real LUKSO contracts on a local chain. It includes an end-to-end run of the shipped bundle as CLI and MCP processes, and the macOS Keychain backend has been verified live. Still to come: live trials inside OpenAI dots and Meta Muse, real Linux and Windows key-store runs, testnet runs with a relayer, and catalogue listings.

## Safety in short

- **The agent never shows, asks for or accepts private keys or seed phrases.** You only ever see and share public addresses. Never paste a private key into any website, chat or form.
- **Two addresses, two roles.** The *controller address* signs and pays gas for direct transactions; fund it only with small gas amounts. The *profile address* is the account; assets go there.
- **One profile, many networks.** The profile is one account that can be deployed on many networks, usually at the same address. On each network it has its own balances, controllers and permissions; moving assets between networks needs a bridge. `up profile status` shows every network at once.
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

## Development

The tools in `scripts/` are built from TypeScript sources with a full test suite: unit tests, local-chain tests on an in-process EVM with the canonical LSP contracts at their mainnet addresses, and an end-to-end run of this exact bundle as CLI and MCP processes. CI covers Linux, macOS and Windows on Node.js 22 and 24.

**Two branches, two jobs:**

| Branch | Contains | Who uses it |
| --- | --- | --- |
| `main` (default) | only the built skill, `SKILL.md` at the root (this page) | everyone who installs the skill; stays well under the 256-file / 8 MiB skill bundle limit |
| [`source`](https://github.com/universal-everything/ai-universalprofile-skill/tree/source) | TypeScript sources (`src/`), tests (`test/`), build and data generators (`build/`), docs (`docs/`), CI, and the skill folder as `skills/universal-profile/` | developers |

**Rules that keep the branches from getting in each other's way:**

- Develop on `source` (or feature branches from it). Open pull requests against `source`, never against `main`.
- **Never merge between `main` and `source`, in either direction.** They have different layouts on purpose. `main` only ever receives publish commits.
- Publishing: `npm run publish:main -- --push` on a clean, pushed `source` checkout adds one normal commit to `main` whose content is exactly `skills/universal-profile/`. It never rewrites history. A version tag `v*` on `source` does the same in the release workflow and also creates a GitHub release with `universal-profile-<version>.tar.gz` and `SHA256SUMS`.
- Small fixes directly on `main` (for example a README edit in the GitHub web editor) are fine. The publish script refuses to publish until they are ported into `source`: `git diff <last publish> origin/main | git apply --directory=skills/universal-profile`, then commit to `source`.
- Switching branches in one checkout works (`node_modules/` is ignored and stays). Separate folders are more comfortable: `git worktree add ../ai-universalprofile-skill-main main`.
- After changing anything in `src/`, run `npm run build` and commit the rebuilt `skills/universal-profile/scripts/` with the source change. CI checks that they match a fresh build byte for byte.
- Versions: `npm run version:set -- minor` (or `patch` / `major`) changes every copy of the version at once; `npm run build`, `npm run verify:skill`, CI and the release workflow refuse copies that disagree. A version is dated (`npm run version:release -- --date …`) only on the day it is published.

```bash
git clone -b source https://github.com/universal-everything/ai-universalprofile-skill && cd ai-universalprofile-skill
npm ci
npm run typecheck && npm test   # unit + local-chain + bundle end-to-end tests
npm run build                   # rebuilds skills/universal-profile/scripts/ (unminified, reproducible)
node build/gen-verb-docs.mjs    # regenerates references/verbs.md
npm run verify:skill            # package gate: spec, sizes, file count, no secrets or local paths
npm run publish:main            # dry run; add -- --push to publish to main
```

Architecture: [`docs/ARCHITECTURE.md`](https://github.com/universal-everything/ai-universalprofile-skill/blob/source/docs/ARCHITECTURE.md). Every requirement mapped to code and tests: [`docs/REQUIREMENTS-COVERAGE.md`](https://github.com/universal-everything/ai-universalprofile-skill/blob/source/docs/REQUIREMENTS-COVERAGE.md).

## License

[MIT-0](LICENSE): use it however you like, no attribution required.
