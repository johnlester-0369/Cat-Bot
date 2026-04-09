import { prisma } from '../index.js';
import type { BotUserData } from '@cat-bot/engine/models/users.model.js';
import { toPlatformNumericId } from '@cat-bot/engine/utils/platform-id.util.js';

export async function upsertUser(data: BotUserData): Promise<void> {
  await prisma.botUser.upsert({
    where: { id: data.id },
    create: data,
    update: { name: data.name, firstName: data.firstName, username: data.username, avatarUrl: data.avatarUrl },
  });
}

/**
 * Reads the JSON data blob for a specific bot_users_session row.
 * Returns an empty object when the row is missing, data is null, or JSON is malformed —
 * callers always receive a safe default so collection operations never throw on first access.
 */
export async function getUserSessionData(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<Record<string, unknown>> {
  const platformId = toPlatformNumericId(platform);
  const row = await prisma.botUserSession.findUnique({
    where: { userId_platformId_sessionId_botUserId: { userId, platformId, sessionId, botUserId } },
    select: { data: true },
  });
  if (!row?.data) return {};
  try { return JSON.parse(row.data) as Record<string, unknown>; }
  catch { return {}; }
}

/**
 * Writes the JSON data blob for a specific bot_users_session row.
 * Uses updateMany instead of update to silently no-op when the row is absent —
 * avoids P2025 in the unlikely race where data is written before upsertUserSession commits.
 */
export async function setUserSessionData(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  await prisma.botUserSession.updateMany({
    where: { userId, platformId, sessionId, botUserId },
    data: { data: JSON.stringify(data) },
  });
}
// WHY: Fulfills the fallback requirement directly at the DB layer so callers never handle undefined.
export async function getUserName(userId: string): Promise<string> {
  const row = await prisma.botUser.findUnique({
    where: { id: userId },
    select: { name: true },
  });
  return row?.name ?? 'Unknown user';
}

export async function userExists(platform: string, userId: string): Promise<boolean> {
  const row = await prisma.botUser.findUnique({ where: { id: userId }, select: { platformId: true } });
  return row !== null;
}

export async function userSessionExists(userId: string, platform: string, sessionId: string, botUserId: string): Promise<boolean> {
  const row = await prisma.botUserSession.findUnique({
    where: { userId_platformId_sessionId_botUserId: { userId, platformId: toPlatformNumericId(platform), sessionId, botUserId } },
    select: { botUserId: true },
  });
  return row !== null;
}

export async function upsertUserSession(userId: string, platform: string, sessionId: string, botUserId: string): Promise<void> {
  const platformNumericId = toPlatformNumericId(platform);
  await prisma.botUserSession.upsert({
    where: { userId_platformId_sessionId_botUserId: { userId, platformId: platformNumericId, sessionId, botUserId } },
    create: { userId, platformId: platformNumericId, sessionId, botUserId },
    update: {},
  });
}

/**
 * Returns all bot_users_session records for a given (userId, platform, sessionId) tuple,
 * with their parsed data blobs. Used by the rank command to sort all users by EXP and
 * compute a leaderboard position without a separate ranking table.
 */
export async function getAllUserSessionData(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<Array<{ botUserId: string; data: Record<string, unknown> }>> {
  const platformId = toPlatformNumericId(platform);
  const rows = await prisma.botUserSession.findMany({
    where: { userId, platformId, sessionId },
    select: { botUserId: true, data: true },
  });
  return rows.map((row) => {
    let data: Record<string, unknown> = {};
    if (row.data) {
      try { data = JSON.parse(row.data) as Record<string, unknown>; }
      catch { /* malformed JSON — default to empty object */ }
    }
    return { botUserId: row.botUserId, data };
  });
}
