# Platforms: installing and running the skill on each host

The skill is one directory (`universal-profile/`: `SKILL.md`, `scripts/`, `references/`, `assets/`) that runs anywhere **Node.js 22 or newer** runs. There is no `npm install`, no native module, no admin step and nothing runs at install time. Repository: https://github.com/universal-everything/ai-universalprofile-skill (branch `main` is exactly this skill, `SKILL.md` at the root; the TypeScript sources, tests and build live on branch `source`). Releases ship `universal-profile-<version>.tar.gz` with a `SHA256SUMS` file.

Status words below: **documented** = the host's own documentation describes this route; **candidate** = should work, not yet proven by an end-to-end test on a fresh installation; **not available** = missing in this version. No host has a recorded end-to-end pass for this version yet; do not tell a human that a host "is supported and tested".

Ask the human before installing software (the skill itself or Node). Never use `sudo`.

## Node.js

`node scripts/up-doctor.mjs` checks the version and prints the remedy. If `node` is missing or older than 22, ask the human, then install it in user space:
- official binary archive from https://nodejs.org/en/download extracted under the home directory, with its `bin/` added to `PATH`;
- or a version manager: nvm (https://github.com/nvm-sh/nvm), fnm (https://github.com/Schniz/fnm) or Volta (https://volta.sh);
- on Windows, the official zip or `winget` in user scope where available.

OpenClaw gateways already run on a newer Node, so nothing is needed there.

## OpenClaw (first-class)

- **Install (documented OpenClaw routes; the `main` branch of the repository is exactly this skill, with `SKILL.md` at its root):**
  - `openclaw skills install git:universal-everything/ai-universalprofile-skill` (default branch `main`; pin a release with `@v<version>`).
  - ClawHub, slug `universal-profile`: `openclaw skills install @<owner>/universal-profile` (owner as shown on the listing), once published.
  - Local copy: `git clone --depth 1 https://github.com/universal-everything/ai-universalprofile-skill universal-profile && openclaw skills install ./universal-profile`, or clone straight into the workspace `skills/` folder.
  - Add `--global` to make it available to all agents.
- **Gating:** the frontmatter declares `metadata.openclaw.requires.bins: [node]` and the supported OS list. `openclaw skills check` shows missing requirements.
- **Running:** the agent runs `node {baseDir}/scripts/up.mjs …` through its exec tool. If an operator configured exec approvals (`ask`, `allowlist`, `deny`), a sandbox or an install policy, report that exact gate to the human instead of working around it.
- **MCP (optional):** `openclaw mcp add universal-profile --command node --arg <absolute skill path>/scripts/up-mcp.mjs`, then `openclaw mcp doctor universal-profile --probe`. Not required: the CLI through exec offers the same verbs.
- **Key storage:** on macOS the OpenClaw gateway runs in the logged-in user's session, so the login keychain backend works after the user has logged in once since boot. On Linux, `systemd-creds` (systemd 256+) works headless; older systems fall back to the labelled key file. On Windows, DPAPI. OpenClaw's own secret store is not used for the controller key (it cannot hand a value to a local script).
- **Images:** attach the PNG files from `media` with OpenClaw's media sending; always also send the text form.

## OpenAI dots

Status: **candidate**. Dots have a cloud computer that can run software; third-party skill installation inside it is not documented, and whether its files persist between sessions is not proven.

- **Primary route (in-VM):** in the dot's cloud computer, `git clone --depth 1 https://github.com/universal-everything/ai-universalprofile-skill universal-profile` (or fetch a release tarball), check `node --version`, run with `UP_AGENT_HOST=dots` so the key is kept in a protected file inside the VM (`vm-protected-file`; approved for this host). Then `up doctor`, `up init`, onboarding as usual.
- If the VM loses its files, the key is gone: recommend the human's wallet as second controller right after setup (`references/onboarding.md`).
- **Connected computer:** a dot can use "local skills" on a computer connected through the ChatGPT desktop app; install the skill there like on any machine. Whether a dot may execute the bundled scripts this way is not verified.
- **Home bridge (optional, advanced):** `platforms/openai/plugin.json` and `platforms/openai/mcp.json` are an [Agent Plugins](https://agent-plugins.org) template for a private plugin that points a dot at an MCP server the user runs at home, so the key never leaves their machine. To assemble it: a folder with those two files plus this skill copied to `skills/universal-profile/`, and the placeholder URL in `mcp.json` replaced by the user's own HTTPS endpoint. That endpoint needs an HTTP MCP transport (Streamable HTTP with OAuth, or the ChatGPT Secure MCP Tunnel to a local server); this version ships the **stdio** MCP server only, so the bridge is **not available** yet. The project hosts no MCP service.
- Images: delivery in dots is unverified; always include the text form.

## Meta Muse

Status: **candidate**. Muse runs agents in a Linux VM with a terminal and file system; outbound network access is approved by Sentinel; third-party skill installation is not documented.

- Install recipe (fetch release, verify sha256, extract to `~/skills/universal-profile`, Node check, egress approvals): `platforms/meta/README.md` in the skill directory.
- Run with `UP_AGENT_HOST=muse` (protected key file inside the VM, approved for this host).
- Egress: request approval for the hosts in `assets/registry/egress.json`, by category, only for what is needed (RPCs and explorers of the chains in use; relayer; GitHub for updates).
- Images: Muse Artifacts can show the QR and identicon PNGs; always include the text form.
- Optional home bridge through a Meta-reviewed MCP connector: not available in this version.

## Other Agent Skills hosts (Claude Code, Codex, Cursor, Gemini CLI, Goose, GitHub Copilot, …)

Status: **candidate** for all.

- `npx skills add universal-everything/ai-universalprofile-skill` (the skills CLI finds `SKILL.md` at the repository root and links the skill into the chosen agent's skills directory; `-a <agent>` selects the host).
- Or clone the repository (it is the skill directory) into the host's skills directory as `universal-profile` (for example `~/.claude/skills/universal-profile` for Claude Code, or `~/.agents/skills/universal-profile` for hosts that read that shared location). Check the host's documentation for its directory.
- Scripts run through the host's shell tool from the skill directory. The same OS key-store backends apply.

## MCP (any MCP client)

`node scripts/up-mcp.mjs` is a stdio MCP server (JSON-RPC, protocol versions 2024-11-05 to 2025-11-25). Each verb is a tool named `up_` + the verb words joined by `_`; tool arguments are the CLI flag names; reference documents are resources (`up://SKILL.md`, `up://references/<name>.md`). Results carry the same JSON as the CLI in `structuredContent`, and images as image content.

Client configuration (use the absolute path of the installed skill):

```json
{
  "mcpServers": {
    "universal-profile": {
      "command": "node",
      "args": ["/absolute/path/to/universal-profile/scripts/up-mcp.mjs"],
      "env": { "UP_HOME": "/absolute/path/to/state-dir" }
    }
  }
}
```

`UP_HOME` is optional (default `~/.universal-profile`); add `"UP_AGENT_HOST": "vm"` when the server runs inside a cloud agent VM. Command-line helpers exist in several hosts, for example `claude mcp add universal-profile -- node /absolute/path/to/universal-profile/scripts/up-mcp.mjs` in Claude Code.

A client's "always allow" setting for a tool is not the human's approval for a transaction; the consent rules in `SKILL.md` still apply.

## Remembering the profile across chats

`up profile identity` finds the saved profile(s) again in any chat that uses **the same state folder** (`UP_HOME`, default `~/.universal-profile`): same user, same machine or the same mounted persistent storage. It reads only public files; it never creates a key or profile, never touches the key store and makes no network call.

- **Works:** several chats of one user on one machine (Claude Code, Codex, OpenClaw and other hosts that run the skill on the user's computer), and any host whose agent VM keeps the state folder between chats.
- **Does not work by itself:** a chat in a different, fresh or reset environment (an isolated cloud VM such as OpenAI dots or Meta Muse without storage that persists between chats, a new machine, another user's account). It cannot see another environment's files, and the verb then reports that nothing is saved here. Whether a given dots/Muse chat keeps its files has not been tested; do not promise it. Ways back: persistent storage the platform mounts at the state folder, restoring an encrypted backup (`up backup import`), or the human authorising the new agent address on their existing profile. A public profile address alone is not access and recovers no key.
- Never keep the key or the state in chat memory, a note or a hosted sync; the skill creates none. Several people sharing one agent need one state folder each.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `UP_HOME` | state directory (default `~/.universal-profile`) |
| `UP_AGENT_HOST` | `dots`, `muse` or `vm`: declares a cloud agent VM so the in-VM protected key file may be used |
| `UP_AGENT_NAME` | the agent's own public display name (never a secret): the default backup file name starts with it when `--bot-name` is not given. Not set by default; the skill never guesses a name |
| `UP_ASSETS_DIR` | override the bundled `assets/` location (development only) |
| `UP_RPC_TIMEOUT_MS` | RPC timeout in milliseconds (default 15000) |

Never put key material in environment variables.
