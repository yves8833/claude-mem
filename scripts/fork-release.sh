#!/usr/bin/env bash
# Turn a tree that has just merged upstream into a fork release: re-apply the
# yves8833 marketplace rename to the hook launchers and hand-written plugin
# scripts (a merge takes upstream's copies of these), pick the next fork
# version, rebuild the bundles and sync every manifest. Prints the version.
#
#   scripts/fork-release.sh [upstream-ref]     # default: upstream/main
#
# The previous fork version is read from origin/main. See FORK.md.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

upstream_ref=${1:-upstream/main}
upstream=$(git show "$upstream_ref:package.json" | jq -r .version)
previous=$(git show origin/main:package.json | jq -r .version)

# Fork version = upstream major.minor.(patch * 100 + N): it must sort above the
# upstream release it is built on, and every fork release needs a new number.
IFS=. read -r ua ub uc <<<"$upstream"
IFS=. read -r pa pb pc <<<"$previous"
if [ "$ua.$ub" = "$pa.$pb" ] && [ $((pc / 100)) -eq "$uc" ]; then
  version="$ua.$ub.$((pc + 1))"
else
  version="$ua.$ub.$((uc * 100 + 1))"
fi

# Links to the upstream repo keep their owner; install paths and plugin keys do not.
perl -pi -e 's{(?<!github\.com/)thedotmack(?!\@gmail)(?!/claude-mem[# .])}{yves8833}g' \
  plugin/hooks/hooks.json plugin/hooks/codex-hooks.json plugin/.mcp.json \
  plugin/scripts/bun-runner.js plugin/scripts/version-check.js

set_json() {
  local file=$1 tmp
  shift
  tmp=$(mktemp)
  jq "$@" "$file" > "$tmp"
  cat "$tmp" > "$file"
  rm -f "$tmp"
}

npm version "$version" --no-git-tag-version --allow-same-version >/dev/null
set_json .claude-plugin/marketplace.json --arg v "$version" '
  .name = "yves8833"
  | .owner.name = "yves8833"
  | .metadata.description = "yves8833 fork of thedotmack/claude-mem (multi-auth observer pool)"
  | (.plugins[] | select(.name == "claude-mem") | .version) = $v'
set_json .grok-plugin/plugin.json --arg v "$version" '.version = $v'
set_json openclaw/openclaw.plugin.json --arg v "$version" '.version = $v'

node scripts/sync-plugin-manifests.js >&2
node scripts/build-hooks.js --write-shell-templates >&2
node scripts/gen-plugin-lockfile.cjs >&2
find plugin -name '*.map' -delete

# Hooks kill the worker on every event when a bundle's baked-in version differs
# from the manifest, so refuse a release where they disagree.
for bundle in plugin/scripts/worker-service.cjs plugin/scripts/mcp-server.cjs \
              plugin/scripts/server-service.cjs plugin/scripts/transcript-watcher.cjs; do
  grep -q "\"$version\"" "$bundle" || { echo "$bundle does not embed $version" >&2; exit 1; }
done

echo "$version"
