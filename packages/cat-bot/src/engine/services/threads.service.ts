/**
 * Threads Service — platform thread-info fetching and persistence orchestration.
 *
 * When a thread is seen for the first time, this service:
 *   1. Fetches full platform metadata via ctx.thread.getInfo(threadId)
 *   2. Walks participant/admin IDs and calls syncUsers() to ensure relational
 *      foreign keys exist BEFORE attempting to link them.
 *   3. Upserts the thread into bot_threads
 *
 * This "hydrate on first encounter" approach means command modules can always
 * look up thread participants by platform+userId without a live API call.
 *
 * Errors are caught here so a failing getFullThreadInfo() (e.g. permission denied
 * in a large Discord guild) never blocks the message pipeline.
 */

import type { BaseCtx } from '@/engine/types/controller.types.js';
import { toBotThreadData } from '@/engine/models/threads.model.js';
import {
  upsertThread,
  upsertThreadSession,
  upsertDiscordServer,
  linkDiscordChannel,
} from '@/engine/repos/threads.repo.js';
import { syncUsers } from '@/engine/services/users.service.js';
import { logger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module
import { Platforms } from '@/engine/modules/platform/platform.constants.js';

/**
 * Fetches full thread metadata, explicitly hydrates participants via
 * ctx.user.getInfo(), then upserts the thread payload.
 *
 * participantIDs may be empty on some platforms:
 *   - Telegram: Bot API does not return member lists for large groups
 *   - Discord: cached members only; very large guilds may return a partial list
 *   In those cases the sender is handled safely by on-chat.middleware.
 */
export async function syncThreadAndParticipants(
  ctx: BaseCtx,
  threadId: string,
  sessionUserId: string,
  sessionId: string,
): Promise<void> {
  try {
    // Staleness is now determined by on-chat.middleware before calling this function —
    // the middleware compares lastUpdatedAt against SYNC_INTERVAL_MS and only calls here
    // when the session row is absent or older than 1 hour. No guard needed here.
    const info = await ctx.thread.getInfo(threadId);

    // Sync users FIRST to guarantee Prisma connect operations find foreign keys in bot_users
    const allUsersToSync = Array.from(
      new Set([...info.participantIDs, ...info.adminIDs]),
    );
    if (allUsersToSync.length > 0) {
      await syncUsers(ctx, allUsersToSync, sessionUserId, sessionId);
    }

    // Intercept Discord channels to store them hierarchically by server to avoid duplicating server state per-channel.
    if (ctx.native.platform === Platforms.Discord && info.serverID) {
      await upsertDiscordServer({
        id: info.serverID,
        name: info.name,
        avatarUrl: info.avatarUrl,
        memberCount: info.memberCount,
        participantIDs: info.participantIDs,
        adminIDs: info.adminIDs,
      });
      await linkDiscordChannel(info.serverID, threadId);
      // Call the existing method, threads.repo.ts intercepts Discord internally to write bot_discord_server_session
      await upsertThreadSession(
        sessionUserId,
        ctx.native.platform,
        sessionId,
        threadId,
      );
    } else {
      // Default platform handling (DMs, Telegram, Facebook)
      await upsertThread(toBotThreadData(info));
      await upsertThreadSession(
        sessionUserId,
        ctx.native.platform,
        sessionId,
        threadId,
      );
    }
  } catch (err: unknown) {
    logger.warn(
      // Embed message in the log string — Winston's JSON transport does not serialize
      // Error.message by default, so the root cause disappears from structured log output.
      `⚠️ [threads.service] Failed to sync thread ${threadId}: ${err instanceof Error ? err.message : String(err)}`,
      {
        error:
          err instanceof Error
            ? { name: err.name, message: err.message }
            : String(err),
      },
    );
  }
}
