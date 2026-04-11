import { prisma } from '../index.js';
import type { BotThreadData } from '@cat-bot/engine/models/threads.model.js';
import { toPlatformNumericId } from '@cat-bot/engine/modules/platform/platform-id.util.js';

export async function upsertThread(data: BotThreadData): Promise<void> {
  const allUserIds = Array.from(new Set([...data.participantIDs, ...data.adminIDs]));
  if (allUserIds.length > 0) {
    const existing = await prisma.botUser.findMany({ where: { id: { in: allUserIds } }, select: { id: true } });
    const existingIds = new Set(existing.map((u) => u.id));
    const toCreate = allUserIds.filter((id) => !existingIds.has(id)).map((id) => ({ platformId: data.platformId, id, name: 'Unknown User' }));
    if (toCreate.length > 0) await prisma.botUser.createMany({ data: toCreate });
  }

  const participantConnects = data.participantIDs.map((id) => ({ id }));
  const adminConnects = data.adminIDs.map((id) => ({ id }));

  await prisma.botThread.upsert({
    where: { id: data.id },
    create: {
      platformId: data.platformId, id: data.id, name: data.name, isGroup: data.isGroup,
      memberCount: data.memberCount, avatarUrl: data.avatarUrl,
      participants: { connect: participantConnects }, admins: { connect: adminConnects },
    },
    update: {
      name: data.name, isGroup: data.isGroup, memberCount: data.memberCount, avatarUrl: data.avatarUrl,
      participants: { set: participantConnects }, admins: { set: adminConnects },
    },
  });
}

export async function threadExists(platform: string, threadId: string): Promise<boolean> {
  const row = await prisma.botThread.findUnique({ where: { id: threadId }, select: { platformId: true } });
  return row !== null;
}

export async function threadSessionExists(userId: string, platform: string, sessionId: string, threadId: string): Promise<boolean> {
  const row = await prisma.botThreadSession.findUnique({
    where: { userId_platformId_sessionId_botThreadId: { userId, platformId: toPlatformNumericId(platform), sessionId, botThreadId: threadId } },
    select: { botThreadId: true },
  });
  return row !== null;
}

export async function upsertThreadSession(userId: string, platform: string, sessionId: string, threadId: string): Promise<void> {
  const platformNumericId = toPlatformNumericId(platform);
  await prisma.botThreadSession.upsert({
    where: { userId_platformId_sessionId_botThreadId: { userId, platformId: platformNumericId, sessionId, botThreadId: threadId } },
    create: { userId, platformId: platformNumericId, sessionId, botThreadId: threadId },
    // Prisma's @updatedAt decorator only fires when at least one field is present in the update payload.
    // An empty update: {} is a no-op — lastUpdatedAt stays frozen at creation time, making every
    // subsequent staleness check see an expired timestamp and trigger a redundant API fetch.
    update: { lastUpdatedAt: new Date() },
  });
}

/**
 * Returns the lastUpdatedAt timestamp for a (session × thread) pair, or null when no row exists.
 * Consumed by on-chat.middleware to determine staleness against SYNC_INTERVAL_MS — the threshold
 * constant lives in the middleware, not here, so this function is purely a data accessor.
 */
export async function getThreadSessionUpdatedAt(
  userId: string, platform: string, sessionId: string, threadId: string,
): Promise<Date | null> {
  const row = await prisma.botThreadSession.findUnique({
    where: { userId_platformId_sessionId_botThreadId: { userId, platformId: toPlatformNumericId(platform), sessionId, botThreadId: threadId } },
    select: { lastUpdatedAt: true },
  });
  return row?.lastUpdatedAt ?? null;
}

export async function isThreadAdmin(threadId: string, userId: string): Promise<boolean> {
  const row = await prisma.botThread.findUnique({
    where: { id: threadId },
    select: { admins: { where: { id: userId }, select: { id: true } } },
  });
  return row !== null && row.admins.length > 0;
}

// WHY: Fulfills the fallback requirement directly at the DB layer so callers never handle undefined.
export async function getThreadName(threadId: string): Promise<string> {
  const row = await prisma.botThread.findUnique({
    where: { id: threadId },
    select: { name: true },
  });
  return row?.name ?? 'Unknown thread';
}

// ── Thread Session Data ────────────────────────────────────────────────────────

/**
 * Reads the JSON data blob for a specific bot_threads_session row.
 * Returns an empty object when the row is missing, data is null, or JSON is malformed —
 * callers always receive a safe default so collection operations never throw on first access.
 */
export async function getThreadSessionData(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
): Promise<Record<string, unknown>> {
  const platformId = toPlatformNumericId(platform);
  const row = await prisma.botThreadSession.findUnique({
    where: { userId_platformId_sessionId_botThreadId: { userId, platformId, sessionId, botThreadId } },
    select: { data: true },
  });
  if (!row?.data) return {};
  try { return JSON.parse(row.data) as Record<string, unknown>; }
  catch { return {}; }
}

/**
 * Writes the JSON data blob for a specific bot_threads_session row.
 * Uses updateMany instead of update to silently no-op when the row is absent —
 * avoids P2025 in the unlikely race where data is written before upsertThreadSession commits.
 */
export async function setThreadSessionData(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  await prisma.botThreadSession.updateMany({
    where: { userId, platformId, sessionId, botThreadId },
    data: { data: JSON.stringify(data) },
  });
}

/**
 * Returns all group thread IDs for a given (userId, platform, sessionId) tuple.
 * Two-step Prisma query: fetch botThreadIds from bot_threads_session, then filter
 * bot_threads by isGroup=true. Used by /sendnoti to restrict broadcast to group chats.
 */
export async function getAllGroupThreadIds(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<string[]> {
  const platformId = toPlatformNumericId(platform);
  // Step 1 — collect all thread IDs the session has tracked
  const sessions = await prisma.botThreadSession.findMany({
    where: { userId, platformId, sessionId },
    select: { botThreadId: true },
  });
  const threadIds = sessions.map((s) => s.botThreadId);
  if (threadIds.length === 0) return [];
  // Step 2 — keep only threads flagged as group chats in the canonical bot_threads table
  const groupThreads = await prisma.botThread.findMany({
    where: { id: { in: threadIds }, isGroup: true },
    select: { id: true },
  });
  return groupThreads.map((t) => t.id);
}
