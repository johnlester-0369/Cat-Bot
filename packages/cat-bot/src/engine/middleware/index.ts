/**
 * Middleware Wiring — Default Pipeline Registration
 *
 * Registers all default middlewares for each lifecycle hook. This module is
 * imported by app.ts as a side-effect import — registration runs once at
 * module evaluation time, before any platform events fire.
 *
 * To extend the pipeline from app.ts or anywhere else:
 *   import { use } from '@/engine/middleware/index.js';
 *   use.onCommand([myAuthMiddleware, myRateLimitMiddleware]);
 *
 * Execution order per lifecycle (first registered = first executed):
 *   onCommand: enforcePermission → enforceCooldown → validateCommandOptions → [user-added] → onCommand handler
 *   onChat:    chatPassthrough        → [user-added] → onChat fan-out (runOnChat)
 *   onReply:   replyStateValidation   → [user-added] → onReply handler
 *   onReact:   reactStateValidation   → [user-added] → onReact handler
 */

export { use, middlewareRegistry } from '@/engine/lib/middleware.lib.js';
export type {
  MiddlewareFn,
  MiddlewareUse,
  OnCommandCtx,
  OnChatCtx,
  OnReplyCtx,
  OnReactCtx,
} from '@/engine/types/middleware.types.js';

import { use } from '@/engine/lib/middleware.lib.js';
import {
  validateCommandOptions,
  enforceCooldown,
  enforcePermission,
  enforceNotBanned,
} from './on-command.middleware.js';
import { chatPassthrough, chatLogThread } from './on-chat.middleware.js';
import { replyStateValidation } from './on-reply.middleware.js';
import { reactStateValidation } from './on-react.middleware.js';

// ── Default middleware pipeline ────────────────────────────────────────────────

use.onCommand([
  // Ban check is the outermost gate — banned users/threads never reach permission
  // checks, cooldown windows, or option parsing, eliminating all wasted processing.
  enforceNotBanned,
  // Permission check runs first — an unauthorised user is rejected before their
  // cooldown window is consumed or option parsing wastes CPU on a denied request.
  enforcePermission,
  // Blocks commands still within their per-user cooldown window; sends exactly one
  // "please wait" notice on the first blocked attempt, silently drops the rest.
  // Runs after permission check so option parsing is still skipped for rate-limited commands.
  enforceCooldown,
  // Parses key:value options from the message body (or reads Discord's pre-resolved
  // optionsRecord), validates required fields, and rejects early on missing options.
  validateCommandOptions,
]);

use.onChat([
  // Passthrough placeholder — extend with rate limiting, audit logging, spam detection.
  chatPassthrough,
  chatLogThread,
]);

use.onReply([
  // Passthrough placeholder — extend with timeout checks, permission guards.
  replyStateValidation,
]);

use.onReact([
  // Passthrough placeholder — extend with emoji allowlists, cooldowns.
  reactStateValidation,
]);
