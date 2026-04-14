/**
 * Threads Repo — LRU cache layer over the database adapter.
 *
 * Thread data is queried on every incoming message in on-chat.middleware:
 *   - threadExists + threadSessionExists → determine if a sync is needed
 *   - getThreadSessionUpdatedAt          → staleness check against SYNC_INTERVAL_MS
 *   - isThreadAdmin                      → THREAD_ADMIN permission enforcement
 *   - getThreadSessionData               → read bot settings (prefix, toggles)
 *
 * Caching these eliminates 4–5 DB roundtrips per message on the hot path.
 *
 * Invalidation strategy:
 *   - upsertThread        → refresh exists/name; bulk-clear all admin checks for that thread
 *                           (isGroup changes are rare so getAllGroupThreadIds relies on TTL)
 *   - upsertThreadSession → set sessionExists=true + updatedAt=now; clear group IDs list
 *   - setThreadSessionData → replace data entry in cache; group IDs list unaffected
 */
import {
  upsertThread as _upsertThread,
  threadExists as _threadExists,
  threadSessionExists as _threadSessionExists,
  upsertThreadSession as _upsertThreadSession,
  isThreadAdmin as _isThreadAdmin,
  getThreadName as _getThreadName,
  getThreadSessionData as _getThreadSessionData,
  setThreadSessionData as _setThreadSessionData,
  getAllGroupThreadIds as _getAllGroupThreadIds,
  getThreadSessionUpdatedAt as _getThreadSessionUpdatedAt,
} from 'database';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';

// ── Cache key builders ────────────────────────────────────────────────────────

const threadExistsKey = (threadId: string): string =>
  `thread:exists:${threadId}`;

const threadSessionExistsKey = (
  userId: string, platform: string, sessionId: string, threadId: string,
): string => `${userId}:${platform}:${sessionId}:thread:sessionExists:${threadId}`;

const threadAdminKey = (threadId: string, userId: string): string =>
  `thread:admin:${threadId}:${userId}`;

const threadNameKey = (threadId: string): string =>
  `thread:name:${threadId}`;

const threadSessionDataKey = (
  userId: string, platform: string, sessionId: string, threadId: string,
): string => `${userId}:${platform}:${sessionId}:thread:sessionData:${threadId}`;

const threadGroupsKey = (userId: string, platform: string, sessionId: string): string =>
  `${userId}:${platform}:${sessionId}:thread:groups`;

const threadSessionUpdatedAtKey = (
  userId: string, platform: string, sessionId: string, threadId: string,
): string => `${userId}:${platform}:${sessionId}:thread:sessionUpdatedAt:${threadId}`;

// ── Wrappers ──────────────────────────────────────────────────────────────────

export async function upsertThread(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
): Promise<void> {
  await _upsertThread(data);
  // Thread now definitively exists; mark it so threadExists callers don't hit DB next time.
  lruCache.set(threadExistsKey(data.id), true);
  // Name may have changed — evict so next getThreadName re-fetches the authoritative value.
  lruCache.del(threadNameKey(data.id));
  // Admin membership array was atomically replaced — all per-user admin checks for this
  // thread are stale regardless of which user they reference.
  lruCache.delByPrefix(`thread:admin:${data.id}:`);
}

export async function threadExists(platform: string, threadId: string): Promise<boolean> {
  const key = threadExistsKey(threadId);
  const cached = lruCache.get<boolean>(key);
  if (cached !== undefined) return cached;
  const result = await _threadExists(platform, threadId);
  lruCache.set(key, result);
  return result;
}

export async function threadSessionExists(
  userId: string,
  platform: string,
  sessionId: string,
  threadId: string,
): Promise<boolean> {
  const key = threadSessionExistsKey(userId, platform, sessionId, threadId);
  const cached = lruCache.get<boolean>(key);
  if (cached !== undefined) return cached;
  const result = await _threadSessionExists(userId, platform, sessionId, threadId);
  lruCache.set(key, result);
  return result;
}

export async function upsertThreadSession(
  userId: string,
  platform: string,
  sessionId: string,
  threadId: string,
): Promise<void> {
  await _upsertThreadSession(userId, platform, sessionId, threadId);
  // Write the known post-upsert state directly — avoids a cold DB read on the very next
  // threadSessionExists or getThreadSessionUpdatedAt call that immediately follows in middleware.
  lruCache.set(threadSessionExistsKey(userId, platform, sessionId, threadId), true);
  lruCache.set(threadSessionUpdatedAtKey(userId, platform, sessionId, threadId), new Date());
  // A newly tracked session-thread pair may belong to a group — evict the cached group ID
  // list so the next getAllGroupThreadIds returns the complete set including this thread.
  lruCache.del(threadGroupsKey(userId, platform, sessionId));
}

export async function isThreadAdmin(threadId: string, userId: string): Promise<boolean> {
  const key = threadAdminKey(threadId, userId);
  const cached = lruCache.get<boolean>(key);
  if (cached !== undefined) return cached;
  const result = await _isThreadAdmin(threadId, userId);
  lruCache.set(key, result);
  return result;
}

export async function getThreadName(threadId: string): Promise<string> {
  const key = threadNameKey(threadId);
  const cached = lruCache.get<string>(key);
  if (cached !== undefined) return cached;
  const result = await _getThreadName(threadId);
  lruCache.set(key, result);
  return result;
}

export async function getThreadSessionData(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
): Promise<Record<string, unknown>> {
  const key = threadSessionDataKey(userId, platform, sessionId, botThreadId);
  const cached = lruCache.get<Record<string, unknown>>(key);
  if (cached !== undefined) return cached;
  const result = await _getThreadSessionData(userId, platform, sessionId, botThreadId);
  lruCache.set(key, result);
  return result;
}

export async function setThreadSessionData(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
  data: Record<string, unknown>,
): Promise<void> {
  await _setThreadSessionData(userId, platform, sessionId, botThreadId, data);
  // Write the new data blob into cache immediately — reads after this call see the fresh
  // value without touching the DB. Shallow copy prevents external mutation of the
  // cached reference if the caller reuses the same object.
  lruCache.set(threadSessionDataKey(userId, platform, sessionId, botThreadId), { ...data });
}

export async function getAllGroupThreadIds(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<string[]> {
  const key = threadGroupsKey(userId, platform, sessionId);
  const cached = lruCache.get<string[]>(key);
  if (cached !== undefined) return cached;
  const result = await _getAllGroupThreadIds(userId, platform, sessionId);
  lruCache.set(key, result);
  return result;
}

export async function getThreadSessionUpdatedAt(
  userId: string,
  platform: string,
  sessionId: string,
  threadId: string,
): Promise<Date | null> {
  const key = threadSessionUpdatedAtKey(userId, platform, sessionId, threadId);
  const cached = lruCache.get<Date | null>(key);
  // Explicitly check undefined: a cached null (no session row yet) is a valid result
  // that short-circuits the DB read and signals to middleware that a sync is required.
  if (cached !== undefined) return cached;
  const result = await _getThreadSessionUpdatedAt(userId, platform, sessionId, threadId);
  lruCache.set(key, result);
  return result;
}
