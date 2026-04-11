/**
 * Message Style Registry
 *
 * Controls how message text is interpreted and rendered by each platform adapter.
 *
 *   TEXT     — Raw plain text. Platform-specific markdown syntax is escaped so it
 *              displays literally (no unintended bold/italic/etc. rendering).
 *              On Discord: escapeMarkdown is applied.
 *              On Telegram: no parse_mode is set.
 *              On FB Messenger/Page: text is sent as-is.
 *
 *   MARKDOWN — Formatted text. Each platform uses its native formatting mechanism.
 *              On Discord: text passes through as-is (Discord renders markdown natively).
 *              On Telegram: parse_mode 'MarkdownV2' is applied. Callers are responsible
 *                           for escaping MarkdownV2 reserved characters.
 *              On FB Messenger/Page: mdToText() converts Markdown to styled Unicode
 *                           characters since neither platform supports native markdown.
 *
 * When style is omitted, platform default behavior is preserved (backward compatible):
 *   Discord   → renders markdown (same as MARKDOWN)
 *   Telegram  → no parse_mode (same as TEXT)
 *   FB        → raw text (same as TEXT)
 */

export const MessageStyle = {
  TEXT: 'text',
  MARKDOWN: 'markdown',
} as const;

export type MessageStyleValue =
  (typeof MessageStyle)[keyof typeof MessageStyle];
