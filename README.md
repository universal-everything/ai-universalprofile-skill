# Universal Profile Agent Skill — source

This is the **`source` branch**: the TypeScript sources, tests, data generators and CI that build the Universal Profile Agent Skill.

**Looking for the skill itself?** It lives on the [`main` branch](https://github.com/universal-everything/ai-universalprofile-skill), with `SKILL.md` at the repository root, so every installer works without a subfolder:

```bash
openclaw skills install git:universal-everything/ai-universalprofile-skill
npx skills add universal-everything/ai-universalprofile-skill
git clone --depth 1 https://github.com/universal-everything/ai-universalprofile-skill <your-skills-dir>/universal-profile
```

The plain-language overview (why this skill, what it does, all LSP standards with links) is the skill's README: [`skills/universal-profile/README.md`](skills/universal-profile/README.md), which becomes the README of `main`.

## Layout

| Path | Content |
| --- | --- |
| `skills/universal-profile/` | the shipped skill, exactly as it appears at the root of `main` (`SKILL.md`, `references/`, `assets/`, `platforms/`, built `scripts/`) |
| `src/` | TypeScript sources of the tools (CLI, MCP server, signer backends, LSP/ERC725 core, execution paths, ABI layer, …) |
| `test/` | unit tests, local-chain tests (in-process EVM with the canonical LSP stack) and an end-to-end test of the shipped bundle |
| `build/` | bundler, data generators (registry, ABIs, 4337 bytecode, verb docs), the package gate and the publish script |
| `docs/` | [ARCHITECTURE.md](docs/ARCHITECTURE.md) (module map) and [REQUIREMENTS-COVERAGE.md](docs/REQUIREMENTS-COVERAGE.md) (every requirement mapped to code and tests) |

## Develop

```bash
npm ci
npm run typecheck
npm test                 # unit + local-chain tests
npm run build            # rebuilds skills/universal-profile/scripts (unminified, < 1 MiB per file, reproducible)
node build/gen-verb-docs.mjs
npm run verify:skill     # package gate (spec, sizes, file count, text-only, no local paths/secrets)
```

Commit the rebuilt `skills/universal-profile/scripts/` together with the source change; CI checks that they match a fresh build.

## Publish to `main`

`main` holds only the built skill. To publish the committed state of `skills/universal-profile/` from a clean, pushed `source` checkout:

```bash
npm run publish:main            # checks, then shows what would be published (dry run)
npm run publish:main -- --push  # adds one commit to main whose tree is skills/universal-profile/ and pushes it
# Direct edits on main (e.g. a README fix in the GitHub UI) are never dropped: publishing stops until they are ported into skills/universal-profile/.
```

A version tag (`v*`) on `source` runs the release workflow: full tests, reproducible build, package gate, the same publish to `main`, and a GitHub release with `universal-profile-<version>.tar.gz` + `SHA256SUMS`.

## License

[MIT-0](LICENSE)
