/**
 * Telegram — removeUserFromGroup
 *
 * Kick = ban then immediately unban with only_if_banned.
 * The immediate unban lets the user rejoin later via an invite link — a
 * permanent ban would be too destructive for a general-purpose kick command.
 */
import type { Context } from 'telegraf';

export async function removeUserFromGroup(
  ctx: Context,
  _threadID: string,
  userID: string,
): Promise<void> {
  const chatId = ctx.chat?.id as number;
  // banChatMember removes the user immediately; unban with only_if_banned lets them rejoin via link
  await ctx.telegram.banChatMember(chatId, Number(userID));
  await ctx.telegram.unbanChatMember(chatId, Number(userID), {
    only_if_banned: true,
  });
}
