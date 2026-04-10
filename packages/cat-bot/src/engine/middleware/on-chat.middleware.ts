/**
 * onChat Middleware — Cross-Cutting Message Concerns + Thread/User Sync
 *
 * Runs ONCE per incoming message BEFORE the onChat fan-out to individual command modules.
 * Provides the injection point for global message-level concerns that apply to every
 * message regardless of whether it triggers a command.
 *
 * ── Database Sync ─────────────────────────────────────────────────────────────
 * On each message, this middleware checks bot_threads and bot_users for the
 * current (platform, threadID) and (platform, senderID) pairs. If either is
 * absent, it fetches from the platform API and upserts:
 *
 *   1. Thread sync  → ctx.thread.getInfo(threadID) → upsert bot_threads
 *                     + loops participantIDs → upsert each into bot_users
 *   2. Sender check → if senderID still absent after thread sync (e.g. FB Page 1:1,
 *                     Telegram private DM where participantIDs is empty),
 *                     fetches directly via ctx.user.getInfo(senderID)
 *
 * Sync errors are caught and logged — they must never block the command pipeline.
 *
 * Extension points: rate limiting, audit logging, bot-mention filtering, spam detection.
 * Add middleware via use.onChat([yourMiddleware]) in src/middleware/index.ts.
 */

import type { MiddlewareFn, OnChatCtx } from '@/engine/types/middleware.types.js';
import { syncThreadAndParticipants } from '@/engine/services/threads.service.js';
import { syncUser } from '@/engine/services/users.service.js';
import { threadSessionExists } from '@/engine/repos/threads.repo.js';
import { userSessionExists } from '../repos/users.repo.js';
import { logger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module

/**
 * Syncs the current thread and message sender into the database on first encounter,
 * then calls next() to continue the middleware chain.
 *
 * The DB check (findUnique selecting only id) is a cheap index-only read. On
 * subsequent messages from a known thread the entire sync block is skipped —
 * the overhead is negligible in steady state.
 */
export const chatPassthrough: MiddlewareFn<OnChatCtx> = async function (
  ctx,
  next,
): Promise<void> {
  const platform = ctx.native.platform;
  // Resolve session identity from native context — set by the platform transport layer from
  // session/{userId}/{platform}/{sessionId}/ directory at boot time.
  const sessionUserId = ctx.native.userId ?? '';
  const sessionId = ctx.native.sessionId ?? '';
  // senderID is the standard field on message events; fall back to userID for
  // edge cases (some reaction-shaped events that still reach this middleware)
  const senderID = (ctx.event['senderID'] ?? ctx.event['userID'] ?? '') as string;
  const threadID = (ctx.event['threadID'] ?? '') as string;

  // All four fields required — partial context can't produce a valid composite session key.
  // Platform listeners that do not yet set userId/sessionId in native context skip sync entirely.
  if (platform && threadID && sessionUserId && sessionId) {
    try {
      const knownThread = await threadSessionExists(sessionUserId, platform, sessionId, threadID);
      if (!knownThread) {
        // Thread sync also walks participantIDs so the sender is likely upserted here too
        await syncThreadAndParticipants(ctx, threadID, sessionUserId, sessionId);
      }

      // Always check the sender explicitly — they may not appear in participantIDs on
      // FB Page 1:1 (participant list only contains the page bot) or Telegram private DMs
      if (senderID) {
        const knownSender = await userSessionExists(sessionUserId, platform, sessionId, senderID);
        if (!knownSender) {
          await syncUser(ctx, senderID, sessionUserId, sessionId);
        }
      }
    } catch (err: unknown) {
      // Sync failure must never interrupt the message pipeline; log and continue
      logger.warn('⚠️ [on-chat] DB sync failed — continuing pipeline', { error: err });
    }
  }

  await next();
};


export const chatLogThread: MiddlewareFn<OnChatCtx> = async function (
  ctx,
  next,
): Promise<void> {
  const { threadID, senderID, message } = ctx.event
  const { logger } = ctx
  const { platform } = ctx.native

  // Guard to prevent logging 'undefined' on non-text events (e.g. photo attachments without caption)
  if (message) {
    logger.info(`[${platform}] ${threadID} | ${senderID}: ${message}`)
  }
  await next()
}
