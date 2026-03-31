/**
 * Middleware Type Definitions
 *
 * Express-style middleware contract for the four Bot lifecycle hooks.
 * Every middleware receives a typed context and a next() continuation.
 *
 *   Calling next()          → passes control to the next middleware, then the final handler
 *   NOT calling next()      → short-circuits the chain (validation rejection, early return)
 *
 * Lifecycle contexts extend BaseCtx so all middleware has access to api, event,
 * commands, thread, chat, bot, user, and native out of the box.
 */

import type {
  BaseCtx,
  ParsedCommand,
  CommandModule,
} from '@/types/controller.types.js';
import type { OptionsMap } from '@/lib/options-map.lib.js';
import type { StateEntry } from '@/lib/reply-state.lib.js';

// ── Core middleware signature ─────────────────────────────────────────────────

/**
 * A single middleware function.
 * TCtx defaults to BaseCtx so generic middleware works across all hooks.
 */
export type MiddlewareFn<TCtx = BaseCtx> = (
  ctx: TCtx,
  next: () => Promise<void>,
) => Promise<void>;

// ── Per-lifecycle context extensions ─────────────────────────────────────────

/**
 * Context for onCommand middleware.
 * `options` is seeded as OptionsMap.empty() by dispatchCommand and replaced
 * by validateCommandOptions middleware before the onCommand handler runs.
 * `prefix` is narrowed from optional (BaseCtx) to required here — it is
 * always provided at command-dispatch time.
 */
export interface OnCommandCtx extends BaseCtx {
  parsed: ParsedCommand;
  prefix: string;
  mod: CommandModule;
  /** Populated by validateCommandOptions; always present when handler executes. */
  options: OptionsMap;
}

/**
 * Context for onChat middleware.
 * Alias of BaseCtx — a separate named type preserves the hook's identity for
 * future extension without triggering the no-empty-object-type lint rule.
 */
export type OnChatCtx = BaseCtx;

/**
 * Context for onReply middleware.
 * `session` carries the stored conversation state the user is replying to.
 */
export interface OnReplyCtx extends BaseCtx {
  session: { id: string } & StateEntry;
}

/**
 * Context for onReact middleware.
 * `emoji` and `messageID` are guaranteed non-null — dispatchOnReact early-returns
 * before building this context when either is absent.
 */
export interface OnReactCtx extends BaseCtx {
  session: { id: string } & StateEntry;
  emoji: string;
  messageID: string;
}

// ── Registration interface ────────────────────────────────────────────────────

/**
 * Public surface for registering middleware arrays per lifecycle.
 * Calling onX() appends to the existing pipeline — registration order
 * determines execution order within each hook.
 */
export interface MiddlewareUse {
  onCommand(middlewares: MiddlewareFn<OnCommandCtx>[]): void;
  onChat(middlewares: MiddlewareFn<OnChatCtx>[]): void;
  onReply(middlewares: MiddlewareFn<OnReplyCtx>[]): void;
  onReact(middlewares: MiddlewareFn<OnReactCtx>[]): void;
}
