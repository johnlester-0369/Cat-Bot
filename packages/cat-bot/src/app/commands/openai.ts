/**
 * AI Chat Command (Deline OpenAI)
 *
 * Simple AI assistant command that uses the free Deline OpenAI API
 * via the centralised api.util registry (no hardcoded URLs).
 *
 * Example usage:
 *   !ai Hello, who are you?
 *   !gpt Tell me a joke
 */
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/utils/api.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'openai',
  aliases: ['openai', 'chatgpt'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description:
    'Chat with a helpful AI assistant using the free Deline OpenAI API.',
  category: 'AI',
  usage: '<your message>',
  cooldown: 5,
  hasPrefix: true,
};

interface DelineAIResponse {
  status: boolean;
  creator: string;
  result: string;
}

export const onCommand = async ({
  args,
  chat,
  usage,
}: AppCtx): Promise<void> => {
  if (!args.length) return usage();

  const text = args.join(' ');

  // Fixed system prompt matching the example you provided
  const prompt = 'You are my assistant';

  // Build the fully-resolved URL using the central api.util registry
  // (deline baseURL is already registered, no hardcoding needed)
  const url = createUrl('deline', '/ai/openai', { text, prompt });
  if (!url) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Failed to build the API request URL.',
    });
    return;
  }

  let data: DelineAIResponse;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API responded with status ${res.status}`);
    data = (await res.json()) as DelineAIResponse;
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ Failed to reach the AI API.\n\`${error.message ?? 'Unknown error'}\``,
    });
    return;
  }

  if (!data?.status || !data?.result) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ The AI API returned an invalid or empty response.',
    });
    return;
  }

  // The AI response is already formatted nicely with newlines and lists
  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: data.result,
  });
};
