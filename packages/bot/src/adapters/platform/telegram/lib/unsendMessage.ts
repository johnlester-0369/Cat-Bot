/**
 * Telegram — unsendMessage
 *
 * Silently swallows errors because the message may have already been deleted,
 * fallen outside the 48-hour Bot API deletion window, or the bot may lack
 * admin rights in the chat — none of these should surface as a user-visible error.
 */
import type { Context } from 'telegraf';

export async function unsendMessage(
  ctx: Context,
  messageID: string | number,
): Promise<void> {
  try {
    await ctx.deleteMessage(Number(messageID));
  } catch {
    /* deletion failure is non-fatal */
  }
}
