/**
 * Copilot AI Command (NexRay + Deline Fallback)
 *
 * Chat with GitHub Copilot AI using the free NexRay API as primary,
 * with Deline API as fallback.
 * Both APIs are resolved via the central createUrl registry.
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
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'copilot',
  aliases: ['copilotai', 'cp', 'githubcopilot'] as string[],
  version: '1.0.2',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description:
    'Chat with GitHub Copilot AI using the free NexRay API (with Deline fallback).',
  category: 'AI Chat',
  usage: '<your message>',
  cooldown: 5,
  hasPrefix: true,
};

interface CopilotResponse {
  status: boolean;
  result: string;
  author?: string;
  creator?: string;
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

  // Primary: NexRay API (via registered createUrl)
  const primaryUrl = createUrl('nexray', '/ai/copilot', { text });
  if (!primaryUrl) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        '❌ Failed to build the primary (NexRay) Copilot API request URL.',
    });
    return;
  }

  let data: CopilotResponse | null = null;
  let errorLog = '';

  // === Try Primary (NexRay) ===
  try {
    const res = await fetch(primaryUrl);
    if (!res.ok)
      throw new Error(`Primary API responded with status ${res.status}`);

    const primaryData = (await res.json()) as CopilotResponse;
    if (primaryData?.status === true && primaryData?.result?.trim()) {
      data = primaryData;
    } else {
      throw new Error('Primary API returned invalid or empty response');
    }
  } catch (err) {
    const error = err as { message?: string };
    errorLog = `Primary (NexRay): ${error.message ?? 'Unknown error'}`;
  }

  // === Fallback: Deline API (if primary failed) ===
  if (!data) {
    // Deline is already registered in the source code system (baseURL = https://api.deline.web.id)
    const fallbackUrl = createUrl('deline', '/ai/copilot', { text });
    if (!fallbackUrl) {
      errorLog += `\nFallback (Deline): Failed to build request URL`;
    } else {
      try {
        const res = await fetch(fallbackUrl);
        if (!res.ok)
          throw new Error(`Fallback API responded with status ${res.status}`);

        const fallbackData = (await res.json()) as CopilotResponse;
        if (fallbackData?.status === true && fallbackData?.result?.trim()) {
          data = fallbackData;
        } else {
          throw new Error('Fallback API returned invalid or empty response');
        }
      } catch (err) {
        const error = err as { message?: string };
        errorLog += `\nFallback (Deline): ${error.message ?? 'Unknown error'}`;
      }
    }
  }

  // === Final result ===
  if (!data) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ Failed to reach any Copilot API.\n\`${errorLog}\``,
    });
    return;
  }

  // Both APIs return the answer in the "result" field
  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: data.result,
  });
};
