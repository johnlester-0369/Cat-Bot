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
  OnButtonClickCtx,
  OnEventCtx,
} from '@/engine/types/middleware.types.js';

import { use } from '@/engine/lib/middleware.lib.js';
import {
  validateCommandOptions,
  enforceCooldown,
  enforcePermission,
  enforceNotBanned,
  enforceAdminOnly,
} from './on-command.middleware.js';
import { chatPassthrough, chatLogThread } from './on-chat.middleware.js';
import { replyStateValidation } from './on-reply.middleware.js';
import { reactStateValidation } from './on-react.middleware.js';
import { enforceButtonScope } from './on-button-click.middleware.js';
import { enforceWarnBan, enforceCommandKick } from './on-event.middleware.js';

// ── Default middleware pipeline ────────────────────────────────────────────────

use.onCommand([
  // Ban check is the outermost gate — banned users/threads never reach permission
  // checks, cooldown windows, or option parsing, eliminating all wasted processing.
  enforceNotBanned,
  // Permission check runs first — an unauthorised user is rejected before their
  // cooldown window is consumed or option parsing wastes CPU on a denied request.
  enforcePermission,
  // Enforces session-wide (adminonly) and per-thread (onlyadminbox) restriction
  // modes; honours the matching ignoreonlyad / ignoreonlyadbox exemption lists.
  // Runs after permission so commands already gated to BOT_ADMIN/SYSTEM_ADMIN do
  // not pay the DB lookup, and before cooldown so a blocked attempt does not
  // consume the user's cooldown window.
  enforceAdminOnly,
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

use.onButtonClick([
  // Scope ownership enforced here — non-owners receive a private ack() rejection invisible to the group.
  enforceButtonScope,
]);

use.onEvent([
  // Fast path: suppresses leave.ts when a member was explicitly removed by the
  // `kick` command or `badwords` auto-kick. Both commands pre-register the target
  // uid in the kick registry before calling thread.removeUser(), so the O(1)
  // in-memory consume() check here avoids the DB round-trip enforceWarnBan performs.
  // A registry miss passes control to enforceWarnBan below.
  enforceCommandKick,
  // Suppresses join.ts welcome for warn-banned rejoining members — checkwarn.ts owns the
  // kick notification for the same log:subscribe event; a simultaneous "Welcome!" contradicts it.
  // Also suppresses leave.ts goodbye for bot-initiated warn-ban kicks on log:unsubscribe —
  // checkwarn.ts already owns the full removal interaction; a simultaneous goodbye message
  // directly contradicts the moderation flow. Voluntary self-leaves are never affected.
  // Only reached for log:unsubscribe when enforceCommandKick misses (no registry entry).
  enforceWarnBan,
]);
