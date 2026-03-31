/**
 * Telegram — removeGroupImage
 *
 * ctx.deleteChatPhoto() is the Telegraf v4 context shorthand — mirrors
 * setGroupImage using ctx.setChatPhoto(); the assert() inside the shorthand
 * guarantees chat.id is defined, eliminating the chat?.id optional-chain risk.
 */
import type { Context } from 'telegraf';

export async function removeGroupImage(
  ctx: Context,
  _threadID: string,
): Promise<void> {
  await ctx.deleteChatPhoto();
}
