/**
 * Options Parsing & Validation — Stateless Helpers
 *
 * Extracted from controllers/options-parser.ts as pure functions with no mutable state.
 * The OptionsMap class and OptionDef interface live in lib/options-map.lib.ts —
 * this file owns only the parsing and validation logic so it can be imported
 * without pulling in the runtime data structure.
 */

import type { OptionDef } from '@/engine/modules/options/options-map.lib.js';

/** Escapes all RegExp special chars in a literal string for safe interpolation. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parses `key: value` pairs from a raw message body, using the recognised
 * option names as delimiters. Each value extends from its colon to the start
 * of the next `key:` token or end of string — multi-word values need no quoting.
 *
 *   parseTextOptions('/trans text: hello world lang: ko', defs)
 *   → { text: 'hello world', lang: 'ko' }
 *
 * Rules:
 *   - Key matching is case-insensitive (`Text:` matches option named `text`).
 *   - Whitespace around the colon is optional: `text:hello` === `text: hello`.
 *   - Option names must be word-character-only (a–z, 0–9, _); hyphens are not
 *     supported because `-` is not a word boundary character in Unicode regex.
 *   - The `args` array (space-split tokens) is kept separate so positional
 *     argument handling is unaffected by the options system.
 */
export function parseTextOptions(
  text: string,
  optionDefs: OptionDef[],
): Record<string, string> {
  if (!optionDefs.length) return {};

  const namesAlt = optionDefs.map((o) => escapeRegex(o.name)).join('|');

  // Each match captures (optionName)(value).
  // The negative lookahead inside the value group stops each value at the next
  // recognised "optionName:" boundary so sibling options act as delimiters.
  const regex = new RegExp(
    `\\b(${namesAlt})\\s*:\\s*((?:(?!\\b(?:${namesAlt})\\s*:)[\\s\\S])*)`,
    'gi',
  );

  const result: Record<string, string> = {};
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const key = (m[1] ?? '').toLowerCase();
    const value = (m[2] ?? '').trim();
    // Only store non-empty values — a trailing "key:" with no body is treated as absent
    if (value) result[key] = value;
  }
  return result;
}
