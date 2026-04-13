import { getMongoDb } from '../client.js';
import { toPlatformNumericId } from '@cat-bot/engine/modules/platform/platform-id.util.js';

export async function upsertSessionCommands(
  userId: string,
  platform: string,
  sessionId: string,
  commandNames: string[],
): Promise<void> {
  if (!commandNames.length) return;
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  // $setOnInsert means this operation creates the row with isEnable=true only when absent.
  // Existing rows with isEnable=false set by the bot admin are never touched — same
  // semantics as the Prisma adapter's createMany({ skipDuplicates: true }) approach.
  const ops = commandNames.map((commandName) => ({
    updateOne: {
      filter: { userId, platformId, sessionId, commandName },
      update: { $setOnInsert: { userId, platformId, sessionId, commandName, isEnable: true } },
      upsert: true,
    },
  }));
  await db.collection('botSessionCommands').bulkWrite(ops, { ordered: false });
}

export async function findSessionCommands(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<Array<{ commandName: string; isEnable: boolean }>> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  const rows = await db
    .collection<{ commandName: string; isEnable: boolean }>('botSessionCommands')
    .find({ userId, platformId, sessionId }, { projection: { commandName: 1, isEnable: 1, _id: 0 } })
    .sort({ commandName: 1 })
    .toArray();
  return rows;
}

export async function setCommandEnabled(
  userId: string,
  platform: string,
  sessionId: string,
  commandName: string,
  isEnable: boolean,
): Promise<void> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  await db.collection('botSessionCommands').updateOne(
    { userId, platformId, sessionId, commandName },
    { $set: { isEnable }, $setOnInsert: { userId, platformId, sessionId, commandName } },
    { upsert: true },
  );
}

export async function isCommandEnabled(
  userId: string,
  platform: string,
  sessionId: string,
  commandName: string,
): Promise<boolean> {
  try {
    const db = getMongoDb();
    const platformId = toPlatformNumericId(platform);
    const rec = await db
      .collection<{ isEnable: boolean }>('botSessionCommands')
      .findOne({ userId, platformId, sessionId, commandName }, { projection: { isEnable: 1, _id: 0 } });
    // Absent row = enabled; fail-open keeps the bot functional during DB hiccups.
    return rec?.isEnable ?? true;
  } catch {
    return true;
  }
}