# Universal Profile Agent Skill

Give any AI agent its own **Universal Profile** — an ERC725 smart-contract account controlled through the LSP6 Key Manager — on LUKSO and every EVM network where the LSP stack is deployed (73 networks today). The agent holds its own controller key, creates or joins a profile, manages controllers and permissions, and acts *as the profile*: direct through the Key Manager, direct through the account (LSP20), via LSP25 relay calls through any LSP15 relayer, or (opt-in) through ERC-4337. Any contract on any EVM chain is reachable through a generic ABI layer with a verification ladder.

- **Skill folder:** [`skills/universal-profile/`](skills/universal-profile) — install this. Read its [`SKILL.md`](skills/universal-profile/SKILL.md).
- **Runtime:** Node.js ≥ 22 only. No `npm install`, no native modules, no admin rights.
- **License:** MIT-0.
- **Website:** https://universalprofile.ai

## Install (agent-only, from chat)

```bash
# OpenClaw (Git installs need SKILL.md at the source root → the release workflow publishes it on the `skill` branch)
openclaw skills install git:universal-everything/ai-universalprofile-skill@skill
# OpenClaw via skills.sh ref, or ClawHub once published (slug: universal-profile)
openclaw skills install skills-sh:universal-everything/ai-universalprofile-skill/universal-profile
# Any Agent-Skills host (Claude Code, Codex, Cursor, Gemini CLI, …)
npx skills add universal-everything/ai-universalprofile-skill
# Manual / cloud VMs: release tarball + SHA256SUMS from GitHub Releases, or
git clone --depth 1 https://github.com/universal-everything/ai-universalprofile-skill && cp -r ai-universalprofile-skill/skills/universal-profile <your-skills-dir>/
```

Then the agent runs `node scripts/up-doctor.mjs` and `node scripts/up.mjs init`. MCP hosts can start `node scripts/up-mcp.mjs` (stdio).

## Develop

```bash
npm ci
npm run typecheck
npm test                 # unit + local-chain tests (in-process EVM with the canonical LSP stack)
npm run build            # rebuilds skills/universal-profile/scripts (unminified, < 1 MiB per file)
node build/gen-verb-docs.mjs
npm run verify:skill     # release gate
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the module map and data generators.
