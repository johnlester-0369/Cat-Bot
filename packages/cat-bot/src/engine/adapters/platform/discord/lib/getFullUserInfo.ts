/**
 * Returns a UnifiedUserInfo for a Discord user ID.
 * Resolution order:
 *   1. client.users.fetch() — REST, most complete data
 *   2. selfUser — interaction path shortcut when querying the command sender
 *   3. guild.members.fetch().user — server-scoped fallback
 *   4. Stub with id only — ensures callers always receive a valid object
 */
import type { Client, Guild, User } from 'discord.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
// @/ alias resolves via tsc-alias at build / tsx at dev time — replaces ../../../../models/
import { createUnifiedUserInfo } from '@/engine/adapters/models/user.model.js';
import type { UnifiedUserInfo } from '@/engine/adapters/models/user.model.js';

export async function getFullUserInfo(
  client: Client | null,
  guild: Guild | null,
  userID: string,
  selfUser: User | null = null,
): Promise<UnifiedUserInfo> {
  let user: User | null = null;

  try {
    user = client ? await client.users.fetch(userID) : null;
  } catch {
    /* try next source */
  }
  if (!user && selfUser?.id === userID) user = selfUser;
  if (!user) {
    try {
      user = guild
        ? await guild.members.fetch(userID).then((m) => m.user)
        : null;
    } catch {
      /* try stub */
    }
  }

  if (!user) {
    return createUnifiedUserInfo({
      platform: Platforms.Discord,
      id: userID,
      name: `User ${userID}`,
    });
  }

  return createUnifiedUserInfo({
    platform: Platforms.Discord,
    id: user.id,
    name: user.globalName ?? user.displayName ?? user.username,
    firstName: null,
    username: user.username,
    avatarUrl: user.displayAvatarURL?.() ?? null,
  });
}
