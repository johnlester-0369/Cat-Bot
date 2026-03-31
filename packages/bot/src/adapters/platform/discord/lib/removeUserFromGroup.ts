/**
 * Kicks a guild member by ID.
 * Requires the bot to have KICK_MEMBERS permission and its role to be higher
 * in the hierarchy than the target member.
 */
import type { Guild } from 'discord.js';

export async function removeUserFromGroup(
  guild: Guild | null,
  userID: string,
): Promise<void> {
  if (!guild) throw new Error('Not in a server.');
  const member = await guild.members.fetch(userID);
  await member.kick('Removed by bot command');
}
