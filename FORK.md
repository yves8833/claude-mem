# yves8833/claude-mem fork

Fork of [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) carrying one feature:
the Claude observer rotates across several subscription auths
(`CLAUDE_MEM_CLAUDE_CONFIG_DIR` as a comma-separated list, see
`src/services/worker/ClaudeAuthPool.ts`) and pauses only when the pool is spent.

## Install

The marketplace must keep the name `thedotmack`: install and cache paths are
hard-coded to it (`src/shared/paths.ts`, `src/shared/worker-utils.ts`,
`src/npx-cli/`). Only its source points at this fork.

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

History on `main` is only ever merged forward (no rebase, no force-push), so the installed
marketplace clone can always fast-forward.

```bash
git fetch upstream
git merge upstream/main
# Conflicts in version fields or plugin/ build output: take upstream's side, the rebuild below replaces them.
npm version <fork-version> --no-git-tag-version
npm run build
# bump the three hand-maintained manifests to <fork-version>
bun test tests/worker/claude-auth-pool.test.ts && npm run typecheck
git add -A ':!*.map' && git commit -m "chore: fork release <fork-version>"
git push origin main
```

Then update the plugin in Claude Code and restart the worker.
