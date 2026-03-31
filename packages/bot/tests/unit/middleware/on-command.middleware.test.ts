import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enforceCooldown } from '@/middleware/on-command.middleware.js';
import { cooldownStore } from '@/lib/cooldown.lib.js';
import { createMockEvent } from '../mocks/mock-data.js';

describe('On-Command Middleware: Cooldown Enforcement', () => {
  beforeEach(() => {
    cooldownStore.pruneIfNeeded(Infinity, 0); // Clean state
  });

  it('should bypass completely if command has no cooldown configured', async () => {
    // WHY: Ensures zero overhead for commands that aren't rate limited
    const ctx = {
      event: createMockEvent(),
      mod: { config: {} }, // No cooldown
      parsed: { name: 'ping' },
    } as unknown as import('@/types/middleware.types.js').OnCommandCtx;
    const next = vi.fn();

    await enforceCooldown(ctx, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('should set cooldown and proceed on first invocation', async () => {
    const ctx = {
      event: createMockEvent({ senderID: 'user-1' }),
      mod: { config: { cooldown: 5 } },
      parsed: { name: 'ping' },
    } as unknown as import('@/types/middleware.types.js').OnCommandCtx;
    const next = vi.fn();

    await enforceCooldown(ctx, next);

    expect(next).toHaveBeenCalledOnce();
    expect(cooldownStore.check('ping:user-1', Date.now())).not.toBeNull();
  });

  it('should block execution and reply with wait message on second invocation', async () => {
    // WHY: Validates the core defense mechanism against spam
    const chatMock = { replyMessage: vi.fn() };
    const ctx = {
      event: createMockEvent({ senderID: 'user-2' }),
      mod: { config: { cooldown: 5 } },
      parsed: { name: 'heavycmd' },
      chat: chatMock,
    } as unknown as import('@/types/middleware.types.js').OnCommandCtx;

    const next = vi.fn();

    // Invocation 1 (Allowed)
    await enforceCooldown(ctx, vi.fn());

    // Invocation 2 (Blocked)
    await enforceCooldown(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(chatMock.replyMessage).toHaveBeenCalledOnce();
    expect(chatMock.replyMessage.mock.calls[0][0].message).toContain(
      'Please wait',
    );
  });
});
