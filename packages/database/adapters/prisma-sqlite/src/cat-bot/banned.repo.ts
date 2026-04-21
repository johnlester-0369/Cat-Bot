import { prisma } from '../index.js';
import { toPlatformNumericId } from '@cat-bot/engine/modules/platform/platform-id.util.js';

// ── User Bans ─────────────────────────────────────────────────────────────────

/**
 * Bans a user for this session. Uses upsert so calling ban twice on the same
 * user is idempotent — the reason is updated on the second call.
 */
export async function banUser(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
  reason?: string,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  await prisma.botUserBanned.upsert({
    where: {
      userId_platformId_sessionId_botUserId: {
        userId,
        platformId,
        sessionId,
        botUserId,
      },
    },
    create: {
      userId,
      platformId,
      sessionId,
      botUserId,
      isBanned: true,
      reason: reason ?? null,
    },
    update: { isBanned: true, reason: reason ?? null },
  });
}

/**
 * Lifts a user ban. Sets isBanned = false rather than deleting the row so the
 * reason field is preserved for audit history.
 */
export async function unbanUser(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  // updateMany avoids P2025 when the record does not exist (user was never banned)
  await prisma.botUserBanned.updateMany({
    where: { userId, platformId, sessionId, botUserId },
    data: { isBanned: false },
  });
}

/**
 * Returns true when the user is actively banned in this session.
 * Fail-open: a missing row or any DB error returns false so a temporary
 * outage never locks out legitimate users.
 */
export async function isUserBanned(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<boolean> {
  try {
    const platformId = toPlatformNumericId(platform);
    const record = await prisma.botUserBanned.findUnique({
      where: {
        userId_platformId_sessionId_botUserId: {
          userId,
          platformId,
          sessionId,
          botUserId,
        },
      },
      select: { isBanned: true },
    });
    return record?.isBanned ?? false;
  } catch {
    return false;
  }
}

// ── Thread Bans ───────────────────────────────────────────────────────────────

/** Bans a thread for this session. Idempotent — reason is updated on re-ban. */
export async function banThread(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
  reason?: string,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  await prisma.botThreadBanned.upsert({
    where: {
      userId_platformId_sessionId_botThreadId: {
        userId,
        platformId,
        sessionId,
        botThreadId,
      },
    },
    create: {
      userId,
      platformId,
      sessionId,
      botThreadId,
      isBanned: true,
      reason: reason ?? null,
    },
    update: { isBanned: true, reason: reason ?? null },
  });
}

/** Lifts a thread ban. Preserves the row so reason is retained for audit. */
export async function unbanThread(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  await prisma.botThreadBanned.updateMany({
    where: { userId, platformId, sessionId, botThreadId },
    data: { isBanned: false },
  });
}

/**
 * Returns true when the thread is actively banned. Fail-open on DB error.
 */
export async function isThreadBanned(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
): Promise<boolean> {
  try {
    const platformId = toPlatformNumericId(platform);
    const record = await prisma.botThreadBanned.findUnique({
      where: {
        userId_platformId_sessionId_botThreadId: {
          userId,
          platformId,
          sessionId,
          botThreadId,
        },
      },
      select: { isBanned: true },
    });
    return record?.isBanned ?? false;
  } catch {
    return false;
  }
}
