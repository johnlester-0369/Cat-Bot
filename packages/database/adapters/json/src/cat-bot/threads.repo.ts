import { getDb, saveDb } from '../store.js';
import type { BotThreadData } from '@cat-bot/engine/models/threads.model.js';
import { toPlatformNumericId } from '@cat-bot/engine/modules/platform/platform-id.util.js';

export async function upsertThread(data: BotThreadData): Promise<void> {
  const db = await getDb();
  const rec = db.botThread.find((t: any) => t.id === data.id);
  if (rec) {
    Object.assign(rec, {
      name: data.name,
      isGroup: data.isGroup,
      memberCount: data.memberCount,
      avatarUrl: data.avatarUrl,
      participants: data.participantIDs,
      admins: data.adminIDs,
    });
  } else {
    db.botThread.push({
      platformId: data.platformId,
      id: data.id,
      name: data.name,
      isGroup: data.isGroup,
      memberCount: data.memberCount,
      avatarUrl: data.avatarUrl,
      participants: data.participantIDs,
      admins: data.adminIDs,
    });
  }
  await saveDb();
}

export async function threadExists(
  platform: string,
  threadId: string,
): Promise<boolean> {
  const db = await getDb();
  return db.botThread.some((t: any) => t.id === threadId);
}

export async function threadSessionExists(
  userId: string,
  platform: string,
  sessionId: string,
  threadId: string,
): Promise<boolean> {
  const db = await getDb();
  const pid = toPlatformNumericId(platform);
  return db.botThreadSession.some(
    (ts: any) =>
      ts.userId === userId &&
      ts.platformId === pid &&
      ts.sessionId === sessionId &&
      ts.botThreadId === threadId,
  );
}

export async function upsertThreadSession(
  userId: string,
  platform: string,
  sessionId: string,
  threadId: string,
): Promise<void> {
  const db = await getDb();
  const pid = toPlatformNumericId(platform);
  const now = new Date().toISOString();
  const rec = db.botThreadSession.find(
    (ts: any) =>
      ts.userId === userId &&
      ts.platformId === pid &&
      ts.sessionId === sessionId &&
      ts.botThreadId === threadId,
  );
  if (!rec) {
    // First encounter — create the row with lastUpdatedAt so the middleware has a baseline timestamp.
    db.botThreadSession.push({
      userId,
      platformId: pid,
      sessionId,
      botThreadId: threadId,
      lastUpdatedAt: now,
    });
    await saveDb();
  } else {
    // Re-sync — update lastUpdatedAt so subsequent staleness checks see the fresh timestamp.
    rec.lastUpdatedAt = now;
    await saveDb();
  }
}

/**
 * Returns the lastUpdatedAt timestamp for a (session × thread) pair, or null when no row exists.
 * The JSON adapter stores timestamps as ISO strings; they are parsed to Date here so the
 * middleware can compare them uniformly regardless of which adapter is active.
 */
export async function getThreadSessionUpdatedAt(
  userId: string,
  platform: string,
  sessionId: string,
  threadId: string,
): Promise<Date | null> {
  const db = await getDb();
  const pid = toPlatformNumericId(platform);
  const rec = db.botThreadSession.find(
    (ts: any) =>
      ts.userId === userId &&
      ts.platformId === pid &&
      ts.sessionId === sessionId &&
      ts.botThreadId === threadId,
  );
  if (!rec?.lastUpdatedAt) return null;
  return new Date(rec.lastUpdatedAt as string);
}

export async function isThreadAdmin(
  threadId: string,
  userId: string,
): Promise<boolean> {
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
    (ts: any) =>
      ts.userId === userId &&
      ts.platformId === pid &&
      ts.sessionId === sessionId &&
      ts.botThreadId === botThreadId,
  );
  if (!rec?.data) return {};
  try {
    return JSON.parse(rec.data as string) as Record<string, unknown>;
  } catch {
    return {};
  }
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
    (ts: any) =>
      ts.userId === userId &&
      ts.platformId === pid &&
      ts.sessionId === sessionId &&
      ts.botThreadId === botThreadId,
  );
  if (rec) {
    rec.data = JSON.stringify(data);
    await saveDb();
  }
}

/**
 * Returns all group thread IDs for a given (userId, platform, sessionId) tuple.
 * Two-step query: collect botThreadIds from bot_threads_session, then cross-reference
 * bot_threads to keep only entries where isGroup=true.
 * Used by /sendnoti so broadcast only reaches group chats, never 1:1 DM threads.
 */
export async function getAllGroupThreadIds(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<string[]> {
  const db = await getDb();
  const pid = toPlatformNumericId(platform);
  // Step 1 — gather every thread ID this session has ever encountered
  const sessionThreadIds: string[] = (db.botThreadSession as any[])
    .filter(
      (ts) =>
        ts.userId === userId &&
        ts.platformId === pid &&
        ts.sessionId === sessionId,
    )
    .map((ts) => ts.botThreadId as string);
  // Step 2 — filter to group-only threads using the shared bot_threads source-of-truth table
  return sessionThreadIds.filter((threadId) => {
    const thread = (db.botThread as any[]).find((t) => t.id === threadId);
    return thread?.isGroup === true;
  });
}

// ── Discord Server Support ──────────────────────────────────────────────────

export async function upsertDiscordServer(data: any): Promise<void> {
  const db = await getDb();
  const rec = db.botDiscordServer.find((s: any) => s.id === data.id);
  if (rec) {
    Object.assign(rec, {
      name: data.name,
      avatarUrl: data.avatarUrl,
      memberCount: data.memberCount,
      participants: data.participantIDs,
      admins: data.adminIDs,
    });
  } else {
    db.botDiscordServer.push({
      id: data.id,
      name: data.name,
      avatarUrl: data.avatarUrl,
      memberCount: data.memberCount,
      participants: data.participantIDs,
      admins: data.adminIDs,
    });
  }
  await saveDb();
}

export async function linkDiscordChannel(
  serverId: string,
  threadId: string,
): Promise<void> {
  const db = await getDb();
  const rec = db.botDiscordChannel.find((c: any) => c.threadId === threadId);
  if (rec) {
    rec.serverId = serverId;
  } else {
    db.botDiscordChannel.push({ serverId, threadId });
  }
  await saveDb();
}

export async function getDiscordServerIdByChannel(
  threadId: string,
): Promise<string | null> {
  const db = await getDb();
  const rec = db.botDiscordChannel.find((c: any) => c.threadId === threadId);
  return rec?.serverId ?? null;
}

export async function upsertDiscordServerSession(
  userId: string,
  sessionId: string,
  serverId: string,
): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  const rec = db.botDiscordServerSession.find(
    (s: any) =>
      s.userId === userId &&
      s.sessionId === sessionId &&
      s.botServerId === serverId,
  );
  if (!rec) {
    db.botDiscordServerSession.push({
      userId,
      sessionId,
      botServerId: serverId,
      lastUpdatedAt: now,
    });
  } else {
    rec.lastUpdatedAt = now;
  }
  await saveDb();
}

export async function getDiscordServerSessionUpdatedAt(
  userId: string,
  sessionId: string,
  serverId: string,
): Promise<Date | null> {
  const db = await getDb();
  const rec = db.botDiscordServerSession.find(
    (s: any) =>
      s.userId === userId &&
      s.sessionId === sessionId &&
      s.botServerId === serverId,
  );
  if (!rec?.lastUpdatedAt) return null;
  return new Date(rec.lastUpdatedAt as string);
}

export async function getDiscordServerSessionData(
  userId: string,
  sessionId: string,
  serverId: string,
): Promise<Record<string, unknown>> {
  const db = await getDb();
  const rec = db.botDiscordServerSession.find(
    (s: any) =>
      s.userId === userId &&
      s.sessionId === sessionId &&
      s.botServerId === serverId,
  );
  if (!rec?.data) return {};
  try {
    return JSON.parse(rec.data as string) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function setDiscordServerSessionData(
  userId: string,
  sessionId: string,
  serverId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const db = await getDb();
  const rec = db.botDiscordServerSession.find(
    (s: any) =>
      s.userId === userId &&
      s.sessionId === sessionId &&
      s.botServerId === serverId,
  );
  if (rec) {
    rec.data = JSON.stringify(data);
    await saveDb();
  }
}

export async function isDiscordServerAdmin(
  serverId: string,
  userId: string,
): Promise<boolean> {
  const db = await getDb();
  const rec = db.botDiscordServer.find((s: any) => s.id === serverId);
  return rec ? rec.admins.includes(userId) : false;
}

export async function getDiscordServerName(serverId: string): Promise<string> {
  const db = await getDb();
  const rec = db.botDiscordServer.find((s: any) => s.id === serverId);
  return rec?.name ?? 'Unknown server';
}

export async function getAllDiscordServerIds(
  userId: string,
  sessionId: string,
): Promise<string[]> {
  const db = await getDb();
  const rows = db.botDiscordServerSession.filter(
    (s: any) => s.userId === userId && s.sessionId === sessionId,
  );
  return rows.map((r: any) => r.botServerId);
}

export async function discordServerExists(serverId: string): Promise<boolean> {
  const db = await getDb();
  return db.botDiscordServer.some((s: any) => s.id === serverId);
}

export async function discordServerSessionExists(
  userId: string,
  sessionId: string,
  serverId: string,
): Promise<boolean> {
  const db = await getDb();
  return db.botDiscordServerSession.some(
    (s: any) =>
      s.userId === userId &&
      s.sessionId === sessionId &&
      s.botServerId === serverId,
  );
}
