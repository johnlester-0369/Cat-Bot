import { describe, it, expect } from 'vitest';
import { createUnifiedUserInfo } from '@/adapters/models/user.model.js';

describe('Unified User Model', () => {
  it('should create default populated user info when data is missing', () => {
    // WHY: Safely falls back so display logic doesn't crash on incomplete API responses
    const result = createUnifiedUserInfo({});

    expect(result.platform).toBe('unknown');
    expect(result.id).toBe('');
    expect(result.name).toBe('');
    expect(result.username).toBeNull();
    expect(result.avatarUrl).toBeNull();
  });

  it('should apply valid overrides', () => {
    const result = createUnifiedUserInfo({ id: '999', name: 'John' });
    expect(result.id).toBe('999');
    expect(result.name).toBe('John');
    expect(result.username).toBeNull();
  });
});
