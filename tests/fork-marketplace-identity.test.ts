import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'child_process';

/**
 * Fork guard: this fork installs as the `yves8833` marketplace
 * (`claude-mem@yves8833`, `plugins/{marketplaces,cache}/yves8833/...`). Upstream
 * hard-codes `thedotmack` in paths and plugin keys, so an upstream merge that adds
 * one more literal would silently point that code at a directory this install
 * never creates. Only references to the upstream project itself may remain.
 */
const ALLOWED = [
  /github\.com\/thedotmack/,                    // upstream repo, issue and attribution URLs
  /thedotmack\/claude-mem[# .]/,                // upstream repo and issue references in prose
  /thedotmack@gmail/,                           // upstream author
  /username="thedotmack"/,                      // viewer star button for the upstream repo
  /LEGACY_CODEX_PLUGIN_IDS = \['claude-mem@thedotmack'\]/, // disables the upstream Codex install
];

describe('fork marketplace identity', () => {
  it('leaves no thedotmack marketplace path or plugin key in source or launchers', () => {
    const result = spawnSync('git', [
      'grep', '-n', 'thedotmack', '--',
      'src', 'scripts', 'plugin/hooks', 'plugin/.mcp.json',
      'plugin/scripts/bun-runner.js', 'plugin/scripts/version-check.js',
      '.claude-plugin/marketplace.json',
    ], { encoding: 'utf-8' });
    const offenders = result.stdout
      .split('\n')
      .filter(Boolean)
      .filter(line => !ALLOWED.some(pattern => pattern.test(line)));
    expect(offenders).toEqual([]);
  });
});
