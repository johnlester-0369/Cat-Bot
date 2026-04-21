import { pool } from '../client.js';
import { toPlatformNumericId } from '@cat-bot/engine/modules/platform/platform-id.util.js';

// ── User Bans ─────────────────────────────────────────────────────────────────

/** Bans a user. Upserts so calling ban twice is idempotent; reason is updated. */
export async function banUser(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
  reason?: string,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  await pool.query(
    `INSERT INTO bot_users_session_banned (user_id, platform_id, session_id, bot_user_id, is_banned, reason)
     VALUES ($1, $2, $3, $4, TRUE, $5)
     ON CONFLICT (user_id, platform_id, session_id, bot_user_id)
     DO UPDATE SET is_banned = TRUE, reason = EXCLUDED.reason`,
    [userId, platformId, sessionId, botUserId, reason ?? null],
  );
}

/** Lifts a user ban. Sets is_banned=FALSE so the reason row is preserved for audit. */
export async function unbanUser(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  // UPDATE instead of DELETE — preserves the reason field for audit history.
  await pool.query(
    `UPDATE bot_users_session_banned
     SET is_banned = FALSE
     WHERE user_id = $1 AND platform_id = $2 AND session_id = $3 AND bot_user_id = $4`,
    [userId, platformId, sessionId, botUserId],
  );
}

/**
 * Returns true when the user is actively banned. Fail-open: a missing row or
 * any DB error returns false so a temporary outage never locks out legitimate users.
 */
export async function isUserBanned(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<boolean> {
  try {
    const platformId = toPlatformNumericId(platform);
    const res = await pool.query<{ is_banned: boolean }>(
      `SELECT is_banned FROM bot_users_session_banned
       WHERE user_id = $1 AND platform_id = $2 AND session_id = $3 AND bot_user_id = $4`,
      [userId, platformId, sessionId, botUserId],
    );
    return res.rows[0]?.is_banned ?? false;
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
  const platformId = toPlatformNumericId(platform);
  await pool.query(
    `INSERT INTO bot_threads_session_banned (user_id, platform_id, session_id, bot_thread_id, is_banned, reason)
     VALUES ($1, $2, $3, $4, TRUE, $5)
     ON CONFLICT (user_id, platform_id, session_id, bot_thread_id)
     DO UPDATE SET is_banned = TRUE, reason = EXCLUDED.reason`,
    [userId, platformId, sessionId, botThreadId, reason ?? null],
  );
}

/** Lifts a thread ban. Preserves the row so reason is retained for audit. */
export async function unbanThread(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  await pool.query(
    `UPDATE bot_threads_session_banned
     SET is_banned = FALSE
     WHERE user_id = $1 AND platform_id = $2 AND session_id = $3 AND bot_thread_id = $4`,
    [userId, platformId, sessionId, botThreadId],
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
    const platformId = toPlatformNumericId(platform);
    const res = await pool.query<{ is_banned: boolean }>(
      `SELECT is_banned FROM bot_threads_session_banned
       WHERE user_id = $1 AND platform_id = $2 AND session_id = $3 AND bot_thread_id = $4`,
      [userId, platformId, sessionId, botThreadId],
    );
    return res.rows[0]?.is_banned ?? false;
  } catch {
    return false;
  }
}
