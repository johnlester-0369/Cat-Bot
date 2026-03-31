/**
 * Middleware Wiring — Default Pipeline Registration
 *
 * Registers all default middlewares for each lifecycle hook. This module is
 * imported by app.ts as a side-effect import — registration runs once at
 * module evaluation time, before any platform events fire.
 *
 * To extend the pipeline from app.ts or anywhere else:
 *   import { use } from '@/middleware/index.js';
 *   use.onCommand([myAuthMiddleware, myRateLimitMiddleware]);
 *
 * Execution order per lifecycle (first registered = first executed):
 *   onCommand: enforceCooldown → validateCommandOptions → [user-added] → onCommand handler
 *   onChat:    chatPassthrough        → [user-added] → onChat fan-out (runOnChat)
 *   onReply:   replyStateValidation   → [user-added] → onReply handler
 *   onReact:   reactStateValidation   → [user-added] → onReact handler
 */

export { use, middlewareRegistry } from '@/lib/middleware.lib.js';
export type {
  MiddlewareFn,
  MiddlewareUse,
  OnCommandCtx,
  OnChatCtx,
  OnReplyCtx,
  OnReactCtx,
} from '@/types/middleware.types.js';

import { use } from '@/lib/middleware.lib.js';
import {
  validateCommandOptions,
  enforceCooldown,
} from './on-command.middleware.js';
import { chatPassthrough } from './on-chat.middleware.js';
import { replyStateValidation } from './on-reply.middleware.js';
import { reactStateValidation } from './on-react.middleware.js';

// ── Default middleware pipeline ────────────────────────────────────────────────

use.onCommand([
  // Blocks commands still within their per-user cooldown window; sends exactly one
  // "please wait" notice on the first blocked attempt, silently drops the rest.
  // Runs first so option parsing is skipped for commands that will be rejected anyway.
  enforceCooldown,
  // Parses key:value options from the message body (or reads Discord's pre-resolved
  // optionsRecord), validates required fields, and rejects early on missing options.
  validateCommandOptions,
]);

use.onChat([
  // Passthrough placeholder — extend with rate limiting, audit logging, spam detection.
  chatPassthrough,
]);

use.onReply([
  // Passthrough placeholder — extend with timeout checks, permission guards.
  replyStateValidation,
]);

use.onReact([
  // Passthrough placeholder — extend with emoji allowlists, cooldowns.
  reactStateValidation,
]);
