/**
 * Users Repo — LRU cache layer over the database adapter.
 *
 * User data follows the same per-message query pattern as threads:
 *   - userExists + userSessionExists  → sync gating in middleware
 *   - getUserSessionUpdatedAt         → staleness check against SYNC_INTERVAL_MS
 *   - getUserSessionData              → per-user bot data (balance, XP, etc.)
 *   - getAllUserSessionData           → rank leaderboard (aggregates entire session)
 *
 * Invalidation strategy:
 *   - upsertUser          → set exists=true; set name to fresh value
 *   - upsertUserSession   → set sessionExists=true; set updatedAt=now
 *   - setUserSessionData  → replace individual data entry; evict allData cache
 *                           since it aggregates all per-user blobs for the session
 */
import {
  upsertUser as _upsertUser,
  userExists as _userExists,
  userSessionExists as _userSessionExists,
  upsertUserSession as _upsertUserSession,
  getUserName as _getUserName,
  getUserSessionData as _getUserSessionData,
  setUserSessionData as _setUserSessionData,
  getAllUserSessionData as _getAllUserSessionData,
  getUserSessionUpdatedAt as _getUserSessionUpdatedAt,
} from 'database';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';

// ── Cache key builders ────────────────────────────────────────────────────────

const userExistsKey = (userId: string): string =>
  `user:exists:${userId}`;

const userNameKey = (userId: string): string =>
  `user:name:${userId}`;

const userSessionExistsKey = (
  userId: string, platform: string, sessionId: string, botUserId: string,
): string => `user:sessionExists:${userId}:${platform}:${sessionId}:${botUserId}`;

const userSessionDataKey = (
  userId: string, platform: string, sessionId: string, botUserId: string,
): string => `user:sessionData:${userId}:${platform}:${sessionId}:${botUserId}`;

const userSessionAllKey = (userId: string, platform: string, sessionId: string): string =>
  `user:sessionAll:${userId}:${platform}:${sessionId}`;

const userSessionUpdatedAtKey = (
  userId: string, platform: string, sessionId: string, botUserId: string,
): string => `user:sessionUpdatedAt:${userId}:${platform}:${sessionId}:${botUserId}`;

// ── Wrappers ──────────────────────────────────────────────────────────────────

export async function upsertUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
): Promise<void> {
  await _upsertUser(data);
  // Update cached derived values using the just-written data to avoid a stale read
  // on the very next userExists or getUserName call for this user.
  lruCache.set(userExistsKey(data.id), true);
  lruCache.set(userNameKey(data.id), data.name);
}

export async function userExists(platform: string, userId: string): Promise<boolean> {
  const key = userExistsKey(userId);
  const cached = lruCache.get<boolean>(key);
  if (cached !== undefined) return cached;
  const result = await _userExists(platform, userId);
  lruCache.set(key, result);
  return result;
}

export async function userSessionExists(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<boolean> {
  const key = userSessionExistsKey(userId, platform, sessionId, botUserId);
  const cached = lruCache.get<boolean>(key);
  if (cached !== undefined) return cached;
  const result = await _userSessionExists(userId, platform, sessionId, botUserId);
  lruCache.set(key, result);
  return result;
}

export async function upsertUserSession(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<void> {
  await _upsertUserSession(userId, platform, sessionId, botUserId);
  // Write known post-upsert state so the immediately-following middleware calls
  // (userSessionExists, getUserSessionUpdatedAt) hit cache instead of DB.
  lruCache.set(userSessionExistsKey(userId, platform, sessionId, botUserId), true);
  lruCache.set(userSessionUpdatedAtKey(userId, platform, sessionId, botUserId), new Date());
}

export async function getUserName(userId: string): Promise<string> {
  const key = userNameKey(userId);
  const cached = lruCache.get<string>(key);
  if (cached !== undefined) return cached;
  const result = await _getUserName(userId);
  lruCache.set(key, result);
  return result;
}

export async function getUserSessionData(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<Record<string, unknown>> {
  const key = userSessionDataKey(userId, platform, sessionId, botUserId);
  const cached = lruCache.get<Record<string, unknown>>(key);
  if (cached !== undefined) return cached;
  const result = await _getUserSessionData(userId, platform, sessionId, botUserId);
  lruCache.set(key, result);
  return result;
}

export async function setUserSessionData(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
  data: Record<string, unknown>,
): Promise<void> {
  await _setUserSessionData(userId, platform, sessionId, botUserId, data);
  // Replace the individual data entry with the fresh value so immediate reads
  // skip the DB. Shallow copy prevents caller mutation of the cached reference.
  lruCache.set(userSessionDataKey(userId, platform, sessionId, botUserId), { ...data });
  // Evict the aggregated all-session cache — it includes this user's data blob and
  // is now stale. The next getAllUserSessionData call will re-fetch the full set.
  lruCache.del(userSessionAllKey(userId, platform, sessionId));
}

export async function getAllUserSessionData(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<Array<{ botUserId: string; data: Record<string, unknown> }>> {
  const key = userSessionAllKey(userId, platform, sessionId);
  const cached = lruCache.get<Array<{ botUserId: string; data: Record<string, unknown> }>>(key);
  if (cached !== undefined) return cached;
  const result = await _getAllUserSessionData(userId, platform, sessionId);
  lruCache.set(key, result);
  return result;
}

export async function getUserSessionUpdatedAt(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<Date | null> {
  const key = userSessionUpdatedAtKey(userId, platform, sessionId, botUserId);
  const cached = lruCache.get<Date | null>(key);
  // null is a valid cached result (user not yet synced) — only undefined means cache miss.
  if (cached !== undefined) return cached;
  const result = await _getUserSessionUpdatedAt(userId, platform, sessionId, botUserId);
  lruCache.set(key, result);
  return result;
}
