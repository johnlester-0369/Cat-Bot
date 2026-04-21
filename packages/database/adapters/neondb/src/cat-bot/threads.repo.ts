import { pool } from '../client.js';
import type { BotThreadData } from '@cat-bot/engine/models/threads.model.js';
import { toPlatformNumericId } from '@cat-bot/engine/modules/platform/platform-id.util.js';

export async function upsertThread(data: BotThreadData): Promise<void> {
  const allUserIds = Array.from(
    new Set([...data.participantIDs, ...data.adminIDs]),
  );

  // ATOMICITY — why BEGIN/COMMIT is mandatory here:
  // Prisma's botThread.upsert with `participants: { set: [...] }` executes the implicit-M:M
  // junction DELETE+INSERT inside a single DB transaction automatically. Reproducing that
  // semantic in raw SQL requires explicit BEGIN/COMMIT: without it, a concurrent
  // isThreadAdmin() read arriving between the DELETE and the INSERT sees an empty admin set
  // and incorrectly returns false for every member — observable in high-traffic bursts.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Ghost user rows — satisfy bot_thread_participants / bot_thread_admins FK constraints
    // before the junction inserts run within this same transaction.
    //
    // Each ghost row needs TWO unique $N slots: one for platformId and one for userId.
    // platformId repeats but still needs its own $N per row because pg maps $N to a flat
    // params array `[plat, id0, plat, id1, …]`; sharing $1 would bind only the first slot.
    // Template: $${i*2+1} emits "$1","$3","$5"… for platformId; $${i*2+2} emits "$2","$4","$6"…
    // for userId — first $ is literal, ${expr} is JS interpolation producing the slot number.
    // Contrast with bot-session-commands where $1/$2/$3 ARE reused across rows — valid there
    // because userId/platformId/sessionId are genuinely shared constants, not per-row scalars.
    if (allUserIds.length > 0) {
      const placeholders = allUserIds
        .map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2}, 'Unknown User')`)
        .join(', ');
      const params = allUserIds.flatMap((id) => [data.platformId, id]);
      await client.query(
        `INSERT INTO bot_users (platform_id, id, name) VALUES ${placeholders}
         ON CONFLICT (id) DO NOTHING`,
        params,
      );
    }

    // Upsert the thread itself
    await client.query(
      `INSERT INTO bot_threads (platform_id, id, name, is_group, member_count, avatar_url, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         is_group = EXCLUDED.is_group,
         member_count = EXCLUDED.member_count,
         avatar_url = EXCLUDED.avatar_url,
         updated_at = NOW()`,
      [
        data.platformId,
        data.id,
        data.name,
        data.isGroup,
        data.memberCount,
        data.avatarUrl,
      ],
    );

    // Atomically replace participants and admins M:M sets — DELETE+INSERT is the standard
    // SQL equivalent of Prisma's { set: [...] } which replaces the full junction set in one TX.
    // $1 = threadId (shared constant across all rows); $${i+2} emits "$2","$3"… for each userId.
    await client.query(
      `DELETE FROM bot_thread_participants WHERE thread_id = $1`,
      [data.id],
    );
    if (data.participantIDs.length > 0) {
      const pValues = data.participantIDs
        .map((_, i) => `($1, $${i + 2})`)
        .join(', ');
      await client.query(
        `INSERT INTO bot_thread_participants (thread_id, user_id) VALUES ${pValues} ON CONFLICT DO NOTHING`,
        [data.id, ...data.participantIDs],
      );
    }

    await client.query(`DELETE FROM bot_thread_admins WHERE thread_id = $1`, [
      data.id,
    ]);
    if (data.adminIDs.length > 0) {
      const aValues = data.adminIDs.map((_, i) => `($1, $${i + 2})`).join(', ');
      await client.query(
        `INSERT INTO bot_thread_admins (thread_id, user_id) VALUES ${aValues} ON CONFLICT DO NOTHING`,
        [data.id, ...data.adminIDs],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function threadExists(
  _platform: string,
  threadId: string,
): Promise<boolean> {
  // _platform is intentionally unused — threadId is the globally unique key across all
  // platforms (each platform adapter generates platform-namespaced IDs). Filtering by
  // platform would require a JOIN to bot_threads.platform_id which adds cost with no gain.
  // Mirrors prisma-sqlite: findUnique({ where: { id: threadId } }) also ignores platform.
  const res = await pool.query(`SELECT 1 FROM bot_threads WHERE id = $1`, [
    threadId,
  ]);
  return (res.rowCount ?? 0) > 0;
}

export async function threadSessionExists(
  userId: string,
  platform: string,
  sessionId: string,
  threadId: string,
): Promise<boolean> {
  const platformId = toPlatformNumericId(platform);
  const res = await pool.query(
    `SELECT 1 FROM bot_threads_session
     WHERE user_id = $1 AND platform_id = $2 AND session_id = $3 AND bot_thread_id = $4`,
    [userId, platformId, sessionId, threadId],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function upsertThreadSession(
  userId: string,
  platform: string,
  sessionId: string,
  threadId: string,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  // Always set last_updated_at = NOW() on conflict — unlike Prisma's @updatedAt, PostgreSQL
  // does not auto-stamp on UPDATE so the explicit assignment is required for staleness checks.
  await pool.query(
    `INSERT INTO bot_threads_session (user_id, platform_id, session_id, bot_thread_id, last_updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id, platform_id, session_id, bot_thread_id)
     DO UPDATE SET last_updated_at = NOW()`,
    [userId, platformId, sessionId, threadId],
  );
}

/**
 * Returns the lastUpdatedAt timestamp for staleness checks in on-chat.middleware.
 * Returns null when no session row exists — signals middleware to trigger a full sync.
 */
export async function getThreadSessionUpdatedAt(
  userId: string,
  platform: string,
  sessionId: string,
  threadId: string,
): Promise<Date | null> {
  const platformId = toPlatformNumericId(platform);
  const res = await pool.query<{ last_updated_at: Date }>(
    `SELECT last_updated_at FROM bot_threads_session
     WHERE user_id = $1 AND platform_id = $2 AND session_id = $3 AND bot_thread_id = $4`,
    [userId, platformId, sessionId, threadId],
  );
  return res.rows[0]?.last_updated_at ?? null;
}

export async function isThreadAdmin(
  threadId: string,
  userId: string,
): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM bot_thread_admins WHERE thread_id = $1 AND user_id = $2`,
    [threadId, userId],
  );
  return (res.rowCount ?? 0) > 0;
}

/** Returns 'Unknown thread' when the thread has not been synced yet — safe fallback for display purposes. */
export async function getThreadName(threadId: string): Promise<string> {
  const res = await pool.query<{ name: string | null }>(
    `SELECT name FROM bot_threads WHERE id = $1`,
    [threadId],
  );
  return res.rows[0]?.name ?? 'Unknown thread';
}

// ── Thread Session Data ────────────────────────────────────────────────────────

/**
 * Reads the JSON data blob for a bot_threads_session row.
 * Returns an empty object on missing row, null data, or parse failure —
 * callers always receive a safe default so collection operations never throw on first access.
 */
export async function getThreadSessionData(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
): Promise<Record<string, unknown>> {
  const platformId = toPlatformNumericId(platform);
  const res = await pool.query<{ data: string | null }>(
    `SELECT data FROM bot_threads_session
     WHERE user_id = $1 AND platform_id = $2 AND session_id = $3 AND bot_thread_id = $4`,
    [userId, platformId, sessionId, botThreadId],
  );
  if (!res.rows[0]?.data) return {};
  try {
    return JSON.parse(res.rows[0].data) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Writes the JSON data blob. UPDATE with no matching row is a silent no-op —
 * mirrors updateMany's fail-open contract; avoids an error if upsertThreadSession races.
 */
export async function setThreadSessionData(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  await pool.query(
    `UPDATE bot_threads_session SET data = $5
     WHERE user_id = $1 AND platform_id = $2 AND session_id = $3 AND bot_thread_id = $4`,
    [userId, platformId, sessionId, botThreadId, JSON.stringify(data)],
  );
}

/**
 * Returns all group thread IDs for a (userId, platform, sessionId) tuple.
 * JOIN to bot_threads filters to group=true so broadcast commands only reach group chats.
 */
export async function getAllGroupThreadIds(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<string[]> {
  const platformId = toPlatformNumericId(platform);
  const res = await pool.query<{ bot_thread_id: string }>(
    `SELECT bts.bot_thread_id
     FROM bot_threads_session bts
     INNER JOIN bot_threads bt ON bt.id = bts.bot_thread_id
     WHERE bts.user_id = $1 AND bts.platform_id = $2 AND bts.session_id = $3
       AND bt.is_group = TRUE`,
    [userId, platformId, sessionId],
  );
  return res.rows.map((r) => r.bot_thread_id);
}
