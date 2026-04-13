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
 * NonNullable<unknown> = {} satisfies lru-cache v7+ constraint V extends {} (unknown includes null|undefined and fails).
 */
import { LRUCache } from 'lru-cache';

const cache = new LRUCache<string, NonNullable<unknown>>({
  max: 2000,
  // 5-minute ceiling on any un-invalidated stale entry. Explicit write-through
  // in repo wrappers makes this rarely the actual expiry mechanism in practice.
  ttl: 1000 * 60 * 5,
});

export const lruCache = {
  get<T>(key: string): T | undefined {
    return cache.get(key) as T | undefined;
  },

  set(key: string, value: unknown): void {
    // Cast strips null|undefined at the type level — lru-cache already throws at runtime
    // for those values, so this cast is safe and keeps the public API accepting unknown.
    cache.set(key, value as NonNullable<unknown>);
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
};
