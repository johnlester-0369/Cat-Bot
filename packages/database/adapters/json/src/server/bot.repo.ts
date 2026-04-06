import { getDb, saveDb } from '../store.js';
import { PLATFORM_TO_ID, ID_TO_PLATFORM } from '@cat-bot/engine/constants/platform.constants.js';
import type { CreateBotRequestDto, CreateBotResponseDto, GetBotListItemDto, GetBotListResponseDto, GetBotDetailResponseDto, UpdateBotRequestDto } from '@cat-bot/server/dtos/bot.dto.js';

export class BotRepo {
  async create(userId: string, sessionId: string, dto: CreateBotRequestDto): Promise<CreateBotResponseDto> {
    const db = await getDb();
    const platformId = (PLATFORM_TO_ID as Record<string, number>)[dto.credentials.platform] ?? (PLATFORM_TO_ID as Record<string, number>)[dto.credentials.platform.replace('_', '-')];
    if (platformId === undefined) throw new Error(`Unknown platform ${dto.credentials.platform}`);

    // isRunning: true mirrors the Prisma schema's @default(true) so session-loader.util.ts
    // includes this session in runningKeys on first boot without requiring an explicit API start call.
    db.botSession.push({ userId, platformId, sessionId, nickname: dto.botNickname, prefix: dto.botPrefix, isRunning: true });
    for (const adminId of dto.botAdmins) db.botAdmin.push({ userId, platformId, sessionId, adminId });

    const creds = dto.credentials;
    if (creds.platform === 'discord') db.botCredentialDiscord.push({ userId, platformId, sessionId, discordToken: creds.discordToken, discordClientId: creds.discordClientId, isCommandRegister: false, commandHash: null });
    else if (creds.platform === 'telegram') db.botCredentialTelegram.push({ userId, platformId, sessionId, telegramToken: creds.telegramToken, isCommandRegister: false, commandHash: null });
    else if (creds.platform === 'facebook_page') db.botCredentialFacebookPage.push({ userId, platformId, sessionId, fbAccessToken: creds.fbAccessToken, fbPageId: creds.fbPageId });
    else db.botCredentialFacebookMessenger.push({ userId, platformId, sessionId, appstate: creds.appstate });
    
    await saveDb();
    return { sessionId, userId, platformId, nickname: dto.botNickname, prefix: dto.botPrefix };
  }

  async getById(userId: string, sessionId: string): Promise<GetBotDetailResponseDto | null> {
    const db = await getDb();
    const session = db.botSession.find((s: any) => s.userId === userId && s.sessionId === sessionId);
    if (!session) return null;

    const platform = (ID_TO_PLATFORM as Record<number, string>)[session.platformId];
    if (!platform) return null;

    const admins = db.botAdmin.filter((a: any) => a.userId === userId && a.sessionId === sessionId).map((a: any) => a.adminId);
    let credentials: GetBotDetailResponseDto['credentials'];
    const p = platform.replace('-', '_');

    if (p === 'discord') {
      const c = db.botCredentialDiscord.find((c: any) => c.userId === userId && c.sessionId === sessionId);
      credentials = { platform: 'discord', discordToken: c.discordToken, discordClientId: c.discordClientId };
    } else if (p === 'telegram') {
      const c = db.botCredentialTelegram.find((c: any) => c.userId === userId && c.sessionId === sessionId);
      credentials = { platform: 'telegram', telegramToken: c.telegramToken };
    } else if (p === 'facebook_page') {
      const c = db.botCredentialFacebookPage.find((c: any) => c.userId === userId && c.sessionId === sessionId);
      credentials = { platform: 'facebook_page', fbAccessToken: c.fbAccessToken, fbPageId: c.fbPageId };
    } else {
      const c = db.botCredentialFacebookMessenger.find((c: any) => c.userId === userId && c.sessionId === sessionId);
      credentials = { platform: 'facebook_messenger', appstate: c.appstate };
    }

    return { sessionId, userId, platformId: session.platformId, platform, nickname: session.nickname ?? '', prefix: session.prefix ?? '', admins, credentials };
  }

  async update(userId: string, sessionId: string, dto: UpdateBotRequestDto, isCredentialsModified: boolean = false): Promise<void> {
    const db = await getDb();
    const platformId = (PLATFORM_TO_ID as Record<string, number>)[dto.credentials.platform] ?? (PLATFORM_TO_ID as Record<string, number>)[dto.credentials.platform.replace('_', '-')];
    const session = db.botSession.find((s: any) => s.userId === userId && s.sessionId === sessionId);
    if (!session) throw new Error('Bot not found');
    
    session.nickname = dto.botNickname;
    session.prefix = dto.botPrefix;

    db.botAdmin = db.botAdmin.filter((a: any) => !(a.userId === userId && a.platformId === platformId && a.sessionId === sessionId));
    for (const adminId of dto.botAdmins) db.botAdmin.push({ userId, platformId, sessionId, adminId });

    const creds = dto.credentials;
    if (creds.platform === 'discord') {
      const c = db.botCredentialDiscord.find((c: any) => c.userId === userId && c.sessionId === sessionId);
      if (c) { c.discordToken = creds.discordToken; c.discordClientId = creds.discordClientId; if (isCredentialsModified) { c.isCommandRegister = false; c.commandHash = null; } }
    } else if (creds.platform === 'telegram') {
      const c = db.botCredentialTelegram.find((c: any) => c.userId === userId && c.sessionId === sessionId);
      if (c) { c.telegramToken = creds.telegramToken; if (isCredentialsModified) { c.isCommandRegister = false; c.commandHash = null; } }
    } else if (creds.platform === 'facebook_page') {
      const c = db.botCredentialFacebookPage.find((c: any) => c.userId === userId && c.sessionId === sessionId);
      if (c) { c.fbAccessToken = creds.fbAccessToken; c.fbPageId = creds.fbPageId; }
    } else {
      const c = db.botCredentialFacebookMessenger.find((c: any) => c.userId === userId && c.sessionId === sessionId);
      if (c) c.appstate = creds.appstate;
    }
    await saveDb();
  }

  async list(userId: string): Promise<GetBotListResponseDto> {
    const db = await getDb();
    const rows = db.botSession.filter((s: any) => s.userId === userId);
    return { bots: rows.map((r: any) => ({ sessionId: r.sessionId, platformId: r.platformId, platform: (ID_TO_PLATFORM as Record<number, string>)[r.platformId], nickname: r.nickname ?? '', prefix: r.prefix ?? '' })) };
  }

  async updateIsRunning(userId: string, sessionId: string, isRunning: boolean): Promise<void> {
    const db = await getDb();
    const session = db.botSession.find((s: any) => s.userId === userId && s.sessionId === sessionId);
    if (session) { session.isRunning = isRunning; await saveDb(); }
  }

  async getPlatformId(userId: string, sessionId: string): Promise<number | null> {
    const db = await getDb();
    const session = db.botSession.find((s: any) => s.userId === userId && s.sessionId === sessionId);
    return session?.platformId ?? null;
  }
}

export const botRepo = new BotRepo();
