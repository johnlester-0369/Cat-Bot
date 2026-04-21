import { prisma } from '../index.js';
import { toPlatformNumericId } from '@cat-bot/engine/modules/platform/platform-id.util.js';

export async function upsertSessionEvents(
  userId: string,
  platform: string,
  sessionId: string,
  eventNames: string[],
): Promise<void> {
  if (!eventNames.length) return;
  const platformId = toPlatformNumericId(platform);
  const existing = await prisma.botSessionEvent.findMany({
    where: { userId, platformId, sessionId, eventName: { in: eventNames } },
    select: { eventName: true },
  });
  const existingNames = new Set(existing.map((e) => e.eventName));
  const toCreate = eventNames
    .filter((name) => !existingNames.has(name))
    .map((eventName) => ({
      userId,
      platformId,
      sessionId,
      eventName,
      isEnable: true,
    }));
  if (toCreate.length > 0)
    await prisma.botSessionEvent.createMany({ data: toCreate });
}

export async function findSessionEvents(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<Array<{ eventName: string; isEnable: boolean }>> {
  const platformId = toPlatformNumericId(platform);
  return prisma.botSessionEvent.findMany({
    where: { userId, platformId, sessionId },
    select: { eventName: true, isEnable: true },
    orderBy: { eventName: 'asc' },
  });
}

export async function setEventEnabled(
  userId: string,
  platform: string,
  sessionId: string,
  eventName: string,
  isEnable: boolean,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  await prisma.botSessionEvent.upsert({
    where: {
      userId_platformId_sessionId_eventName: {
        userId,
        platformId,
        sessionId,
        eventName,
      },
    },
    create: { userId, platformId, sessionId, eventName, isEnable },
    update: { isEnable },
  });
}

export async function isEventEnabled(
  userId: string,
  platform: string,
  sessionId: string,
  eventName: string,
): Promise<boolean> {
  try {
    const platformId = toPlatformNumericId(platform);
    const record = await prisma.botSessionEvent.findUnique({
      where: {
        userId_platformId_sessionId_eventName: {
          userId,
          platformId,
          sessionId,
          eventName,
        },
      },
      select: { isEnable: true },
    });
    return record?.isEnable ?? true;
  } catch {
    return true; // Fail-open
  }
}
