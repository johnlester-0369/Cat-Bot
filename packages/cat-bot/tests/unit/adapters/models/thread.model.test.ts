import { describe, it, expect } from 'vitest';
import { createUnifiedThreadInfo } from '@/engine/adapters/models/thread.model.js';

describe('Unified Thread Model', () => {
  it('should create default populated thread info when data is missing', () => {
    // WHY: Protects command logic from null-pointer exceptions if a platform fails to fetch metadata
    const result = createUnifiedThreadInfo({});

    expect(result.platform).toBe('unknown');
    expect(result.threadID).toBe('');
    expect(result.isGroup).toBe(false);
    expect(result.participantIDs).toEqual([]);
    expect(result.adminIDs).toEqual([]);
    expect(result.name).toBeNull();
  });

  it('should apply partial overlays correctly', () => {
    const result = createUnifiedThreadInfo({ threadID: '123', isGroup: true });
    expect(result.threadID).toBe('123');
    expect(result.isGroup).toBe(true);
    expect(result.platform).toBe('unknown'); // Still falls back
  });
});
