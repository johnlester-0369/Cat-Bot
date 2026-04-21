import { describe, it, expect, vi } from 'vitest';
import { runMiddlewareChain } from '@/engine/lib/middleware.lib.js';
import type { MiddlewareFn } from '@/engine/types/middleware.types.js';

describe('Middleware Library Chain Runner', () => {
  it('should execute middleware in sequential order and call final handler', async () => {
    // WHY: Verifies the express-style chain iterates fully
    const order: number[] = [];
    const mw1: MiddlewareFn<unknown> = async (_ctx, next) => {
      order.push(1);
      await next();
    };
    const mw2: MiddlewareFn<unknown> = async (_ctx, next) => {
      order.push(2);
      await next();
    };
    const final = vi.fn().mockImplementation(async () => {
      order.push(3);
    });

    await runMiddlewareChain([mw1, mw2], {}, final);

    expect(order).toEqual([1, 2, 3]);
    expect(final).toHaveBeenCalledOnce();
  });

  it('should short-circuit if next() is not called', async () => {
    // WHY: Blocking (e.g., auth, rate-limit) relies on halting the chain
    const order: number[] = [];
    const mw1: MiddlewareFn<unknown> = async (_ctx, _next) => {
      order.push(1); /* Missing next() */
    };
    const mw2: MiddlewareFn<unknown> = async (_ctx, next) => {
      order.push(2);
      await next();
    };
    const final = vi.fn();

    await runMiddlewareChain([mw1, mw2], {}, final);

    expect(order).toEqual([1]);
    expect(final).not.toHaveBeenCalled();
  });
});
