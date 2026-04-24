import { getMongoDb } from '../client.js';
import { ObjectId } from 'mongodb';
import {
  PLATFORM_TO_ID,
  ID_TO_PLATFORM,
  Platforms,
} from '@cat-bot/engine/modules/platform/platform.constants.js';
import type {
  CreateBotRequestDto,
  CreateBotResponseDto,
  GetBotListResponseDto,
  GetBotDetailResponseDto,
  UpdateBotRequestDto,
} from '@cat-bot/server/dtos/bot.dto.js';
import type { GetAdminBotListResponseDto } from '@cat-bot/server/dtos/admin.dto.js';
import { encrypt, decrypt } from '@cat-bot/engine/utils/crypto.util.js';

// NOTE: MongoDB transactions require a replica set. Atlas M0/M2/M5 free-tier clusters do
// NOT support replica-set transactions. Operations here are intentionally non-transactional
// (matching the json adapter) so the bot works on Atlas free tier out of the box.
// Users on paid Atlas tiers or self-hosted replica sets can wrap these in a session if needed.

export class BotRepo {
  async create(
    userId: string,
    sessionId: string,
    dto: CreateBotRequestDto,
  ): Promise<CreateBotResponseDto> {
    const db = getMongoDb();
    const platformId = (PLATFORM_TO_ID as Record<string, number>)[
      dto.credentials.platform
    ];
    if (platformId === undefined)
      throw new Error(`Unknown platform ${dto.credentials.platform}`);

    // isRunning: true mirrors the Prisma schema's @default(true) so session-loader picks
    // this session up on first boot without requiring an explicit API start call.
    await db.collection('botSessions').insertOne({
      userId,
      platformId,
      sessionId,
      nickname: dto.botNickname,
      prefix: dto.botPrefix,
      isRunning: true,
    });

    if (dto.botAdmins.length > 0) {
      await db.collection('botAdmins').insertMany(
        dto.botAdmins.map((adminId) => ({
          userId,
          platformId,
          sessionId,
          adminId,
        })),
      );
    }

    // Insert premium privileges if present
    if ((dto.botPremiums ?? []).length > 0) {
      await db.collection('botPremiums').insertMany(
        dto.botPremiums!.map((premiumId) => ({
          userId,
          platformId,
          sessionId,
          premiumId,
        })),
      );
    }

    const creds = dto.credentials;
    if (creds.platform === Platforms.Discord) {
      await db.collection('botCredentialDiscord').insertOne({
        userId,
        platformId,
        sessionId,
        discordToken: encrypt(creds.discordToken),
        discordClientId: creds.discordClientId,
        isCommandRegister: false,
        commandHash: null,
      });
    } else if (creds.platform === Platforms.Telegram) {
      await db.collection('botCredentialTelegram').insertOne({
        userId,
        platformId,
        sessionId,
        telegramToken: encrypt(creds.telegramToken),
        isCommandRegister: false,
        commandHash: null,
      });
    } else if (creds.platform === Platforms.FacebookPage) {
      await db.collection('botCredentialFacebookPage').insertOne({
        userId,
        platformId,
        sessionId,
        fbAccessToken: encrypt(creds.fbAccessToken),
        fbPageId: creds.fbPageId,
      });
    } else {
      await db.collection('botCredentialFacebookMessenger').insertOne({
        userId,
        platformId,
        sessionId,
        // Narrowed via exhaustive if-else — creds.platform is Platforms.FacebookMessenger here
        appstate: encrypt(
          (
            creds as {
              platform: typeof Platforms.FacebookMessenger;
              appstate: string;
            }
          ).appstate,
        ),
      });
    }

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
    const db = getMongoDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = await db
      .collection<any>('botSessions')
      .findOne({ userId, sessionId }, { projection: { _id: 0 } });
    if (!session) return null;

    const platform = (ID_TO_PLATFORM as Record<number, string>)[
      session.platformId as number
    ];
    if (!platform) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adminDocs = await db
      .collection<{ adminId: string }>('botAdmins')
      .find({ userId, sessionId }, { projection: { adminId: 1, _id: 0 } })
      .toArray();
    const admins = adminDocs.map((a) => a.adminId);

    // Fetch premium privileges to satisfy GetBotDetailResponseDto
    const premiumDocs = await db
      .collection<{ premiumId: string }>('botPremiums')
      .find({ userId, sessionId }, { projection: { premiumId: 1, _id: 0 } })
      .toArray();
    const premiums = premiumDocs.map((p) => p.premiumId);

    let credentials: GetBotDetailResponseDto['credentials'];

    if (platform === Platforms.Discord) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = await db
        .collection<any>('botCredentialDiscord')
        .findOne({ userId, sessionId });
      if (!c) throw new Error('Missing credentials');
      credentials = {
        platform: Platforms.Discord,
        discordToken: decrypt(c.discordToken as string),
        discordClientId: c.discordClientId as string,
      };
    } else if (platform === Platforms.Telegram) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = await db
        .collection<any>('botCredentialTelegram')
        .findOne({ userId, sessionId });
      if (!c) throw new Error('Missing credentials');
      credentials = {
        platform: Platforms.Telegram,
        telegramToken: decrypt(c.telegramToken as string),
      };
    } else if (platform === Platforms.FacebookPage) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = await db
        .collection<any>('botCredentialFacebookPage')
        .findOne({ userId, sessionId });
      if (!c) throw new Error('Missing credentials');
      credentials = {
        platform: Platforms.FacebookPage,
        fbAccessToken: decrypt(c.fbAccessToken as string),
        fbPageId: c.fbPageId as string,
      };
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = await db
        .collection<any>('botCredentialFacebookMessenger')
        .findOne({ userId, sessionId });
      if (!c) throw new Error('Missing credentials');
      credentials = {
        platform: Platforms.FacebookMessenger,
        appstate: decrypt(c.appstate as string),
      };
    }

    return {
      sessionId,
      userId,
      platformId: session.platformId as number,
      platform,
      nickname: (session.nickname as string | undefined) ?? '',
      prefix: (session.prefix as string | undefined) ?? '',
      admins,
      premiums,
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
    const platformId = (PLATFORM_TO_ID as Record<string, number>)[
      dto.credentials.platform
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = await db
      .collection<any>('botSessions')
      .findOne({ userId, sessionId }, { projection: { _id: 0 } });
    if (!session) throw new Error('Bot not found');
    // Guard matches Prisma: platform is part of the composite PK; changing it would corrupt
    // all credential documents that are keyed by (userId, platformId, sessionId).
    if ((session.platformId as number) !== platformId)
      throw new Error('Platform cannot be changed after bot creation.');

    await db
      .collection('botSessions')
      .updateOne(
        { userId, platformId, sessionId },
        { $set: { nickname: dto.botNickname, prefix: dto.botPrefix } },
      );

    // Replace all admins atomically by deleting then re-inserting — mirrors Prisma's deleteMany + create loop.
    await db
      .collection('botAdmins')
      .deleteMany({ userId, platformId, sessionId });
    if (dto.botAdmins.length > 0) {
      await db.collection('botAdmins').insertMany(
        dto.botAdmins.map((adminId) => ({
          userId,
          platformId,
          sessionId,
          adminId,
        })),
      );
    }

    // Replace all premiums atomically by deleting then re-inserting
    await db
      .collection('botPremiums')
      .deleteMany({ userId, platformId, sessionId });
    if ((dto.botPremiums ?? []).length > 0) {
      await db.collection('botPremiums').insertMany(
        dto.botPremiums!.map((premiumId) => ({
          userId,
          platformId,
          sessionId,
          premiumId,
        })),
      );
    }

    const creds = dto.credentials;
    if (creds.platform === Platforms.Discord) {
      await db.collection('botCredentialDiscord').updateOne(
        { userId, sessionId },
        {
          $set: {
            discordToken: encrypt(creds.discordToken),
            discordClientId: creds.discordClientId,
            ...(isCredentialsModified
              ? { isCommandRegister: false, commandHash: null }
              : {}),
          },
        },
      );
    } else if (creds.platform === Platforms.Telegram) {
      await db.collection('botCredentialTelegram').updateOne(
        { userId, sessionId },
        {
          $set: {
            telegramToken: encrypt(creds.telegramToken),
            ...(isCredentialsModified
              ? { isCommandRegister: false, commandHash: null }
              : {}),
          },
        },
      );
    } else if (creds.platform === Platforms.FacebookPage) {
      await db.collection('botCredentialFacebookPage').updateOne(
        { userId, sessionId },
        {
          $set: {
            fbAccessToken: encrypt(creds.fbAccessToken),
            fbPageId: creds.fbPageId,
          },
        },
      );
    } else {
      await db.collection('botCredentialFacebookMessenger').updateOne(
        { userId, sessionId },
        {
          $set: {
            appstate: encrypt(
              (
                creds as {
                  platform: typeof Platforms.FacebookMessenger;
                  appstate: string;
                }
              ).appstate,
            ),
          },
        },
      );
    }
  }

  async list(userId: string): Promise<GetBotListResponseDto> {
    const db = getMongoDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await db
      .collection<any>('botSessions')
      .find({ userId })
      .toArray();
    return {
      bots: rows.map((r) => ({
        sessionId: r.sessionId as string,
        platformId: r.platformId as number,
        platform:
          (ID_TO_PLATFORM as Record<number, string>)[r.platformId as number] ??
          '',
        nickname: (r.nickname as string | undefined) ?? '',
        prefix: (r.prefix as string | undefined) ?? '',
      })),
    };
  }

  async updateIsRunning(
    userId: string,
    sessionId: string,
    isRunning: boolean,
  ): Promise<void> {
    const db = getMongoDb();
    await db
      .collection('botSessions')
      .updateOne({ userId, sessionId }, { $set: { isRunning } });
  }

  async getPlatformId(
    userId: string,
    sessionId: string,
  ): Promise<number | null> {
    const db = getMongoDb();
    const rec = await db
      .collection<{ platformId: number }>('botSessions')
      .findOne(
        { userId, sessionId },
        { projection: { platformId: 1, _id: 0 } },
      );
    return rec?.platformId ?? null;
  }

  // Returns every bot session across all owners — used only by admin dashboard endpoints.
  async listAll(search: string = '', page: number = 1, limit: number = 10): Promise<GetAdminBotListResponseDto> {
    const db = getMongoDb();
    
    // Execute filtering, joining, and pagination completely within the MongoDB engine.
    // Handle ObjectID mapping and fallback to 'users' collection to ensure owner is found.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pipeline: any[] = [
      {
        $lookup: {
          from: 'user',
          let: { uid: '$userId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ['$_id', '$$uid'] },
                    { $eq: ['$id', '$$uid'] },
                    { $eq: [{ $toString: '$_id' }, '$$uid'] }
                  ]
                }
              }
            }
          ],
          as: 'owner_user'
        }
      },
      {
        $lookup: {
          from: 'users',
          let: { uid: '$userId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ['$_id', '$$uid'] },
                    { $eq: ['$id', '$$uid'] },
                    { $eq: [{ $toString: '$_id' }, '$$uid'] }
                  ]
                }
              }
            }
          ],
          as: 'owner_users'
        }
      },
      {
        $addFields: {
          // Prefer the 'user' collection result, fallback to 'users'
          owner: {
            $cond: {
              if: { $gt: [{ $size: '$owner_user' }, 0] },
              then: { $arrayElemAt: ['$owner_user', 0] },
              else: {
                $cond: {
                  if: { $gt: [{ $size: '$owner_users' }, 0] },
                  then: { $arrayElemAt: ['$owner_users', 0] },
                  else: null
                }
              }
            }
          }
        }
      },
      {
        $project: {
          owner_user: 0,
          owner_users: 0
        }
      }
    ];

    if (search) {
      // WHY: Escape regex characters to prevent SyntaxError crashes and ReDoS attacks
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escapedSearch, 'i');
      const platformIdMatches: number[] =[];
      for (const [idStr, platStr] of Object.entries(ID_TO_PLATFORM)) {
        if ((platStr as string).toLowerCase().includes(search.toLowerCase())) {
          platformIdMatches.push(parseInt(idStr, 10));
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const matchOr: any[] =[
        { nickname: { $regex: searchRegex } },
        { 'owner.name': { $regex: searchRegex } },
        { 'owner.email': { $regex: searchRegex } }
      ];

      if (platformIdMatches.length > 0) {
        matchOr.push({ platformId: { $in: platformIdMatches } });
      }

      pipeline.push({ $match: { $or: matchOr } });
    }

    // Process skip, limit, and total count simultaneously using MongoDB Facets
    pipeline.push({
      $facet: {
        metadata: [{ $count: 'total' }],
        data:[
          { $sort: { userId: 1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit }
        ]
      }
    });

    const [result] = await db.collection('botSessions').aggregate(pipeline).toArray();
    
    const total = result?.metadata[0]?.total ?? 0;
    const paginated = result?.data ??[];

    const statsPipeline =[
      {
        $group: {
          _id: '$platformId',
          total: { $sum: 1 },
          active: { $sum: { $cond: ['$isRunning', 1, 0] } }
        }
      }
    ];
    
    const statsResult = await db.collection('botSessions').aggregate(statsPipeline).toArray();

    const platformDist: Record<string, number> = {};
    const platformActiveDist: Record<string, number> = {};
    let totalBots = 0;
    let activeBots = 0;

    for (const stat of statsResult) {
      const platStr = (ID_TO_PLATFORM as Record<number, string>)[stat._id as number] ?? '';
      platformDist[platStr] = stat.total;
      platformActiveDist[platStr] = stat.active;
      totalBots += stat.total;
      activeBots += stat.active;
    }

    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      bots: paginated.map((r: any) => {
        return {
          sessionId: r.sessionId as string,
          userId: r.userId as string,
          platformId: r.platformId as number,
          platform:
            (ID_TO_PLATFORM as Record<number, string>)[r.platformId as number] ?? '',
          nickname: (r.nickname as string | undefined) ?? '',
          prefix: (r.prefix as string | undefined) ?? '',
          isRunning: (r.isRunning as boolean | undefined) ?? false,
          userName: r.owner?.name ?? undefined,
          userEmail: r.owner?.email ?? undefined,
        };
      }),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      stats: { totalBots, activeBots, platformDist, platformActiveDist }
    };
  }

  /**
   * Permanently removes every document tied to this bot session across all collections.
   * MongoDB Atlas free tier does not support multi-document transactions, so this is a
   * sequential deleteMany series — matches the json adapter's non-transactional pattern.
   * Collection names mirror those used by the other MongoDB repos in this adapter.
   */
  async deleteById(userId: string, sessionId: string): Promise<void> {
    const db = getMongoDb();
    await db.collection('botSessionCommand').deleteMany({ userId, sessionId });
    await db.collection('botSessionEvent').deleteMany({ userId, sessionId });
    await db.collection('botUserBanned').deleteMany({ userId, sessionId });
    await db.collection('botThreadBanned').deleteMany({ userId, sessionId });
    await db.collection('botUserSession').deleteMany({ userId, sessionId });
    await db.collection('botThreadSession').deleteMany({ userId, sessionId });
    await db.collection('botAdmins').deleteMany({ userId, sessionId });
    await db.collection('botPremiums').deleteMany({ userId, sessionId });
    await db
      .collection('botCredentialDiscord')
      .deleteMany({ userId, sessionId });
    await db
      .collection('botCredentialTelegram')
      .deleteMany({ userId, sessionId });
    await db
      .collection('botCredentialFacebookPage')
      .deleteMany({ userId, sessionId });
    await db
      .collection('botCredentialFacebookMessenger')
      .deleteMany({ userId, sessionId });
    await db.collection('botSessions').deleteMany({ userId, sessionId });
  }
}

export const botRepo = new BotRepo();
