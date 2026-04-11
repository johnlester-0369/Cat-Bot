/**
 * Telegram — MarkdownV2 Escaping & Validation Utilities
 *
 * Official Bot API spec (core.telegram.org/bots/api#markdownv2-style):
 *   Outside formatting entities these 18 chars MUST be preceded by '\':
 *     _ * [ ] ( ) ~ ` > # + - = | { } . !
 *   '\' itself must also be escaped as '\\'.
 *   Any character with code 1–126 can be escaped by a preceding '\',
 *   in which case it is treated as an ordinary character.
 *
 * Three exports:
 *   escapeMarkdownV2   — full escape for guaranteed-safe plain text (no formatting)
 *   sanitizeMarkdownV2 — preserves intentional formatting; escapes only bare reserved chars
 *   validateMarkdownV2 — pre-flight check; returns false if text contains bare reserved chars
 */

/** The 18 reserved characters outside formatting entities (Bot API MarkdownV2-style). */
const RESERVED = new Set<string>([
  '_',
  '*',
  '[',
  ']',
  '(',
  ')',
  '~',
  '`',
  '>',
  '#',
  '+',
  '-',
  '=',
  '|',
  '{',
  '}',
  '.',
  '!',
]);

// ── escapeMarkdownV2 ──────────────────────────────────────────────────────────

/**
 * Escapes EVERY MarkdownV2 reserved character (including '\' itself) so the text
 * renders as literal plain text with no Markdown formatting applied.
 *
 * Use this when the caller does NOT intend any formatting — e.g., sending a raw
 * user-supplied string (username, file path, error message) that may contain any char.
 *
 * Escape order matters: '\' must be escaped first so we never double-escape chars
 * added in the second pass.
 */
export function escapeMarkdownV2(text: string): string {
  // Escape '\' first, then all 18 reserved chars
  let result = '';
  for (const ch of text) {
    if (ch === '\\' || RESERVED.has(ch)) {
      result += '\\' + ch;
    } else {
      result += ch;
    }
  }
  return result;
}

// ── sanitizeMarkdownV2 ────────────────────────────────────────────────────────

/**
 * Escapes only the bare reserved characters that would cause a 400 Bot API error,
 * while preserving existing escape sequences and intentional formatting markers.
 *
 * Algorithm (stateful char-by-char scanner):
 *   1. If current char is '\' AND next char has code 1–126 → valid escape; copy both, advance 2.
 *   2. If current char is '\' with no valid next char → bare backslash; escape it as '\\'.
 *   3. If current char is a reserved char → escape it as '\X'.
 *   4. Otherwise → copy as-is.
 *
 * This means *bold* stays *bold*, _italic_ stays _italic_, and "user.name" becomes "user\.name".
 * It does NOT validate that formatting markers are properly paired — use this as a best-effort
 * sanitiser. For fully controlled output (no formatting), use escapeMarkdownV2() instead.
 */
export function sanitizeMarkdownV2(text: string): string {
  let result = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;

    if (ch === '\\' && i + 1 < text.length) {
      const next = text[i + 1]!;
      // Valid escape sequence: \X where X has code 1–126 — pass through unchanged
      if (next.charCodeAt(0) >= 1 && next.charCodeAt(0) <= 126) {
        result += ch + next;
        i += 2;
        continue;
      }
      // Bare backslash not forming a valid escape — escape the backslash itself
      result += '\\\\';
      i++;
      continue;
    }

    if (RESERVED.has(ch)) {
      // Bare reserved char — escape it so the Bot API does not treat it as syntax
      result += '\\' + ch;
    } else {
      result += ch;
    }
    i++;
  }
  return result;
}

// ── validateMarkdownV2 ────────────────────────────────────────────────────────

/**
 * Returns true if the text contains no bare (unescaped) MarkdownV2 reserved characters,
 * meaning it is safe to send with parse_mode: 'MarkdownV2' without triggering a 400 error.
 *
 * Uses the same scanner logic as sanitizeMarkdownV2 — a '\' followed by a char with
 * code 1–126 is treated as an intentional escape and skipped; any other reserved char
 * without a preceding '\' fails validation.
 *
 * Note: syntactic validity only — does not verify paired formatting markers (e.g.,
 * every opening '*' has a closing '*'). Telegram's own parser handles pair matching.
 */
export function validateMarkdownV2(text: string): boolean {
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;

    if (ch === '\\' && i + 1 < text.length) {
      const next = text[i + 1]!;
      if (next.charCodeAt(0) >= 1 && next.charCodeAt(0) <= 126) {
        i += 2; // Valid escape — skip both chars
        continue;
      }
    }

    // Bare reserved char (or bare backslash at end of string) → invalid MarkdownV2
    if (RESERVED.has(ch) || ch === '\\') return false;
    i++;
  }
  return true;
}
