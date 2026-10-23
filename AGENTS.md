# AGENTS.md — Universal Profile Agent Skill, `source` branch

## This repo

- **Two branches.** `source` holds the sources (`src/`), tests (`test/`), build and data generators (`build/`), docs (`docs/`) and CI. `main` holds only the built skill (`skills/universal-profile/` as the repository root), written by `build/publish-main.mjs`. Never merge between them.
- **Rebuild with every source change.** After changing `src/`: `npm run build` and `node build/gen-verb-docs.mjs`, then commit the rebuilt `skills/universal-profile/scripts/` and `references/verbs.md` together with the change. CI rebuilds and fails on any difference.
- **Local tool databases are not part of the repo.** `agentdb.rvf`, `agentdb.rvf.lock` and `ruvector.db` files (also inside `skills/universal-profile/`) belong to local tools: never stage, move, read or delete them. Because the package gate reads every file in the skill folder, run `npm run verify:skill` and `npm run publish:main` in a clean worktree: `git worktree add --detach <dir> <commit>`, then `npm ci` there.
- **Test counts.** `test/unit/coverage/` is git-ignored, so local `vitest` counts are one file and three tests higher than CI and clean checkouts.
- **Version.** `package.json` holds it; `build/version.mjs` writes and checks every other copy (README.md, "Versioning and releases"). Never edit a copy by hand.

## Release checklist (every release, in this order)

1. **Bump:** `npm run version:set -- <patch|minor|major|X.Y.Z>`. Patch = compatible fixes, minor = additive features (new verbs, options, output fields), major = anything that breaks an agent, host or script (removed or renamed verbs or options, changed or removed output fields or error codes, state-folder formats older versions cannot read, a higher Node.js requirement), also before 1.0.
2. **Describe it:** fill the new "Unreleased" entry in `skills/universal-profile/CHANGELOG.md` and add `- **X.Y.Z** (unreleased): …` (one plain sentence for users) to the release history in `skills/universal-profile/README.md` ("Versions"). Preserve edits made directly on `main` (the publish script refuses to drop them; port them first).
3. **Build and test:** `npm run build && node build/gen-verb-docs.mjs`, `npm run typecheck && npm test`, `npm run version:check`.
4. **Commit and CI:** commit with explicit paths, push `source`, wait until every CI job (3 operating systems × Node.js 22 and 24, and `package`) is green.
5. **Review** the exact source commit independently before anything is published.
6. **Date it on the publish day:** `npm run version:release -- --date YYYY-MM-DD` (refuses a future date or one before the previous release; the bundles do not change), commit "release X.Y.Z", push `source`, wait for CI.
7. **Publish `main`** from a clean worktree of that commit: `npm ci && npm run verify:skill && npm run publish:main` (dry run: check the file count, tree and version), then `npm run publish:main -- --push`. Or let step 8 do it; never run both at the same time.
8. **Tag** only after review and a green CI: `git tag vX.Y.Z <source commit> && git push origin vX.Y.Z`. The release workflow refuses a tag that is not the version in `package.json` or an undated CHANGELOG entry, re-runs the tests and the reproducible build, publishes `main` only if its tree changed, and creates the GitHub release with `universal-profile-X.Y.Z.tar.gz` and `SHA256SUMS`.
9. **Verify:** `git diff vX.Y.Z:skills/universal-profile origin/main` is empty, the release archive unpacks to the same tree, and `node scripts/up.mjs --version` in a fresh install of `main` prints `X.Y.Z`.
