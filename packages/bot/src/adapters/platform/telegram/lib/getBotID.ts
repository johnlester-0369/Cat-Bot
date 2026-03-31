/**
 * Telegram — getBotID
 *
 * ctx.botInfo is populated by Telegraf on every update after bot.launch() —
 * same object as getMe() but cached in-process, so this costs zero network
 * round-trips in normal operation. The ctx.telegram.getMe() fallback covers
 * the test-mock path and any edge where botInfo hasn't been hydrated yet.
 */
import type { Context } from 'telegraf';

export async function getBotID(ctx: Context): Promise<string> {
  if (ctx.botInfo?.id != null) return String(ctx.botInfo.id);
  const me = await ctx.telegram.getMe();
  return String(me.id);
}
