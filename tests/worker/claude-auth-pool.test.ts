import { describe, it, expect } from 'bun:test';
import { ClaudeAuthPool } from '../../src/services/worker/ClaudeAuthPool.js';
import { QUOTA_EXHAUSTED_RECHECK_COOLDOWN_MS } from '../../src/shared/quota-cooldown.js';
import { resolveClaudeConfigDirs } from '../../src/shared/oauth-token.js';

const NOW = 1_700_000_000_000;
const WEEK_AHEAD = NOW + 3 * 24 * 60 * 60_000;
const A = '/home/u/.claude';
const B = '/home/u/.claude-dev';
const C = '/home/u/.claude-work';
const DIRS = [A, B, C];
const oauth = () => 'Claude Code OAuth token (read from system keychain at spawn) profile=x';

function weekly(pool: ClaudeAuthPool, dir: string, utilization: number, status: 'allowed' | 'rejected' = 'allowed') {
  pool.store(dir).set({ rateLimitType: 'seven_day', utilization, status, resetsAt: WEEK_AHEAD });
}

describe('ClaudeAuthPool.decide', () => {
  it('tries unmeasured auths first, in configured order', () => {
    const pool = new ClaudeAuthPool();
    weekly(pool, A, 0.2);
    expect(pool.decide(DIRS, oauth, NOW)).toEqual({ kind: 'use', configDir: B });
  });

  it('runs on the auth with the lowest weekly utilization', () => {
    const pool = new ClaudeAuthPool();
    weekly(pool, A, 0.5);
    weekly(pool, B, 0.3);
    weekly(pool, C, 0.4);
    expect(pool.decide(DIRS, oauth, NOW)).toEqual({ kind: 'use', configDir: B });
  });

  it('skips an auth over its own threshold while the pool mean is below 93%', () => {
    const pool = new ClaudeAuthPool();
    weekly(pool, A, 0.98);
    weekly(pool, B, 0.6);
    weekly(pool, C, 0.7);
    expect(pool.decide([A, C], oauth, NOW)).toEqual({ kind: 'use', configDir: C });
    expect(pool.decide(DIRS, oauth, NOW)).toEqual({ kind: 'use', configDir: B });
  });

  it('pauses when the mean weekly utilization reaches 93% even if one auth is under its threshold', () => {
    const pool = new ClaudeAuthPool();
    weekly(pool, A, 1, 'rejected');
    weekly(pool, B, 0.9);
    weekly(pool, C, 0.89);
    const decision = pool.decide(DIRS, oauth, NOW);
    expect(decision.kind).toBe('pause');
  });

  it('does not pause on the mean while an auth is unmeasured', () => {
    const pool = new ClaudeAuthPool();
    weekly(pool, A, 0.99);
    weekly(pool, B, 0.99);
    expect(pool.decide(DIRS, oauth, NOW)).toEqual({ kind: 'use', configDir: C });
  });

  it('pauses when no auth is eligible', () => {
    const pool = new ClaudeAuthPool();
    weekly(pool, A, 0.95);
    pool.store(B).set({ rateLimitType: 'five_hour', utilization: 0.97, resetsAt: NOW + 2 * 60 * 60_000 });
    pool.bench(C, NOW);
    expect(pool.decide(DIRS, oauth, NOW).kind).toBe('pause');
  });

  it('returns a benched auth to rotation after one breaker cooldown', () => {
    const pool = new ClaudeAuthPool();
    pool.bench(A, NOW);
    expect(pool.decide([A, B], oauth, NOW)).toEqual({ kind: 'use', configDir: B });
    expect(pool.decide([A], oauth, NOW).kind).toBe('pause');
    expect(pool.decide([A], oauth, NOW + QUOTA_EXHAUSTED_RECHECK_COOLDOWN_MS)).toEqual({ kind: 'use', configDir: A });
  });

  it('ignores a weekly reading whose window has reset', () => {
    const pool = new ClaudeAuthPool();
    pool.store(A).set({ rateLimitType: 'seven_day', utilization: 0.99, resetsAt: NOW - 1 });
    weekly(pool, B, 0.1);
    expect(pool.decide([A, B], oauth, NOW)).toEqual({ kind: 'use', configDir: A });
  });

  it('never pauses API-key auth', () => {
    const pool = new ClaudeAuthPool();
    weekly(pool, A, 1, 'rejected');
    expect(pool.decide([A], () => 'API key (from ~/.claude-mem/.env)', NOW)).toEqual({ kind: 'use', configDir: A });
  });
});

describe('resolveClaudeConfigDirs', () => {
  it('splits, trims, strips trailing separators and dedupes', () => {
    expect(resolveClaudeConfigDirs(' /a/.claude/ , /b/.claude-dev,/a/.claude ')).toEqual(['/a/.claude', '/b/.claude-dev']);
  });

  it('falls back to the single default dir when empty', () => {
    expect(resolveClaudeConfigDirs('')).toHaveLength(1);
    expect(resolveClaudeConfigDirs(' , ')).toHaveLength(1);
  });
});
