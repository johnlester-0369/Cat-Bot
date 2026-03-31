/**
 * onChat Middleware — Cross-Cutting Message Concerns
 *
 * Runs ONCE per incoming message BEFORE the onChat fan-out to individual command modules.
 * Provides the injection point for global message-level concerns that should apply to
 * every message regardless of whether it triggers a command.
 *
 * Extension points: rate limiting, audit logging, bot-mention filtering, spam detection.
 * Add middleware via use.onChat([yourMiddleware]) in src/middleware/index.ts.
 */

import type { MiddlewareFn, OnChatCtx } from '@/types/middleware.types.js';

/**
 * Default passthrough — calls next() immediately.
 * Extend by registering additional middlewares via use.onChat([...]) in index.ts.
 */
export const chatPassthrough: MiddlewareFn<OnChatCtx> = async function (
  _ctx,
  next,
): Promise<void> {
  await next();
};
