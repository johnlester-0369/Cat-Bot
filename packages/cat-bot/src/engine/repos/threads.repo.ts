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
  upsertDiscordServer as _upsertDiscordServer,
  linkDiscordChannel as _linkDiscordChannel,
  getDiscordServerIdByChannel as _getDiscordServerIdByChannel,
  upsertDiscordServerSession as _upsertDiscordServerSession,
  getDiscordServerSessionUpdatedAt as _getDiscordServerSessionUpdatedAt,
  getDiscordServerSessionData as _getDiscordServerSessionData,
  setDiscordServerSessionData as _setDiscordServerSessionData,
  isDiscordServerAdmin as _isDiscordServerAdmin,
  getDiscordServerName as _getDiscordServerName,
  getAllDiscordServerIds as _getAllDiscordServerIds,
  discordServerExists as _discordServerExists,
  discordServerSessionExists as _discordServerSessionExists,
} from 'database';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';

// ── Cache key builders ────────────────────────────────────────────────────────

const threadExistsKey = (threadId: string): string =>
  `thread:exists:${threadId}`;

const threadSessionExistsKey = (
  userId: string,
  platform: string,
  sessionId: string,
  threadId: string,
): string =>
  `${userId}:${platform}:${sessionId}:thread:sessionExists:${threadId}`;

const threadAdminsSetKey = (threadId: string): string =>
  `thread:admins:set:${threadId}`;

const threadNameKey = (threadId: string): string => `thread:name:${threadId}`;

const threadSessionDataKey = (
  userId: string,
  platform: string,
  sessionId: string,
  threadId: string,
): string =>
  `${userId}:${platform}:${sessionId}:thread:sessionData:${threadId}`;

const threadGroupsKey = (
  userId: string,
  platform: string,
  sessionId: string,
): string => `${userId}:${platform}:${sessionId}:thread:groups`;

const threadSessionUpdatedAtKey = (
  userId: string,
  platform: string,
  sessionId: string,
  threadId: string,
): string =>
  `${userId}:${platform}:${sessionId}:thread:sessionUpdatedAt:${threadId}`;

// ── Wrappers ──────────────────────────────────────────────────────────────────

export async function upsertDiscordServer(data: any): Promise<void> {
  await _upsertDiscordServer(data);
  // Pre-seed admin map into cache so isThreadAdmin looks up from memory
  lruCache.set(
    threadAdminsSetKey(data.id),
    new Set<string>((data.adminIDs as string[] | undefined) ?? []),
  );
}

export async function linkDiscordChannel(
  serverId: string,
  threadId: string,
): Promise<void> {
  await _linkDiscordChannel(serverId, threadId);
  lruCache.set(`discord:channel:${threadId}`, serverId);
}

export async function getDiscordServerIdByChannel(
  threadId: string,
): Promise<string | null> {
  const key = `discord:channel:${threadId}`;
  const cached = lruCache.get<string | null>(key);
  if (cached !== undefined) return cached;
  const result = await _getDiscordServerIdByChannel(threadId);
  lruCache.set(key, result);
  return result;
}

export async function upsertThread(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
): Promise<void> {
  await _upsertThread(data);
  lruCache.set(threadExistsKey(data.id), true);
  lruCache.del(threadNameKey(data.id));
  // Cache admin IDs as a single Set — O(threads) entries instead of O(threads × participants).
  // Every isThreadAdmin check for this thread resolves via Set.has() in memory without a new
  // cache entry per (thread, sender) pair. Data is fresh from the just-completed upsert.
  lruCache.set(
    threadAdminsSetKey(data.id),
    new Set<string>((data.adminIDs as string[] | undefined) ?? []),
  );
}

export async function threadExists(
  platform: string,
  threadId: string,
): Promise<boolean> {
  if (platform === Platforms.Discord) {
    const serverId = await getDiscordServerIdByChannel(threadId);
    if (serverId) {
      const key = threadExistsKey(serverId);
      const cached = lruCache.get<boolean>(key);
      if (cached !== undefined) return cached;
      const result = await _discordServerExists(serverId);
      lruCache.set(key, result);
      return result;
    }
  }
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
  if (platform === Platforms.Discord) {
    const serverId = await getDiscordServerIdByChannel(threadId);
    if (serverId) {
      // Use serverId as the suffix to avoid caching the same value under N different channel IDs
      const key = threadSessionExistsKey(userId, platform, sessionId, serverId);
      const cached = lruCache.get<boolean>(key);
      if (cached !== undefined) return cached;
      const result = await _discordServerSessionExists(
        userId,
        sessionId,
        serverId,
      );
      lruCache.set(key, result);
      return result;
    }
  }
  const key = threadSessionExistsKey(userId, platform, sessionId, threadId);
  const cached = lruCache.get<boolean>(key);
  if (cached !== undefined) return cached;
  const result = await _threadSessionExists(
    userId,
    platform,
    sessionId,
    threadId,
  );
  lruCache.set(key, result);
  return result;
}

export async function upsertThreadSession(
  userId: string,
  platform: string,
  sessionId: string,
  threadId: string,
): Promise<void> {
  // Intercept Discord channels to update the underlying Server Session timestamp instead
  if (platform === Platforms.Discord) {
    const serverId = await getDiscordServerIdByChannel(threadId);
    if (serverId) {
      await _upsertDiscordServerSession(userId, sessionId, serverId);
      // Update channel's session cache mapping just in case
      lruCache.set(
        threadSessionExistsKey(userId, platform, sessionId, threadId),
        true,
      );
      lruCache.set(
        threadSessionUpdatedAtKey(userId, platform, sessionId, serverId),
        new Date(),
      );
      lruCache.del(threadGroupsKey(userId, platform, sessionId));
      return;
    }
    // If not found (either DM or a newly discovered channel awaiting full sync),
    // gracefully fall back to threading a temporary session record.
  }
  await _upsertThreadSession(userId, platform, sessionId, threadId);
  // Write the known post-upsert state directly — avoids a cold DB read on the very next
  // threadSessionExists or getThreadSessionUpdatedAt call that immediately follows in middleware.
  lruCache.set(
    threadSessionExistsKey(userId, platform, sessionId, threadId),
    true,
  );
  lruCache.set(
    threadSessionUpdatedAtKey(userId, platform, sessionId, threadId),
    new Date(),
  );
  // A newly tracked session-thread pair may belong to a group — evict the cached group ID
  // list so the next getAllGroupThreadIds returns the complete set including this thread.
  lruCache.del(threadGroupsKey(userId, platform, sessionId));
}

export async function isThreadAdmin(
  threadId: string,
  userId: string,
): Promise<boolean> {
  const set = lruCache.get<Set<string>>(threadAdminsSetKey(threadId));
  if (set !== undefined) return set.has(userId);

  // Opportunistically verify against the parent Discord server's admin list
  const serverId = await getDiscordServerIdByChannel(threadId);
  if (serverId) {
    const serverSet = lruCache.get<Set<string>>(threadAdminsSetKey(serverId));
    if (serverSet !== undefined) return serverSet.has(userId);
    return _isDiscordServerAdmin(serverId, userId);
  }

  // Cache miss: upsertThread hasn't synced this thread yet in this process lifetime.
  // Fall through to DB without caching a per-user boolean — the next upsertThread
  // call (triggered by chatPassthrough on the next message) populates the Set so
  // all future checks become in-memory Set.has() lookups with zero new cache entries.
  return _isThreadAdmin(threadId, userId);
}

export async function getThreadName(threadId: string): Promise<string> {
  const key = threadNameKey(threadId);
  const cached = lruCache.get<string>(key);
  if (cached !== undefined) return cached;

  let result: string;
  const serverId = await getDiscordServerIdByChannel(threadId);
  if (serverId) {
    result = await _getDiscordServerName(serverId);
  } else {
    result = await _getThreadName(threadId);
  }
  lruCache.set(key, result);
  return result;
}

export async function getThreadSessionData(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
): Promise<Record<string, unknown>> {
  // Intercept to store feature settings at the Server level rather than individual Channel level
  if (platform === Platforms.Discord) {
    const serverId = await getDiscordServerIdByChannel(botThreadId);
    if (serverId) {
      const skey = threadSessionDataKey(userId, platform, sessionId, serverId);
      const scached = lruCache.get<Record<string, unknown>>(skey);
      if (scached !== undefined) return scached;
      const sresult = await _getDiscordServerSessionData(
        userId,
        sessionId,
        serverId,
      );
      lruCache.set(skey, sresult);
      return sresult;
    }
  }

  const key = threadSessionDataKey(userId, platform, sessionId, botThreadId);
  const cached = lruCache.get<Record<string, unknown>>(key);
  if (cached !== undefined) return cached;
  const result = await _getThreadSessionData(
    userId,
    platform,
    sessionId,
    botThreadId,
  );
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
  if (platform === Platforms.Discord) {
    const serverId = await getDiscordServerIdByChannel(botThreadId);
    if (serverId) {
      await _setDiscordServerSessionData(userId, sessionId, serverId, data);
      lruCache.set(
        threadSessionDataKey(userId, platform, sessionId, serverId),
        { ...data },
      );
      return;
    }
  }

  await _setThreadSessionData(userId, platform, sessionId, botThreadId, data);
  // Write the new data blob into cache immediately — reads after this call see the fresh
  // value without touching the DB. Shallow copy prevents external mutation of the
  // cached reference if the caller reuses the same object.
  lruCache.set(threadSessionDataKey(userId, platform, sessionId, botThreadId), {
    ...data,
  });
}

export async function getAllGroupThreadIds(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<string[]> {
  const key = threadGroupsKey(userId, platform, sessionId);
  const cached = lruCache.get<string[]>(key);
  if (cached !== undefined) return cached;

  let result = await _getAllGroupThreadIds(userId, platform, sessionId);
  // Map Discord servers as broadcastable "groups" as well
  if (platform === Platforms.Discord) {
    const discordServers = await _getAllDiscordServerIds(userId, sessionId);
    result = [...result, ...discordServers];
  }

  lruCache.set(key, result);
  return result;
}

export async function getThreadSessionUpdatedAt(
  userId: string,
  platform: string,
  sessionId: string,
  threadId: string,
): Promise<Date | null> {
  if (platform === Platforms.Discord) {
    const serverId = await getDiscordServerIdByChannel(threadId);
    if (serverId) {
      const skey = threadSessionUpdatedAtKey(
        userId,
        platform,
        sessionId,
        serverId,
      );
      const scached = lruCache.get<Date | null>(skey);
      if (scached !== undefined) return scached;
      const sresult = await _getDiscordServerSessionUpdatedAt(
        userId,
        sessionId,
        serverId,
      );
      lruCache.set(skey, sresult);
      return sresult;
    }
  }

  const key = threadSessionUpdatedAtKey(userId, platform, sessionId, threadId);
  const cached = lruCache.get<Date | null>(key);
  // Explicitly check undefined: a cached null (no session row yet) is a valid result
  // that short-circuits the DB read and signals to middleware that a sync is required.
  if (cached !== undefined) return cached;
  const result = await _getThreadSessionUpdatedAt(
    userId,
    platform,
    sessionId,
    threadId,
  );
  lruCache.set(key, result);
  return result;
}
