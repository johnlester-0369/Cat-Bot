import { prisma } from '../index.js';
import type { BotThreadData } from '@cat-bot/engine/models/threads.model.js';
import { toPlatformNumericId } from '@cat-bot/engine/utils/platform-id.util.js';

export async function upsertThread(data: BotThreadData): Promise<void> {
  const allUserIds = Array.from(new Set([...data.participantIDs, ...data.adminIDs]));
  if (allUserIds.length > 0) {
    const existing = await prisma.botUser.findMany({ where: { id: { in: allUserIds } }, select: { id: true } });
    const existingIds = new Set(existing.map((u) => u.id));
    const toCreate = allUserIds.filter((id) => !existingIds.has(id)).map((id) => ({ platformId: data.platformId, id, name: 'Unknown User' }));
    if (toCreate.length > 0) await prisma.botUser.createMany({ data: toCreate });
  }

  const participantConnects = data.participantIDs.map((id) => ({ id }));
  const adminConnects = data.adminIDs.map((id) => ({ id }));

  await prisma.botThread.upsert({
    where: { id: data.id },
    create: {
      platformId: data.platformId, id: data.id, name: data.name, isGroup: data.isGroup,
      memberCount: data.memberCount, avatarUrl: data.avatarUrl,
      participants: { connect: participantConnects }, admins: { connect: adminConnects },
    },
    update: {
      name: data.name, isGroup: data.isGroup, memberCount: data.memberCount, avatarUrl: data.avatarUrl,
      participants: { set: participantConnects }, admins: { set: adminConnects },
    },
  });
}

export async function threadExists(platform: string, threadId: string): Promise<boolean> {
  const row = await prisma.botThread.findUnique({ where: { id: threadId }, select: { platformId: true } });
  return row !== null;
}

export async function threadSessionExists(userId: string, platform: string, sessionId: string, threadId: string): Promise<boolean> {
  const row = await prisma.botThreadSession.findUnique({
    where: { userId_platformId_sessionId_botThreadId: { userId, platformId: toPlatformNumericId(platform), sessionId, botThreadId: threadId } },
    select: { botThreadId: true },
  });
  return row !== null;
}

export async function upsertThreadSession(userId: string, platform: string, sessionId: string, threadId: string): Promise<void> {
  const platformNumericId = toPlatformNumericId(platform);
  await prisma.botThreadSession.upsert({
    where: { userId_platformId_sessionId_botThreadId: { userId, platformId: platformNumericId, sessionId, botThreadId: threadId } },
    create: { userId, platformId: platformNumericId, sessionId, botThreadId: threadId },
    update: {},
  });
}

export async function isThreadAdmin(threadId: string, userId: string): Promise<boolean> {
  const row = await prisma.botThread.findUnique({
    where: { id: threadId },
    select: { admins: { where: { id: userId }, select: { id: true } } },
  });
  return row !== null && row.admins.length > 0;
  return row !== null && row.admins.length > 0;
}

// WHY: Fulfills the fallback requirement directly at the DB layer so callers never handle undefined.
export async function getThreadName(threadId: string): Promise<string> {
  const row = await prisma.botThread.findUnique({
    where: { id: threadId },
    select: { name: true },
  });
  return row?.name ?? 'Unknown thread';
}

