/**
 * onReply Middleware — Reply Flow Pre-Handler Guards
 *
 * Runs after a pending onReply state has been matched by dispatchOnReply
 * but BEFORE the registered handler executes. The resolved session is
 * available on ctx.session for state-aware guard logic.
 *
 * Extension points: conversation step timeout checks, user permission validation,
 *                   input sanitisation before the handler reads ctx.event.
 * Add middleware via use.onReply([yourMiddleware]) in src/middleware/index.ts.
 */

import type { MiddlewareFn, OnReplyCtx } from '@/types/middleware.types.js';

/**
 * Default passthrough — state was already validated by dispatchOnReply (state lookup,
 * button-fallback routing) before this middleware runs.
 * Extend by registering additional middlewares via use.onReply([...]) in index.ts.
 */
export const replyStateValidation: MiddlewareFn<OnReplyCtx> = async function (
  _ctx,
  next,
): Promise<void> {
  await next();
};
