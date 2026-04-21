import { prisma } from '../index.js';
import { toPlatformNumericId } from '@cat-bot/engine/modules/platform/platform-id.util.js';

export async function upsertSessionCommands(
  userId: string,
  platform: string,
  sessionId: string,
  commandNames: string[],
): Promise<void> {
  if (!commandNames.length) return;
  const platformId = toPlatformNumericId(platform);
  const existing = await prisma.botSessionCommand.findMany({
    where: { userId, platformId, sessionId, commandName: { in: commandNames } },
    select: { commandName: true },
  });
  const existingNames = new Set(existing.map((c) => c.commandName));
  const toCreate = commandNames
    .filter((name) => !existingNames.has(name))
    .map((commandName) => ({
      userId,
      platformId,
      sessionId,
      commandName,
      isEnable: true,
    }));
  if (toCreate.length > 0)
    await prisma.botSessionCommand.createMany({ data: toCreate });
}

export async function findSessionCommands(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<Array<{ commandName: string; isEnable: boolean }>> {
  const platformId = toPlatformNumericId(platform);
  return prisma.botSessionCommand.findMany({
    where: { userId, platformId, sessionId },
    select: { commandName: true, isEnable: true },
    orderBy: { commandName: 'asc' },
  });
}

export async function setCommandEnabled(
  userId: string,
  platform: string,
  sessionId: string,
  commandName: string,
  isEnable: boolean,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  await prisma.botSessionCommand.upsert({
    where: {
      userId_platformId_sessionId_commandName: {
        userId,
        platformId,
        sessionId,
        commandName,
      },
    },
    create: { userId, platformId, sessionId, commandName, isEnable },
    update: { isEnable },
  });
}

export async function isCommandEnabled(
  userId: string,
  platform: string,
  sessionId: string,
  commandName: string,
): Promise<boolean> {
  try {
    const platformId = toPlatformNumericId(platform);
    const record = await prisma.botSessionCommand.findUnique({
      where: {
        userId_platformId_sessionId_commandName: {
          userId,
          platformId,
          sessionId,
          commandName,
        },
      },
      select: { isEnable: true },
    });
    return record?.isEnable ?? true;
  } catch {
    return true; // Fail-open
  }
}
