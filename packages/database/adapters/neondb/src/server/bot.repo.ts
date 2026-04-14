import { pool } from '../client.js';
import { PLATFORM_TO_ID, ID_TO_PLATFORM } from '@cat-bot/engine/modules/platform/platform.constants.js';
import type {
  CreateBotRequestDto,
  CreateBotResponseDto,
  GetBotListResponseDto,
  GetBotDetailResponseDto,
  UpdateBotRequestDto,
} from '@cat-bot/server/dtos/bot.dto.js';
import { encrypt, decrypt } from '@cat-bot/engine/utils/crypto.util.js';

export class BotRepo {
  async create(
    userId: string,
    sessionId: string,
    dto: CreateBotRequestDto,
  ): Promise<CreateBotResponseDto> {
    const platformId =
      (PLATFORM_TO_ID as Record<string, number>)[dto.credentials.platform] ??
      (PLATFORM_TO_ID as Record<string, number>)[dto.credentials.platform.replace('_', '-')];
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

      const { credentials } = dto;
      if (credentials.platform === 'discord') {
        await client.query(
          `INSERT INTO bot_credential_discord (user_id, platform_id, session_id, discord_token, discord_client_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, platformId, sessionId, encrypt(credentials.discordToken), credentials.discordClientId],
        );
      } else if (credentials.platform === 'telegram') {
        await client.query(
          `INSERT INTO bot_credential_telegram (user_id, platform_id, session_id, telegram_token)
           VALUES ($1, $2, $3, $4)`,
          [userId, platformId, sessionId, encrypt(credentials.telegramToken)],
        );
      } else if (credentials.platform === 'facebook_page') {
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

    const normalizedPlatform = platform.replace('-', '_');
    let credentials: GetBotDetailResponseDto['credentials'];

    if (normalizedPlatform === 'discord') {
      const credRes = await pool.query<{ discord_token: string; discord_client_id: string }>(
        `SELECT discord_token, discord_client_id FROM bot_credential_discord
         WHERE user_id = $1 AND session_id = $2 LIMIT 1`,
        [userId, sessionId],
      );
      if (!credRes.rows[0]) throw new Error('Missing credentials');
      credentials = {
        platform: 'discord',
        discordToken: decrypt(credRes.rows[0].discord_token),
        discordClientId: credRes.rows[0].discord_client_id,
      };
    } else if (normalizedPlatform === 'telegram') {
      const credRes = await pool.query<{ telegram_token: string }>(
        `SELECT telegram_token FROM bot_credential_telegram
         WHERE user_id = $1 AND session_id = $2 LIMIT 1`,
        [userId, sessionId],
      );
      if (!credRes.rows[0]) throw new Error('Missing credentials');
      credentials = { platform: 'telegram', telegramToken: decrypt(credRes.rows[0].telegram_token) };
    } else if (normalizedPlatform === 'facebook_page') {
      const credRes = await pool.query<{ fb_access_token: string; fb_page_id: string }>(
        `SELECT fb_access_token, fb_page_id FROM bot_credential_facebook_page
         WHERE user_id = $1 AND session_id = $2 LIMIT 1`,
        [userId, sessionId],
      );
      if (!credRes.rows[0]) throw new Error('Missing credentials');
      credentials = {
        platform: 'facebook_page',
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
      credentials = { platform: 'facebook_messenger', appstate: decrypt(credRes.rows[0].appstate) };
    }

    return {
      sessionId, userId,
      platformId: sess.platform_id,
      platform,
      nickname: sess.nickname ?? '',
      prefix: sess.prefix ?? '',
      admins: adminsRes.rows.map((r) => r.admin_id),
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
      (PLATFORM_TO_ID as Record<string, number>)[dto.credentials.platform] ??
      (PLATFORM_TO_ID as Record<string, number>)[dto.credentials.platform.replace('_', '-')];

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

      const { credentials } = dto;
      if (credentials.platform === 'discord') {
        const extra = isCredentialsModified
          ? ', is_command_register = FALSE, command_hash = NULL'
          : '';
        await client.query(
          `UPDATE bot_credential_discord
           SET discord_token = $4, discord_client_id = $5${extra}
           WHERE user_id = $1 AND platform_id = $2 AND session_id = $3`,
          [userId, platformId, sessionId, encrypt(credentials.discordToken), credentials.discordClientId],
        );
      } else if (credentials.platform === 'telegram') {
        const extra = isCredentialsModified
          ? ', is_command_register = FALSE, command_hash = NULL'
          : '';
        await client.query(
          `UPDATE bot_credential_telegram
           SET telegram_token = $4${extra}
           WHERE user_id = $1 AND platform_id = $2 AND session_id = $3`,
          [userId, platformId, sessionId, encrypt(credentials.telegramToken)],
        );
      } else if (credentials.platform === 'facebook_page') {
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
}

export const botRepo = new BotRepo();