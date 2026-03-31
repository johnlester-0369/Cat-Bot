/**
 * Telegram — getFullUserInfo
 *
 * The Bot API has no standalone getUser endpoint. Resolution order:
 *   1. getChatMember for the current chat (most complete data when user is in chat)
 *   2. ctx.from when IDs match (covers the message author without an extra API call)
 *   3. Generic fallback "User {userID}"
 *
 * avatarUrl is null — getFile round-trip is deferred to avoid blocking.
 */
import type { Context } from 'telegraf';
import type { User } from 'telegraf/types';
import { PLATFORM_ID } from '../index.js';
import {
  createUnifiedUserInfo,
  type UnifiedUserInfo,
} from '@/adapters/models/user.model.js';

export async function getFullUserInfo(
  ctx: Context,
  userID: string,
): Promise<UnifiedUserInfo> {
  let u: User | null = null;

  try {
    const member = await ctx.telegram.getChatMember(
      ctx.chat?.id as number,
      Number(userID),
    );
    u = member?.user ?? null;
  } catch {
    /* user not in current chat or API error — fall through to ctx.from */
  }

  if (!u && String(ctx.from?.id) === String(userID)) {
    u = ctx.from ?? null;
  }

  if (!u) {
    return createUnifiedUserInfo({
      platform: PLATFORM_ID,
      id: userID,
      name: `User ${userID}`,
    });
  }

  return createUnifiedUserInfo({
    platform: PLATFORM_ID,
    id: String(u.id),
    name:
      `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() ||
      u.username ||
      String(u.id),
    firstName: u.first_name ?? null,
    username: u.username ?? null,
    avatarUrl: null,
  });
}
