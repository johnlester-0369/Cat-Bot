import { getMongoDb } from '../client.js';
import type { BotUserData } from '@cat-bot/engine/models/users.model.js';
import { toPlatformNumericId } from '@cat-bot/engine/modules/platform/platform-id.util.js';

export async function upsertUser(data: BotUserData): Promise<void> {
  const db = getMongoDb();
  await db.collection('botUsers').updateOne(
    { id: data.id },
    {
      $set: {
        name: data.name,
        firstName: data.firstName,
        username: data.username,
        avatarUrl: data.avatarUrl,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        platformId: data.platformId,
        id: data.id,
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );
}

export async function userExists(
  platform: string,
  userId: string,
): Promise<boolean> {
  const db = getMongoDb();
  const rec = await db
    .collection('botUsers')
    .findOne({ id: userId }, { projection: { _id: 1 } });
  return rec !== null;
}

export async function userSessionExists(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<boolean> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  const rec = await db
    .collection('botUserSessions')
    .findOne(
      { userId, platformId, sessionId, botUserId },
      { projection: { _id: 1 } },
    );
  return rec !== null;
}

export async function upsertUserSession(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<void> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  // $set lastUpdatedAt on every upsert — if only $setOnInsert were used, the timestamp
  // would freeze at creation time and every subsequent message would be treated as stale,
  // triggering a getFullUserInfo API call on every single event.
  await db.collection('botUserSessions').updateOne(
    { userId, platformId, sessionId, botUserId },
    {
      $set: { lastUpdatedAt: new Date() },
      $setOnInsert: { userId, platformId, sessionId, botUserId },
    },
    { upsert: true },
  );
}

export async function getUserSessionUpdatedAt(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<Date | null> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  const rec = await db
    .collection<{ lastUpdatedAt: Date }>('botUserSessions')
    .findOne(
      { userId, platformId, sessionId, botUserId },
      { projection: { lastUpdatedAt: 1, _id: 0 } },
    );
  return rec?.lastUpdatedAt ?? null;
}

// WHY: Fulfills the fallback requirement directly at the DB layer so callers never handle undefined.
export async function getUserName(userId: string): Promise<string> {
  const db = getMongoDb();
  const rec = await db
    .collection<{ name: string }>('botUsers')
    .findOne({ id: userId }, { projection: { name: 1, _id: 0 } });
  return rec?.name ?? 'Unknown user';
}

/**
 * Reads the JSON data blob for a specific bot user session record.
 * Returns empty object on missing record, null data, or parse failure — same fail-open
 * contract as the other adapters so collection callers never need to guard against undefined.
 */
export async function getUserSessionData(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<Record<string, unknown>> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  const rec = await db
    .collection<{ data?: string }>('botUserSessions')
    .findOne(
      { userId, platformId, sessionId, botUserId },
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
 * Writes the JSON data blob for a specific bot user session record.
 * Silently no-ops when the record is absent — mirrors the Prisma updateMany contract.
 */
export async function setUserSessionData(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  await db
    .collection('botUserSessions')
    .updateOne(
      { userId, platformId, sessionId, botUserId },
      { $set: { data: JSON.stringify(data) } },
    );
}

/**
 * Returns all bot user session records for a given (userId, platform, sessionId) tuple,
 * with their parsed data blobs. Used by the rank command to sort all users by EXP and
 * compute a leaderboard position without a separate ranking collection.
 */
export async function getAllUserSessionData(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<Array<{ botUserId: string; data: Record<string, unknown> }>> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  const rows = await db
    .collection<{ botUserId: string; data?: string }>('botUserSessions')
    .find(
      { userId, platformId, sessionId },
      { projection: { botUserId: 1, data: 1, _id: 0 } },
    )
    .toArray();
  return rows.map((row) => {
    let parsedData: Record<string, unknown> = {};
    if (row.data) {
      try {
        parsedData = JSON.parse(row.data) as Record<string, unknown>;
      } catch {
        /* malformed JSON — default to empty object */
      }
    }
    return { botUserId: row.botUserId, data: parsedData };
  });
}
