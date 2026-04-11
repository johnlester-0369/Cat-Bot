/**
 * Telegram — MarkdownV2 Escaping & Validation Utilities
 *
 * Official Bot API 9.6 spec (core.telegram.org/bots/api#markdownv2-style, April 2026):
 *
 *   In ALL places — including inside bold, italic, and other formatting spans —
 *   these 18 characters MUST be preceded by '\':
 *     _ * [ ] ( ) ~ ` > # + - = | { } . !
 *   '\' itself must also be escaped as '\\'.
 *
 * ── The critical rule that the previous implementation missed ─────────────────
 * "In all other places" in the spec does NOT mean "outside formatting spans".
 * It means "anywhere that is not a pre/code block". So ( ) . ! inside *bold* STILL
 * need escaping — only the formatting MARKER chars themselves (the `*` delimiters)
 * are kept as-is. Everything else in the span content is treated like plain text.
 *
 * ── Architecture of sanitizeMarkdownV2 ───────────────────────────────────────
 * State machine — char-by-char — four cases:
 *   1. Existing \X escape → copy verbatim, advance 2
 *   2. Formatting span opener (`, ```, *, __, _, ~, ||, [) → keep marker,
 *      call escapeInner() on content, keep closing marker
 *   3. No matching closing marker → treat opener as bare reserved char → escape it
 *   4. Plain char → escape if reserved, else copy
 *
 * escapeInner(content, exceptChar):
 *   Escapes all reserved chars EXCEPT the span's own marker character. The marker
 *   char appears as both opener and closer; escaping it inside the content would
 *   prematurely terminate the span. Existing \X sequences inside content are
 *   preserved verbatim (idempotency guarantee).
 *
 * Supported formatting patterns (Telegram MarkdownV2, Bot API 9.6):
 *   *bold*        _italic_    __underline__    ~strikethrough~
 *   ||spoiler||   `inline`    ```block```      [text](url)
 *
 * CommonMark **bold** (double asterisk) is auto-converted to *bold* because
 * command modules in this codebase use the more familiar CommonMark syntax.
 *
 * Three exports — same surface as before, no import changes needed in callers:
 *   escapeMarkdownV2   — full escape for literal plain text (no formatting)
 *   sanitizeMarkdownV2 — smart converter: markers kept, content escaped, **→*
 *   validateMarkdownV2 — true iff sanitizeMarkdownV2 would not change the text
 */

/** All 18 reserved characters outside formatting entities (Bot API MarkdownV2-style). */
const RESERVED = new Set<string>([
  '_', '*', '[', ']', '(', ')', '~', '`', '>',
  '#', '+', '-', '=', '|', '{', '}', '.', '!',
]);

// ── escapeMarkdownV2 ──────────────────────────────────────────────────────────

/**
 * Full escape — every reserved character AND '\' is escaped so the text renders
 * as literal plain text with zero formatting applied.
 *
 * Use for raw user-supplied strings (usernames, file paths, error messages)
 * that must appear verbatim. Never use when intentional formatting is present —
 * it would escape the formatting markers too.
 *
 * Escapes '\' first to avoid double-escaping chars added in the second pass.
 */
export function escapeMarkdownV2(text: string): string {
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

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Converts CommonMark **double-asterisk bold** → Telegram MarkdownV2 *single-asterisk bold*.
 *
 * Command modules use **bold** (CommonMark) because it is widely recognised in editors
 * and documentation. Telegram MarkdownV2 uses a single asterisk. Without this conversion,
 * the double asterisks would be treated as two bare reserved '*' chars and escaped to
 * \*\*bold\*\*, producing literal asterisks with no formatting.
 *
 * Non-greedy [^*\n]+? prevents consuming adjacent **spans** on one line.
 */
function convertCommonMarkBold(text: string): string {
  return text.replace(/\*\*([^*\n]+?)\*\*/g, '*$1*');
}

/**
 * Scans forward from `start` and returns the index of the first unescaped
 * occurrence of `marker`. Returns -1 when:
 *   - a newline is crossed and `crossNewline` is false (inline spans can't span lines)
 *   - end of string is reached without finding the marker
 *
 * Skips existing \X escape sequences (they do not close the span).
 */
function findClosingMarker(
  text: string,
  start: number,
  marker: string,
  crossNewline = false,
): number {
  let i = start;
  while (i < text.length) {
    const ch = text[i]!;
    // Existing \X escape — the escaped char cannot be a span closer
    if (ch === '\\' && i + 1 < text.length) {
      i += 2;
      continue;
    }
    // Inline formatting cannot cross newlines
    if (!crossNewline && ch === '\n') return -1;
    if (ch === marker) return i;
    i++;
  }
  return -1;
}

/**
 * Escapes all MarkdownV2 reserved characters inside a formatting span's CONTENT —
 * i.e., everything between the opening and closing marker characters.
 *
 * Why `exceptChar` exists: the span's own marker character (e.g. `*` for bold) must
 * NOT be escaped inside the content. Escaping it would not prematurely close the span
 * in the Bot API parser, but it would break the visual render because the parser would
 * see `\*` (escaped literal asterisk) instead of the structural marker it expects at
 * the boundary. Command modules never embed a literal `*` inside `*bold*` text, so this
 * edge case is safely ignored — the marker char is simply kept as-is.
 *
 * Existing \X escape sequences are preserved verbatim — running this function twice on
 * already-sanitized content returns the same string (idempotency guarantee).
 *
 * Example:
 *   escapeInner('Load avg (1/5/15 min):', '*')
 *   → 'Load avg \(1/5/15 min\):'    ( ( and ) escaped; : not reserved; * untouched )
 */
function escapeInner(content: string, exceptChar: string): string {
  let result = '';
  let i = 0;
  while (i < content.length) {
    const ch = content[i]!;

    // Preserve existing \X escape sequences — idempotency: never re-escape \( or \. etc.
    if (
      ch === '\\' &&
      i + 1 < content.length &&
      content[i + 1]!.charCodeAt(0) >= 1 &&
      content[i + 1]!.charCodeAt(0) <= 126
    ) {
      result += '\\' + content[i + 1]!;
      i += 2;
      continue;
    }

    // Keep the span's own marker char — it is the structural delimiter, not content
    if (ch === exceptChar) {
      result += ch;
      i++;
      continue;
    }

    // Escape bare '\' (not forming a valid \X sequence above)
    if (ch === '\\') {
      result += '\\\\';
      i++;
      continue;
    }

    // Escape any other reserved character
    if (RESERVED.has(ch)) {
      result += '\\' + ch;
    } else {
      result += ch;
    }
    i++;
  }
  return result;
}

// ── sanitizeMarkdownV2 ────────────────────────────────────────────────────────

/**
 * Converts command-module Markdown output into valid Telegram MarkdownV2.
 *
 * The state machine processes the text character-by-character, alternating between
 * formatting-span recognition and plain-text escaping. The central contract:
 *
 *   FORMATTING MARKERS (*, _, __, ~, ||, `, ```) → kept verbatim (they ARE the syntax)
 *   SPAN CONTENT (everything between markers) → escapeInner() (Bot API requires all
 *     18 reserved chars escaped here too, including ( ) . !)
 *   PLAIN TEXT (outside any span) → all 18 reserved chars + '\' escaped
 *   EXISTING \X SEQUENCES → copied verbatim in all contexts (idempotency)
 *
 * Step 1: convertCommonMarkBold — **bold** → *bold* so the single-asterisk form is
 *         recognised as a formatting span in step 2.
 * Step 2: state machine — processes spans in priority order (``` before `, __ before _,
 *         || before bare |) to avoid partial matches.
 *
 * Idempotent: running on already-sanitized MarkdownV2 text returns the same string.
 */
export function sanitizeMarkdownV2(text: string): string {
  // Step 1: Normalise **bold** → *bold* so the single-asterisk form is matched below
  const src = convertCommonMarkBold(text);

  let result = '';
  let i = 0;

  while (i < src.length) {
    const ch = src[i]!;

    // ── Preserve existing \X escape sequences (idempotency) ───────────────────
    if (
      ch === '\\' &&
      i + 1 < src.length &&
      src[i + 1]!.charCodeAt(0) >= 1 &&
      src[i + 1]!.charCodeAt(0) <= 126
    ) {
      result += '\\' + src[i + 1]!;
      i += 2;
      continue;
    }

    // ── Triple-backtick code block: ```...``` ─────────────────────────────────
    // Must be checked BEFORE single backtick to avoid partial match
    if (src.startsWith('```', i)) {
      const closeIdx = src.indexOf('```', i + 3);
      if (closeIdx !== -1) {
        // Inside code blocks: only ` and \ need escaping (Bot API pre-block rules)
        const inner = src.slice(i + 3, closeIdx);
        result += '```' + inner.replace(/[`\\]/g, '\\$&') + '```';
        i = closeIdx + 3;
        continue;
      }
      // No closing ```: treat first ` as bare reserved char, reprocess remaining
      result += '\\`';
      i++;
      continue;
    }

    // ── Single-backtick inline code: `...` ───────────────────────────────────
    if (ch === '`') {
      const closeIdx = findClosingMarker(src, i + 1, '`', false);
      if (closeIdx !== -1 && closeIdx > i + 1) {
        // Inside inline code: only ` and \ need escaping (Bot API code-entity rules)
        const inner = src.slice(i + 1, closeIdx);
        result += '`' + inner.replace(/[`\\]/g, '\\$&') + '`';
        i = closeIdx + 1;
        continue;
      }
      // No closing ` on this line: bare backtick → escape
      result += '\\`';
      i++;
      continue;
    }

    // ── Bold: *...* ───────────────────────────────────────────────────────────
    // convertCommonMarkBold has already converted **x** → *x* above.
    // Non-empty span only: closeIdx must be > i+1 (at least one char of content).
    if (ch === '*') {
      const closeIdx = findClosingMarker(src, i + 1, '*', false);
      if (closeIdx !== -1 && closeIdx > i + 1) {
        const inner = src.slice(i + 1, closeIdx);
        // Markers kept; content passed through escapeInner to fix ( ) . ! etc.
        result += '*' + escapeInner(inner, '*') + '*';
        i = closeIdx + 1;
        continue;
      }
      // No matching closing * on this line → bare asterisk → escape
      result += '\\*';
      i++;
      continue;
    }

    // ── Underline: __...__ (MUST be checked before single underscore) ─────────
    if (ch === '_' && src[i + 1] === '_') {
      const closeIdx = src.indexOf('__', i + 2);
      if (closeIdx !== -1 && closeIdx > i + 2) {
        const inner = src.slice(i + 2, closeIdx);
        result += '__' + escapeInner(inner, '_') + '__';
        i = closeIdx + 2;
        continue;
      }
    }

    // ── Italic: _..._ ────────────────────────────────────────────────────────
    if (ch === '_') {
      const closeIdx = findClosingMarker(src, i + 1, '_', false);
      // Reject if closing position would form __ (ambiguous with underline end)
      if (closeIdx !== -1 && closeIdx > i + 1 && src[closeIdx + 1] !== '_') {
        const inner = src.slice(i + 1, closeIdx);
        result += '_' + escapeInner(inner, '_') + '_';
        i = closeIdx + 1;
        continue;
      }
      // Bare underscore → escape
      result += '\\_';
      i++;
      continue;
    }

    // ── Strikethrough: ~...~ ─────────────────────────────────────────────────
    if (ch === '~') {
      const closeIdx = findClosingMarker(src, i + 1, '~', false);
      if (closeIdx !== -1 && closeIdx > i + 1) {
        const inner = src.slice(i + 1, closeIdx);
        result += '~' + escapeInner(inner, '~') + '~';
        i = closeIdx + 1;
        continue;
      }
      result += '\\~';
      i++;
      continue;
    }

    // ── Spoiler: ||...|| (MUST be checked before bare |) ─────────────────────
    if (ch === '|' && src[i + 1] === '|') {
      const closeIdx = src.indexOf('||', i + 2);
      if (closeIdx !== -1 && closeIdx > i + 2) {
        const inner = src.slice(i + 2, closeIdx);
        result += '||' + escapeInner(inner, '|') + '||';
        i = closeIdx + 2;
        continue;
      }
    }

    // ── Inline link: [text](url) ─────────────────────────────────────────────
    // URL portion is kept verbatim — Telegram parses it as a raw URI without
    // MarkdownV2 escaping rules applied (the ( ) delimiters are structural here).
    if (ch === '[') {
      const textClose = src.indexOf(']', i + 1);
      if (textClose !== -1 && src[textClose + 1] === '(') {
        const urlClose = src.indexOf(')', textClose + 2);
        if (urlClose !== -1) {
          const linkText = src.slice(i + 1, textClose);
          const url = src.slice(textClose + 2, urlClose);
          result += '[' + escapeInner(linkText, ']') + '](' + url + ')';
          i = urlClose + 1;
          continue;
        }
      }
    }

    // ── Plain character ───────────────────────────────────────────────────────
    // Bare '\' (no valid \X pair above) — escape it
    if (ch === '\\') {
      result += '\\\\';
      i++;
      continue;
    }
    // Any of the 18 reserved chars in plain text — escape
    if (RESERVED.has(ch)) {
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
 * Returns true if the text is already valid Telegram MarkdownV2 — i.e.,
 * sanitizeMarkdownV2() would not modify it.
 *
 * Used as a quick-exit check: if the caller has already produced well-formed
 * MarkdownV2 (all reserved chars properly escaped, no **bold** to convert),
 * there is no need to re-process. The equality check is exact — any difference,
 * including the **→* conversion, returns false.
 *
 * Because sanitizeMarkdownV2 is idempotent, this correctly returns true for
 * any text produced by a prior call to sanitizeMarkdownV2.
 */
export function validateMarkdownV2(text: string): boolean {
  return sanitizeMarkdownV2(text) === text;
}