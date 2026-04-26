/**
 * claude.ts — Claude AI Chat (Lexcode API)
 *
 * Chat with Claude 3 Haiku via the Lexcode API endpoint.
 * Supports direct text input and replying to a quoted message.
 *
 * Usage:
 *   !claude apa itu evangelion?
 *   (reply to any message) !claude
 *
 * Coin cost: 5 per use.
 *
 * ── Conversion gaps flagged ──────────────────────────────────────────────────
 * ❌ ctx.text || ctx.quoted?.text   → args.join(' ') for direct text;
 *                                    event['messageReply']?.['message'] for quoted.
 * ❌ richResponse: [{ text }]       → No Cat-Bot equivalent. Plain message string used.
 * ❌ tools.msg.generateInstruction  → No equivalent. usage() used.
 * ❌ tools.cmd.handleError          → No equivalent. Standard try/catch used.
 * ❌ formatter.bold()               → **Markdown** used directly.
 * ❌ permissions: { coin: 5 }       → Not a config field. Enforced via currencies manually.
 *
 * API provider:
 *   lexcode  /api/ai/claude-3-haiku
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/utils/api.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'claude',
  aliases: ['cl', 'claudeai'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Chat with Claude 3 Haiku via the Lexcode API.',
  category: 'AI Chat',
  usage: '<your message>',
  cooldown: 5,
  hasPrefix: true,
};

// ── Response shape ────────────────────────────────────────────────────────────

interface LexcodeClaudeResponse {
  result: string;
}

// ── Command ───────────────────────────────────────────────────────────────────

export const onCommand = async ({
  args,
  chat,
  event,
  currencies,
  usage,
}: AppCtx): Promise<void> => {
  // ── Resolve input ──────────────────────────────────────────────────────────
  // ctx.text → args.join(' ') for the typed message after the command name
  // ctx.quoted?.text → event['messageReply']?.['message'] for quoted messages
  const directText = args.join(' ').trim();
  const quotedText = (
    (event['messageReply'] as Record<string, unknown> | undefined)?.['message'] as
      | string
      | undefined
  )?.trim();

  const input = directText || quotedText;

  if (!input) return usage();

  // ── Coin gate (5 coins per use) ────────────────────────────────────────────
  const senderID = event['senderID'] as string;
  const balance = await currencies.getMoney(senderID);
  if (balance < 5) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ You need at least **5 coins** to use this command.\nYour balance: **${balance} coins**`,
    });
    return;
  }
  await currencies.decreaseMoney({ user_id: senderID, money: 5 });

  // ── API call ───────────────────────────────────────────────────────────────
  const url = createUrl('lexcode', '/api/ai/claude-3-haiku', { prompt: input });
  if (!url) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Failed to build the Claude API request URL.',
    });
    return;
  }

  try {
    const res = await fetch(url);
    if (!res.ok)
      throw new Error(`API responded with status ${res.status}`);

    const data = (await res.json()) as LexcodeClaudeResponse;
    if (!data?.result) throw new Error('API returned an empty response.');

    // richResponse: [{ text }] has no Cat-Bot equivalent — send as plain message
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: data.result,
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ **Claude API error.**\n\`${error.message ?? 'Unknown error'}\``,
    });
  }
};