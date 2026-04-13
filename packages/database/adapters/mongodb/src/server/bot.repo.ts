import { getMongoDb } from '../client.js';
import { PLATFORM_TO_ID, ID_TO_PLATFORM } from '@cat-bot/engine/modules/platform/platform.constants.js';
import type {
  CreateBotRequestDto,
  CreateBotResponseDto,
  GetBotListResponseDto,
  GetBotDetailResponseDto,
  UpdateBotRequestDto,
} from '@cat-bot/server/dtos/bot.dto.js';
import { encrypt, decrypt } from '@cat-bot/engine/utils/crypto.util.js';

// NOTE: MongoDB transactions require a replica set. Atlas M0/M2/M5 free-tier clusters do
// NOT support replica-set transactions. Operations here are intentionally non-transactional
// (matching the json adapter) so the bot works on Atlas free tier out of the box.
// Users on paid Atlas tiers or self-hosted replica sets can wrap these in a session if needed.

export class BotRepo {
  async create(userId: string, sessionId: string, dto: CreateBotRequestDto): Promise<CreateBotResponseDto> {
    const db = getMongoDb();
    const platformId =
      (PLATFORM_TO_ID as Record<string, number>)[dto.credentials.platform] ??
      (PLATFORM_TO_ID as Record<string, number>)[dto.credentials.platform.replace('_', '-')];
    if (platformId === undefined) throw new Error(`Unknown platform ${dto.credentials.platform}`);

    // isRunning: true mirrors the Prisma schema's @default(true) so session-loader picks
    // this session up on first boot without requiring an explicit API start call.
    await db.collection('botSessions').insertOne({
      userId, platformId, sessionId,
      nickname: dto.botNickname, prefix: dto.botPrefix,
      isRunning: true,
    });

    if (dto.botAdmins.length > 0) {
      await db.collection('botAdmins').insertMany(
        dto.botAdmins.map((adminId) => ({ userId, platformId, sessionId, adminId })),
      );
    }

    const creds = dto.credentials;
    if (creds.platform === 'discord') {
      await db.collection('botCredentialDiscord').insertOne({
        userId, platformId, sessionId,
        discordToken: encrypt(creds.discordToken),
        discordClientId: creds.discordClientId,
        isCommandRegister: false, commandHash: null,
      });
    } else if (creds.platform === 'telegram') {
      await db.collection('botCredentialTelegram').insertOne({
        userId, platformId, sessionId,
        telegramToken: encrypt(creds.telegramToken),
        isCommandRegister: false, commandHash: null,
      });
    } else if (creds.platform === 'facebook_page') {
      await db.collection('botCredentialFacebookPage').insertOne({
        userId, platformId, sessionId,
        fbAccessToken: encrypt(creds.fbAccessToken),
        fbPageId: creds.fbPageId,
      });
    } else {
      await db.collection('botCredentialFacebookMessenger').insertOne({
        userId, platformId, sessionId,
        // Narrowed via exhaustive if-else — creds.platform must be 'facebook_messenger' here
        appstate: encrypt((creds as { platform: 'facebook_messenger'; appstate: string }).appstate),
      });
    }

    return { sessionId, userId, platformId, nickname: dto.botNickname, prefix: dto.botPrefix };
  }

  async getById(userId: string, sessionId: string): Promise<GetBotDetailResponseDto | null> {
    const db = getMongoDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = await db.collection<any>('botSessions').findOne({ userId, sessionId }, { projection: { _id: 0 } });
    if (!session) return null;

    const platform = (ID_TO_PLATFORM as Record<number, string>)[session.platformId as number];
    if (!platform) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adminDocs = await db.collection<{ adminId: string }>('botAdmins')
      .find({ userId, sessionId }, { projection: { adminId: 1, _id: 0 } })
      .toArray();
    const admins = adminDocs.map((a) => a.adminId);

    const normalizedPlatform = platform.replace('-', '_');
    let credentials: GetBotDetailResponseDto['credentials'];

    if (normalizedPlatform === 'discord') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = await db.collection<any>('botCredentialDiscord').findOne({ userId, sessionId });
      if (!c) throw new Error('Missing credentials');
      credentials = { platform: 'discord', discordToken: decrypt(c.discordToken as string), discordClientId: c.discordClientId as string };
    } else if (normalizedPlatform === 'telegram') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = await db.collection<any>('botCredentialTelegram').findOne({ userId, sessionId });
      if (!c) throw new Error('Missing credentials');
      credentials = { platform: 'telegram', telegramToken: decrypt(c.telegramToken as string) };
    } else if (normalizedPlatform === 'facebook_page') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = await db.collection<any>('botCredentialFacebookPage').findOne({ userId, sessionId });
      if (!c) throw new Error('Missing credentials');
      credentials = { platform: 'facebook_page', fbAccessToken: decrypt(c.fbAccessToken as string), fbPageId: c.fbPageId as string };
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = await db.collection<any>('botCredentialFacebookMessenger').findOne({ userId, sessionId });
      if (!c) throw new Error('Missing credentials');
      credentials = { platform: 'facebook_messenger', appstate: decrypt(c.appstate as string) };
    }

    return {
      sessionId,
      userId,
      platformId: session.platformId as number,
      platform,
      nickname: (session.nickname as string | undefined) ?? '',
      prefix:   (session.prefix   as string | undefined) ?? '',
      admins,
      credentials,
    };
  }

  async update(
    userId: string,
    sessionId: string,
    dto: UpdateBotRequestDto,
    isCredentialsModified = false,
  ): Promise<void> {
    const db = getMongoDb();
    const platformId =
      (PLATFORM_TO_ID as Record<string, number>)[dto.credentials.platform] ??
      (PLATFORM_TO_ID as Record<string, number>)[dto.credentials.platform.replace('_', '-')];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = await db.collection<any>('botSessions').findOne({ userId, sessionId }, { projection: { _id: 0 } });
    if (!session) throw new Error('Bot not found');
    // Guard matches Prisma: platform is part of the composite PK; changing it would corrupt
    // all credential documents that are keyed by (userId, platformId, sessionId).
    if ((session.platformId as number) !== platformId) throw new Error('Platform cannot be changed after bot creation.');

    await db.collection('botSessions').updateOne(
      { userId, platformId, sessionId },
      { $set: { nickname: dto.botNickname, prefix: dto.botPrefix } },
    );

    // Replace all admins atomically by deleting then re-inserting — mirrors Prisma's deleteMany + create loop.
    await db.collection('botAdmins').deleteMany({ userId, platformId, sessionId });
    if (dto.botAdmins.length > 0) {
      await db.collection('botAdmins').insertMany(
        dto.botAdmins.map((adminId) => ({ userId, platformId, sessionId, adminId })),
      );
    }

    const creds = dto.credentials;
    if (creds.platform === 'discord') {
      await db.collection('botCredentialDiscord').updateOne(
        { userId, sessionId },
        {
          $set: {
            discordToken:    encrypt(creds.discordToken),
            discordClientId: creds.discordClientId,
            ...(isCredentialsModified ? { isCommandRegister: false, commandHash: null } : {}),
          },
        },
      );
    } else if (creds.platform === 'telegram') {
      await db.collection('botCredentialTelegram').updateOne(
        { userId, sessionId },
        {
          $set: {
            telegramToken: encrypt(creds.telegramToken),
            ...(isCredentialsModified ? { isCommandRegister: false, commandHash: null } : {}),
          },
        },
      );
    } else if (creds.platform === 'facebook_page') {
      await db.collection('botCredentialFacebookPage').updateOne(
        { userId, sessionId },
        { $set: { fbAccessToken: encrypt(creds.fbAccessToken), fbPageId: creds.fbPageId } },
      );
    } else {
      await db.collection('botCredentialFacebookMessenger').updateOne(
        { userId, sessionId },
        { $set: { appstate: encrypt((creds as { platform: 'facebook_messenger'; appstate: string }).appstate) } },
      );
    }
  }

  async list(userId: string): Promise<GetBotListResponseDto> {
    const db = getMongoDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await db.collection<any>('botSessions').find({ userId }).toArray();
    return {
      bots: rows.map((r) => ({
        sessionId:  r.sessionId as string,
        platformId: r.platformId as number,
        platform:   (ID_TO_PLATFORM as Record<number, string>)[r.platformId as number] ?? '',
        nickname:   (r.nickname as string | undefined) ?? '',
        prefix:     (r.prefix   as string | undefined) ?? '',
      })),
    };
  }

  async updateIsRunning(userId: string, sessionId: string, isRunning: boolean): Promise<void> {
    const db = getMongoDb();
    await db.collection('botSessions').updateOne({ userId, sessionId }, { $set: { isRunning } });
  }

  async getPlatformId(userId: string, sessionId: string): Promise<number | null> {
    const db = getMongoDb();
    const rec = await db
      .collection<{ platformId: number }>('botSessions')
      .findOne({ userId, sessionId }, { projection: { platformId: 1, _id: 0 } });
    return rec?.platformId ?? null;
  }
}

export const botRepo = new BotRepo();
