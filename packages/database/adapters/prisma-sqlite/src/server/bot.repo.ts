import { prisma } from '../index.js';
import {
  PLATFORM_TO_ID,
  ID_TO_PLATFORM,
  Platforms,
} from '@cat-bot/engine/modules/platform/platform.constants.js';
import type {
  CreateBotRequestDto,
  CreateBotResponseDto,
  GetBotListItemDto,
  GetBotListResponseDto,
  GetBotDetailResponseDto,
  UpdateBotRequestDto,
} from '@cat-bot/server/dtos/bot.dto.js';
import type {
  GetAdminBotListItemDto,
  GetAdminBotListResponseDto,
} from '@cat-bot/server/dtos/admin.dto.js';
import { encrypt, decrypt } from '@cat-bot/engine/utils/crypto.util.js';

export class BotRepo {
  async create(
    userId: string,
    sessionId: string,
    dto: CreateBotRequestDto,
  ): Promise<CreateBotResponseDto> {
    const platformId = (PLATFORM_TO_ID as Record<string, number>)[
      dto.credentials.platform
    ];
    if (platformId === undefined)
      throw new Error(`Unknown platform ${dto.credentials.platform}`);

    await prisma.$transaction(async (tx) => {
      await tx.botSession.create({
        data: {
          userId,
          platformId,
          sessionId,
          nickname: dto.botNickname,
          prefix: dto.botPrefix,
        },
      });
      for (const adminId of dto.botAdmins)
        await tx.botAdmin.create({
          data: { userId, platformId, sessionId, adminId },
        });
      for (const premiumId of dto.botPremiums ?? [])
        await tx.botPremium.create({
          data: { userId, platformId, sessionId, premiumId },
        });

      const { credentials } = dto;
      if (credentials.platform === Platforms.Discord)
        await tx.botCredentialDiscord.create({
          data: {
            userId,
            platformId,
            sessionId,
            discordToken: encrypt(credentials.discordToken),
            discordClientId: credentials.discordClientId,
          },
        });
      else if (credentials.platform === Platforms.Telegram)
        await tx.botCredentialTelegram.create({
          data: {
            userId,
            platformId,
            sessionId,
            telegramToken: encrypt(credentials.telegramToken),
          },
        });
      else if (credentials.platform === Platforms.FacebookPage)
        await tx.botCredentialFacebookPage.create({
          data: {
            userId,
            platformId,
            sessionId,
            fbAccessToken: encrypt(credentials.fbAccessToken),
            fbPageId: credentials.fbPageId,
          },
        });
      else
        await tx.botCredentialFacebookMessenger.create({
          data: {
            userId,
            platformId,
            sessionId,
            appstate: encrypt(credentials.appstate),
          },
        });
    });
    return {
      sessionId,
      userId,
      platformId,
      nickname: dto.botNickname,
      prefix: dto.botPrefix,
    };
  }

  async getById(
    userId: string,
    sessionId: string,
  ): Promise<GetBotDetailResponseDto | null> {
    const botSessionInfo = await prisma.botSession.findFirst({
      where: { userId, sessionId },
    });
    if (!botSessionInfo) return null;

    const platform = (ID_TO_PLATFORM as Record<number, string>)[
      botSessionInfo.platformId
    ];
    if (!platform) return null;

    const admins = await prisma.botAdmin.findMany({
      where: { userId, sessionId },
    });
    const premiums = await prisma.botPremium.findMany({
      where: { userId, sessionId },
    });
    let credentials: GetBotDetailResponseDto['credentials'];

    if (platform === Platforms.Discord) {
      const cred = await prisma.botCredentialDiscord.findFirst({
        where: { userId, sessionId },
      });
      if (!cred) throw new Error(`Missing credentials`);
      credentials = {
        platform: Platforms.Discord,
        discordToken: decrypt(cred.discordToken),
        discordClientId: cred.discordClientId,
      };
    } else if (platform === Platforms.Telegram) {
      const cred = await prisma.botCredentialTelegram.findFirst({
        where: { userId, sessionId },
      });
      if (!cred) throw new Error(`Missing credentials`);
      credentials = {
        platform: Platforms.Telegram,
        telegramToken: decrypt(cred.telegramToken),
      };
    } else if (platform === Platforms.FacebookPage) {
      const cred = await prisma.botCredentialFacebookPage.findFirst({
        where: { userId, sessionId },
      });
      if (!cred) throw new Error(`Missing credentials`);
      credentials = {
        platform: Platforms.FacebookPage,
        fbAccessToken: decrypt(cred.fbAccessToken),
        fbPageId: cred.fbPageId,
      };
    } else {
      const cred = await prisma.botCredentialFacebookMessenger.findFirst({
        where: { userId, sessionId },
      });
      if (!cred) throw new Error(`Missing credentials`);
      credentials = {
        platform: Platforms.FacebookMessenger,
        appstate: decrypt(cred.appstate),
      };
    }

    return {
      sessionId,
      userId,
      platformId: botSessionInfo.platformId,
      platform,
      nickname: botSessionInfo.nickname ?? '',
      prefix: botSessionInfo.prefix ?? '',
      admins: admins.map((a) => a.adminId),
      premiums: premiums.map((p) => p.premiumId),
      credentials,
    };
  }

  async update(
    userId: string,
    sessionId: string,
    dto: UpdateBotRequestDto,
    isCredentialsModified: boolean = false,
  ): Promise<void> {
    const platformId = (PLATFORM_TO_ID as Record<string, number>)[
      dto.credentials.platform
    ];
    const botSessionInfo = await prisma.botSession.findFirst({
      where: { userId, sessionId },
    });
    if (!botSessionInfo) throw new Error('Bot not found');
    if (botSessionInfo.platformId !== platformId)
      throw new Error('Platform cannot be changed after bot creation.');

    await prisma.$transaction(async (tx) => {
      await tx.botSession.update({
        where: {
          userId_platformId_sessionId: { userId, platformId, sessionId },
        },
        data: { nickname: dto.botNickname, prefix: dto.botPrefix },
      });
      await tx.botAdmin.deleteMany({
        where: { userId, platformId, sessionId },
      });
      for (const adminId of dto.botAdmins)
        await tx.botAdmin.create({
          data: { userId, platformId, sessionId, adminId },
        });
      // Full premium list replacement inside the same transaction — maintains referential atomicity.
      await tx.botPremium.deleteMany({
        where: { userId, platformId, sessionId },
      });
      for (const premiumId of dto.botPremiums ?? [])
        await tx.botPremium.create({
          data: { userId, platformId, sessionId, premiumId },
        });

      const { credentials } = dto;
      if (credentials.platform === Platforms.Discord)
        await tx.botCredentialDiscord.update({
          where: {
            userId_platformId_sessionId: { userId, platformId, sessionId },
          },
          data: {
            discordToken: encrypt(credentials.discordToken),
            discordClientId: credentials.discordClientId,
            ...(isCredentialsModified
              ? { isCommandRegister: false, commandHash: null }
              : {}),
          },
        });
      else if (credentials.platform === Platforms.Telegram)
        await tx.botCredentialTelegram.update({
          where: {
            userId_platformId_sessionId: { userId, platformId, sessionId },
          },
          data: {
            telegramToken: encrypt(credentials.telegramToken),
            ...(isCredentialsModified
              ? { isCommandRegister: false, commandHash: null }
              : {}),
          },
        });
      else if (credentials.platform === Platforms.FacebookPage)
        await tx.botCredentialFacebookPage.update({
          where: {
            userId_platformId_sessionId: { userId, platformId, sessionId },
          },
          data: {
            fbAccessToken: encrypt(credentials.fbAccessToken),
            fbPageId: credentials.fbPageId,
          },
        });
      else
        await tx.botCredentialFacebookMessenger.update({
          where: {
            userId_platformId_sessionId: { userId, platformId, sessionId },
          },
          data: { appstate: encrypt(credentials.appstate) },
        });
    });
  }

  async list(userId: string): Promise<GetBotListResponseDto> {
    const rows = await prisma.botSession.findMany({ where: { userId } });
    // ID_TO_PLATFORM lookup returns string | undefined under noUncheckedIndexedAccess;
    // an unrecognised platformId is an integrity issue, but we fail-safe to '' rather than crashing the list endpoint.
    return {
      bots: rows.map((row) => ({
        sessionId: row.sessionId,
        platformId: row.platformId,
        platform:
          (ID_TO_PLATFORM as Record<number, string>)[row.platformId] ?? '',
        nickname: row.nickname ?? '',
        prefix: row.prefix ?? '',
      })),
    };
  }

  async updateIsRunning(
    userId: string,
    sessionId: string,
    isRunning: boolean,
  ): Promise<void> {
    await prisma.botSession.updateMany({
      where: { userId, sessionId },
      data: { isRunning },
    });
  }

  async getPlatformId(
    userId: string,
    sessionId: string,
  ): Promise<number | null> {
    const botSessionInfo = await prisma.botSession.findFirst({
      where: { userId, sessionId },
      select: { platformId: true },
    });
    return botSessionInfo?.platformId ?? null;
  }

  // Returns every bot session across all owners — used only by admin dashboard endpoints.
  // No userId filter intentional: admin needs a global view of platform health.
  async listAll(): Promise<GetAdminBotListResponseDto> {
    // Include the owning user's name and email in a single query via the existing
    // BotSession → user relation — avoids a separate lookup for every session row.
    const rows = await prisma.botSession.findMany({
      orderBy: { userId: 'asc' },
      include: { user: true },
    });
    return {
      bots: rows.map((row) => ({
        sessionId: row.sessionId,
        userId: row.userId,
        platformId: row.platformId,
        platform:
          (ID_TO_PLATFORM as Record<number, string>)[row.platformId] ?? '',
        nickname: row.nickname ?? '',
        prefix: row.prefix ?? '',
        isRunning: row.isRunning,
        // Safe navigation guards against orphaned sessions. Use ?? undefined to ensure empty
        // strings are preserved, preventing the frontend from rendering raw IDs when name is blank.
        userName: row.user?.name ?? undefined,
        userEmail: row.user?.email ?? undefined,
      })),
    };
  }

  /**
   * Permanently removes every DB record tied to this bot session.
   * Prisma has no cascade from bot_session to the command/event/ban/credential tables
   * (those FKs point to `user`, not `bot_session`), so we delete each table explicitly
   * in a single transaction so a mid-run crash never leaves orphan rows.
   */
  async deleteById(userId: string, sessionId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      // Child rows first — no FK from these to bot_session so order within this group is free.
      await tx.botSessionCommand.deleteMany({ where: { userId, sessionId } });
      await tx.botSessionEvent.deleteMany({ where: { userId, sessionId } });
      await tx.botUserBanned.deleteMany({ where: { userId, sessionId } });
      await tx.botThreadBanned.deleteMany({ where: { userId, sessionId } });
      // Session tracking join tables reference bot_users/bot_threads (not bot_session), so safe to delete here.
      await tx.botUserSession.deleteMany({ where: { userId, sessionId } });
      await tx.botThreadSession.deleteMany({ where: { userId, sessionId } });
      // Identity / credential tables
      await tx.botAdmin.deleteMany({ where: { userId, sessionId } });
      await tx.botPremium.deleteMany({ where: { userId, sessionId } });
      await tx.botCredentialDiscord.deleteMany({
        where: { userId, sessionId },
      });
      await tx.botCredentialTelegram.deleteMany({
        where: { userId, sessionId },
      });
      await tx.botCredentialFacebookPage.deleteMany({
        where: { userId, sessionId },
      });
      await tx.botCredentialFacebookMessenger.deleteMany({
        where: { userId, sessionId },
      });
      // Parent session row last — everything that logically "belongs" to it is already gone.
      await tx.botSession.deleteMany({ where: { userId, sessionId } });
    });
  }
}

export const botRepo = new BotRepo();
