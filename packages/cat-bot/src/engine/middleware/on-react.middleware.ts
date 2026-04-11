/**
 * onReact Middleware — Reaction Flow Pre-Handler Guards
 *
 * Runs after a pending onReact state has been matched by dispatchOnReact
 * but BEFORE the emoji-keyed handler executes. `ctx.emoji` and `ctx.messageID`
 * are guaranteed non-null (dispatchOnReact early-returns before this point if either is absent).
 *
 * Extension points: emoji allowlist enforcement, per-emoji cooldowns,
 *                   user permission checks, reaction-count guards.
 * Add middleware via use.onReact([yourMiddleware]) in src/middleware/index.ts.
 */

import type {
  MiddlewareFn,
  OnReactCtx,
} from '@/engine/types/middleware.types.js';

/**
 * Default passthrough — emoji and messageID were validated by dispatchOnReact before this runs.
 * Extend by registering additional middlewares via use.onReact([...]) in index.ts.
 */
export const reactStateValidation: MiddlewareFn<OnReactCtx> = async function (
  _ctx,
  next,
): Promise<void> {
  await next();
};
