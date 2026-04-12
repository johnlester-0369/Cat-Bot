/**
 * Telegram — editMessage
 *
 * editMessageText(chatId, message_id, inline_message_id, text):
 * inline_message_id must be undefined (not null) for non-inline messages —
 * passing null would violate the strict TypeScript signature on the Telegraf type.
 */
import type { Context } from 'telegraf';
import type { EditMessageOptions } from '@/engine/adapters/models/api.model.js';
import { sanitizeMarkdownV2 } from '../utils/markdownv2.util.js';

export async function editMessage(
  ctx: Context,
  messageID: string,
  options: string | EditMessageOptions,
): Promise<void> {
  // Safely extract text from both plain string and unified SendPayload shapes —
  // options.message is typed as string | SendPayload | undefined; the nested object
  // branch handles the case where a raw SendPayload is forwarded from context.model.
  let text: string;
  if (typeof options === 'string') {
    text = options;
  } else {
    const rawMsg = options.message;
    text = typeof rawMsg === 'string'
      ? rawMsg
      : ((rawMsg as { message?: string } | undefined)?.message ??
         (rawMsg as { body?: string } | undefined)?.body ??
         '');
  }

  const style = typeof options === 'object' ? options.style : undefined;
  const parseMode = style === 'markdown' ? 'MarkdownV2' : undefined;

  if (parseMode === 'MarkdownV2') text = sanitizeMarkdownV2(text);

  const button = typeof options === 'object' ? options.button : undefined;
  let replyMarkup;

  if (button !== undefined) {
    replyMarkup = button.length > 0 ? {
      inline_keyboard: [
        button.map((btn) => ({
          text: btn.label,
          callback_data: btn.id.slice(0, 64),
        })),
      ],
    } : { inline_keyboard: [] };
  }

  // parseInt with base-10 radix guards against the silent failures Number() produces:
  // Number('') === 0 and Number('undefined') === NaN both cause Telegram Bot API 400.
  const msgId = parseInt(messageID, 10);
  if (!Number.isFinite(msgId) || msgId <= 0) {
    throw new Error(`[telegram] editMessage: invalid messageID "${messageID}"`);
  }
  await ctx.telegram.editMessageText(
    ctx.chat?.id,
    msgId,
    undefined, // inline_message_id — must be undefined, not null, for non-inline messages
    text,
    {
      ...(parseMode ? { parse_mode: parseMode } : {}),
      ...(replyMarkup ? { reply_markup: replyMarkup } : {})
    }
  );
}
