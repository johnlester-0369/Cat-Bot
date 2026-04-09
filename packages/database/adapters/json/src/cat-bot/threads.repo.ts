import { getDb, saveDb } from '../store.js';
import type { BotThreadData } from '@cat-bot/engine/models/threads.model.js';
import { toPlatformNumericId } from '@cat-bot/engine/utils/platform-id.util.js';

export async function upsertThread(data: BotThreadData): Promise<void> {
  const db = await getDb();
  const rec = db.botThread.find((t: any) => t.id === data.id);
  if (rec) {
    Object.assign(rec, { name: data.name, isGroup: data.isGroup, memberCount: data.memberCount, avatarUrl: data.avatarUrl, participants: data.participantIDs, admins: data.adminIDs });
  } else {
    db.botThread.push({ platformId: data.platformId, id: data.id, name: data.name, isGroup: data.isGroup, memberCount: data.memberCount, avatarUrl: data.avatarUrl, participants: data.participantIDs, admins: data.adminIDs });
  }
  await saveDb();
}

export async function threadExists(platform: string, threadId: string): Promise<boolean> {
  const db = await getDb();
  return db.botThread.some((t: any) => t.id === threadId);
}

export async function threadSessionExists(userId: string, platform: string, sessionId: string, threadId: string): Promise<boolean> {
  const db = await getDb();
  const pid = toPlatformNumericId(platform);
  return db.botThreadSession.some((ts: any) => ts.userId === userId && ts.platformId === pid && ts.sessionId === sessionId && ts.botThreadId === threadId);
}

export async function upsertThreadSession(userId: string, platform: string, sessionId: string, threadId: string): Promise<void> {
  const db = await getDb();
  const pid = toPlatformNumericId(platform);
  const rec = db.botThreadSession.find((ts: any) => ts.userId === userId && ts.platformId === pid && ts.sessionId === sessionId && ts.botThreadId === threadId);
  if (!rec) { db.botThreadSession.push({ userId, platformId: pid, sessionId, botThreadId: threadId }); await saveDb(); }
}

export async function isThreadAdmin(threadId: string, userId: string): Promise<boolean> {
  const db = await getDb();
  const rec = db.botThread.find((t: any) => t.id === threadId);
  return rec ? rec.admins.includes(userId) : false;
}

// WHY: Fulfills the fallback requirement directly at the DB layer so callers never handle undefined.
export async function getThreadName(threadId: string): Promise<string> {
  const db = await getDb();
  const rec = db.botThread.find((t: any) => t.id === threadId);
  return rec?.name ?? 'Unknown thread';
}

// ── Thread Session Data ────────────────────────────────────────────────────────

/**
 * Reads the JSON data blob for a specific bot_threads_session record.
 * Returns empty object on missing record, null data, or parse failure — same fail-open
 * contract as the Prisma adapter so collection callers never need to guard against undefined.
 */
export async function getThreadSessionData(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
): Promise<Record<string, unknown>> {
  const db = await getDb();
  const pid = toPlatformNumericId(platform);
  const rec = db.botThreadSession.find(
    (ts: any) => ts.userId === userId && ts.platformId === pid && ts.sessionId === sessionId && ts.botThreadId === botThreadId,
  );
  if (!rec?.data) return {};
  try { return JSON.parse(rec.data as string) as Record<string, unknown>; }
  catch { return {}; }
}

/**
 * Writes the JSON data blob for a specific bot_threads_session record.
 * Silently skips when the record is absent — mirrors updateMany no-op behaviour in the Prisma adapter.
 */
export async function setThreadSessionData(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const db = await getDb();
  const pid = toPlatformNumericId(platform);
  const rec = db.botThreadSession.find(
    (ts: any) => ts.userId === userId && ts.platformId === pid && ts.sessionId === sessionId && ts.botThreadId === botThreadId,
  );
  if (rec) {
    rec.data = JSON.stringify(data);
    await saveDb();
  }
}
