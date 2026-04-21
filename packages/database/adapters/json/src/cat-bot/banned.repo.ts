import { getDb, saveDb } from '../store.js';
import { toPlatformNumericId } from '@cat-bot/engine/modules/platform/platform-id.util.js';

// ── User Bans ─────────────────────────────────────────────────────────────────

/** Bans a user. Upserts so calling ban twice is idempotent; reason is updated. */
export async function banUser(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
  reason?: string,
): Promise<void> {
  const db = await getDb();
  const platformId = toPlatformNumericId(platform);
  const rec = db.botUserBanned.find(
    (r: any) =>
      r.userId === userId &&
      r.platformId === platformId &&
      r.sessionId === sessionId &&
      r.botUserId === botUserId,
  );
  if (rec) {
    rec.isBanned = true;
    rec.reason = reason ?? null;
  } else {
    db.botUserBanned.push({
      userId,
      platformId,
      sessionId,
      botUserId,
      isBanned: true,
      reason: reason ?? null,
    });
  }
  await saveDb();
}

/** Lifts a user ban. Sets isBanned=false so the reason row is preserved for audit. */
export async function unbanUser(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<void> {
  const db = await getDb();
  const platformId = toPlatformNumericId(platform);
  const rec = db.botUserBanned.find(
    (r: any) =>
      r.userId === userId &&
      r.platformId === platformId &&
      r.sessionId === sessionId &&
      r.botUserId === botUserId,
  );
  if (rec) {
    rec.isBanned = false;
    await saveDb();
  }
}

/** Returns true when the user is actively banned. Fail-open on error. */
export async function isUserBanned(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<boolean> {
  try {
    const db = await getDb();
    const platformId = toPlatformNumericId(platform);
    const rec = db.botUserBanned.find(
      (r: any) =>
        r.userId === userId &&
        r.platformId === platformId &&
        r.sessionId === sessionId &&
        r.botUserId === botUserId,
    );
    return rec?.isBanned ?? false;
  } catch {
    return false;
  }
}

// ── Thread Bans ───────────────────────────────────────────────────────────────

/** Bans a thread. Idempotent — reason is updated on re-ban. */
export async function banThread(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
  reason?: string,
): Promise<void> {
  const db = await getDb();
  const platformId = toPlatformNumericId(platform);
  const rec = db.botThreadBanned.find(
    (r: any) =>
      r.userId === userId &&
      r.platformId === platformId &&
      r.sessionId === sessionId &&
      r.botThreadId === botThreadId,
  );
  if (rec) {
    rec.isBanned = true;
    rec.reason = reason ?? null;
  } else {
    db.botThreadBanned.push({
      userId,
      platformId,
      sessionId,
      botThreadId,
      isBanned: true,
      reason: reason ?? null,
    });
  }
  await saveDb();
}

/** Lifts a thread ban. Preserves the row so reason is retained for audit. */
export async function unbanThread(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
): Promise<void> {
  const db = await getDb();
  const platformId = toPlatformNumericId(platform);
  const rec = db.botThreadBanned.find(
    (r: any) =>
      r.userId === userId &&
      r.platformId === platformId &&
      r.sessionId === sessionId &&
      r.botThreadId === botThreadId,
  );
  if (rec) {
    rec.isBanned = false;
    await saveDb();
  }
}

/** Returns true when the thread is actively banned. Fail-open on error. */
export async function isThreadBanned(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
): Promise<boolean> {
  try {
    const db = await getDb();
    const platformId = toPlatformNumericId(platform);
    const rec = db.botThreadBanned.find(
      (r: any) =>
        r.userId === userId &&
        r.platformId === platformId &&
        r.sessionId === sessionId &&
        r.botThreadId === botThreadId,
    );
    return rec?.isBanned ?? false;
  } catch {
    return false;
  }
}
