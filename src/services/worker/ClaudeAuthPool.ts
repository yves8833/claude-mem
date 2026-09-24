/**
 * Rotates the Claude observer across several subscription auths — the config
 * dirs listed, comma-separated, in CLAUDE_MEM_CLAUDE_CONFIG_DIR — and pauses
 * only when the pool as a whole is spent.
 *
 * Each auth keeps its own RateLimitStore, fed by the `rate_limit_event`
 * snapshots the observer receives while running on it. A snapshot describes the
 * whole account, so it already counts the user's interactive usage.
 *
 * - An auth is eligible when its own snapshots pass `shouldAbortForQuota` and
 *   no refusal it earned is still benched.
 * - The observer runs on the eligible auth with the lowest seven_day
 *   utilization. An auth with no seven_day reading sorts first, so it gets
 *   measured; ties keep the configured order.
 * - The pool pauses when no auth is eligible, or when every auth has a
 *   seven_day reading and their mean reaches POOL_SEVEN_DAY_PAUSE_THRESHOLD.
 *
 * Readings are only as fresh as the observer's last run on each auth, and the
 * SDK reports one window per event, so the mean can lag the truth; the
 * per-auth thresholds still hold every auth the observer actually runs on.
 * State is in memory: a worker restart re-measures every auth.
 */

import { logger } from '../../utils/logger.js';
import { QUOTA_EXHAUSTED_RECHECK_COOLDOWN_MS } from '../../shared/quota-cooldown.js';
import { claudeConfigDirProfileLabel } from '../../shared/EnvManager.js';
import {
  RateLimitStore,
  isApiKeyAuth,
  sevenDayUtilization,
  shouldAbortForQuota,
} from './RateLimitStore.js';

/** Mean seven_day utilization across the pool at which the observer pauses. */
export const POOL_SEVEN_DAY_PAUSE_THRESHOLD = 0.93;

export type AuthPoolDecision =
  | { kind: 'use'; configDir: string }
  | { kind: 'pause'; reason: string };

export class ClaudeAuthPool {
  private stores = new Map<string, RateLimitStore>();
  private benchedUntil = new Map<string, number>();

  store(configDir: string): RateLimitStore {
    let store = this.stores.get(configDir);
    if (!store) {
      store = new RateLimitStore();
      this.stores.set(configDir, store);
    }
    return store;
  }

  /**
   * Bench an auth whose refusal carried no snapshot (quota prose, a thrown
   * quota or 429 error) for one quota-breaker cooldown.
   */
  bench(configDir: string, now: number = Date.now()): void {
    this.benchedUntil.set(configDir, now + QUOTA_EXHAUSTED_RECHECK_COOLDOWN_MS);
    logger.warn('SDK', 'Benching a Claude auth after a refusal', {
      profile: claudeConfigDirProfileLabel(configDir),
      minutes: QUOTA_EXHAUSTED_RECHECK_COOLDOWN_MS / 60_000,
    });
  }

  decide(
    configDirs: string[],
    authMethodOf: (configDir: string) => string,
    now: number = Date.now(),
  ): AuthPoolDecision {
    // API-key and gateway credentials come from ~/.claude-mem/.env and apply to
    // every dir alike; per-call billing is never paused (see shouldAbortForQuota).
    if (isApiKeyAuth(authMethodOf(configDirs[0]))) {
      return { kind: 'use', configDir: configDirs[0] };
    }

    const eligible = configDirs.filter(configDir =>
      (this.benchedUntil.get(configDir) ?? 0) <= now &&
      !shouldAbortForQuota(authMethodOf(configDir), this.store(configDir), now).abort
    );
    if (eligible.length === 0) {
      return { kind: 'pause', reason: `no eligible auth among ${configDirs.length}` };
    }

    const readings = new Map(configDirs.map(configDir => [
      configDir,
      sevenDayUtilization(this.store(configDir), now),
    ]));
    const known = [...readings.values()].filter((u): u is number => u !== undefined);
    if (known.length === configDirs.length) {
      const mean = known.reduce((sum, u) => sum + u, 0) / known.length;
      if (mean >= POOL_SEVEN_DAY_PAUSE_THRESHOLD) {
        return {
          kind: 'pause',
          reason: `seven_day mean ${(mean * 100).toFixed(1)}% >= ${(POOL_SEVEN_DAY_PAUSE_THRESHOLD * 100).toFixed(0)}% across ${known.length} auths`,
        };
      }
    }

    const rank = (configDir: string) => readings.get(configDir) ?? -1;
    const [configDir] = [...eligible].sort((a, b) => rank(a) - rank(b));
    return { kind: 'use', configDir };
  }

  /** Latest snapshots per auth, keyed by profile label, for the health surface. */
  snapshot(): Record<string, ReturnType<RateLimitStore['getMostRecentByWindow']>> {
    return Object.fromEntries(
      [...this.stores].map(([configDir, store]) => [
        claudeConfigDirProfileLabel(configDir),
        store.getMostRecentByWindow(),
      ]),
    );
  }
}

/** Process-wide pool. */
export const claudeAuthPool = new ClaudeAuthPool();
