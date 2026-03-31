/**
 * Telegram — editMessage
 *
 * editMessageText(chatId, message_id, inline_message_id, text):
 * inline_message_id must be undefined (not null) for non-inline messages —
 * passing null would violate the strict TypeScript signature on the Telegraf type.
 */
import type { Context } from 'telegraf';

export async function editMessage(
  ctx: Context,
  messageID: string | number,
  newBody: string,
): Promise<void> {
  await ctx.telegram.editMessageText(
    ctx.chat?.id,
    Number(messageID),
    undefined, // inline_message_id — must be undefined, not null, for non-inline messages
    newBody,
  );
}
