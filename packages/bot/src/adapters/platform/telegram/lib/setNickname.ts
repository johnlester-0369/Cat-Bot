/**
 * Telegram — setNickname
 *
 * The closest equivalent to a participant nickname in Telegram is a custom
 * administrator title via setChatAdministratorCustomTitle. This only works for
 * chat administrators — regular-member nicknames are not exposed by the Bot API
 * as of 2026. Command modules should handle the resulting API error gracefully
 * and inform the user that the target must be an admin.
 */
import type { Context } from 'telegraf';

export async function setNickname(
  ctx: Context,
  _threadID: string,
  userID: string,
  nickname: string,
): Promise<void> {
  await ctx.telegram.setChatAdministratorCustomTitle(
    ctx.chat?.id as number,
    Number(userID),
    nickname ?? '',
  );
}
