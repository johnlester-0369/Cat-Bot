/**
 * Banned Repo — LRU cache layer over the database adapter.
 *
 * isUserBanned / isThreadBanned are called on every incoming message before command dispatch.
 * Caching them eliminates a DB roundtrip on the hot path while maintaining correctness:
 * ban/unban mutations write the known new boolean directly into cache rather than deleting
 * the key, so the next isUserBanned read sees the authoritative value from memory instead
 * of re-querying the DB.
 */
import {
  banUser as _banUser,
  unbanUser as _unbanUser,
  isUserBanned as _isUserBanned,
  banThread as _banThread,
  unbanThread as _unbanThread,
  isThreadBanned as _isThreadBanned,
} from 'database';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';

// ── Cache key builders ─────────────────────────────────────────────────────────
// Colon-separated segments make prefix scanning unambiguous and human-readable in
// debug tooling. The `banned:` namespace prevents collisions with other repo keys.

const userBanKey = (
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): string => `banned:user:${userId}:${platform}:${sessionId}:${botUserId}`;

const threadBanKey = (
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
): string => `banned:thread:${userId}:${platform}:${sessionId}:${botThreadId}`;

// ── User Bans ─────────────────────────────────────────────────────────────────

export async function banUser(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
  reason?: string,
): Promise<void> {
  await _banUser(userId, platform, sessionId, botUserId, reason);
  // Write true immediately so the next isUserBanned call within the TTL window
  // doesn't see a stale false from a pre-ban read that's still in cache.
  lruCache.set(userBanKey(userId, platform, sessionId, botUserId), true);
}

export async function unbanUser(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<void> {
  await _unbanUser(userId, platform, sessionId, botUserId);
  lruCache.set(userBanKey(userId, platform, sessionId, botUserId), false);
}

export async function isUserBanned(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<boolean> {
  const key = userBanKey(userId, platform, sessionId, botUserId);
  const cached = lruCache.get<boolean>(key);
  if (cached !== undefined) return cached;
  const result = await _isUserBanned(userId, platform, sessionId, botUserId);
  lruCache.set(key, result);
  return result;
}

// ── Thread Bans ───────────────────────────────────────────────────────────────

export async function banThread(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
  reason?: string,
): Promise<void> {
  await _banThread(userId, platform, sessionId, botThreadId, reason);
  lruCache.set(threadBanKey(userId, platform, sessionId, botThreadId), true);
}

export async function unbanThread(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
): Promise<void> {
  await _unbanThread(userId, platform, sessionId, botThreadId);
  lruCache.set(threadBanKey(userId, platform, sessionId, botThreadId), false);
}

export async function isThreadBanned(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
): Promise<boolean> {
  const key = threadBanKey(userId, platform, sessionId, botThreadId);
  const cached = lruCache.get<boolean>(key);
  if (cached !== undefined) return cached;
  const result = await _isThreadBanned(userId, platform, sessionId, botThreadId);
  lruCache.set(key, result);
  return result;
}