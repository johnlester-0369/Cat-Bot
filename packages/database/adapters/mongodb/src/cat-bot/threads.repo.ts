import { getMongoDb } from '../client.js';
import type { BotThreadData } from '@cat-bot/engine/models/threads.model.js';
import { toPlatformNumericId } from '@cat-bot/engine/modules/platform/platform-id.util.js';

export async function upsertThread(data: BotThreadData): Promise<void> {
  const db = getMongoDb();
  // Store participantIDs and adminIDs as flat string arrays — the natural MongoDB document
  // shape. No join table needed; the document is self-contained and atomic on update.
  await db.collection('botThreads').updateOne(
    { id: data.id },
    {
      $set: {
        platformId: data.platformId,
        id: data.id,
        name: data.name,
        isGroup: data.isGroup,
        memberCount: data.memberCount,
        avatarUrl: data.avatarUrl,
        participantIDs: data.participantIDs,
        adminIDs: data.adminIDs,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );
}

export async function threadExists(
  platform: string,
  threadId: string,
): Promise<boolean> {
  const db = getMongoDb();
  const rec = await db
    .collection('botThreads')
    .findOne({ id: threadId }, { projection: { _id: 1 } });
  return rec !== null;
}

export async function threadSessionExists(
  userId: string,
  platform: string,
  sessionId: string,
  threadId: string,
): Promise<boolean> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  const rec = await db
    .collection('botThreadSessions')
    .findOne(
      { userId, platformId, sessionId, botThreadId: threadId },
      { projection: { _id: 1 } },
    );
  return rec !== null;
}

export async function upsertThreadSession(
  userId: string,
  platform: string,
  sessionId: string,
  threadId: string,
): Promise<void> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  // $set lastUpdatedAt on every upsert so subsequent staleness checks see the fresh timestamp.
  // Without this, a $setOnInsert-only upsert would freeze lastUpdatedAt at creation time
  // and trigger getFullThreadInfo on every single incoming message from that thread.
  await db.collection('botThreadSessions').updateOne(
    { userId, platformId, sessionId, botThreadId: threadId },
    {
      $set: { lastUpdatedAt: new Date() },
      $setOnInsert: { userId, platformId, sessionId, botThreadId: threadId },
    },
    { upsert: true },
  );
}

export async function getThreadSessionUpdatedAt(
  userId: string,
  platform: string,
  sessionId: string,
  threadId: string,
): Promise<Date | null> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  const rec = await db
    .collection<{ lastUpdatedAt: Date }>('botThreadSessions')
    .findOne(
      { userId, platformId, sessionId, botThreadId: threadId },
      { projection: { lastUpdatedAt: 1, _id: 0 } },
    );
  return rec?.lastUpdatedAt ?? null;
}

export async function isThreadAdmin(
  threadId: string,
  userId: string,
): Promise<boolean> {
  const db = getMongoDb();
  const rec = await db
    .collection<{ adminIDs: string[] }>('botThreads')
    .findOne({ id: threadId }, { projection: { adminIDs: 1, _id: 0 } });
  return rec?.adminIDs.includes(userId) ?? false;
}

// WHY: Fulfills the fallback requirement directly at the DB layer so callers never handle undefined.
export async function getThreadName(threadId: string): Promise<string> {
  const db = getMongoDb();
  const rec = await db
    .collection<{ name: string | null }>('botThreads')
    .findOne({ id: threadId }, { projection: { name: 1, _id: 0 } });
  return rec?.name ?? 'Unknown thread';
}

// ── Thread Session Data ────────────────────────────────────────────────────────

/**
 * Reads the JSON data blob for a specific bot thread session record.
 * Returns empty object on missing record, null data, or parse failure — same fail-open
 * contract as the other adapters so collection callers never need to guard against undefined.
 */
export async function getThreadSessionData(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
): Promise<Record<string, unknown>> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  const rec = await db
    .collection<{ data?: string }>('botThreadSessions')
    .findOne(
      { userId, platformId, sessionId, botThreadId },
      { projection: { data: 1, _id: 0 } },
    );
  if (!rec?.data) return {};
  try {
    return JSON.parse(rec.data) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Writes the JSON data blob for a specific bot thread session record.
 * Silently no-ops when the record is absent — mirrors the Prisma updateMany contract.
 */
export async function setThreadSessionData(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  await db
    .collection('botThreadSessions')
    .updateOne(
      { userId, platformId, sessionId, botThreadId },
      { $set: { data: JSON.stringify(data) } },
    );
}

/**
 * Returns all group thread IDs for a given (userId, platform, sessionId) tuple.
 * Two-step query: collect botThreadIds from botThreadSessions, then cross-reference
 * botThreads to keep only entries where isGroup=true.
 * Used by /sendnoti so broadcast only reaches group chats, never 1:1 DM threads.
 */
export async function getAllGroupThreadIds(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<string[]> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  // Step 1 — gather every thread ID this session has ever encountered
  const sessionRows = await db
    .collection<{ botThreadId: string }>('botThreadSessions')
    .find(
      { userId, platformId, sessionId },
      { projection: { botThreadId: 1, _id: 0 } },
    )
    .toArray();
  const threadIds = sessionRows.map((r) => r.botThreadId);
  if (threadIds.length === 0) return [];
  // Step 2 — filter to group-only threads using the canonical botThreads collection
  const groupRows = await db
    .collection<{ id: string }>('botThreads')
    .find(
      { id: { $in: threadIds }, isGroup: true },
      { projection: { id: 1, _id: 0 } },
    )
    .toArray();
  return groupRows.map((r) => r.id);
}

// ── Discord Server Support ──────────────────────────────────────────────────

export async function upsertDiscordServer(data: any): Promise<void> {
  const db = getMongoDb();
  await db.collection('botDiscordServers').updateOne(
    { id: data.id },
    {
      $set: {
        id: data.id,
        name: data.name,
        avatarUrl: data.avatarUrl,
        memberCount: data.memberCount,
        participantIDs: data.participantIDs,
        adminIDs: data.adminIDs,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );
}

export async function linkDiscordChannel(serverId: string, threadId: string): Promise<void> {
  const db = getMongoDb();
  await db.collection('botDiscordChannels').updateOne(
    { threadId },
    { $set: { serverId, threadId } },
    { upsert: true }
  );
}

export async function getDiscordServerIdByChannel(threadId: string): Promise<string | null> {
  const db = getMongoDb();
  const rec = await db.collection('botDiscordChannels').findOne({ threadId }, { projection: { serverId: 1, _id: 0 } });
  return rec?.serverId ?? null;
}

export async function upsertDiscordServerSession(userId: string, sessionId: string, serverId: string): Promise<void> {
  const db = getMongoDb();
  await db.collection('botDiscordServerSessions').updateOne(
    { userId, sessionId, botServerId: serverId },
    {
      $set: { lastUpdatedAt: new Date() },
      $setOnInsert: { userId, sessionId, botServerId: serverId },
    },
    { upsert: true }
  );
}

export async function getDiscordServerSessionUpdatedAt(userId: string, sessionId: string, serverId: string): Promise<Date | null> {
  const db = getMongoDb();
  const rec = await db.collection<{ lastUpdatedAt: Date }>('botDiscordServerSessions').findOne(
    { userId, sessionId, botServerId: serverId },
    { projection: { lastUpdatedAt: 1, _id: 0 } }
  );
  return rec?.lastUpdatedAt ?? null;
}

export async function getDiscordServerSessionData(userId: string, sessionId: string, serverId: string): Promise<Record<string, unknown>> {
  const db = getMongoDb();
  const rec = await db.collection<{ data?: string }>('botDiscordServerSessions').findOne(
    { userId, sessionId, botServerId: serverId },
    { projection: { data: 1, _id: 0 } }
  );
  if (!rec?.data) return {};
  try { return JSON.parse(rec.data) as Record<string, unknown>; } catch { return {}; }
}

export async function setDiscordServerSessionData(userId: string, sessionId: string, serverId: string, data: Record<string, unknown>): Promise<void> {
  const db = getMongoDb();
  await db.collection('botDiscordServerSessions').updateOne(
    { userId, sessionId, botServerId: serverId },
    { $set: { data: JSON.stringify(data) } }
  );
}

export async function isDiscordServerAdmin(serverId: string, userId: string): Promise<boolean> {
  const db = getMongoDb();
  const rec = await db.collection<{ adminIDs: string[] }>('botDiscordServers').findOne({ id: serverId }, { projection: { adminIDs: 1, _id: 0 } });
  return rec?.adminIDs.includes(userId) ?? false;
}

export async function getDiscordServerName(serverId: string): Promise<string> {
  const db = getMongoDb();
  const rec = await db.collection<{ name: string }>('botDiscordServers').findOne({ id: serverId }, { projection: { name: 1, _id: 0 } });
  return rec?.name ?? 'Unknown server';
}

export async function getAllDiscordServerIds(userId: string, sessionId: string): Promise<string[]> {
  const db = getMongoDb();
  const rows = await db.collection<{ botServerId: string }>('botDiscordServerSessions').find({ userId, sessionId }, { projection: { botServerId: 1, _id: 0 } }).toArray();
  return rows.map(r => r.botServerId);
}

export async function discordServerExists(serverId: string): Promise<boolean> {
  const db = getMongoDb();
  const rec = await db.collection('botDiscordServers').findOne({ id: serverId }, { projection: { _id: 1 } });
  return rec !== null;
}

export async function discordServerSessionExists(userId: string, sessionId: string, serverId: string): Promise<boolean> {
  const db = getMongoDb();
  const rec = await db.collection('botDiscordServerSessions').findOne({ userId, sessionId, botServerId: serverId }, { projection: { _id: 1 } });
  return rec !== null;
}
