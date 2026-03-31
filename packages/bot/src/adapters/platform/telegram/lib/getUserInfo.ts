/**
 * Telegram — getUserInfo
 *
 * The Bot API has no batch getUserInfo endpoint. For the sender (ctx.from),
 * we resolve the full name from the current context object at zero cost.
 * For all other IDs we fall back to a generic "User {id}" label because
 * getChatMember requires the user to be in the current chat and is expensive
 * to call per-user in bulk; this trade-off is acceptable since getUserInfo
 * is called primarily for the sender.
 */
import type { Context } from 'telegraf';
import type { UserInfo } from '@/adapters/models/api.model.js';

export async function getUserInfo(
  ctx: Context,
  userIds: string[],
): Promise<Record<string, UserInfo>> {
  const result: Record<string, UserInfo> = {};

  for (const id of userIds) {
    if (String(ctx.from?.id) === id && ctx.from) {
      const f = ctx.from;
      result[id] = {
        name:
          `${f.first_name || ''} ${f.last_name || ''}`.trim() ||
          f.username ||
          id,
      };
    } else {
      result[id] = { name: `User ${id}` };
    }
  }

  return result;
}
