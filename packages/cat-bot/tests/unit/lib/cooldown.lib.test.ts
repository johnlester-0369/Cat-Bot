import { describe, it, expect, beforeEach } from 'vitest';
import { cooldownStore } from '@/engine/lib/cooldown.lib.js';

describe('Cooldown Store Library', () => {
  const SENDER = 'user-123';
  const CMD = 'ping';
  const KEY = `${CMD}:${SENDER}`;

  beforeEach(() => {
    // Ensure clean state per test
    cooldownStore.pruneIfNeeded(Infinity, 0);
  });

  it('should return null when cooldown is not set', () => {
    // WHY: Unrestricted users should pass through immediately
    expect(cooldownStore.check(KEY, Date.now())).toBeNull();
  });

  it('should return active entry when inside cooldown window', () => {
    // WHY: Rate limits active spammers
    const now = Date.now();
    cooldownStore.record(KEY, now, 5000); // 5 sec cooldown

    const entry = cooldownStore.check(KEY, now + 1000);
    expect(entry).not.toBeNull();
    expect(entry?.notified).toBe(false);
  });

  it('should mark notified to prevent spamming warnings', () => {
    // WHY: A user spamming 10 times in 1 second should only get 1 warning
    const now = Date.now();
    cooldownStore.record(KEY, now, 5000);
    cooldownStore.markNotified(KEY);

    const entry = cooldownStore.check(KEY, now + 1000);
    expect(entry?.notified).toBe(true);
  });

  it('should clear expired cooldowns on prune', () => {
    // WHY: Prevents memory leaks in the Map over time
    const now = Date.now();
    cooldownStore.record(KEY, now, 1000);

    // Fast forward 2 seconds
    cooldownStore.pruneIfNeeded(now + 2000, 0);
    expect(cooldownStore.check(KEY, now + 2000)).toBeNull();
  });
});
