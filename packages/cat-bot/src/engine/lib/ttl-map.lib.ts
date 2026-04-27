/**
 * TTLMap — Generic In-Memory Map with Sliding or Fixed Expiration and Lazy Eviction
 *
 * Drop-in replacement for raw Map<string, V> where entries must auto-expire to prevent
 * unbounded memory growth. Two eviction strategies are combined:
 *
 *   1. Lazy eviction on read     — get() checks expiry and deletes before returning
 *   2. Threshold-triggered sweep — set() runs a full prune when size hits pruneThreshold
 *   3. Background timer (opt-in) — unref'd setInterval for long-idle stores
 *
 * Sliding vs. fixed TTL:
 *   sliding: true  (default) — each successful get() resets the TTL window, keeping
 *                              actively-used entries alive (conversation flows, button contexts).
 *   sliding: false           — TTL is fixed at write time and never extended; use for
 *                              single-consumption payloads (agent result keys) where a read
 *                              does not indicate renewed interest.
 *
 * Zero external dependencies — safe to import from any layer without risk of circular deps.
 */

export class TTLMap<V> {
  readonly #store = new Map<string, { value: V; expiry: number }>();
  readonly #ttlMs: number;
  readonly #sliding: boolean;
  readonly #pruneThreshold: number;

  constructor(opts: {
    /** Milliseconds each entry lives from its last write (or last read in sliding mode). */
    ttlMs: number;
    /**
     * When true (default), a successful get() resets the expiry clock.
     * Set to false for one-shot payloads that should expire regardless of reads.
     */
    sliding?: boolean;
    /**
     * Store size above which the next set() triggers a full expired-entry sweep.
     * Bounds peak memory between background timer intervals without adding I/O.
     * Defaults to 500 — sufficient for all current in-memory bot stores.
     */
    pruneThreshold?: number;
    /**
     * Milliseconds between background cleanup sweeps via setInterval.
     * The timer is unref'd — it never delays process exit after all other work finishes.
     * Omit for low-write stores where threshold-triggered pruning alone is adequate.
     */
    cleanupIntervalMs?: number;
  }) {
    this.#ttlMs = opts.ttlMs;
    this.#sliding = opts.sliding ?? true;
    this.#pruneThreshold = opts.pruneThreshold ?? 500;

    if (opts.cleanupIntervalMs !== undefined) {
      // Unref keeps the timer from preventing process exit — housekeeping should never
      // outlive the application's meaningful work.
      const timer = setInterval(() => {
        this.prune();
      }, opts.cleanupIntervalMs);
      (timer as NodeJS.Timeout).unref();
    }
  }

  /**
   * Returns the value for `key`, or undefined when absent or expired.
   * Expired entries are lazily deleted on the first failed read.
   * In sliding mode, a successful hit resets the TTL clock.
   */
  get(key: string): V | undefined {
    const entry = this.#store.get(key);
    if (entry === undefined) return undefined;
    const now = Date.now();
    if (now >= entry.expiry) {
      // Lazy eviction: remove the stale entry immediately rather than waiting for
      // a sweep — guarantees callers never observe post-expiry values.
      this.#store.delete(key);
      return undefined;
    }
    if (this.#sliding) {
      // Extend the deadline on every successful access — entries that are actively
      // used remain alive without requiring the caller to explicitly re-set them.
      entry.expiry = now + this.#ttlMs;
    }
    return entry.value;
  }

  /**
   * Stores a value with a fresh TTL window starting from now.
   * Triggers a sweep when the store exceeds pruneThreshold to bound peak memory.
   */
  set(key: string, value: V): void {
    if (this.#store.size >= this.#pruneThreshold) this.prune();
    this.#store.set(key, { value, expiry: Date.now() + this.#ttlMs });
  }

  /** Returns true when the key exists and its TTL has not elapsed. */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /** Immediately removes an entry regardless of its remaining TTL. */
  delete(key: string): void {
    this.#store.delete(key);
  }

  /** Sweeps the entire store, removing all entries whose TTL has elapsed. */
  prune(): void {
    const now = Date.now();
    for (const [k, v] of this.#store) {
      if (now >= v.expiry) this.#store.delete(k);
    }
  }

  /**
   * Raw entry count including entries that may have expired but not yet been lazily evicted.
   * Use has() or get() for authoritative existence checks.
   */
  get size(): number {
    return this.#store.size;
  }
}
