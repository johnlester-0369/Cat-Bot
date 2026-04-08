import { prisma } from '../index.js';
import type { BotUserData } from '@cat-bot/engine/models/users.model.js';
import { toPlatformNumericId } from '@cat-bot/engine/utils/platform-id.util.js';

export async function upsertUser(data: BotUserData): Promise<void> {
  await prisma.botUser.upsert({
    where: { id: data.id },
    create: data,
    update: { name: data.name, firstName: data.firstName, username: data.username, avatarUrl: data.avatarUrl },
  });
}

// WHY: Fulfills the fallback requirement directly at the DB layer so callers never handle undefined.
export async function getUserName(userId: string): Promise<string> {
  const row = await prisma.botUser.findUnique({
    where: { id: userId },
    select: { name: true },
  });
  return row?.name ?? 'Unknown user';
}

export async function userExists(platform: string, userId: string): Promise<boolean> {
  const row = await prisma.botUser.findUnique({ where: { id: userId }, select: { platformId: true } });
  return row !== null;
}

export async function userSessionExists(userId: string, platform: string, sessionId: string, botUserId: string): Promise<boolean> {
  const row = await prisma.botUserSession.findUnique({
    where: { userId_platformId_sessionId_botUserId: { userId, platformId: toPlatformNumericId(platform), sessionId, botUserId } },
    select: { botUserId: true },
  });
  return row !== null;
}

export async function upsertUserSession(userId: string, platform: string, sessionId: string, botUserId: string): Promise<void> {
  const platformNumericId = toPlatformNumericId(platform);
  await prisma.botUserSession.upsert({
    where: { userId_platformId_sessionId_botUserId: { userId, platformId: platformNumericId, sessionId, botUserId } },
    create: { userId, platformId: platformNumericId, sessionId, botUserId },
    update: {},
  });
}
