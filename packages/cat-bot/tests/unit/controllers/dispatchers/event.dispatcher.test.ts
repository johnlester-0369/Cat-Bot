import { describe, it, expect, vi } from 'vitest';
import { dispatchEvent } from '@/engine/controllers/dispatchers/event.dispatcher.js';

describe('Event Dispatcher', () => {
  it('should route events to registered handlers for matching event type', async () => {
    // WHY: Validates the central pub/sub mechanism for thread events (joins/leaves)
    const mockHandler = vi.fn();
    const eventModules = new Map([
      ['log:subscribe', [{ config: { name: 'join' }, onEvent: mockHandler }]],
    ]);

    const ctx = { native: { platform: 'discord' }, event: {} };

    await dispatchEvent(eventModules, 'log:subscribe', ctx);

    expect(mockHandler).toHaveBeenCalledOnce();
    expect(mockHandler).toHaveBeenCalledWith(ctx);
  });

  it('should safely ignore event types with no registered handlers', async () => {
    // WHY: System shouldn't crash if a platform emits an administrative event we don't care about
    const eventModules = new Map();

    // No throw
    await dispatchEvent(eventModules, 'unknown_event_type', { native: { platform: 'discord' } } as any);
  });

  it('should skip modules if platform is explicitly filtered out', async () => {
    // WHY: Enforces cross-platform structural safety at dispatch layer
    const mockHandler = vi.fn();
    const eventModules = new Map([
      [
        'log:subscribe',
        [
          {
            config: { name: 'join', platform: ['telegram'] },
            onEvent: mockHandler,
          },
        ],
      ],
    ]);

    const ctx = { native: { platform: 'discord' }, event: {} };

    await dispatchEvent(eventModules, 'log:subscribe', ctx);

    expect(mockHandler).not.toHaveBeenCalled(); // Filter blocked it
  });
});
