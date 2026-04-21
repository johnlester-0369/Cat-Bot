import { getDb, saveDb } from '../store.js';

export async function getFbPageWebhookVerification(
  userId: string,
): Promise<{ isVerified: boolean } | null> {
  const db = await getDb();
  const rec = db.fbPageWebhook.find((w: any) => w.userId === userId);
  return rec ? { isVerified: rec.isVerified } : null;
}

export async function upsertFbPageWebhookVerification(
  userId: string,
): Promise<void> {
  const db = await getDb();
  const rec = db.fbPageWebhook.find((w: any) => w.userId === userId);
  if (rec) rec.isVerified = true;
  else db.fbPageWebhook.push({ userId, isVerified: true });
  await saveDb();
}
