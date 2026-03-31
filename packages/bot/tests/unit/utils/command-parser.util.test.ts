import { describe, it, expect } from 'vitest';
import { parseCommand } from '@/utils/command-parser.util.js';

describe('Command Parser Utility', () => {
  it('should parse a standard prefixed command', () => {
    // WHY: Verify standard tokenization splits the command correctly
    const result = parseCommand(['/ping', 'arg1', 'arg2'], '/');
    expect(result).toEqual({ name: 'ping', args: ['arg1', 'arg2'] });
  });

  it('should return null when prefix is missing', () => {
    // WHY: Ensures messages without the trigger prefix are ignored
    const result = parseCommand(['ping', 'arg1'], '/');
    expect(result).toBeNull();
  });

  it('should return null if the token is ONLY the prefix', () => {
    // WHY: Edge case where user types just "/" and hits enter
    const result = parseCommand(['/'], '/');
    expect(result).toBeNull();
  });

  it('should handle spaced prefixes (prefix as independent token)', () => {
    // WHY: Some platforms split symbols and letters differently
    const result = parseCommand(['/', 'ping', 'arg1'], '/');
    expect(result).toEqual({ name: 'ping', args: ['arg1'] });
  });

  it('should force command name to lowercase', () => {
    // WHY: Commands must be case-insensitive for reliable routing
    const result = parseCommand(['/PiNg'], '/');
    expect(result?.name).toBe('ping');
  });
});
