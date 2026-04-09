/**
 * Telegram — sendMessage
 *
 * Sends to the explicit threadID when provided — this is the correct path
 * for cross-chat delivery (e.g. forwarding a user message to an admin DM).
 * Falls back to ctx.chat?.id for the common case where the reply target is
 * the same chat that triggered the update.
 */
import type { Context } from 'telegraf';
import type { SendPayload } from '@/engine/adapters/models/api.model.js';

export async function sendMessage(
  ctx: Context,
  msg: string | SendPayload,
  threadID: string,
): Promise<string> {
  const text = typeof msg === 'string' ? msg : (msg.body ?? msg.message ?? '');
  // Prefer the explicit numeric threadID so the bot can message a different chat
  // (e.g. admin DM, support group) without being bound to the triggering ctx.chat.
  const targetChatId = Number(threadID) || (ctx.chat?.id as number);
  const sent = await ctx.telegram.sendMessage(targetChatId, text);
  return String(sent.message_id);
}
