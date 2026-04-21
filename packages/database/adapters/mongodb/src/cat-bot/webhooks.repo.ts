import { getMongoDb } from '../client.js';

export async function getFbPageWebhookVerification(
  userId: string,
): Promise<{ isVerified: boolean } | null> {
  const db = getMongoDb();
  const rec = await db
    .collection<{ isVerified: boolean }>('fbPageWebhooks')
    .findOne({ userId }, { projection: { isVerified: 1, _id: 0 } });
  return rec ?? null;
}

export async function upsertFbPageWebhookVerification(
  userId: string,
): Promise<void> {
  const db = getMongoDb();
  await db
    .collection('fbPageWebhooks')
    .updateOne(
      { userId },
      { $set: { isVerified: true }, $setOnInsert: { userId } },
      { upsert: true },
    );
}
