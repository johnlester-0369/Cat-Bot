/**
 * mdToText — Markdown → Styled Unicode Plain Text
 *
 * Converts standard Markdown syntax into visually styled Unicode characters
 * for platforms that have no native markdown rendering support
 * (Facebook Messenger, Facebook Page).
 *
 * Based on established practice (tools.s-anand.net/unicoder):
 *   Headings + bold  →  Math Sans-Serif Bold    (U+1D5D4 / U+1D5EE / U+1D7EC)
 *   Italic           →  Math Sans-Serif Italic  (U+1D608 / U+1D622)
 *   Inline code      →  Math Monospace          (U+1D670 / U+1D68A / U+1D7F6)
 *
 * Code blocks, tables, and horizontal rules are passed through unchanged
 * because they carry structural meaning best preserved as ASCII.
 *
 * Ported from CJS mdToText.js to ESM TypeScript for compatibility with the
 * nodenext module resolution and strict TypeScript config of this project.
 */

// ─── Character map builder ────────────────────────────────────────────────────

function buildMap(
  upBase: number,
  loBase: number,
  dgBase: number | null = null,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (let i = 0; i < 26; i++) {
    map[String.fromCharCode(65 + i)] = String.fromCodePoint(upBase + i);
    map[String.fromCharCode(97 + i)] = String.fromCodePoint(loBase + i);
  }
  if (dgBase !== null) {
    for (let i = 0; i < 10; i++) {
      map[String.fromCharCode(48 + i)] = String.fromCodePoint(dgBase + i);
    }
  }
  return map;
}

const MAPS = {
  bold: buildMap(0x1d5d4, 0x1d5ee, 0x1d7ec), // sans-serif bold   (+ digits)
  italic: buildMap(0x1d608, 0x1d622), // sans-serif italic (no digits)
  sans: buildMap(0x1d5a0, 0x1d5ba, 0x1d7e2), // sans-serif regular
  mono: buildMap(0x1d670, 0x1d68a, 0x1d7f6), // monospace
} as const;

function applyMap(str: string, map: Record<string, string>): string {
  return [...str].map((c) => map[c] ?? c).join('');
}

export const bold = (str: string): string => applyMap(str, MAPS.bold);
export const italic = (str: string): string => applyMap(str, MAPS.italic);
export const sans = (str: string): string => applyMap(str, MAPS.sans);
export const mono = (str: string): string => applyMap(str, MAPS.mono);

export const strikethrough = (str: string): string =>
  [...str].map((c) => c + '\u0336').join('');
export const underline = (str: string): string =>
  [...str].map((c) => c + '\u0332').join('');

// ─── Heading styles ───────────────────────────────────────────────────────────
// H1/H2 → Sans-Serif Bold (most prominent), H3 → Sans-Serif Regular, H4+ → Italic

function heading(level: number, text: string): string {
  if (level <= 2) return bold(text);
  if (level === 3) return sans(text);
  return italic(text);
}

// ─── Blockquote ───────────────────────────────────────────────────────────────

function blockquote(lines: string[]): string {
  return lines.map((l) => '┃ ' + italic(l)).join('\n');
}

// ─── Inline processor ─────────────────────────────────────────────────────────

function processInline(text: string): string {
  return (
    text
      // Bold-italic ***text*** (must run first to avoid matching inner **)
      .replace(/\*\*\*(.+?)\*\*\*/g, (_, t: string) => bold(italic(t)))
      // Bold **text** or __text__
      .replace(/\*\*(.+?)\*\*/g, (_, t: string) => bold(t))
      .replace(/(?<!_)__(.+?)__(?!_)/g, (_, t: string) => bold(t))
      // Italic *text* or _text_
      .replace(/\*(.+?)\*/g, (_, t: string) => italic(t))
      .replace(/(?<!_)_([^_]+)_(?!_)/g, (_, t: string) => italic(t))
      // Strikethrough ~~text~~
      .replace(/~~(.+?)~~/g, (_, t: string) => strikethrough(t))
      // Underline <u>text</u>
      .replace(/<u>(.+?)<\/u>/gi, (_, t: string) => underline(t))
      // Inline code `text`
      .replace(/`([^`]+)`/g, (_, t: string) => mono(t))
      // Links [label](url)
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        (_, label: string, url: string) => `${italic(label)} ‹${url}›`,
      )
      // Images ![alt](url) — display alt text with a camera prefix
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, (_, alt: string) => `🖼  ${alt}`)
      // HTML entities
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
  );
}

// ─── Main converter ───────────────────────────────────────────────────────────

/**
 * Convert Markdown to styled Unicode plain text.
 *
 * Passes through unchanged: fenced code blocks, tables, horizontal rules.
 * Suitable for platforms with no native markdown rendering (FB Messenger, FB Page).
 */
export function mdToText(md: string): string {
  const output: string[] = [];
  const lines = md.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    // ── Fenced code block → pass through as-is ────────────────────────────────
    const fenceMatch = line.match(/^(`{3}|~{3})/);
    if (fenceMatch) {
      const fence = fenceMatch[1] ?? '```';
      output.push(line);
      i++;
      while (i < lines.length && !(lines[i] ?? '').startsWith(fence)) {
        output.push(lines[i] ?? '');
        i++;
      }
      if (i < lines.length) {
        output.push(lines[i] ?? '');
        i++;
      }
      continue;
    }

    // ── Table → pass through as-is ────────────────────────────────────────────
    if (line.startsWith('|')) {
      while (i < lines.length && (lines[i] ?? '').startsWith('|')) {
        output.push(lines[i] ?? '');
        i++;
      }
      continue;
    }

    // ── Horizontal rule → pass through as-is ──────────────────────────────────
    if (/^[-*_]{3,}\s*$/.test(line)) {
      output.push(line);
      i++;
      continue;
    }

    // ── ATX Heading (# Title) ─────────────────────────────────────────────────
    const hMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (hMatch) {
      output.push(
        heading((hMatch[1] ?? '#').length, processInline(hMatch[2] ?? '')),
      );
      i++;
      continue;
    }

    // ── Setext heading (underlined with === or ---) ────────────────────────────
    if (i + 1 < lines.length && line.trim()) {
      if (/^=+$/.test(lines[i + 1] ?? '')) {
        output.push(heading(1, processInline(line)));
        i += 2;
        continue;
      }
      if (/^-+$/.test(lines[i + 1] ?? '') && !line.match(/^[-*+]\s/)) {
        output.push(heading(2, processInline(line)));
        i += 2;
        continue;
      }
    }

    // ── Blockquote (> text) ───────────────────────────────────────────────────
    if (line.startsWith('>')) {
      const qLines: string[] = [];
      while (i < lines.length && (lines[i] ?? '').startsWith('>')) {
        qLines.push((lines[i] ?? '').replace(/^>\s?/, ''));
        i++;
      }
      output.push(blockquote(qLines.map(processInline)));
      continue;
    }

    // ── Task list (before ul) — [ ] and [x] ──────────────────────────────────
    const taskMatch = line.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)/);
    if (taskMatch) {
      const depth = Math.floor((taskMatch[1] ?? '').length / 2);
      const checked = (taskMatch[2] ?? ' ').toLowerCase() === 'x' ? '☑' : '☐';
      output.push(
        '  '.repeat(depth) + checked + ' ' + processInline(taskMatch[3] ?? ''),
      );
      i++;
      continue;
    }

    // ── Unordered list (-, *, +) ──────────────────────────────────────────────
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.*)/);
    if (ulMatch) {
      const depth = Math.floor((ulMatch[1] ?? '').length / 2);
      const bullet = (['•', '◦', '▸'] as const)[depth % 3] ?? '•';
      output.push(
        '  '.repeat(depth) + bullet + ' ' + processInline(ulMatch[2] ?? ''),
      );
      i++;
      continue;
    }

    // ── Ordered list (1. 2. ...) ──────────────────────────────────────────────
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)/);
    if (olMatch) {
      const depth = Math.floor((olMatch[1] ?? '').length / 2);
      output.push(
        '  '.repeat(depth) +
          bold((olMatch[2] ?? '1') + '.') +
          ' ' +
          processInline(olMatch[3] ?? ''),
      );
      i++;
      continue;
    }

    // ── Blank line ────────────────────────────────────────────────────────────
    if (line.trim() === '') {
      output.push('');
      i++;
      continue;
    }

    // ── Paragraph ─────────────────────────────────────────────────────────────
    output.push(processInline(line));
    i++;
  }

  return output.join('\n');
}
