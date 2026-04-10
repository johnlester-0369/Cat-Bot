import { getDb, saveDb } from '../store.js';
import type { BotUserData } from '@cat-bot/engine/models/users.model.js';
import { toPlatformNumericId } from '@cat-bot/engine/modules/platform/platform-id.util.js';

export async function upsertUser(data: BotUserData): Promise<void> {
  const db = await getDb();
  const rec = db.botUser.find((u: any) => u.id === data.id);
  if (rec) {
    Object.assign(rec, { name: data.name, firstName: data.firstName, username: data.username, avatarUrl: data.avatarUrl });
  } else {
    db.botUser.push({ ...data });
  }
  await saveDb();
}

export async function userExists(platform: string, userId: string): Promise<boolean> {
  const db = await getDb();
  return db.botUser.some((u: any) => u.id === userId);
}

export async function userSessionExists(userId: string, platform: string, sessionId: string, botUserId: string): Promise<boolean> {
  const db = await getDb();
  const pid = toPlatformNumericId(platform);
  return db.botUserSession.some((us: any) => us.userId === userId && us.platformId === pid && us.sessionId === sessionId && us.botUserId === botUserId);
}

export async function upsertUserSession(userId: string, platform: string, sessionId: string, botUserId: string): Promise<void> {
  const db = await getDb();
  const pid = toPlatformNumericId(platform);
  const now = new Date().toISOString();
  const rec = db.botUserSession.find((us: any) => us.userId === userId && us.platformId === pid && us.sessionId === sessionId && us.botUserId === botUserId);
  if (!rec) {
    // First encounter — create the row with lastUpdatedAt so the middleware has a baseline timestamp.
    db.botUserSession.push({ userId, platformId: pid, sessionId, botUserId, lastUpdatedAt: now });
    await saveDb();
  } else {
    // Re-sync — update lastUpdatedAt so subsequent staleness checks see the fresh timestamp.
    rec.lastUpdatedAt = now;
    await saveDb();
  }
}

/**
 * Returns the lastUpdatedAt timestamp for a (session × user) pair, or null when no row exists.
 * The JSON adapter stores timestamps as ISO strings; they are parsed to Date here so the
 * middleware can compare them uniformly regardless of which adapter is active.
 */
export async function getUserSessionUpdatedAt(
  userId: string, platform: string, sessionId: string, botUserId: string,
): Promise<Date | null> {
  const db = await getDb();
  const pid = toPlatformNumericId(platform);
  const rec = db.botUserSession.find(
    (us: any) => us.userId === userId && us.platformId === pid && us.sessionId === sessionId && us.botUserId === botUserId,
  );
  if (!rec?.lastUpdatedAt) return null;
  return new Date(rec.lastUpdatedAt as string);
}

// WHY: Fulfills the fallback requirement directly at the DB layer so callers never handle undefined.
export async function getUserName(userId: string): Promise<string> {
  const db = await getDb();
  const rec = db.botUser.find((u: any) => u.id === userId);
  return rec?.name ?? 'Unknown user';
}

/**
 * Reads the JSON data blob for a specific bot_users_session record.
 * Returns empty object on missing record, null data, or parse failure — same fail-open
 * contract as the Prisma adapter so collection callers never need to guard against undefined.
 */
export async function getUserSessionData(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<Record<string, unknown>> {
  const db = await getDb();
  const pid = toPlatformNumericId(platform);
  const rec = db.botUserSession.find(
    (us: any) => us.userId === userId && us.platformId === pid && us.sessionId === sessionId && us.botUserId === botUserId,
  );
  if (!rec?.data) return {};
  try { return JSON.parse(rec.data as string) as Record<string, unknown>; }
  catch { return {}; }
}

/**
 * Writes the JSON data blob for a specific bot_users_session record.
 * Silently skips when the record is absent — mirrors updateMany no-op behaviour in the Prisma adapter.
 */
export async function setUserSessionData(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const db = await getDb();
  const pid = toPlatformNumericId(platform);
  const rec = db.botUserSession.find(
    (us: any) => us.userId === userId && us.platformId === pid && us.sessionId === sessionId && us.botUserId === botUserId,
  );
  if (rec) {
    rec.data = JSON.stringify(data);
    await saveDb();
  }
}

/**
 * Returns all bot_users_session records for a given (userId, platform, sessionId) tuple.
 * Used by the rank command to sort all users by EXP and compute leaderboard position.
 */
export async function getAllUserSessionData(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<Array<{ botUserId: string; data: Record<string, unknown> }>> {
  const db = await getDb();
  const pid = toPlatformNumericId(platform);
  return db.botUserSession
    .filter((us: any) => us.userId === userId && us.platformId === pid && us.sessionId === sessionId)
    .map((us: any) => {
      let data: Record<string, unknown> = {};
      try { if (us.data) data = JSON.parse(us.data as string) as Record<string, unknown>; }
      catch { /* malformed JSON — default to empty object */ }
      return { botUserId: us.botUserId as string, data };
    });
}
