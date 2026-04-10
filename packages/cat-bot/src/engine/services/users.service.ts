/**
 * Users Service — platform user-info fetching and persistence orchestration.
 *
 * Called from two places:
 *   1. threads.service — when walking a thread's participantIDs after a new thread is synced
 *   2. on-chat.middleware — for the event sender specifically (may not appear in participantIDs
 *      on FB Page 1:1 or Telegram private-chat contexts)
 *
 * Errors are caught and logged at the individual-user level so one failing getInfo()
 * (e.g. network hiccup, rate limit) never skips the remaining participants.
 */

import type { BaseCtx } from '@/engine/types/controller.types.js';
import { toBotUserData } from '@/engine/models/users.model.js';
import { upsertUser, userSessionExists, upsertUserSession } from '@/engine/repos/users.repo.js';
import { logger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module

/**
 * Fetches user info from the platform for a single user ID and upserts the result.
 *
 * Errors are swallowed after logging so the bot pipeline never stalls because one
 * user's profile endpoint is temporarily unavailable.
 */
export async function syncUser(
  ctx: BaseCtx,
  userId: string,
  sessionUserId: string,
  sessionId: string,
): Promise<void> {
  try {
    // Session table is the existence gate — if this (userId, platform, sessionId, userId)
    // tuple already exists, the data is current; skip the API round-trip entirely.
    const alreadySynced = await userSessionExists(sessionUserId, ctx.native.platform, sessionId, userId);
    if (alreadySynced) return;

    const info = await ctx.user.getInfo(userId);
    await upsertUser(toBotUserData(info));
    // Mark this session as having seen this user — subsequent messages short-circuit here
    await upsertUserSession(sessionUserId, ctx.native.platform, sessionId, userId);
  } catch (err: unknown) {
    logger.warn(
      // Embed message in the log string — Winston's JSON transport does not serialize
      // Error.message by default, so the root cause disappears from structured log output.
      `⚠️ [users.service] Failed to sync user ${userId}: ${err instanceof Error ? err.message : String(err)}`,
      { error: err instanceof Error ? { name: err.name, message: err.message } : String(err) },
    );
  }
}

/**
 * Syncs a list of user IDs concurrently — used when hydrating a thread's participantIDs.
 *
 * Promise.allSettled ensures a rejection from one user's getInfo() never prevents the
 * remaining users from being stored. Individual errors are handled inside syncUser().
 */
export async function syncUsers(
  ctx: BaseCtx,
  userIds: string[],
  sessionUserId: string,
  sessionId: string,
): Promise<void> {
  await Promise.allSettled(userIds.map((id) => syncUser(ctx, id, sessionUserId, sessionId)));
}
