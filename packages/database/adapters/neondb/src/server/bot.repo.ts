import { pool } from '../client.js';
import { PLATFORM_TO_ID, ID_TO_PLATFORM, Platforms } from '@cat-bot/engine/modules/platform/platform.constants.js';
import type {
  CreateBotRequestDto,
  CreateBotResponseDto,
  GetBotListResponseDto,
  GetBotDetailResponseDto,
  UpdateBotRequestDto,
} from '@cat-bot/server/dtos/bot.dto.js';
import type { GetAdminBotListResponseDto } from '@cat-bot/server/dtos/admin.dto.js';
import { encrypt, decrypt } from '@cat-bot/engine/utils/crypto.util.js';

export class BotRepo {
  async create(
    userId: string,
    sessionId: string,
    dto: CreateBotRequestDto,
  ): Promise<CreateBotResponseDto> {
    const platformId =
      (PLATFORM_TO_ID as Record<string, number>)[dto.credentials.platform];
    if (platformId === undefined)
      throw new Error(`Unknown platform ${dto.credentials.platform}`);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // isRunning defaults to TRUE via column default, matching Prisma schema @default(true).
      await client.query(
        `INSERT INTO bot_session (user_id, platform_id, session_id, nickname, prefix)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, platformId, sessionId, dto.botNickname, dto.botPrefix],
      );

      for (const adminId of dto.botAdmins) {
        await client.query(
          `INSERT INTO bot_admin (user_id, platform_id, session_id, admin_id) VALUES ($1, $2, $3, $4)`,
          [userId, platformId, sessionId, adminId],
        );
      }
      // Premium rows are optional on input; ?? [] guards callers that omit the field.
      for (const premiumId of (dto.botPremiums ?? [])) {
        await client.query(
          `INSERT INTO bot_premium (user_id, platform_id, session_id, premium_id) VALUES ($1, $2, $3, $4)`,
          [userId, platformId, sessionId, premiumId],
        );
      }

      const { credentials } = dto;
      if (credentials.platform === Platforms.Discord) {
        await client.query(
          `INSERT INTO bot_credential_discord (user_id, platform_id, session_id, discord_token, discord_client_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, platformId, sessionId, encrypt(credentials.discordToken), credentials.discordClientId],
        );
      } else if (credentials.platform === Platforms.Telegram) {
        await client.query(
          `INSERT INTO bot_credential_telegram (user_id, platform_id, session_id, telegram_token)
           VALUES ($1, $2, $3, $4)`,
          [userId, platformId, sessionId, encrypt(credentials.telegramToken)],
        );
      } else if (credentials.platform === Platforms.FacebookPage) {
        await client.query(
          `INSERT INTO bot_credential_facebook_page (user_id, platform_id, session_id, fb_access_token, fb_page_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, platformId, sessionId, encrypt(credentials.fbAccessToken), credentials.fbPageId],
        );
      } else {
        await client.query(
          `INSERT INTO bot_credential_facebook_messenger (user_id, platform_id, session_id, appstate)
           VALUES ($1, $2, $3, $4)`,
          [userId, platformId, sessionId, encrypt(credentials.appstate)],
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return { sessionId, userId, platformId, nickname: dto.botNickname, prefix: dto.botPrefix };
  }

  async getById(
    userId: string,
    sessionId: string,
  ): Promise<GetBotDetailResponseDto | null> {
    const sessionRes = await pool.query<{
      platform_id: number; nickname: string | null; prefix: string | null;
    }>(
      `SELECT platform_id, nickname, prefix FROM bot_session
       WHERE user_id = $1 AND session_id = $2 LIMIT 1`,
      [userId, sessionId],
    );
    if (!sessionRes.rows[0]) return null;

    const sess = sessionRes.rows[0];
    const platform = (ID_TO_PLATFORM as Record<number, string>)[sess.platform_id];
    if (!platform) return null;

    const adminsRes = await pool.query<{ admin_id: string }>(
      `SELECT admin_id FROM bot_admin WHERE user_id = $1 AND session_id = $2 ORDER BY admin_id`,
      [userId, sessionId],
    );
    const premiumsRes = await pool.query<{ premium_id: string }>(
      `SELECT premium_id FROM bot_premium WHERE user_id = $1 AND session_id = $2 ORDER BY premium_id`,
      [userId, sessionId],
    );

    let credentials: GetBotDetailResponseDto['credentials'];

    if (platform === Platforms.Discord) {
      const credRes = await pool.query<{ discord_token: string; discord_client_id: string }>(
        `SELECT discord_token, discord_client_id FROM bot_credential_discord
         WHERE user_id = $1 AND session_id = $2 LIMIT 1`,
        [userId, sessionId],
      );
      if (!credRes.rows[0]) throw new Error('Missing credentials');
      credentials = {
        platform: Platforms.Discord,
        discordToken: decrypt(credRes.rows[0].discord_token),
        discordClientId: credRes.rows[0].discord_client_id,
      };
    } else if (platform === Platforms.Telegram) {
      const credRes = await pool.query<{ telegram_token: string }>(
        `SELECT telegram_token FROM bot_credential_telegram
         WHERE user_id = $1 AND session_id = $2 LIMIT 1`,
        [userId, sessionId],
      );
      if (!credRes.rows[0]) throw new Error('Missing credentials');
      credentials = { platform: Platforms.Telegram, telegramToken: decrypt(credRes.rows[0].telegram_token) };
    } else if (platform === Platforms.FacebookPage) {
      const credRes = await pool.query<{ fb_access_token: string; fb_page_id: string }>(
        `SELECT fb_access_token, fb_page_id FROM bot_credential_facebook_page
         WHERE user_id = $1 AND session_id = $2 LIMIT 1`,
        [userId, sessionId],
      );
      if (!credRes.rows[0]) throw new Error('Missing credentials');
      credentials = {
        platform: Platforms.FacebookPage,
        fbAccessToken: decrypt(credRes.rows[0].fb_access_token),
        fbPageId: credRes.rows[0].fb_page_id,
      };
    } else {
      const credRes = await pool.query<{ appstate: string }>(
        `SELECT appstate FROM bot_credential_facebook_messenger
         WHERE user_id = $1 AND session_id = $2 LIMIT 1`,
        [userId, sessionId],
      );
      if (!credRes.rows[0]) throw new Error('Missing credentials');
      credentials = { platform: Platforms.FacebookMessenger, appstate: decrypt(credRes.rows[0].appstate) };
    }

    return {
      sessionId, userId,
      platformId: sess.platform_id,
      platform,
      nickname: sess.nickname ?? '',
      prefix: sess.prefix ?? '',
      admins: adminsRes.rows.map((r) => r.admin_id),
      premiums: premiumsRes.rows.map((r) => r.premium_id),
      credentials,
    };
  }

  async update(
    userId: string,
    sessionId: string,
    dto: UpdateBotRequestDto,
    isCredentialsModified = false,
  ): Promise<void> {
    const platformId =
      (PLATFORM_TO_ID as Record<string, number>)[dto.credentials.platform];

    const sessionRes = await pool.query<{ platform_id: number }>(
      `SELECT platform_id FROM bot_session WHERE user_id = $1 AND session_id = $2 LIMIT 1`,
      [userId, sessionId],
    );
    if (!sessionRes.rows[0]) throw new Error('Bot not found');
    // Guard: platform is immutable after creation — changing it would corrupt credential FKs.
    if (sessionRes.rows[0].platform_id !== platformId)
      throw new Error('Platform cannot be changed after bot creation.');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE bot_session SET nickname = $4, prefix = $5
         WHERE user_id = $1 AND platform_id = $2 AND session_id = $3`,
        [userId, platformId, sessionId, dto.botNickname, dto.botPrefix],
      );

      // Full admin list replacement — delete all then re-insert mirrors Prisma's set: pattern.
      await client.query(
        `DELETE FROM bot_admin WHERE user_id = $1 AND platform_id = $2 AND session_id = $3`,
        [userId, platformId, sessionId],
      );
      for (const adminId of dto.botAdmins) {
        await client.query(
          `INSERT INTO bot_admin (user_id, platform_id, session_id, admin_id) VALUES ($1, $2, $3, $4)`,
          [userId, platformId, sessionId, adminId],
        );
      }

      // Full premium list replacement — delete all then re-insert mirrors the admin pattern.
      await client.query(
        `DELETE FROM bot_premium WHERE user_id = $1 AND platform_id = $2 AND session_id = $3`,
        [userId, platformId, sessionId],
      );
      for (const premiumId of (dto.botPremiums ?? [])) {
        await client.query(
          `INSERT INTO bot_premium (user_id, platform_id, session_id, premium_id) VALUES ($1, $2, $3, $4)`,
          [userId, platformId, sessionId, premiumId],
        );
      }

      const { credentials } = dto;
      if (credentials.platform === Platforms.Discord) {
        const extra = isCredentialsModified
          ? ', is_command_register = FALSE, command_hash = NULL'
          : '';
        await client.query(
          `UPDATE bot_credential_discord
           SET discord_token = $4, discord_client_id = $5${extra}
           WHERE user_id = $1 AND platform_id = $2 AND session_id = $3`,
          [userId, platformId, sessionId, encrypt(credentials.discordToken), credentials.discordClientId],
        );
      } else if (credentials.platform === Platforms.Telegram) {
        const extra = isCredentialsModified
          ? ', is_command_register = FALSE, command_hash = NULL'
          : '';
        await client.query(
          `UPDATE bot_credential_telegram
           SET telegram_token = $4${extra}
           WHERE user_id = $1 AND platform_id = $2 AND session_id = $3`,
          [userId, platformId, sessionId, encrypt(credentials.telegramToken)],
        );
      } else if (credentials.platform === Platforms.FacebookPage) {
        await client.query(
          `UPDATE bot_credential_facebook_page
           SET fb_access_token = $4, fb_page_id = $5
           WHERE user_id = $1 AND platform_id = $2 AND session_id = $3`,
          [userId, platformId, sessionId, encrypt(credentials.fbAccessToken), credentials.fbPageId],
        );
      } else {
        await client.query(
          `UPDATE bot_credential_facebook_messenger
           SET appstate = $4
           WHERE user_id = $1 AND platform_id = $2 AND session_id = $3`,
          [userId, platformId, sessionId, encrypt(credentials.appstate)],
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

  async list(userId: string): Promise<GetBotListResponseDto> {
    const res = await pool.query<{
      session_id: string; platform_id: number; nickname: string | null; prefix: string | null;
    }>(
      `SELECT session_id, platform_id, nickname, prefix FROM bot_session WHERE user_id = $1`,
      [userId],
    );
    return {
      bots: res.rows.map((r) => ({
        sessionId: r.session_id,
        platformId: r.platform_id,
        platform: (ID_TO_PLATFORM as Record<number, string>)[r.platform_id] ?? '',
        nickname: r.nickname ?? '',
        prefix: r.prefix ?? '',
      })),
    };
  }

  async updateIsRunning(userId: string, sessionId: string, isRunning: boolean): Promise<void> {
    await pool.query(
      `UPDATE bot_session SET is_running = $3 WHERE user_id = $1 AND session_id = $2`,
      [userId, sessionId, isRunning],
    );
  }

  async getPlatformId(userId: string, sessionId: string): Promise<number | null> {
    const res = await pool.query<{ platform_id: number }>(
      `SELECT platform_id FROM bot_session WHERE user_id = $1 AND session_id = $2 LIMIT 1`,
      [userId, sessionId],
    );
    return res.rows[0]?.platform_id ?? null;
  }

  // Returns every bot session regardless of owner — admin-only view.
  async listAll(): Promise<GetAdminBotListResponseDto> {
    const res = await pool.query<{
      user_id: string; session_id: string; platform_id: number;
      nickname: string | null; prefix: string | null; is_running: boolean;
      user_name: string | null; user_email: string | null;
    }>(`
      SELECT bs.user_id, bs.session_id, bs.platform_id, bs.nickname, bs.prefix, bs.is_running,
             u.name  AS user_name,
             u.email AS user_email
      FROM bot_session bs
      LEFT JOIN "user" u ON u.id = bs.user_id
      ORDER BY bs.user_id
    `);
    return {
      bots: res.rows.map((r) => ({
        sessionId: r.session_id,
        userId: r.user_id,
        platformId: r.platform_id,
        platform: (ID_TO_PLATFORM as Record<number, string>)[r.platform_id] ?? '',
        nickname: r.nickname ?? '',
                prefix: r.prefix ?? '',
                isRunning: r.is_running,
                // Use ?? undefined to ensure empty strings are preserved,
                // preventing the frontend from rendering raw IDs if a user's name is saved as an empty string.
                userName: r.user_name ?? undefined,
                userEmail: r.user_email ?? undefined,
              })),
            };
  }

  /**
   * Permanently removes every DB record tied to this bot session.
   * All deletes run inside a single transaction so a crash mid-way leaves no orphan rows.
   * Table names match the NeonDB schema in client.ts initDb().
   */
  async deleteById(userId: string, sessionId: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Child rows with no FK dependency on bot_session — delete first.
      await client.query(`DELETE FROM bot_session_commands WHERE user_id = $1 AND session_id = $2`, [userId, sessionId]);
      await client.query(`DELETE FROM bot_session_events WHERE user_id = $1 AND session_id = $2`, [userId, sessionId]);
      await client.query(`DELETE FROM bot_users_session_banned WHERE user_id = $1 AND session_id = $2`, [userId, sessionId]);
      await client.query(`DELETE FROM bot_threads_session_banned WHERE user_id = $1 AND session_id = $2`, [userId, sessionId]);
      // Session tracking join tables — FK is to bot_users/bot_threads, not bot_session.
      await client.query(`DELETE FROM bot_users_session WHERE user_id = $1 AND session_id = $2`, [userId, sessionId]);
      await client.query(`DELETE FROM bot_threads_session WHERE user_id = $1 AND session_id = $2`, [userId, sessionId]);
      // Identity and credential rows.
      await client.query(`DELETE FROM bot_admin WHERE user_id = $1 AND session_id = $2`, [userId, sessionId]);
      await client.query(`DELETE FROM bot_premium WHERE user_id = $1 AND session_id = $2`, [userId, sessionId]);
      await client.query(`DELETE FROM bot_credential_discord WHERE user_id = $1 AND session_id = $2`, [userId, sessionId]);
      await client.query(`DELETE FROM bot_credential_telegram WHERE user_id = $1 AND session_id = $2`, [userId, sessionId]);
      await client.query(`DELETE FROM bot_credential_facebook_page WHERE user_id = $1 AND session_id = $2`, [userId, sessionId]);
      await client.query(`DELETE FROM bot_credential_facebook_messenger WHERE user_id = $1 AND session_id = $2`, [userId, sessionId]);
      // Parent session row last.
      await client.query(`DELETE FROM bot_session WHERE user_id = $1 AND session_id = $2`, [userId, sessionId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

export const botRepo = new BotRepo();
