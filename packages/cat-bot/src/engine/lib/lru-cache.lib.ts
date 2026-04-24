/**
 * Shared LRU Cache — Single bounded in-memory store for all repo caching layers.
 *
 * One shared instance keeps total memory predictable regardless of how many repos
 * import this module. The 2000-entry LRU eviction policy ensures hot entries (active
 * users, current thread sessions, bot admin checks) survive while cold entries are
 * evicted automatically without manual cleanup.
 *
 * TTL of 5 minutes is a safety-net fallback — all write mutations in the repo layer
 * explicitly invalidate or update their keys so stale data from any missed invalidation
 * is bounded to 5 minutes at most.
 *
 * Null-value caching: lru-cache v11 throws only for `undefined` (not null). Repos that
 * cache "not found" results (getBotNickname → null, getThreadSessionUpdatedAt → null, etc.)
 * use NULL_SENTINEL so get() can distinguish a cached null from a cache miss (undefined).
 * Without the sentinel, `if (cached !== undefined) return cached` would incorrectly treat
 * a cached null as a miss and issue a redundant DB read on every subsequent call.
 */
import { LRUCache } from 'lru-cache';

// Stored in place of null so get() can distinguish "cached null" from "cache miss" (undefined).
// Repos that legitimately cache null (no-row results) rely on this round-trip correctly.
const NULL_SENTINEL: unique symbol = Symbol('lru:null');

const cache = new LRUCache<string, NonNullable<unknown>>({
  max: 2000,
  // 5-minute ceiling on any un-invalidated stale entry. Explicit write-through
  // in repo wrappers makes this rarely the actual expiry mechanism in practice.
  ttl: 1000 * 60 * 5,
});

export const lruCache = {
  get<T>(key: string): T | undefined {
    const raw = cache.get(key) as unknown;
    if (raw === undefined) return undefined;
    // Unwrap the sentinel back to null so callers receive the originally stored value.
    if (raw === NULL_SENTINEL) return null as T;
    return raw as T;
  },

  set(key: string, value: unknown): void {
    // lru-cache v11 throws for undefined — silently skip to prevent uncaught exceptions
    // from propagating into the message-handling pipeline on accidental undefined writes.
    if (value === undefined) return;
    // Null cannot be stored directly under NonNullable<unknown>; wrap it in NULL_SENTINEL
    // so get() can return null (cached "not found") instead of undefined (cache miss).
    cache.set(key, value === null ? NULL_SENTINEL : (value as NonNullable<unknown>));
  },

  del(key: string): void {
    cache.delete(key);
  },

  /**
   * Delete every key whose string begins with `prefix`.
   * Used to bulk-invalidate related entries without knowing exact keys — e.g.
   * removing all cached isThreadAdmin results for a thread whose admin list changed.
   */
  delByPrefix(prefix: string): void {
    for (const key of cache.keys()) {
      if (key.startsWith(prefix)) cache.delete(key);
    }
  },

  /**
   * Delete every key that begins with ANY of the given prefixes in a single iteration.
   * Use instead of multiple sequential delByPrefix() calls to avoid O(n × p) key-set
   * scans — e.g. clearUserCache must evict three separate namespaces for the same userId
   * and benefits from collapsing three O(n) passes into one.
   */
  delByPrefixes(prefixes: string[]): void {
    for (const key of cache.keys()) {
      if (prefixes.some((p) => key.startsWith(p))) cache.delete(key);
    }
  },
};