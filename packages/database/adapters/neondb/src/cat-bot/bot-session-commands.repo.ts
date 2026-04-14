import { pool } from '../client.js';
import { toPlatformNumericId } from '@cat-bot/engine/modules/platform/platform-id.util.js';

export async function upsertSessionCommands(
  userId: string,
  platform: string,
  sessionId: string,
  commandNames: string[],
): Promise<void> {
  if (!commandNames.length) return;
  const platformId = toPlatformNumericId(platform);
  // Build a multi-row VALUES list for a single INSERT statement.
  //
  // $1/$2/$3 are shared pg parameter positions across every row (userId/platformId/sessionId) —
  // PostgreSQL binds the same $N to the same value everywhere it appears; reusing them is valid.
  // $4, $5, … hold commandNames[0], commandNames[1], … — each command gets its own $N slot.
  // $${i + 4}: in a JS template literal the first $ is a literal character; ${i + 4} is the JS
  // interpolation producing the slot number — together they emit the pg placeholder "$4", "$5", etc.
  // (Writing just ${i + 4} would emit bare integer "4", not the pg placeholder "$4".)
  //
  // Single-statement equivalent of prisma-sqlite's find-then-createMany.
  // ON CONFLICT DO NOTHING preserves existing isEnable=false rows (admin-disabled
  // commands are never overwritten — the skip is intentional, not a lost update).
  const values = commandNames
    .map((_, i) => `($1, $2, $3, $${i + 4}, TRUE)`)
    .join(', ');
  await pool.query(
    `INSERT INTO bot_session_commands (user_id, platform_id, session_id, command_name, is_enable)
     VALUES ${values}
     ON CONFLICT (user_id, platform_id, session_id, command_name) DO NOTHING`,
    [userId, platformId, sessionId, ...commandNames],
  );
}

export async function findSessionCommands(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<Array<{ commandName: string; isEnable: boolean }>> {
  const platformId = toPlatformNumericId(platform);
  const res = await pool.query<{ command_name: string; is_enable: boolean }>(
    `SELECT command_name, is_enable FROM bot_session_commands
     WHERE user_id = $1 AND platform_id = $2 AND session_id = $3
     ORDER BY command_name`,
    [userId, platformId, sessionId],
  );
  return res.rows.map((r) => ({ commandName: r.command_name, isEnable: r.is_enable }));
}

export async function setCommandEnabled(
  userId: string,
  platform: string,
  sessionId: string,
  commandName: string,
  isEnable: boolean,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  await pool.query(
    `INSERT INTO bot_session_commands (user_id, platform_id, session_id, command_name, is_enable)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, platform_id, session_id, command_name)
     DO UPDATE SET is_enable = EXCLUDED.is_enable`,
    [userId, platformId, sessionId, commandName, isEnable],
  );
}

export async function isCommandEnabled(
  userId: string,
  platform: string,
  sessionId: string,
  commandName: string,
): Promise<boolean> {
  try {
    const platformId = toPlatformNumericId(platform);
    const res = await pool.query<{ is_enable: boolean }>(
      `SELECT is_enable FROM bot_session_commands
       WHERE user_id = $1 AND platform_id = $2 AND session_id = $3 AND command_name = $4`,
      [userId, platformId, sessionId, commandName],
    );
    // Absent row = enabled — fail-open so a missing DB entry never silently disables commands.
    return res.rows[0]?.is_enable ?? true;
  } catch {
    return true;
  }
}
