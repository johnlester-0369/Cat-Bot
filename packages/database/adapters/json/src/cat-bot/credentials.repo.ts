import { getDb, saveDb } from '../store.js';
import {
  Platforms,
  PLATFORM_TO_ID,
} from '@cat-bot/engine/modules/platform/platform.constants.js';
import { toPlatformNumericId } from '@cat-bot/engine/modules/platform/platform-id.util.js';
import { decrypt } from '@cat-bot/engine/utils/crypto.util.js';

export async function findDiscordCredentialState(
  userId: string,
  sessionId: string,
): Promise<{ isCommandRegister: boolean; commandHash: string | null } | null> {
  const db = await getDb();
  const rec = db.botCredentialDiscord.find(
    (c: any) =>
      c.userId === userId &&
      c.platformId === PLATFORM_TO_ID[Platforms.Discord] &&
      c.sessionId === sessionId,
  );
  return rec
    ? { isCommandRegister: rec.isCommandRegister, commandHash: rec.commandHash }
    : null;
}

export async function updateDiscordCredentialCommandHash(
  userId: string,
  sessionId: string,
  data: { isCommandRegister: boolean; commandHash: string },
): Promise<void> {
  const db = await getDb();
  const rec = db.botCredentialDiscord.find(
    (c: any) =>
      c.userId === userId &&
      c.platformId === PLATFORM_TO_ID[Platforms.Discord] &&
      c.sessionId === sessionId,
  );
  // Mirror Prisma's update() which throws P2025 when the record is absent —
  // a missing credential at this call site means something is structurally wrong upstream.
  if (!rec) throw new Error('Credential record not found');
  rec.isCommandRegister = data.isCommandRegister;
  rec.commandHash = data.commandHash;
  await saveDb();
}

export async function findAllDiscordCredentials(): Promise<any[]> {
  const db = await getDb();
  return db.botCredentialDiscord.map((r: any) => ({
    ...r,
    discordToken: decrypt(r.discordToken as string),
  }));
}

export async function findTelegramCredentialState(
  userId: string,
  sessionId: string,
): Promise<{ isCommandRegister: boolean; commandHash: string | null } | null> {
  const db = await getDb();
  const rec = db.botCredentialTelegram.find(
    (c: any) =>
      c.userId === userId &&
      c.platformId === PLATFORM_TO_ID[Platforms.Telegram] &&
      c.sessionId === sessionId,
  );
  return rec
    ? { isCommandRegister: rec.isCommandRegister, commandHash: rec.commandHash }
    : null;
}

export async function updateTelegramCredentialCommandHash(
  userId: string,
  sessionId: string,
  data: { isCommandRegister: boolean; commandHash: string },
): Promise<void> {
  const db = await getDb();
  const rec = db.botCredentialTelegram.find(
    (c: any) =>
      c.userId === userId &&
      c.platformId === PLATFORM_TO_ID[Platforms.Telegram] &&
      c.sessionId === sessionId,
  );
  // Mirror Prisma's update() which throws P2025 when the record is absent —
  // a missing credential at this call site means something is structurally wrong upstream.
  if (!rec) throw new Error('Credential record not found');
  rec.isCommandRegister = data.isCommandRegister;
  rec.commandHash = data.commandHash;
  await saveDb();
}

export async function findAllTelegramCredentials(): Promise<any[]> {
  const db = await getDb();
  return db.botCredentialTelegram.map((r: any) => ({
    ...r,
    telegramToken: decrypt(r.telegramToken as string),
  }));
}
export async function findAllFbPageCredentials(): Promise<any[]> {
  const db = await getDb();
  return db.botCredentialFacebookPage.map((r: any) => ({
    ...r,
    fbAccessToken: decrypt(r.fbAccessToken as string),
  }));
}
export async function findAllFbMessengerCredentials(): Promise<any[]> {
  const db = await getDb();
  return db.botCredentialFacebookMessenger.map((r: any) => ({
    ...r,
    appstate: decrypt(r.appstate as string),
  }));
}
export async function findAllBotSessions(): Promise<any[]> {
  const db = await getDb();
  return [...db.botSession];
}

export async function isBotAdmin(
  userId: string,
  platform: string,
  sessionId: string,
  adminId: string,
): Promise<boolean> {
  const db = await getDb();
  const platformId = toPlatformNumericId(platform);
  return db.botAdmin.some(
    (a: any) =>
      a.userId === userId &&
      a.platformId === platformId &&
      a.sessionId === sessionId &&
      a.adminId === adminId,
  );
}

export async function addBotAdmin(
  userId: string,
  platform: string,
  sessionId: string,
  adminId: string,
): Promise<void> {
  const db = await getDb();
  const platformId = toPlatformNumericId(platform);
  // Guard prevents duplicate entries — mirrors Prisma upsert's idempotent contract.
  const exists = db.botAdmin.some(
    (a: any) =>
      a.userId === userId &&
      a.platformId === platformId &&
      a.sessionId === sessionId &&
      a.adminId === adminId,
  );
  if (!exists) db.botAdmin.push({ userId, platformId, sessionId, adminId });
  await saveDb();
}

export async function removeBotAdmin(
  userId: string,
  platform: string,
  sessionId: string,
  adminId: string,
): Promise<void> {
  const db = await getDb();
  const platformId = toPlatformNumericId(platform);
  // filter replaces the array in-place — no error when the record is absent (mirrors Prisma deleteMany).
  db.botAdmin = db.botAdmin.filter(
    (a: any) =>
      !(
        a.userId === userId &&
        a.platformId === platformId &&
        a.sessionId === sessionId &&
        a.adminId === adminId
      ),
  );
  await saveDb();
}

export async function listBotAdmins(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<string[]> {
  const db = await getDb();
  const platformId = toPlatformNumericId(platform);
  return db.botAdmin
    .filter(
      (a: any) =>
        a.userId === userId &&
        a.platformId === platformId &&
        a.sessionId === sessionId,
    )
    .map((a: any) => a.adminId as string)
    .sort();
}

/**
 * Persists a system prefix change to the bot_session row so the admin's choice
 * survives a process restart. updateMany semantics — silently no-ops when the
 * session row is absent (matches the fail-open contract of other session mutations).
 */
export async function updateBotSessionPrefix(
  userId: string,
  platform: string,
  sessionId: string,
  prefix: string,
): Promise<void> {
  const db = await getDb();
  const platformId = toPlatformNumericId(platform);
  const rec = db.botSession.find(
    (s: any) =>
      s.userId === userId &&
      s.platformId === platformId &&
      s.sessionId === sessionId,
  );
  if (rec) {
    rec.prefix = prefix;
    await saveDb();
  }
}

/**
 * Reads the bot's configured display name from the in-memory botSession array.
 * Returns null when no row matches or nickname was never set.
 */
export async function getBotNickname(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<string | null> {
  const db = await getDb();
  const platformId = toPlatformNumericId(platform);
  const rec = db.botSession.find(
    (s: any) =>
      s.userId === userId &&
      s.platformId === platformId &&
      s.sessionId === sessionId,
  );
  return (rec?.nickname as string | undefined) ?? null;
}

// ── Bot Premium ───────────────────────────────────────────────────────────────

export async function isBotPremium(
  userId: string,
  platform: string,
  sessionId: string,
  premiumId: string,
): Promise<boolean> {
  const db = await getDb();
  const platformId = toPlatformNumericId(platform);
  return db.botPremium.some(
    (p: any) =>
      p.userId === userId &&
      p.platformId === platformId &&
      p.sessionId === sessionId &&
      p.premiumId === premiumId,
  );
}

export async function addBotPremium(
  userId: string,
  platform: string,
  sessionId: string,
  premiumId: string,
): Promise<void> {
  const db = await getDb();
  const platformId = toPlatformNumericId(platform);
  // Guard prevents duplicates — mirrors Prisma upsert idempotent contract.
  const exists = db.botPremium.some(
    (p: any) =>
      p.userId === userId &&
      p.platformId === platformId &&
      p.sessionId === sessionId &&
      p.premiumId === premiumId,
  );
  if (!exists) db.botPremium.push({ userId, platformId, sessionId, premiumId });
  await saveDb();
}

export async function removeBotPremium(
  userId: string,
  platform: string,
  sessionId: string,
  premiumId: string,
): Promise<void> {
  const db = await getDb();
  const platformId = toPlatformNumericId(platform);
  // filter replaces array in-place — silent no-op when record is absent.
  db.botPremium = db.botPremium.filter(
    (p: any) =>
      !(
        p.userId === userId &&
        p.platformId === platformId &&
        p.sessionId === sessionId &&
        p.premiumId === premiumId
      ),
  );
  await saveDb();
}

export async function listBotPremiums(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<string[]> {
  const db = await getDb();
  const platformId = toPlatformNumericId(platform);
  return db.botPremium
    .filter(
      (p: any) =>
        p.userId === userId &&
        p.platformId === platformId &&
        p.sessionId === sessionId,
    )
    .map((p: any) => p.premiumId as string)
    .sort();
}
