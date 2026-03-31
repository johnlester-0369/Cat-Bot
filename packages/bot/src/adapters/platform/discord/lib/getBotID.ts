/**
 * Returns the Discord bot's own user ID.
 * The interaction path always has a live client with user.id.
 * The channel path may have client=null when constructed in early tests,
 * so we fall back to guild.members.me as a secondary source.
 */
import type { Client, Guild } from 'discord.js';

export async function getBotID(
  client: Client | null,
  guild: Guild | null = null,
): Promise<string> {
  if (client?.user?.id) return client.user.id;
  if (guild?.members?.me?.user?.id) return guild.members.me.user.id;
  throw new Error(
    'Cannot determine bot ID for Discord channel API — client reference missing',
  );
}
