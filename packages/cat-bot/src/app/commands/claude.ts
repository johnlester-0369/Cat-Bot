/**
 * Claude AI Command (NexRay)
 *
 * Chat with Claude AI using the free NexRay API.
 * Simple text-in → text-out, no extra prompt needed.
 *
 * Usage:
 *   !claude Hi, who are you?
 *   !claude Tell me a joke
 *   !claude Explain quantum computing simply
 */
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/utils/api.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'claude',
  aliases: ['claudeai', 'cl', 'claud'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Chat with Claude AI using the free NexRay API.',
  category: 'AI Chat',
  usage: '<your message>',
  cooldown: 5,
  hasPrefix: true,
};

interface NexrayClaudeResponse {
  status: boolean;
  author: string;
  result: string;
  timestamp?: string;
  response_time?: string;
}

export const onCommand = async ({
  args,
  chat,
  usage,
}: AppCtx): Promise<void> => {
  if (!args.length) return usage();

  const text = args.join(' ');

  // Build the fully-resolved URL using the central api.util registry
  // (nexray baseURL = https://api.nexray.web.id is already registered)
  const url = createUrl('nexray', '/ai/claude', { text });
  if (!url) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Failed to build the Claude API request URL.',
    });
    return;
  }

  let data: NexrayClaudeResponse;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API responded with status ${res.status}`);
    data = (await res.json()) as NexrayClaudeResponse;
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ Failed to reach the Claude API.\n\`${error.message ?? 'Unknown error'}\``,
    });
    return;
  }

  if (!data?.status || !data?.result) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ The Claude API returned an invalid or empty response.',
    });
    return;
  }

  // Claude's response is already clean and ready to send
  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: data.result,
  });
};
