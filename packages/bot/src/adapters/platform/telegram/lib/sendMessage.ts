/**
 * Telegram — sendMessage
 *
 * Uses ctx.chat.id from the active update context rather than the passed
 * threadID because Telegraf handlers always run within the context of a
 * specific update; threadID is accepted to satisfy the UnifiedApi interface.
 */
import type { Context } from 'telegraf';
import type { SendPayload } from '@/adapters/models/api.model.js';

export async function sendMessage(
  ctx: Context,
  msg: string | SendPayload,
  _threadID: string,
): Promise<string> {
  const text = typeof msg === 'string' ? msg : (msg.body ?? msg.message ?? '');
  const sent = await ctx.telegram.sendMessage(ctx.chat?.id as number, text);
  return String(sent.message_id);
}
