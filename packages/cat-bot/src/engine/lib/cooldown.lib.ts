/**
 * CooldownStore — In-Memory Per-User Command Rate-Limit Tracker
 *
 * Extracted from on-command.middleware.ts to follow the lib/ pattern established
 * by state.lib.ts and options-map.lib.ts: lib/ owns mutable state;
 * middleware/ owns dispatch logic only.
 *
 * Dependency direction: lib/cooldown.lib.ts → (none)
 * Zero external imports keeps this a true leaf node — safe to import from
 * any layer without risk of circular dependencies.
 *
 * Intentionally in-memory (Map) rather than persistent storage:
 *   - Cooldown windows are session-scoped; a bot restart resetting active
 *     windows is acceptable UX for interactive command rate-limiting.
 *   - Synchronous reads keep the hot path (every command invocation) latency-free.
 */

// ── Entry shape ───────────────────────────────────────────────────────────────

export interface CooldownEntry {
  /** Unix ms timestamp when this user's cooldown window expires. */
  expiry: number;
  /**
   * Flipped to true after the first "please wait" reply is sent.
   * Prevents the bot from flooding the chat when a user repeatedly
   * retries a command within the same blocked window.
   */
  notified: boolean;
}

// ── Store ─────────────────────────────────────────────────────────────────────

class CooldownStore {
  readonly #store = new Map<string, CooldownEntry>();

  /**
   * Returns the active CooldownEntry for a key when the window has not yet
   * expired, or null when the user is free to proceed.
   *
   * Returning the entry (rather than a boolean) lets `enforceCooldown`
   * compute the exact remaining seconds without a second lookup.
   */
  check(key: string, now: number): CooldownEntry | null {
    const entry = this.#store.get(key);
    // noUncheckedIndexedAccess: Map.get() returns T | undefined — guard required
    if (entry !== undefined && now < entry.expiry) return entry;
    return null;
  }

  /**
   * Registers a fresh cooldown window for a key.
   * Always overwrites any existing entry — first-invocation and post-expiry
   * calls both follow the same code path.
   * Window starts at `now` so the user's wait time is predictable regardless
   * of how long the handler takes to execute.
   */
  record(key: string, now: number, durationMs: number): void {
    this.#store.set(key, { expiry: now + durationMs, notified: false });
  }

  /**
   * Marks an active entry as notified so the next blocked attempt within
   * the same window is silently dropped — one notice per cooldown window maximum.
   * No-op when the key is absent (window already expired between check and notify).
   */
  markNotified(key: string): void {
    const entry = this.#store.get(key);
    if (entry !== undefined) entry.notified = true;
  }

  /**
   * Lazy eviction: prunes expired entries when the store exceeds `threshold`.
   * Called at the top of enforceCooldown rather than on a background timer so
   * this lib stays dependency-free (no node:timers coupling) and the GC pressure
   * is proportional to actual bot activity.
   *
   * The 10 000 default matches the original inline guard — only commands with
   * cooldowns contribute entries, so this threshold is rarely reached.
   */
  pruneIfNeeded(now: number, threshold = 10_000): void {
    if (this.#store.size <= threshold) return;
    for (const [k, v] of this.#store) {
      if (now > v.expiry) this.#store.delete(k);
    }
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

/**
 * Singleton — all middleware invocations share this instance so cooldown
 * windows persist for the full process lifetime across concurrent requests.
 */
export const cooldownStore = new CooldownStore();

// Background sweep every 5 minutes evicts expired cooldown windows that accumulated
// without a subsequent write to trigger the lazy threshold prune. Unref'd so this
// housekeeping timer cannot delay process exit after all bot sessions have stopped.
// NOTE: cooldowns use fixed TTL — the window must NOT slide on access, because
// resetting the penalty clock when a user retries would defeat rate-limiting entirely.
const _cooldownCleanup = setInterval(() => {
  cooldownStore.pruneIfNeeded(Date.now(), 0);
}, 5 * 60 * 1000);
(_cooldownCleanup as NodeJS.Timeout).unref();
