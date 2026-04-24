import { describe, it, expect } from 'vitest';
import {
  parseTextOptions,
  validateOptions,
} from '@/engine/modules/options/options.util.js';
import { OptionsMap } from '@/engine/modules/options/options-map.lib.js';
import type { OptionDef } from '@/engine/modules/options/options-map.lib.js';

describe('Options Utility', () => {
  const defs: OptionDef[] = [
    { name: 'text', required: true },
    { name: 'lang', required: false },
  ];

  describe('parseTextOptions', () => {
    it('should extract key-value pairs separated by colons', () => {
      // WHY: Validates the core regex behavior processing multi-word arguments
      const result = parseTextOptions('text: hello world lang: es', defs);
      expect(result).toEqual({ text: 'hello world', lang: 'es' });
    });

    it('should ignore unrecognized keys', () => {
      // WHY: Extraneous text shouldn't pollute the parsed map
      const result = parseTextOptions(
        'text: valid garbage: skip lang: fr',
        defs,
      );
      expect(result).toEqual({ text: 'valid garbage: skip', lang: 'fr' });
    });

    it('should handle missing optional arguments', () => {
      const result = parseTextOptions('text: just text', defs);
      expect(result).toEqual({ text: 'just text' });
    });
  });

  describe('validateOptions', () => {
    it('should return null when all required options are present', () => {
      // WHY: Null indicates validation success
      const options = new OptionsMap({ text: 'data' });
      const error = validateOptions(options, defs, 'translate', '/');
      expect(error).toBeNull();
    });

    it('should return formatted error string when required option is missing', () => {
      // WHY: Automatically generates usage instructions to help the user
      const options = new OptionsMap({ lang: 'es' });
      const error = validateOptions(options, defs, 'translate', '/');
      expect(error).toContain('Missing required input');
      expect(error).toContain('text (required)');
    });
  });
});
