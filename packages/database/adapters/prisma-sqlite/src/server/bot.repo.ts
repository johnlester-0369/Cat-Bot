import { prisma } from '../index.js';
import { PLATFORM_TO_ID, ID_TO_PLATFORM } from '@cat-bot/engine/constants/platform.constants.js';
import type { CreateBotRequestDto, CreateBotResponseDto, GetBotListItemDto, GetBotListResponseDto, GetBotDetailResponseDto, UpdateBotRequestDto } from '@cat-bot/server/dtos/bot.dto.js';
import { encrypt, decrypt } from '@cat-bot/engine/utils/crypto.util.js';

export class BotRepo {
  async create(userId: string, sessionId: string, dto: CreateBotRequestDto): Promise<CreateBotResponseDto> {
    let platformId = (PLATFORM_TO_ID as Record<string, number>)[dto.credentials.platform] ?? (PLATFORM_TO_ID as Record<string, number>)[dto.credentials.platform.replace('_', '-')];
    if (platformId === undefined) throw new Error(`Unknown platform ${dto.credentials.platform}`);

    await prisma.$transaction(async (tx) => {
      await tx.botSession.create({ data: { userId, platformId, sessionId, nickname: dto.botNickname, prefix: dto.botPrefix } });
      for (const adminId of dto.botAdmins) await tx.botAdmin.create({ data: { userId, platformId, sessionId, adminId } });

      const { credentials } = dto;
      if (credentials.platform === 'discord') await tx.botCredentialDiscord.create({ data: { userId, platformId, sessionId, discordToken: encrypt(credentials.discordToken), discordClientId: credentials.discordClientId } });
      else if (credentials.platform === 'telegram') await tx.botCredentialTelegram.create({ data: { userId, platformId, sessionId, telegramToken: encrypt(credentials.telegramToken) } });
      else if (credentials.platform === 'facebook_page') await tx.botCredentialFacebookPage.create({ data: { userId, platformId, sessionId, fbAccessToken: encrypt(credentials.fbAccessToken), fbPageId: credentials.fbPageId } });
      else await tx.botCredentialFacebookMessenger.create({ data: { userId, platformId, sessionId, appstate: encrypt(credentials.appstate) } });
    });
    return { sessionId, userId, platformId, nickname: dto.botNickname, prefix: dto.botPrefix };
  }

  async getById(userId: string, sessionId: string): Promise<GetBotDetailResponseDto | null> {
    const botSessionInfo = await prisma.botSession.findFirst({ where: { userId, sessionId } });
    if (!botSessionInfo) return null;

    const platform = (ID_TO_PLATFORM as Record<number, string>)[botSessionInfo.platformId];
    if (!platform) return null;

    const admins = await prisma.botAdmin.findMany({ where: { userId, sessionId } });
    let credentials: GetBotDetailResponseDto['credentials'];
    const normalizedPlatform = platform.replace('-', '_');

    if (normalizedPlatform === 'discord') {
      const cred = await prisma.botCredentialDiscord.findFirst({ where: { userId, sessionId } });
      if (!cred) throw new Error(`Missing credentials`);
      credentials = { platform: 'discord', discordToken: decrypt(cred.discordToken), discordClientId: cred.discordClientId };
    } else if (normalizedPlatform === 'telegram') {
      const cred = await prisma.botCredentialTelegram.findFirst({ where: { userId, sessionId } });
      if (!cred) throw new Error(`Missing credentials`);
      credentials = { platform: 'telegram', telegramToken: decrypt(cred.telegramToken) };
    } else if (normalizedPlatform === 'facebook_page') {
      const cred = await prisma.botCredentialFacebookPage.findFirst({ where: { userId, sessionId } });
      if (!cred) throw new Error(`Missing credentials`);
      credentials = { platform: 'facebook_page', fbAccessToken: decrypt(cred.fbAccessToken), fbPageId: cred.fbPageId };
    } else {
      const cred = await prisma.botCredentialFacebookMessenger.findFirst({ where: { userId, sessionId } });
      if (!cred) throw new Error(`Missing credentials`);
      credentials = { platform: 'facebook_messenger', appstate: decrypt(cred.appstate) };
    }

    return { sessionId, userId, platformId: botSessionInfo.platformId, platform, nickname: botSessionInfo.nickname ?? '', prefix: botSessionInfo.prefix ?? '', admins: admins.map((a) => a.adminId), credentials };
  }

  async update(userId: string, sessionId: string, dto: UpdateBotRequestDto, isCredentialsModified: boolean = false): Promise<void> {
    const platformId = (PLATFORM_TO_ID as Record<string, number>)[dto.credentials.platform] ?? (PLATFORM_TO_ID as Record<string, number>)[dto.credentials.platform.replace('_', '-')];
    const botSessionInfo = await prisma.botSession.findFirst({ where: { userId, sessionId } });
    if (!botSessionInfo) throw new Error('Bot not found');
    if (botSessionInfo.platformId !== platformId) throw new Error('Platform cannot be changed after bot creation.');

    await prisma.$transaction(async (tx) => {
      await tx.botSession.update({ where: { userId_platformId_sessionId: { userId, platformId, sessionId } }, data: { nickname: dto.botNickname, prefix: dto.botPrefix } });
      await tx.botAdmin.deleteMany({ where: { userId, platformId, sessionId } });
      for (const adminId of dto.botAdmins) await tx.botAdmin.create({ data: { userId, platformId, sessionId, adminId } });

      const { credentials } = dto;
      if (credentials.platform === 'discord') await tx.botCredentialDiscord.update({ where: { userId_platformId_sessionId: { userId, platformId, sessionId } }, data: { discordToken: encrypt(credentials.discordToken), discordClientId: credentials.discordClientId, ...(isCredentialsModified ? { isCommandRegister: false, commandHash: null } : {}) } });
      else if (credentials.platform === 'telegram') await tx.botCredentialTelegram.update({ where: { userId_platformId_sessionId: { userId, platformId, sessionId } }, data: { telegramToken: encrypt(credentials.telegramToken), ...(isCredentialsModified ? { isCommandRegister: false, commandHash: null } : {}) } });
      else if (credentials.platform === 'facebook_page') await tx.botCredentialFacebookPage.update({ where: { userId_platformId_sessionId: { userId, platformId, sessionId } }, data: { fbAccessToken: encrypt(credentials.fbAccessToken), fbPageId: credentials.fbPageId } });
      else await tx.botCredentialFacebookMessenger.update({ where: { userId_platformId_sessionId: { userId, platformId, sessionId } }, data: { appstate: encrypt(credentials.appstate) } });
    });
  }

  async list(userId: string): Promise<GetBotListResponseDto> {
    const rows = await prisma.botSession.findMany({ where: { userId } });
    // ID_TO_PLATFORM lookup returns string | undefined under noUncheckedIndexedAccess;
    // an unrecognised platformId is an integrity issue, but we fail-safe to '' rather than crashing the list endpoint.
    return { bots: rows.map(row => ({ sessionId: row.sessionId, platformId: row.platformId, platform: (ID_TO_PLATFORM as Record<number, string>)[row.platformId] ?? '', nickname: row.nickname ?? '', prefix: row.prefix ?? '' })) };
  }

  async updateIsRunning(userId: string, sessionId: string, isRunning: boolean): Promise<void> {
    await prisma.botSession.updateMany({ where: { userId, sessionId }, data: { isRunning } });
  }

  async getPlatformId(userId: string, sessionId: string): Promise<number | null> {
    const botSessionInfo = await prisma.botSession.findFirst({ where: { userId, sessionId }, select: { platformId: true } });
    return botSessionInfo?.platformId ?? null;
  }
}

export const botRepo = new BotRepo();
