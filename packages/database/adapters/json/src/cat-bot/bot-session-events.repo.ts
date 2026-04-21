import { getDb, saveDb } from '../store.js';
import { toPlatformNumericId } from '@cat-bot/engine/modules/platform/platform-id.util.js';

export async function upsertSessionEvents(
  userId: string,
  platform: string,
  sessionId: string,
  eventNames: string[],
): Promise<void> {
  const db = await getDb();
  const platformId = toPlatformNumericId(platform);
  for (const name of eventNames) {
    const exists = db.botSessionEvent.find(
      (e: any) =>
        e.userId === userId &&
        e.platformId === platformId &&
        e.sessionId === sessionId &&
        e.eventName === name,
    );
    if (!exists)
      db.botSessionEvent.push({
        userId,
        platformId,
        sessionId,
        eventName: name,
        isEnable: true,
      });
  }
  await saveDb();
}

export async function findSessionEvents(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<Array<{ eventName: string; isEnable: boolean }>> {
  const db = await getDb();
  const platformId = toPlatformNumericId(platform);
  return db.botSessionEvent
    .filter(
      (e: any) =>
        e.userId === userId &&
        e.platformId === platformId &&
        e.sessionId === sessionId,
    )
    .map((e: any) => ({ eventName: e.eventName, isEnable: e.isEnable }));
}

export async function setEventEnabled(
  userId: string,
  platform: string,
  sessionId: string,
  eventName: string,
  isEnable: boolean,
): Promise<void> {
  const db = await getDb();
  const platformId = toPlatformNumericId(platform);
  const record = db.botSessionEvent.find(
    (e: any) =>
      e.userId === userId &&
      e.platformId === platformId &&
      e.sessionId === sessionId &&
      e.eventName === eventName,
  );
  if (record) record.isEnable = isEnable;
  else
    db.botSessionEvent.push({
      userId,
      platformId,
      sessionId,
      eventName,
      isEnable,
    });
  await saveDb();
}

export async function isEventEnabled(
  userId: string,
  platform: string,
  sessionId: string,
  eventName: string,
): Promise<boolean> {
  const db = await getDb();
  try {
    const platformId = toPlatformNumericId(platform);
    const record = db.botSessionEvent.find(
      (e: any) =>
        e.userId === userId &&
        e.platformId === platformId &&
        e.sessionId === sessionId &&
        e.eventName === eventName,
    );
    return record?.isEnable ?? true;
  } catch {
    return true;
  }
}
