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

import type { BaseCtx } from '@/types/controller.types.js';
import { toBotUserData } from '@/models/users.model.js';
import { upsertUser } from '../repos/users.repo.js';
import { logger } from '@/lib/logger.lib.js';

/**
 * Fetches user info from the platform for a single user ID and upserts the result.
 *
 * Errors are swallowed after logging so the bot pipeline never stalls because one
 * user's profile endpoint is temporarily unavailable.
 */
export async function syncUser(ctx: BaseCtx, userId: string): Promise<void> {
  try {
    const info = await ctx.user.getInfo(userId);
    await upsertUser(toBotUserData(info));
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
export async function syncUsers(ctx: BaseCtx, userIds: string[]): Promise<void> {
  await Promise.allSettled(userIds.map((id) => syncUser(ctx, id)));
}
