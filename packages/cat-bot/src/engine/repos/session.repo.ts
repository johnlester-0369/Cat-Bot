/**
 * Session Repo — LRU cache layer over the database adapter for bot_session reads.
 *
 * Bot nickname is read on every ai command invocation and every passive onChat
 * message that contains a trigger phrase. Without caching, each message would
 * incur a DB roundtrip for data that only changes when the bot admin edits the
 * session via the dashboard — potentially dozens of unnecessary reads per minute
 * in active group chats.
 *
 * Invalidation: nickname updates flow through bot.repo.ts which already clears
 * `bot:detail:{userId}:{sessionId}` and `bot:list:{userId}`. The nickname key
 * here uses its own namespace so future mutations can target it independently.
 * TTL-based expiry (lruCache default) provides eventual consistency without
 * requiring explicit cross-repo coupling for every possible write path.
 */
import {
  getBotNickname as _getBotNickname,
} from 'database';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';

// ── Cache key builder ─────────────────────────────────────────────────────────
// Colon-separated segments prevent collisions with other repo namespaces.
// The `session:nickname` suffix scopes it within the (userId, platform, sessionId) tuple.

const nicknameKey = (
  userId: string,
  platform: string,
  sessionId: string,
): string => `${userId}:${platform}:${sessionId}:session:nickname`;

// ── Bot Nickname ──────────────────────────────────────────────────────────────

/**
 * Returns the bot's configured display name for the given session, or null when
 * no nickname has been set. Null callers should fall back to a generic identity.
 */
export async function getBotNickname(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<string | null> {
  const key = nicknameKey(userId, platform, sessionId);
  const cached = lruCache.get<string | null>(key);
  // Explicit undefined check: a cached null (nickname unset) is a valid result
  // that short-circuits the DB read without triggering a spurious re-fetch.
  if (cached !== undefined) return cached;
  const result = await _getBotNickname(userId, platform, sessionId);
  lruCache.set(key, result);
  return result;
}