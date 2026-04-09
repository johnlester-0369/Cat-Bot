/**
 * Telegram — reactToMessage
 *
 * Uses Bot API 7.0+ setMessageReaction. Reaction type 'emoji' is the standard
 * non-paid emoji; paid reactions require a different type and are not handled here.
 */
import type { Context } from 'telegraf';

export async function reactToMessage(
  ctx: Context,
  _threadID: string,
  messageID: string,
  emoji: string,
): Promise<void> {
  await ctx.telegram.setMessageReaction(
    ctx.chat?.id as number,
    Number(messageID),
    // @ts-expect-error Telegraf strongly types emojis; Cat-Bot passes string and relies on Telegram API validation
    [{ type: 'emoji' as const, emoji }],
  );
}
