/**
 * Telegram — setGroupName
 *
 * ctx.setChatTitle() is the Telegraf v4 shortcut (context.ts) — reads chat.id
 * internally, eliminating the need for an optional-chain on ctx.chat?.id.
 */
import type { Context } from 'telegraf';

export async function setGroupName(
  ctx: Context,
  _threadID: string,
  name: string,
): Promise<void> {
  await ctx.setChatTitle(name);
}
