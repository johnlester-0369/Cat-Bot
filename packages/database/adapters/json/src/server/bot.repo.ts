import { getDb, saveDb } from '../store.js';
import { PLATFORM_TO_ID, ID_TO_PLATFORM, Platforms } from '@cat-bot/engine/modules/platform/platform.constants.js';
import type { CreateBotRequestDto, CreateBotResponseDto, GetBotListItemDto, GetBotListResponseDto, GetBotDetailResponseDto, UpdateBotRequestDto } from '@cat-bot/server/dtos/bot.dto.js';
import { encrypt, decrypt } from '@cat-bot/engine/utils/crypto.util.js';

export class BotRepo {
  async create(userId: string, sessionId: string, dto: CreateBotRequestDto): Promise<CreateBotResponseDto> {
    const db = await getDb();
    // dto.credentials.platform is always hyphen-format ('facebook-page' etc.) — no fallback replace needed
    const platformId = (PLATFORM_TO_ID as Record<string, number>)[dto.credentials.platform];
    if (platformId === undefined) throw new Error(`Unknown platform ${dto.credentials.platform}`);

    // isRunning: true mirrors the Prisma schema's @default(true) so session-loader.util.ts
    // includes this session in runningKeys on first boot without requiring an explicit API start call.
    db.botSession.push({ userId, platformId, sessionId, nickname: dto.botNickname, prefix: dto.botPrefix, isRunning: true });
    for (const adminId of dto.botAdmins) db.botAdmin.push({ userId, platformId, sessionId, adminId });

    const creds = dto.credentials;
    if (creds.platform === Platforms.Discord) db.botCredentialDiscord.push({ userId, platformId, sessionId, discordToken: encrypt(creds.discordToken), discordClientId: creds.discordClientId, isCommandRegister: false, commandHash: null });
    else if (creds.platform === Platforms.Telegram) db.botCredentialTelegram.push({ userId, platformId, sessionId, telegramToken: encrypt(creds.telegramToken), isCommandRegister: false, commandHash: null });
    else if (creds.platform === Platforms.FacebookPage) db.botCredentialFacebookPage.push({ userId, platformId, sessionId, fbAccessToken: encrypt(creds.fbAccessToken), fbPageId: creds.fbPageId });
    else db.botCredentialFacebookMessenger.push({ userId, platformId, sessionId, appstate: encrypt(creds.appstate) }); // facebook-messenger
    
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

    if (platform === Platforms.Discord) {
      const c = db.botCredentialDiscord.find((c: any) => c.userId === userId && c.sessionId === sessionId);
      credentials = { platform: Platforms.Discord, discordToken: decrypt(c.discordToken as string), discordClientId: c.discordClientId };
    } else if (platform === Platforms.Telegram) {
      const c = db.botCredentialTelegram.find((c: any) => c.userId === userId && c.sessionId === sessionId);
      credentials = { platform: Platforms.Telegram, telegramToken: decrypt(c.telegramToken as string) };
    } else if (platform === Platforms.FacebookPage) {
      const c = db.botCredentialFacebookPage.find((c: any) => c.userId === userId && c.sessionId === sessionId);
      credentials = { platform: Platforms.FacebookPage, fbAccessToken: decrypt(c.fbAccessToken as string), fbPageId: c.fbPageId };
    } else {
      const c = db.botCredentialFacebookMessenger.find((c: any) => c.userId === userId && c.sessionId === sessionId);
      credentials = { platform: Platforms.FacebookMessenger, appstate: decrypt(c.appstate as string) };
    }

    return { sessionId, userId, platformId: session.platformId, platform, nickname: session.nickname ?? '', prefix: session.prefix ?? '', admins, credentials };
  }

  async update(userId: string, sessionId: string, dto: UpdateBotRequestDto, isCredentialsModified: boolean = false): Promise<void> {
    const db = await getDb();
    const platformId = (PLATFORM_TO_ID as Record<string, number>)[dto.credentials.platform];
    const session = db.botSession.find((s: any) => s.userId === userId && s.sessionId === sessionId);
    if (!session) throw new Error('Bot not found');
    // Guard matches Prisma: admin deletions and credential updates use the incoming platformId,
    // so silently proceeding when it differs would corrupt those rows for the wrong platform.
    if (session.platformId !== platformId) throw new Error('Platform cannot be changed after bot creation.');
    
    session.nickname = dto.botNickname;
    session.prefix = dto.botPrefix;

    db.botAdmin = db.botAdmin.filter((a: any) => !(a.userId === userId && a.platformId === platformId && a.sessionId === sessionId));
    for (const adminId of dto.botAdmins) db.botAdmin.push({ userId, platformId, sessionId, adminId });

    const creds = dto.credentials;
    if (creds.platform === Platforms.Discord) {
      const c = db.botCredentialDiscord.find((c: any) => c.userId === userId && c.sessionId === sessionId);
      if (c) { c.discordToken = encrypt(creds.discordToken); c.discordClientId = creds.discordClientId; if (isCredentialsModified) { c.isCommandRegister = false; c.commandHash = null; } }
    } else if (creds.platform === Platforms.Telegram) {
      const c = db.botCredentialTelegram.find((c: any) => c.userId === userId && c.sessionId === sessionId);
      if (c) { c.telegramToken = encrypt(creds.telegramToken); if (isCredentialsModified) { c.isCommandRegister = false; c.commandHash = null; } }
    } else if (creds.platform === Platforms.FacebookPage) {
      const c = db.botCredentialFacebookPage.find((c: any) => c.userId === userId && c.sessionId === sessionId);
      if (c) { c.fbAccessToken = encrypt(creds.fbAccessToken); c.fbPageId = creds.fbPageId; }
    } else {
      const c = db.botCredentialFacebookMessenger.find((c: any) => c.userId === userId && c.sessionId === sessionId);
      if (c) c.appstate = encrypt(creds.appstate);
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

  /**
   * Removes all rows for this bot session from every JSON store array then persists once.
   * A single saveDb() at the end keeps I/O minimal — intermediate state stays in-memory only.
   */
  async deleteById(userId: string, sessionId: string): Promise<void> {
    const db = await getDb();
    const match = (r: any) => r.userId === userId && r.sessionId === sessionId;
    db.botSessionCommand          = db.botSessionCommand.filter((r: any) => !match(r));
    db.botSessionEvent            = db.botSessionEvent.filter((r: any) => !match(r));
    db.botUserBanned              = db.botUserBanned.filter((r: any) => !match(r));
    db.botThreadBanned            = db.botThreadBanned.filter((r: any) => !match(r));
    db.botUserSession             = db.botUserSession.filter((r: any) => !match(r));
    db.botThreadSession           = db.botThreadSession.filter((r: any) => !match(r));
    db.botAdmin                   = db.botAdmin.filter((r: any) => !match(r));
    db.botCredentialDiscord       = db.botCredentialDiscord.filter((r: any) => !match(r));
    db.botCredentialTelegram      = db.botCredentialTelegram.filter((r: any) => !match(r));
    db.botCredentialFacebookPage  = db.botCredentialFacebookPage.filter((r: any) => !match(r));
    db.botCredentialFacebookMessenger = db.botCredentialFacebookMessenger.filter((r: any) => !match(r));
    db.botSession                 = db.botSession.filter((r: any) => !match(r));
    await saveDb();
  }
}

export const botRepo = new BotRepo();
