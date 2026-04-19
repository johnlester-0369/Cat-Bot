/**
 * Copilot AI Command (NexRay)
 *
 * Chat with GitHub Copilot AI using the free NexRay API.
 * Simple text-in → text-out, no extra prompt needed.
 *
 * Usage:
 *   !copilot Hey, how are you?
 *   !copilot Write a Python function to reverse a string
 *   !copilot Tell me a fun fact about space
 */
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/utils/api.util.js';

export const config = {
  name: 'copilot',
  aliases: ['copilotai', 'cp', 'githubcopilot'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Chat with GitHub Copilot AI using the free NexRay API.',
  category: 'AI',
  usage: '<your message>',
  cooldown: 5,
  hasPrefix: true,
};

interface NexrayCopilotResponse {
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
  const url = createUrl('nexray', '/ai/copilot', { text });
  if (!url) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Failed to build the Copilot API request URL.',
    });
    return;
  }

  let data: NexrayCopilotResponse;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API responded with status ${res.status}`);
    data = (await res.json()) as NexrayCopilotResponse;
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ Failed to reach the Copilot API.\n\`${error.message ?? 'Unknown error'}\``,
    });
    return;
  }

  if (!data?.status || !data?.result) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ The Copilot API returned an invalid or empty response.',
    });
    return;
  }

  // Copilot's response is ready to send directly
  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: data.result,
  });
};