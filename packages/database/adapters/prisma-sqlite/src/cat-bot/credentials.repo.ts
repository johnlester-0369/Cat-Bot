import { prisma } from '../index.js';
import type { BotCredentialDiscord, BotCredentialTelegram, BotCredentialFacebookPage, BotCredentialFacebookMessenger, BotSession } from '../index.js';
import { Platforms, PLATFORM_TO_ID } from '@cat-bot/engine/constants/platform.constants.js';
import { toPlatformNumericId } from '@cat-bot/engine/utils/platform-id.util.js';
import { decrypt } from '@cat-bot/engine/utils/crypto.util.js';

export async function findDiscordCredentialState(userId: string, sessionId: string): Promise<{ isCommandRegister: boolean; commandHash: string | null } | null> {
  return prisma.botCredentialDiscord.findUnique({
    where: { userId_platformId_sessionId: { userId, platformId: PLATFORM_TO_ID[Platforms.Discord], sessionId } },
    select: { isCommandRegister: true, commandHash: true },
  });
}

export async function updateDiscordCredentialCommandHash(userId: string, sessionId: string, data: { isCommandRegister: boolean; commandHash: string }): Promise<void> {
  await prisma.botCredentialDiscord.update({
    where: { userId_platformId_sessionId: { userId, platformId: PLATFORM_TO_ID[Platforms.Discord], sessionId } },
    data,
  });
}

export async function findAllDiscordCredentials(): Promise<BotCredentialDiscord[]> { const rows = await prisma.botCredentialDiscord.findMany(); return rows.map(r => ({ ...r, discordToken: decrypt(r.discordToken) })); }

export async function findTelegramCredentialState(userId: string, sessionId: string): Promise<{ isCommandRegister: boolean; commandHash: string | null } | null> {
  return prisma.botCredentialTelegram.findUnique({
    where: { userId_platformId_sessionId: { userId, platformId: PLATFORM_TO_ID[Platforms.Telegram], sessionId } },
    select: { isCommandRegister: true, commandHash: true },
  });
}

export async function updateTelegramCredentialCommandHash(userId: string, sessionId: string, data: { isCommandRegister: boolean; commandHash: string }): Promise<void> {
  await prisma.botCredentialTelegram.update({
    where: { userId_platformId_sessionId: { userId, platformId: PLATFORM_TO_ID[Platforms.Telegram], sessionId } },
    data,
  });
}

export async function findAllTelegramCredentials(): Promise<BotCredentialTelegram[]> { const rows = await prisma.botCredentialTelegram.findMany(); return rows.map(r => ({ ...r, telegramToken: decrypt(r.telegramToken) })); }
export async function findAllFbPageCredentials(): Promise<BotCredentialFacebookPage[]> { const rows = await prisma.botCredentialFacebookPage.findMany(); return rows.map(r => ({ ...r, fbAccessToken: decrypt(r.fbAccessToken) })); }
export async function findAllFbMessengerCredentials(): Promise<BotCredentialFacebookMessenger[]> { const rows = await prisma.botCredentialFacebookMessenger.findMany(); return rows.map(r => ({ ...r, appstate: decrypt(r.appstate) })); }
export async function findAllBotSessions(): Promise<BotSession[]> { return prisma.botSession.findMany(); }

export async function isBotAdmin(userId: string, platform: string, sessionId: string, adminId: string): Promise<boolean> {
  const row = await prisma.botAdmin.findUnique({
    where: { userId_platformId_sessionId_adminId: { userId, platformId: toPlatformNumericId(platform), sessionId, adminId } },
    select: { adminId: true },
  });
  return row !== null;
}

export async function addBotAdmin(userId: string, platform: string, sessionId: string, adminId: string): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  // upsert instead of create — idempotent when the same uid is added twice; avoids
  // unique-constraint violations if the dashboard and an in-chat /admin add race.
  await prisma.botAdmin.upsert({
    where: { userId_platformId_sessionId_adminId: { userId, platformId, sessionId, adminId } },
    create: { userId, platformId, sessionId, adminId },
    update: {},
  });
}

export async function removeBotAdmin(userId: string, platform: string, sessionId: string, adminId: string): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  // deleteMany instead of delete — avoids Prisma P2025 "record not found" when the uid
  // was never registered; the caller treats a no-op as a success (already not an admin).
  await prisma.botAdmin.deleteMany({
    where: { userId, platformId, sessionId, adminId },
  });
}

export async function listBotAdmins(userId: string, platform: string, sessionId: string): Promise<string[]> {
  const platformId = toPlatformNumericId(platform);
  const rows = await prisma.botAdmin.findMany({
    where: { userId, platformId, sessionId },
    select: { adminId: true },
    orderBy: { adminId: 'asc' },
  });
  return rows.map((r) => r.adminId);
}
