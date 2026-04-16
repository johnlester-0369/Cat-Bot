import { getMongoDb } from '../client.js';
import { Platforms, PLATFORM_TO_ID } from '@cat-bot/engine/modules/platform/platform.constants.js';
import { toPlatformNumericId } from '@cat-bot/engine/modules/platform/platform-id.util.js';
import { decrypt } from '@cat-bot/engine/utils/crypto.util.js';

// ── Discord ───────────────────────────────────────────────────────────────────

export async function findDiscordCredentialState(
  userId: string,
  sessionId: string,
): Promise<{ isCommandRegister: boolean; commandHash: string | null } | null> {
  const db = getMongoDb();
  const rec = await db
    .collection<{ isCommandRegister: boolean; commandHash: string | null }>('botCredentialDiscord')
    .findOne(
      { userId, platformId: PLATFORM_TO_ID[Platforms.Discord], sessionId },
      { projection: { isCommandRegister: 1, commandHash: 1, _id: 0 } },
    );
  return rec ?? null;
}

export async function updateDiscordCredentialCommandHash(
  userId: string,
  sessionId: string,
  data: { isCommandRegister: boolean; commandHash: string },
): Promise<void> {
  const db = getMongoDb();
  const result = await db.collection('botCredentialDiscord').updateOne(
    { userId, platformId: PLATFORM_TO_ID[Platforms.Discord], sessionId },
    { $set: data },
  );
  // Mirror Prisma's update() which throws P2025 when the record is absent.
  if (result.matchedCount === 0) throw new Error('Credential record not found');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function findAllDiscordCredentials(): Promise<any[]> {
  const db = getMongoDb();
  const rows = await db.collection('botCredentialDiscord').find({}, { projection: { _id: 0 } }).toArray();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((r: any) => ({ ...r, discordToken: decrypt(r.discordToken as string) }));
}

// ── Telegram ──────────────────────────────────────────────────────────────────

export async function findTelegramCredentialState(
  userId: string,
  sessionId: string,
): Promise<{ isCommandRegister: boolean; commandHash: string | null } | null> {
  const db = getMongoDb();
  const rec = await db
    .collection<{ isCommandRegister: boolean; commandHash: string | null }>('botCredentialTelegram')
    .findOne(
      { userId, platformId: PLATFORM_TO_ID[Platforms.Telegram], sessionId },
      { projection: { isCommandRegister: 1, commandHash: 1, _id: 0 } },
    );
  return rec ?? null;
}

export async function updateTelegramCredentialCommandHash(
  userId: string,
  sessionId: string,
  data: { isCommandRegister: boolean; commandHash: string },
): Promise<void> {
  const db = getMongoDb();
  const result = await db.collection('botCredentialTelegram').updateOne(
    { userId, platformId: PLATFORM_TO_ID[Platforms.Telegram], sessionId },
    { $set: data },
  );
  if (result.matchedCount === 0) throw new Error('Credential record not found');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function findAllTelegramCredentials(): Promise<any[]> {
  const db = getMongoDb();
  const rows = await db.collection('botCredentialTelegram').find({}, { projection: { _id: 0 } }).toArray();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((r: any) => ({ ...r, telegramToken: decrypt(r.telegramToken as string) }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function findAllFbPageCredentials(): Promise<any[]> {
  const db = getMongoDb();
  const rows = await db.collection('botCredentialFacebookPage').find({}, { projection: { _id: 0 } }).toArray();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((r: any) => ({ ...r, fbAccessToken: decrypt(r.fbAccessToken as string) }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function findAllFbMessengerCredentials(): Promise<any[]> {
  const db = getMongoDb();
  const rows = await db.collection('botCredentialFacebookMessenger').find({}, { projection: { _id: 0 } }).toArray();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((r: any) => ({ ...r, appstate: decrypt(r.appstate as string) }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function findAllBotSessions(): Promise<any[]> {
  const db = getMongoDb();
  return db.collection('botSessions').find({}, { projection: { _id: 0 } }).toArray();
}

// ── Bot Admin ─────────────────────────────────────────────────────────────────

export async function isBotAdmin(
  userId: string,
  platform: string,
  sessionId: string,
  adminId: string,
): Promise<boolean> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  const rec = await db
    .collection('botAdmins')
    .findOne({ userId, platformId, sessionId, adminId }, { projection: { _id: 1 } });
  return rec !== null;
}

export async function addBotAdmin(
  userId: string,
  platform: string,
  sessionId: string,
  adminId: string,
): Promise<void> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  // upsert — idempotent when the same adminId is added twice; avoids duplicate key errors
  // if the dashboard and an in-chat /admin command race each other.
  await db.collection('botAdmins').updateOne(
    { userId, platformId, sessionId, adminId },
    { $setOnInsert: { userId, platformId, sessionId, adminId } },
    { upsert: true },
  );
}

export async function removeBotAdmin(
  userId: string,
  platform: string,
  sessionId: string,
  adminId: string,
): Promise<void> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  // deleteOne no-ops when absent — mirrors Prisma deleteMany fail-open contract.
  await db.collection('botAdmins').deleteOne({ userId, platformId, sessionId, adminId });
}

export async function listBotAdmins(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<string[]> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  const rows = await db
    .collection<{ adminId: string }>('botAdmins')
    .find({ userId, platformId, sessionId }, { projection: { adminId: 1, _id: 0 } })
    .sort({ adminId: 1 })
    .toArray();
  return rows.map((r) => r.adminId);
}

// ── Session prefix ────────────────────────────────────────────────────────────

/**
 * Persists a system prefix change to the bot session row so the admin's choice
 * survives a process restart. updateOne no-ops when the row is absent —
 * same fail-open contract as other updateMany mutations in the other adapters.
 */
export async function updateBotSessionPrefix(
  userId: string,
  platform: string,
  sessionId: string,
  prefix: string,
): Promise<void> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  await db.collection('botSessions').updateOne(
    { userId, platformId, sessionId },
    { $set: { prefix } },
  );
}

/**
 * Reads the bot's configured display name from the botSessions collection.
 * Returns null when no document matches or nickname field is absent.
 */
export async function getBotNickname(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<string | null> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  const rec = await db
    .collection<{ nickname?: string }>('botSessions')
    .findOne({ userId, platformId, sessionId }, { projection: { nickname: 1, _id: 0 } });
  return rec?.nickname ?? null;
}

// ── Bot Premium ───────────────────────────────────────────────────────────────

export async function isBotPremium(
  userId: string,
  platform: string,
  sessionId: string,
  premiumId: string,
): Promise<boolean> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  const rec = await db
    .collection('botPremiums')
    .findOne({ userId, platformId, sessionId, premiumId }, { projection: { _id: 1 } });
  return rec !== null;
}

export async function addBotPremium(
  userId: string,
  platform: string,
  sessionId: string,
  premiumId: string,
): Promise<void> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  // $setOnInsert is idempotent — a duplicate premiumId upsert silently no-ops.
  await db.collection('botPremiums').updateOne(
    { userId, platformId, sessionId, premiumId },
    { $setOnInsert: { userId, platformId, sessionId, premiumId } },
    { upsert: true },
  );
}

export async function removeBotPremium(
  userId: string,
  platform: string,
  sessionId: string,
  premiumId: string,
): Promise<void> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  // deleteOne no-ops when absent — mirrors Prisma deleteMany fail-open contract.
  await db.collection('botPremiums').deleteOne({ userId, platformId, sessionId, premiumId });
}

export async function listBotPremiums(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<string[]> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  const rows = await db
    .collection<{ premiumId: string }>('botPremiums')
    .find({ userId, platformId, sessionId }, { projection: { premiumId: 1, _id: 0 } })
    .sort({ premiumId: 1 })
    .toArray();
  return rows.map((r) => r.premiumId);
}
