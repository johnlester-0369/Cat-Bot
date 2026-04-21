/**
 * Perplexity AI Command (NexRay)
 *
 * Chat with Perplexity AI (real-time web search + reasoning).
 * Simple text-in → text-out using the free NexRay API.
 *
 * Usage:
 *   !perplexity Apa itu Evangelion?
 *   !perplexity Latest news about AI
 *   !perplexity Explain quantum computing simply
 */
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/utils/api.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'perplexity',
  aliases: ['perplex', 'pplx', 'searchai'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description:
    'Chat with Perplexity AI using the free NexRay API (real-time search + reasoning).',
  category: 'AI Chat',
  usage: '<your message>',
  cooldown: 5,
  hasPrefix: true,
};

interface PerplexityResponse {
  status: boolean;
  result: string;
  author?: string;
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
  const url = createUrl('nexray', '/ai/perplexity', { text });
  if (!url) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Failed to build the Perplexity API request URL.',
    });
    return;
  }

  let data: PerplexityResponse;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API responded with status ${res.status}`);

    data = (await res.json()) as PerplexityResponse;
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ Failed to reach the Perplexity API.\n\`${error.message ?? 'Unknown error'}\``,
    });
    return;
  }

  if (!data?.status || !data?.result?.trim()) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ The Perplexity API returned an invalid or empty response.',
    });
    return;
  }

  // Perplexity's response is ready to send directly
  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: data.result,
  });
};
