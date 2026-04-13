import { getMongoDb } from '../client.js';
import { toPlatformNumericId } from '@cat-bot/engine/modules/platform/platform-id.util.js';

// ── User Bans ─────────────────────────────────────────────────────────────────

/**
 * Bans a user. Upserts so calling ban twice is idempotent; reason is updated on re-ban.
 */
export async function banUser(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
  reason?: string,
): Promise<void> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  await db.collection('botUserBanned').updateOne(
    { userId, platformId, sessionId, botUserId },
    { $set: { userId, platformId, sessionId, botUserId, isBanned: true, reason: reason ?? null } },
    { upsert: true },
  );
}

/**
 * Lifts a user ban. Sets isBanned=false so the reason row is preserved for audit history.
 */
export async function unbanUser(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<void> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  // updateOne no-ops when the document is absent — mirrors Prisma updateMany fail-open contract.
  await db.collection('botUserBanned').updateOne(
    { userId, platformId, sessionId, botUserId },
    { $set: { isBanned: false } },
  );
}

/**
 * Returns true when the user is actively banned. Fail-open on any DB error.
 */
export async function isUserBanned(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<boolean> {
  try {
    const db = getMongoDb();
    const platformId = toPlatformNumericId(platform);
    const rec = await db
      .collection<{ isBanned: boolean }>('botUserBanned')
      .findOne({ userId, platformId, sessionId, botUserId }, { projection: { isBanned: 1, _id: 0 } });
    return rec?.isBanned ?? false;
  } catch {
    return false;
  }
}

// ── Thread Bans ───────────────────────────────────────────────────────────────

/** Bans a thread. Idempotent — reason is updated on re-ban. */
export async function banThread(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
  reason?: string,
): Promise<void> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  await db.collection('botThreadBanned').updateOne(
    { userId, platformId, sessionId, botThreadId },
    { $set: { userId, platformId, sessionId, botThreadId, isBanned: true, reason: reason ?? null } },
    { upsert: true },
  );
}

/** Lifts a thread ban. Preserves the row so reason is retained for audit. */
export async function unbanThread(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
): Promise<void> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  await db.collection('botThreadBanned').updateOne(
    { userId, platformId, sessionId, botThreadId },
    { $set: { isBanned: false } },
  );
}

/** Returns true when the thread is actively banned. Fail-open on DB error. */
export async function isThreadBanned(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
): Promise<boolean> {
  try {
    const db = getMongoDb();
    const platformId = toPlatformNumericId(platform);
    const rec = await db
      .collection<{ isBanned: boolean }>('botThreadBanned')
      .findOne({ userId, platformId, sessionId, botThreadId }, { projection: { isBanned: 1, _id: 0 } });
    return rec?.isBanned ?? false;
  } catch {
    return false;
  }
}