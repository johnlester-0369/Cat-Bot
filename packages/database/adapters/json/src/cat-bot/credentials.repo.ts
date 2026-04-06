import { getDb, saveDb } from '../store.js';
import { Platforms, PLATFORM_TO_ID } from '@cat-bot/engine/constants/platform.constants.js';
import { toPlatformNumericId } from '@cat-bot/engine/utils/platform-id.util.js';

export async function findDiscordCredentialState(userId: string, sessionId: string): Promise<{ isCommandRegister: boolean; commandHash: string | null } | null> {
  const db = await getDb();
  const rec = db.botCredentialDiscord.find((c: any) => c.userId === userId && c.platformId === PLATFORM_TO_ID[Platforms.Discord] && c.sessionId === sessionId);
  return rec ? { isCommandRegister: rec.isCommandRegister, commandHash: rec.commandHash } : null;
}

export async function updateDiscordCredentialCommandHash(userId: string, sessionId: string, data: { isCommandRegister: boolean; commandHash: string }): Promise<void> {
  const db = await getDb();
  const rec = db.botCredentialDiscord.find((c: any) => c.userId === userId && c.platformId === PLATFORM_TO_ID[Platforms.Discord] && c.sessionId === sessionId);
  // Mirror Prisma's update() which throws P2025 when the record is absent —
  // a missing credential at this call site means something is structurally wrong upstream.
  if (!rec) throw new Error('Credential record not found');
  rec.isCommandRegister = data.isCommandRegister;
  rec.commandHash = data.commandHash;
  await saveDb();
}

export async function findAllDiscordCredentials(): Promise<any[]> { const db = await getDb(); return [...db.botCredentialDiscord]; }

export async function findTelegramCredentialState(userId: string, sessionId: string): Promise<{ isCommandRegister: boolean; commandHash: string | null } | null> {
  const db = await getDb();
  const rec = db.botCredentialTelegram.find((c: any) => c.userId === userId && c.platformId === PLATFORM_TO_ID[Platforms.Telegram] && c.sessionId === sessionId);
  return rec ? { isCommandRegister: rec.isCommandRegister, commandHash: rec.commandHash } : null;
}

export async function updateTelegramCredentialCommandHash(userId: string, sessionId: string, data: { isCommandRegister: boolean; commandHash: string }): Promise<void> {
  const db = await getDb();
  const rec = db.botCredentialTelegram.find((c: any) => c.userId === userId && c.platformId === PLATFORM_TO_ID[Platforms.Telegram] && c.sessionId === sessionId);
  // Mirror Prisma's update() which throws P2025 when the record is absent —
  // a missing credential at this call site means something is structurally wrong upstream.
  if (!rec) throw new Error('Credential record not found');
  rec.isCommandRegister = data.isCommandRegister;
  rec.commandHash = data.commandHash;
  await saveDb();
}

export async function findAllTelegramCredentials(): Promise<any[]> { const db = await getDb(); return [...db.botCredentialTelegram]; }
export async function findAllFbPageCredentials(): Promise<any[]> { const db = await getDb(); return [...db.botCredentialFacebookPage]; }
export async function findAllFbMessengerCredentials(): Promise<any[]> { const db = await getDb(); return [...db.botCredentialFacebookMessenger]; }
export async function findAllBotSessions(): Promise<any[]> { const db = await getDb(); return [...db.botSession]; }

export async function isBotAdmin(userId: string, platform: string, sessionId: string, adminId: string): Promise<boolean> {
  const db = await getDb();
  const platformId = toPlatformNumericId(platform);
  return db.botAdmin.some((a: any) => a.userId === userId && a.platformId === platformId && a.sessionId === sessionId && a.adminId === adminId);
}

export async function addBotAdmin(userId: string, platform: string, sessionId: string, adminId: string): Promise<void> {
  const db = await getDb();
  const platformId = toPlatformNumericId(platform);
  // Guard prevents duplicate entries — mirrors Prisma upsert's idempotent contract.
  const exists = db.botAdmin.some((a: any) => a.userId === userId && a.platformId === platformId && a.sessionId === sessionId && a.adminId === adminId);
  if (!exists) db.botAdmin.push({ userId, platformId, sessionId, adminId });
  await saveDb();
}

export async function removeBotAdmin(userId: string, platform: string, sessionId: string, adminId: string): Promise<void> {
  const db = await getDb();
  const platformId = toPlatformNumericId(platform);
  // filter replaces the array in-place — no error when the record is absent (mirrors Prisma deleteMany).
  db.botAdmin = db.botAdmin.filter((a: any) => !(a.userId === userId && a.platformId === platformId && a.sessionId === sessionId && a.adminId === adminId));
  await saveDb();
}

export async function listBotAdmins(userId: string, platform: string, sessionId: string): Promise<string[]> {
  const db = await getDb();
  const platformId = toPlatformNumericId(platform);
  return db.botAdmin
    .filter((a: any) => a.userId === userId && a.platformId === platformId && a.sessionId === sessionId)
    .map((a: any) => a.adminId as string)
    .sort();
}
