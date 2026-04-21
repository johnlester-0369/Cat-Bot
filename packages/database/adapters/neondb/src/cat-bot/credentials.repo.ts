import { pool } from '../client.js';
import {
  Platforms,
  PLATFORM_TO_ID,
} from '@cat-bot/engine/modules/platform/platform.constants.js';
import { toPlatformNumericId } from '@cat-bot/engine/modules/platform/platform-id.util.js';
import { decrypt } from '@cat-bot/engine/utils/crypto.util.js';

// ── Discord ───────────────────────────────────────────────────────────────────

export async function findDiscordCredentialState(
  userId: string,
  sessionId: string,
): Promise<{ isCommandRegister: boolean; commandHash: string | null } | null> {
  const res = await pool.query<{
    is_command_register: boolean;
    command_hash: string | null;
  }>(
    `SELECT is_command_register, command_hash FROM bot_credential_discord
     WHERE user_id = $1 AND platform_id = $2 AND session_id = $3`,
    [userId, PLATFORM_TO_ID[Platforms.Discord], sessionId],
  );
  if (!res.rows[0]) return null;
  const r = res.rows[0];
  return {
    isCommandRegister: r.is_command_register,
    commandHash: r.command_hash,
  };
}

export async function updateDiscordCredentialCommandHash(
  userId: string,
  sessionId: string,
  data: { isCommandRegister: boolean; commandHash: string },
): Promise<void> {
  // UPDATE throws implicitly on missing row via rowCount check — mirrors Prisma update() P2025.
  const res = await pool.query(
    `UPDATE bot_credential_discord
     SET is_command_register = $4, command_hash = $5
     WHERE user_id = $1 AND platform_id = $2 AND session_id = $3`,
    [
      userId,
      PLATFORM_TO_ID[Platforms.Discord],
      sessionId,
      data.isCommandRegister,
      data.commandHash,
    ],
  );
  if (res.rowCount === 0) throw new Error('Credential record not found');
}

export async function findAllDiscordCredentials(): Promise<
  Record<string, unknown>[]
> {
  const res = await pool.query<{
    user_id: string;
    platform_id: number;
    session_id: string;
    discord_token: string;
    discord_client_id: string;
    is_command_register: boolean;
    command_hash: string | null;
  }>(`SELECT user_id, platform_id, session_id, discord_token, discord_client_id,
             is_command_register, command_hash
      FROM bot_credential_discord`);
  return res.rows.map((r) => ({
    userId: r.user_id,
    platformId: r.platform_id,
    sessionId: r.session_id,
    discordToken: decrypt(r.discord_token),
    discordClientId: r.discord_client_id,
    isCommandRegister: r.is_command_register,
    commandHash: r.command_hash,
  }));
}

// ── Telegram ──────────────────────────────────────────────────────────────────

export async function findTelegramCredentialState(
  userId: string,
  sessionId: string,
): Promise<{ isCommandRegister: boolean; commandHash: string | null } | null> {
  const res = await pool.query<{
    is_command_register: boolean;
    command_hash: string | null;
  }>(
    `SELECT is_command_register, command_hash FROM bot_credential_telegram
     WHERE user_id = $1 AND platform_id = $2 AND session_id = $3`,
    [userId, PLATFORM_TO_ID[Platforms.Telegram], sessionId],
  );
  if (!res.rows[0]) return null;
  const r = res.rows[0];
  return {
    isCommandRegister: r.is_command_register,
    commandHash: r.command_hash,
  };
}

export async function updateTelegramCredentialCommandHash(
  userId: string,
  sessionId: string,
  data: { isCommandRegister: boolean; commandHash: string },
): Promise<void> {
  const res = await pool.query(
    `UPDATE bot_credential_telegram
     SET is_command_register = $4, command_hash = $5
     WHERE user_id = $1 AND platform_id = $2 AND session_id = $3`,
    [
      userId,
      PLATFORM_TO_ID[Platforms.Telegram],
      sessionId,
      data.isCommandRegister,
      data.commandHash,
    ],
  );
  if (res.rowCount === 0) throw new Error('Credential record not found');
}

export async function findAllTelegramCredentials(): Promise<
  Record<string, unknown>[]
> {
  const res = await pool.query<{
    user_id: string;
    platform_id: number;
    session_id: string;
    telegram_token: string;
    is_command_register: boolean;
    command_hash: string | null;
  }>(`SELECT user_id, platform_id, session_id, telegram_token, is_command_register, command_hash
      FROM bot_credential_telegram`);
  return res.rows.map((r) => ({
    userId: r.user_id,
    platformId: r.platform_id,
    sessionId: r.session_id,
    telegramToken: decrypt(r.telegram_token),
    isCommandRegister: r.is_command_register,
    commandHash: r.command_hash,
  }));
}

// ── Facebook Page ──────────────────────────────────────────────────────────────

export async function findAllFbPageCredentials(): Promise<
  Record<string, unknown>[]
> {
  const res = await pool.query<{
    user_id: string;
    platform_id: number;
    session_id: string;
    fb_access_token: string;
    fb_page_id: string;
  }>(`SELECT user_id, platform_id, session_id, fb_access_token, fb_page_id
      FROM bot_credential_facebook_page`);
  return res.rows.map((r) => ({
    userId: r.user_id,
    platformId: r.platform_id,
    sessionId: r.session_id,
    fbAccessToken: decrypt(r.fb_access_token),
    fbPageId: r.fb_page_id,
  }));
}

// ── Facebook Messenger ────────────────────────────────────────────────────────

export async function findAllFbMessengerCredentials(): Promise<
  Record<string, unknown>[]
> {
  const res = await pool.query<{
    user_id: string;
    platform_id: number;
    session_id: string;
    appstate: string;
  }>(`SELECT user_id, platform_id, session_id, appstate
      FROM bot_credential_facebook_messenger`);
  return res.rows.map((r) => ({
    userId: r.user_id,
    platformId: r.platform_id,
    sessionId: r.session_id,
    appstate: decrypt(r.appstate),
  }));
}

// ── Bot Sessions ──────────────────────────────────────────────────────────────

export async function findAllBotSessions(): Promise<Record<string, unknown>[]> {
  const res = await pool.query<{
    user_id: string;
    platform_id: number;
    session_id: string;
    nickname: string | null;
    prefix: string | null;
    is_running: boolean;
  }>(`SELECT user_id, platform_id, session_id, nickname, prefix, is_running
      FROM bot_session`);
  return res.rows.map((r) => ({
    userId: r.user_id,
    platformId: r.platform_id,
    sessionId: r.session_id,
    nickname: r.nickname,
    prefix: r.prefix,
    isRunning: r.is_running,
  }));
}

// ── Bot Admin ─────────────────────────────────────────────────────────────────

export async function isBotAdmin(
  userId: string,
  platform: string,
  sessionId: string,
  adminId: string,
): Promise<boolean> {
  const platformId = toPlatformNumericId(platform);
  const res = await pool.query(
    `SELECT 1 FROM bot_admin
     WHERE user_id = $1 AND platform_id = $2 AND session_id = $3 AND admin_id = $4`,
    [userId, platformId, sessionId, adminId],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function addBotAdmin(
  userId: string,
  platform: string,
  sessionId: string,
  adminId: string,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  // ON CONFLICT DO NOTHING is the PostgreSQL equivalent of prisma-sqlite's:
  //   prisma.botAdmin.upsert({ ..., update: {} })
  // Both are idempotent: a duplicate admin insert silently no-ops without error.
  // The empty update: {} in Prisma also no-ops on conflict — DO NOTHING makes this
  // explicit and avoids the overhead of an UPDATE that writes nothing.
  await pool.query(
    `INSERT INTO bot_admin (user_id, platform_id, session_id, admin_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, platform_id, session_id, admin_id) DO NOTHING`,
    [userId, platformId, sessionId, adminId],
  );
}

export async function removeBotAdmin(
  userId: string,
  platform: string,
  sessionId: string,
  adminId: string,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  // DELETE with no row = silent no-op, matching deleteMany fail-safe contract.
  await pool.query(
    `DELETE FROM bot_admin
     WHERE user_id = $1 AND platform_id = $2 AND session_id = $3 AND admin_id = $4`,
    [userId, platformId, sessionId, adminId],
  );
}

export async function listBotAdmins(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<string[]> {
  const platformId = toPlatformNumericId(platform);
  const res = await pool.query<{ admin_id: string }>(
    `SELECT admin_id FROM bot_admin
     WHERE user_id = $1 AND platform_id = $2 AND session_id = $3
     ORDER BY admin_id`,
    [userId, platformId, sessionId],
  );
  return res.rows.map((r) => r.admin_id);
}

/**
 * Persists a system prefix change so the admin's choice survives a process restart.
 * UPDATE with no matching row is a silent no-op — same fail-open contract as updateMany.
 */
export async function updateBotSessionPrefix(
  userId: string,
  platform: string,
  sessionId: string,
  prefix: string,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  await pool.query(
    `UPDATE bot_session SET prefix = $4
     WHERE user_id = $1 AND platform_id = $2 AND session_id = $3`,
    [userId, platformId, sessionId, prefix],
  );
}

/**
 * Reads the bot's configured display name from bot_session.
 * Returns null when the session row is absent or nickname was never set.
 */
export async function getBotNickname(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<string | null> {
  const platformId = toPlatformNumericId(platform);
  const res = await pool.query<{ nickname: string | null }>(
    `SELECT nickname FROM bot_session
     WHERE user_id = $1 AND platform_id = $2 AND session_id = $3 LIMIT 1`,
    [userId, platformId, sessionId],
  );
  return res.rows[0]?.nickname ?? null;
}

// ── Bot Premium ───────────────────────────────────────────────────────────────

export async function isBotPremium(
  userId: string,
  platform: string,
  sessionId: string,
  premiumId: string,
): Promise<boolean> {
  const platformId = toPlatformNumericId(platform);
  const res = await pool.query(
    `SELECT 1 FROM bot_premium
     WHERE user_id = $1 AND platform_id = $2 AND session_id = $3 AND premium_id = $4`,
    [userId, platformId, sessionId, premiumId],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function addBotPremium(
  userId: string,
  platform: string,
  sessionId: string,
  premiumId: string,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  // ON CONFLICT DO NOTHING mirrors prisma-sqlite's upsert({ update: {} }) — idempotent
  // when the same premiumId is added twice; no error on duplicate insert.
  await pool.query(
    `INSERT INTO bot_premium (user_id, platform_id, session_id, premium_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, platform_id, session_id, premium_id) DO NOTHING`,
    [userId, platformId, sessionId, premiumId],
  );
}

export async function removeBotPremium(
  userId: string,
  platform: string,
  sessionId: string,
  premiumId: string,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  // DELETE with no matching row is a silent no-op — same fail-open contract as admin.
  await pool.query(
    `DELETE FROM bot_premium
     WHERE user_id = $1 AND platform_id = $2 AND session_id = $3 AND premium_id = $4`,
    [userId, platformId, sessionId, premiumId],
  );
}

export async function listBotPremiums(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<string[]> {
  const platformId = toPlatformNumericId(platform);
  const res = await pool.query<{ premium_id: string }>(
    `SELECT premium_id FROM bot_premium
     WHERE user_id = $1 AND platform_id = $2 AND session_id = $3
     ORDER BY premium_id`,
    [userId, platformId, sessionId],
  );
  return res.rows.map((r) => r.premium_id);
}
