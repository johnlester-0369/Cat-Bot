/**
 * Sets a guild member's display nickname.
 * Requires the bot's role to be higher in the hierarchy than the target member.
 * Pass null or empty string to clear the nickname back to the default account username.
 */
import type { Guild } from 'discord.js';

export async function setNickname(
  guild: Guild | null,
  userID: string,
  nickname: string | null,
): Promise<void> {
  if (!guild) throw new Error('Not in a server.');
  const member = await guild.members.fetch(userID);
  await member.setNickname(nickname ?? null, 'Set by bot command');
}
