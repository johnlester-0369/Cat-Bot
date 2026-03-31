/**
 * Renames a Discord guild (server).
 * Requires the bot's role to have the Manage Server permission.
 * Shared between DiscordApi (slash) and createDiscordChannelApi (message) paths.
 */
import type { Guild } from 'discord.js';

export async function setGroupName(
  guild: Guild | null,
  name: string,
): Promise<void> {
  if (!guild) throw new Error('Not in a server.');
  if (!guild.members.me?.permissions?.has('ManageGuild')) {
    throw new Error(
      'I need the Manage Server permission to rename this server.',
    );
  }
  await guild.setName(name);
}
