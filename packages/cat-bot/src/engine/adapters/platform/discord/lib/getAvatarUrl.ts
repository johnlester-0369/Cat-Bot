/**
 * Discord — Avatar URL Resolution (discord.js v14)
 *
 * Retrieves a user's avatar URL using the discord.js v14 GuildMember / User API.
 *
 * Resolution order (cache-first to avoid unnecessary REST budget):
 *   1. GuildMember cache — captures server-specific avatar overrides (Discord supports
 *      per-server custom avatars distinct from the global account avatar).
 *   2. guild.members.fetch() — REST fallback when member is not yet cached.
 *   3. client.users.cache — global User object (no guild context); covers DM interactions.
 *   4. client.users.fetch() — REST fallback for the global User object.
 *
 * displayAvatarURL() is the discord.js v14 method that returns the default avatar
 * (a coloured Discord logo) when the user has no custom avatar, so this function
 * never returns null when a client/guild reference is available.
 *
 * Reference: https://discord.js.org/docs/packages/discord.js/14.26.2/User:Class#displayAvatarURL
 */

import type { Client, Guild } from 'discord.js';

/**
 * Resolves the best available avatar URL for a Discord user.
 *
 * @param client - discord.js Client used for REST fallback (client.users.fetch); null in guild-only contexts
 * @param guild  - Current guild for cache-first member lookup; null in DM or non-guild contexts
 * @param userID - Discord snowflake user ID (as string)
 * @returns Avatar URL string, or null if resolution fails entirely
 */
export async function getAvatarUrl(
  client: Client | null,
  guild: Guild | null,
  userID: string,
): Promise<string | null> {
  // Guild-member lookup first to capture server-specific avatar overrides
  if (guild) {
    const cached = guild.members.cache.get(userID);
    if (cached) {
      // displayAvatarURL() returns the default avatar when no custom one is set
      return cached.displayAvatarURL({ size: 256 }) ?? null;
    }
    try {
      const member = await guild.members.fetch(userID);
      return member.displayAvatarURL({ size: 256 }) ?? null;
    } catch {
      // Member not in this guild (e.g. DM context) — fall through to global user lookup
    }
  }

  if (client) {
    // Global user cache — no guild-specific avatar, but always available for cached users
    const cachedUser = client.users.cache.get(userID);
    if (cachedUser) return cachedUser.displayAvatarURL({ size: 256 }) ?? null;
    try {
      const user = await client.users.fetch(userID);
      return user.displayAvatarURL({ size: 256 }) ?? null;
    } catch {
      return null;
    }
  }

  return null;
}