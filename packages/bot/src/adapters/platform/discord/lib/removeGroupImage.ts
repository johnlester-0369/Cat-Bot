/**
 * Removes a Discord guild's icon by passing null to guild.setIcon.
 */
import type { Guild } from 'discord.js';

export async function removeGroupImage(guild: Guild | null): Promise<void> {
  if (!guild) throw new Error('Not in a server.');
  await guild.setIcon(null);
}
