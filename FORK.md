# yves8833/claude-mem fork

Fork of [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) carrying one feature:
the Claude observer rotates across several subscription auths
(`CLAUDE_MEM_CLAUDE_CONFIG_DIR` as a comma-separated list, see
`src/services/worker/ClaudeAuthPool.ts`) and pauses only when the pool is spent.

## Install

This fork installs as the `yves8833` marketplace (`claude-mem@yves8833`), so it is never
mistaken for the official plugin. Upstream hard-codes `thedotmack` in install/cache paths,
plugin keys and hook launchers; the fork renames all of them, and
`tests/fork-marketplace-identity.test.ts` fails if a merge brings a new one in. On that
failure, rename the new literal (links to the upstream repo stay as they are), then
`node scripts/build-hooks.js --write-shell-templates` if a hook launcher changed.

```bash
claude plugin marketplace add yves8833/claude-mem
claude plugin install claude-mem@yves8833
```

## Versioning

Fork version = upstream `major.minor.(patch × 100 + N)`, where N counts fork releases on that
upstream version (upstream 13.25.3 → 13.25.301, 13.25.302, …; upstream 13.26.0 → 13.26.1).
The worker resolver runs the highest version found in the plugin cache, and ranks a prerelease
(`-fork.1`) below its release, so a fork build must sort strictly above the upstream version it
is based on.

The manifest version and the version baked into `plugin/scripts/*.cjs` must match, or hooks
kill the worker on every event. `npm run build` handles the plugin manifests and bundles;
`.claude-plugin/marketplace.json`, `.grok-plugin/plugin.json` and
`openclaw/openclaw.plugin.json` are bumped by hand.

## Syncing upstream

`.github/workflows/fork-upstream-sync.yml` checks upstream daily for a new release tag
(`vX.Y.Z`). When one exists it merges it on a branch, takes upstream's side of conflicts in
build output and version fields, runs `scripts/fork-release.sh` (re-applies the rename to the
hook launchers, picks the next fork version, rebuilds, checks bundle versions), runs the type
check and the fork-sensitive tests, and opens a PR. Merging that PR is the release: installed
copies auto-update from `main`. A conflict in source files or a failing check opens an
"Upstream sync needs attention" issue instead. Run it on demand with
`gh workflow run fork-upstream-sync.yml` (add `-f dry_run=true` to build and verify only).

Never use GitHub's "Sync fork" button: it merges upstream's version numbers, `thedotmack`
paths and bundles into `main` unrebuilt, and installed copies would pick that up.

By hand (same steps as the workflow; `main` is only ever merged forward, never rebased or
force-pushed, so installed marketplace clones can always fast-forward):

```bash
git fetch --tags upstream
git merge vX.Y.Z            # on conflicts in plugin/ or version fields: git checkout --theirs
scripts/fork-release.sh vX.Y.Z
npm run typecheck && bun test tests/fork-marketplace-identity.test.ts tests/worker/claude-auth-pool.test.ts
git add -A && git commit -m "chore: fork release <printed version>"
git push origin main
```

Do not open Claude Code sessions inside this repo: the worker resolver also considers the
session's working directory, and a local build newer than the installed one makes sessions
kill each other's worker.
