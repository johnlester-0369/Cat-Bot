import { pool } from '../client.js';
import type { BotUserData } from '@cat-bot/engine/models/users.model.js';
import { toPlatformNumericId } from '@cat-bot/engine/modules/platform/platform-id.util.js';

export async function upsertUser(data: BotUserData): Promise<void> {
  await pool.query(
    `INSERT INTO bot_users (platform_id, id, name, first_name, username, avatar_url, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       first_name = EXCLUDED.first_name,
       username = EXCLUDED.username,
       avatar_url = EXCLUDED.avatar_url,
       updated_at = NOW()`,
    [
      data.platformId,
      data.id,
      data.name,
      data.firstName ?? null,
      data.username ?? null,
      data.avatarUrl ?? null,
    ],
  );
}

export async function userExists(
  platform: string,
  userId: string,
): Promise<boolean> {
  const res = await pool.query(`SELECT 1 FROM bot_users WHERE id = $1`, [
    userId,
  ]);
  return (res.rowCount ?? 0) > 0;
}

export async function userSessionExists(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<boolean> {
  const platformId = toPlatformNumericId(platform);
  const res = await pool.query(
    `SELECT 1 FROM bot_users_session
     WHERE user_id = $1 AND platform_id = $2 AND session_id = $3 AND bot_user_id = $4`,
    [userId, platformId, sessionId, botUserId],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function upsertUserSession(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  // Explicit last_updated_at = NOW() on conflict mirrors the fix in prisma-sqlite's upsertUserSession:
  // Prisma's @updatedAt only fires when a field is written; raw SQL requires the same explicit stamp.
  await pool.query(
    `INSERT INTO bot_users_session (user_id, platform_id, session_id, bot_user_id, last_updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id, platform_id, session_id, bot_user_id)
     DO UPDATE SET last_updated_at = NOW()`,
    [userId, platformId, sessionId, botUserId],
  );
}

/**
 * Returns the lastUpdatedAt timestamp for staleness checks. Returns null when no row exists,
 * signalling middleware that a full user sync is required on the next message.
 */
export async function getUserSessionUpdatedAt(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<Date | null> {
  const platformId = toPlatformNumericId(platform);
  const res = await pool.query<{ last_updated_at: Date }>(
    `SELECT last_updated_at FROM bot_users_session
     WHERE user_id = $1 AND platform_id = $2 AND session_id = $3 AND bot_user_id = $4`,
    [userId, platformId, sessionId, botUserId],
  );
  return res.rows[0]?.last_updated_at ?? null;
}

/** Returns 'Unknown user' when the user has not been synced yet — safe fallback for display. */
export async function getUserName(userId: string): Promise<string> {
  const res = await pool.query<{ name: string }>(
    `SELECT name FROM bot_users WHERE id = $1`,
    [userId],
  );
  return res.rows[0]?.name ?? 'Unknown user';
}

/**
 * Reads the JSON data blob for a bot_users_session row.
 * Returns an empty object on missing row, null data, or parse failure.
 */
export async function getUserSessionData(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<Record<string, unknown>> {
  const platformId = toPlatformNumericId(platform);
  const res = await pool.query<{ data: string | null }>(
    `SELECT data FROM bot_users_session
     WHERE user_id = $1 AND platform_id = $2 AND session_id = $3 AND bot_user_id = $4`,
    [userId, platformId, sessionId, botUserId],
  );
  if (!res.rows[0]?.data) return {};
  try {
    return JSON.parse(res.rows[0].data) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Writes the JSON data blob. UPDATE with no matching row is a silent no-op.
 */
export async function setUserSessionData(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  await pool.query(
    `UPDATE bot_users_session SET data = $5
     WHERE user_id = $1 AND platform_id = $2 AND session_id = $3 AND bot_user_id = $4`,
    [userId, platformId, sessionId, botUserId, JSON.stringify(data)],
  );
}

/**
 * Returns all bot_users_session records with parsed data blobs.
 * Used by the rank command to sort all users by EXP and compute leaderboard position.
 */
export async function getAllUserSessionData(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<Array<{ botUserId: string; data: Record<string, unknown> }>> {
  const platformId = toPlatformNumericId(platform);
  const res = await pool.query<{ bot_user_id: string; data: string | null }>(
    `SELECT bot_user_id, data FROM bot_users_session
     WHERE user_id = $1 AND platform_id = $2 AND session_id = $3`,
    [userId, platformId, sessionId],
  );
  return res.rows.map((row) => {
    let data: Record<string, unknown> = {};
    if (row.data) {
      try {
        data = JSON.parse(row.data) as Record<string, unknown>;
      } catch {
        /* malformed JSON — default to empty object */
      }
    }
    return { botUserId: row.bot_user_id, data };
  });
}
