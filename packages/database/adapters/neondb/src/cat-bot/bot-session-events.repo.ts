import { pool } from '../client.js';
import { toPlatformNumericId } from '@cat-bot/engine/modules/platform/platform-id.util.js';

export async function upsertSessionEvents(
  userId: string,
  platform: string,
  sessionId: string,
  eventNames: string[],
): Promise<void> {
  if (!eventNames.length) return;
  const platformId = toPlatformNumericId(platform);
  // Same $N reuse pattern as bot-session-commands: $1/$2/$3 are shared constants
  // (userId/platformId/sessionId) across all rows; $4, $5, … are unique per eventName —
  // $${i + 4}: the first $ is a literal "$"; ${i + 4} is JS interpolation that produces the slot
  // number — together they emit the pg placeholder "$4", "$5", etc. (bare ${i+4} would emit "4").
  // ON CONFLICT DO NOTHING preserves admin-set isEnable=false rows (same intent as
  // prisma-sqlite's find-then-createMany approach, in a single DB round trip).
  const values = eventNames
    .map((_, i) => `($1, $2, $3, $${i + 4}, TRUE)`)
    .join(', ');
  await pool.query(
    `INSERT INTO bot_session_events (user_id, platform_id, session_id, event_name, is_enable)
     VALUES ${values}
     ON CONFLICT (user_id, platform_id, session_id, event_name) DO NOTHING`,
    [userId, platformId, sessionId, ...eventNames],
  );
}

export async function findSessionEvents(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<Array<{ eventName: string; isEnable: boolean }>> {
  const platformId = toPlatformNumericId(platform);
  const res = await pool.query<{ event_name: string; is_enable: boolean }>(
    `SELECT event_name, is_enable FROM bot_session_events
     WHERE user_id = $1 AND platform_id = $2 AND session_id = $3
     ORDER BY event_name`,
    [userId, platformId, sessionId],
  );
  return res.rows.map((r) => ({ eventName: r.event_name, isEnable: r.is_enable }));
}

export async function setEventEnabled(
  userId: string,
  platform: string,
  sessionId: string,
  eventName: string,
  isEnable: boolean,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  await pool.query(
    `INSERT INTO bot_session_events (user_id, platform_id, session_id, event_name, is_enable)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, platform_id, session_id, event_name)
     DO UPDATE SET is_enable = EXCLUDED.is_enable`,
    [userId, platformId, sessionId, eventName, isEnable],
  );
}

export async function isEventEnabled(
  userId: string,
  platform: string,
  sessionId: string,
  eventName: string,
): Promise<boolean> {
  try {
    const platformId = toPlatformNumericId(platform);
    const res = await pool.query<{ is_enable: boolean }>(
      `SELECT is_enable FROM bot_session_events
       WHERE user_id = $1 AND platform_id = $2 AND session_id = $3 AND event_name = $4`,
      [userId, platformId, sessionId, eventName],
    );
    return res.rows[0]?.is_enable ?? true;
  } catch {
    return true;
  }
}
