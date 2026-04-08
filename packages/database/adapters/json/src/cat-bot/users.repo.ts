import { getDb, saveDb } from '../store.js';
import type { BotUserData } from '@cat-bot/engine/models/users.model.js';
import { toPlatformNumericId } from '@cat-bot/engine/utils/platform-id.util.js';

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
  const rec = db.botUserSession.find((us: any) => us.userId === userId && us.platformId === pid && us.sessionId === sessionId && us.botUserId === botUserId);
  if (!rec) { db.botUserSession.push({ userId, platformId: pid, sessionId, botUserId }); await saveDb(); }
  if (!rec) { db.botUserSession.push({ userId, platformId: pid, sessionId, botUserId }); await saveDb(); }
}

// WHY: Fulfills the fallback requirement directly at the DB layer so callers never handle undefined.
export async function getUserName(userId: string): Promise<string> {
  const db = await getDb();
  const rec = db.botUser.find((u: any) => u.id === userId);
  return rec?.name ?? 'Unknown user';
}

