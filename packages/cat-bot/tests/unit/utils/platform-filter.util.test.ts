import { describe, it, expect } from 'vitest';
import { isPlatformAllowed } from '@/engine/modules/platform/platform-filter.util.js';

describe('Platform Filter Utility', () => {
  it('should allow all platforms if config.platform is absent', () => {
    // WHY: Maintains backward compatibility for commands without explicit platform filters
    const mod = { config: { name: 'test' } };
    expect(isPlatformAllowed(mod, 'discord')).toBe(true);
    expect(isPlatformAllowed(mod, 'telegram')).toBe(true);
  });

  it('should allow all platforms if config.platform is empty array', () => {
    const mod = { config: { name: 'test', platform: [] } };
    expect(isPlatformAllowed(mod, 'facebook-messenger')).toBe(true);
  });

  it('should restrict execution to explicitly listed platforms', () => {
    // WHY: Secures commands that use native payload features exclusively supported by one platform
    const mod = { config: { name: 'test', platform: ['discord'] } };
    expect(isPlatformAllowed(mod, 'discord')).toBe(true);
    expect(isPlatformAllowed(mod, 'telegram')).toBe(false);
  });
});
