import { getDb, saveDb } from '../store.js';
import { toPlatformNumericId } from '@cat-bot/engine/modules/platform/platform-id.util.js';

export async function upsertSessionCommands(
  userId: string,
  platform: string,
  sessionId: string,
  commandNames: string[],
): Promise<void> {
  const db = await getDb();
  const platformId = toPlatformNumericId(platform);
  for (const name of commandNames) {
    const exists = db.botSessionCommand.find(
      (c: any) =>
        c.userId === userId &&
        c.platformId === platformId &&
        c.sessionId === sessionId &&
        c.commandName === name,
    );
    if (!exists)
      db.botSessionCommand.push({
        userId,
        platformId,
        sessionId,
        commandName: name,
        isEnable: true,
      });
  }
  await saveDb();
}

export async function findSessionCommands(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<Array<{ commandName: string; isEnable: boolean }>> {
  const db = await getDb();
  const platformId = toPlatformNumericId(platform);
  return db.botSessionCommand
    .filter(
      (c: any) =>
        c.userId === userId &&
        c.platformId === platformId &&
        c.sessionId === sessionId,
    )
    .map((c: any) => ({ commandName: c.commandName, isEnable: c.isEnable }));
}

export async function setCommandEnabled(
  userId: string,
  platform: string,
  sessionId: string,
  commandName: string,
  isEnable: boolean,
): Promise<void> {
  const db = await getDb();
  const platformId = toPlatformNumericId(platform);
  const record = db.botSessionCommand.find(
    (c: any) =>
      c.userId === userId &&
      c.platformId === platformId &&
      c.sessionId === sessionId &&
      c.commandName === commandName,
  );
  if (record) record.isEnable = isEnable;
  else
    db.botSessionCommand.push({
      userId,
      platformId,
      sessionId,
      commandName,
      isEnable,
    });
  await saveDb();
}

export async function isCommandEnabled(
  userId: string,
  platform: string,
  sessionId: string,
  commandName: string,
): Promise<boolean> {
  const db = await getDb();
  try {
    const platformId = toPlatformNumericId(platform);
    const record = db.botSessionCommand.find(
      (c: any) =>
        c.userId === userId &&
        c.platformId === platformId &&
        c.sessionId === sessionId &&
        c.commandName === commandName,
    );
    return record?.isEnable ?? true;
  } catch {
    return true;
  }
}
