import { describe, it, expect } from 'vitest';
import { formatEvent, EventType } from '@/adapters/models/event.model.js';

describe('Unified Event Model Formatter', () => {
  it('should securely normalize a basic message event', () => {
    // WHY: Verifies structural guarantees—omitted fields become safe defaults rather than undefined
    const raw = {
      type: EventType.MESSAGE,
      messageID: 'msg-1',
      // omitting threadID, senderID, and body
    };

    const formatted = formatEvent(raw);

    expect(formatted.type).toBe(EventType.MESSAGE);
    expect(formatted.messageID).toBe('msg-1');
    expect(formatted.threadID).toBe(''); // fallback
    expect(formatted.senderID).toBe(''); // fallback
    expect((formatted as Record<string, unknown>).message).toBe(''); // fallback
  });

  it('should pass through unknown events unaffected', () => {
    // WHY: Avoids catastrophic failure if a platform emits a brand new event type
    const raw = { type: 'unknown_future_event', randomField: 42 };
    const formatted = formatEvent(raw);

    expect(formatted).toEqual(raw);
  });
});
