import { getMongoDb } from '../client.js';
import { toPlatformNumericId } from '@cat-bot/engine/modules/platform/platform-id.util.js';

export async function upsertSessionEvents(
  userId: string,
  platform: string,
  sessionId: string,
  eventNames: string[],
): Promise<void> {
  if (!eventNames.length) return;
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  // Identical bulkWrite pattern to bot-session-commands: $setOnInsert preserves
  // isEnable=false rows set by the bot admin across restarts.
  const ops = eventNames.map((eventName) => ({
    updateOne: {
      filter: { userId, platformId, sessionId, eventName },
      update: { $setOnInsert: { userId, platformId, sessionId, eventName, isEnable: true } },
      upsert: true,
    },
  }));
  await db.collection('botSessionEvents').bulkWrite(ops, { ordered: false });
}

export async function findSessionEvents(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<Array<{ eventName: string; isEnable: boolean }>> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  const rows = await db
    .collection<{ eventName: string; isEnable: boolean }>('botSessionEvents')
    .find({ userId, platformId, sessionId }, { projection: { eventName: 1, isEnable: 1, _id: 0 } })
    .sort({ eventName: 1 })
    .toArray();
  return rows;
}

export async function setEventEnabled(
  userId: string,
  platform: string,
  sessionId: string,
  eventName: string,
  isEnable: boolean,
): Promise<void> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  await db.collection('botSessionEvents').updateOne(
    { userId, platformId, sessionId, eventName },
    { $set: { isEnable }, $setOnInsert: { userId, platformId, sessionId, eventName } },
    { upsert: true },
  );
}

export async function isEventEnabled(
  userId: string,
  platform: string,
  sessionId: string,
  eventName: string,
): Promise<boolean> {
  try {
    const db = getMongoDb();
    const platformId = toPlatformNumericId(platform);
    const rec = await db
      .collection<{ isEnable: boolean }>('botSessionEvents')
      .findOne({ userId, platformId, sessionId, eventName }, { projection: { isEnable: 1, _id: 0 } });
    return rec?.isEnable ?? true;
  } catch {
    return true;
  }
}