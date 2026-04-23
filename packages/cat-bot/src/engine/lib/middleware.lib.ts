/**
 * Middleware Infrastructure — Registry + Chain Runner
 *
 * Extracted from middleware/registry.ts and middleware/runner.ts as stateful
 * single-purpose infrastructure. The type definitions (MiddlewareFn, MiddlewareUse,
 * OnCommandCtx, etc.) remain in middleware/types.ts to keep the type layer
 * co-located with the middleware hooks that consume them.
 *
 * Dependency direction: lib/middleware.lib.ts → middleware/types.ts → lib/options-map.lib.ts
 * No circular dependency — lib files never import back from middleware/types.ts
 * for anything other than type definitions.
 */

import type {
  MiddlewareFn,
  MiddlewareUse,
  OnCommandCtx,
  OnChatCtx,
  OnReplyCtx,
  OnReactCtx,
  OnButtonClickCtx,
  OnEventCtx,
} from '@/engine/types/middleware.types.js';

// ── Registry ──────────────────────────────────────────────────────────────────

class MiddlewareRegistry implements MiddlewareUse {
  #onCommand: MiddlewareFn<OnCommandCtx>[] = [];
  #onChat: MiddlewareFn<OnChatCtx>[] = [];
  #onReply: MiddlewareFn<OnReplyCtx>[] = [];
  #onReact: MiddlewareFn<OnReactCtx>[] = [];
  #onButtonClick: MiddlewareFn<OnButtonClickCtx>[] = [];
  #onEvent: MiddlewareFn<OnEventCtx>[] = [];

  onCommand(middlewares: MiddlewareFn<OnCommandCtx>[]): void {
    this.#onCommand.push(...middlewares);
  }

  onChat(middlewares: MiddlewareFn<OnChatCtx>[]): void {
    this.#onChat.push(...middlewares);
  }

  onReply(middlewares: MiddlewareFn<OnReplyCtx>[]): void {
    this.#onReply.push(...middlewares);
  }

  onReact(middlewares: MiddlewareFn<OnReactCtx>[]): void {
    this.#onReact.push(...middlewares);
  }

  onButtonClick(middlewares: MiddlewareFn<OnButtonClickCtx>[]): void {
    this.#onButtonClick.push(...middlewares);
  }

  onEvent(middlewares: MiddlewareFn<OnEventCtx>[]): void {
    this.#onEvent.push(...middlewares);
  }

  /** Snapshot copy — callers cannot mutate the registry's internal array mid-chain. */
  getOnCommand(): MiddlewareFn<OnCommandCtx>[] {
    return [...this.#onCommand];
  }

  getOnChat(): MiddlewareFn<OnChatCtx>[] {
    return [...this.#onChat];
  }

  getOnReply(): MiddlewareFn<OnReplyCtx>[] {
    return [...this.#onReply];
  }

  getOnReact(): MiddlewareFn<OnReactCtx>[] {
    return [...this.#onReact];
  }

  getOnButtonClick(): MiddlewareFn<OnButtonClickCtx>[] {
    return [...this.#onButtonClick];
  }

  getOnEvent(): MiddlewareFn<OnEventCtx>[] {
    return [...this.#onEvent];
  }
}

/**
 * Singleton — all dispatchers share this instance so registrations in
 * src/middleware/index.ts are visible everywhere at runtime.
 */
export const middlewareRegistry = new MiddlewareRegistry();

/** Typed as MiddlewareUse to expose only the registration surface at call sites. */
export const use: MiddlewareUse = middlewareRegistry;

// ── Chain Runner ──────────────────────────────────────────────────────────────

/**
 * Runs `middlewares` sequentially, then calls `finalHandler` once all have called next().
 * Designed to be called from dispatchers — each dispatch site provides its own finalHandler.
 *
 * Short-circuit contract:
 *   A middleware that does NOT call next() halts the chain at that point.
 *   Neither subsequent middleware nor the final handler will execute.
 *   This is the intended pattern for guard clauses (validation rejection,
 *   rate-limit enforcement, permission checks).
 *
 * NOTE: `finalHandler` must not call next(). Doing so would re-invoke finalHandler, not
 * advance the middleware chain (the chain is already exhausted at that point).
 */
export async function runMiddlewareChain<TCtx>(
  middlewares: MiddlewareFn<TCtx>[],
  ctx: TCtx,
  finalHandler: () => Promise<void>,
): Promise<void> {
  let index = 0;

  // Closure captures index so each next() invocation advances the chain independently
  // regardless of async interleaving between parallel requests.
  const next = async (): Promise<void> => {
    // noUncheckedIndexedAccess: array[n] returns T | undefined; guard against exhausted chain
    const mw = middlewares[index++];
    if (mw !== undefined) {
      await mw(ctx, next);
    } else {
      await finalHandler();
    }
  };

  await next();
}
