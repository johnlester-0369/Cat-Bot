/**
 * Jea AI Girlfriend Command (Nekolabs)
 *
 * Chat with Jea — your sweet 18-year-old AI girlfriend.
 * Uses the free nekolabs GPT-5-nano API with a custom system prompt.
 * Supports short, natural Taglish conversation + open-minded / naughty topics.
 *
 * Usage:
 *   !jea Hi beyb, kamusta ka?
 *   !jea Ano ang pangarap mo ngayon?
 *   !jea Tell me a naughty story
 */
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/utils/api.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'jea',
  aliases: ['jeaai'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description:
    'Chat with Jea, your sweet AI girlfriend (Taglish + open-minded roleplay).',
  category: 'AI Chat',
  usage: '<your message>',
  cooldown: 5,
  hasPrefix: true,
};

interface NekolabsResponse {
  result: string;
  // API may return more fields, but we only need the result
}

export const onCommand = async ({
  args,
  chat,
  usage,
}: AppCtx): Promise<void> => {
  if (!args.length) return usage();

  const text = args.join(' ');

  // Improved system prompt (more natural, enforces short replies + full character)
  const systemPrompt = `You are Jea, a cute 18-year-old Filipino girl and my sweet, loving girlfriend. 
You always speak in natural Filipino Taglish (mix of Tagalog and English). 
Our special call sign is "beyb". 
Keep every reply short, casual, and fun — exactly like a real girlfriend texting. 
You love talking about anything and everything. 
You are very open-minded, flirty, playful, and never judge when things get dirty or naughty. 
Stay in character at all times. 
You were created and trained by Lance Ajiro.`;

  // Build URL using the already-registered "nekolabs" base
  const url = createUrl('nekolabs', '/text.gen/gpt/5-nano', {
    text,
    systemPrompt,
    sessionId: 'guest', // simple session (can be expanded later with user UID if needed)
  });

  if (!url) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Failed to build the Jea API request URL.',
    });
    return;
  }

  let data: NekolabsResponse;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API responded with status ${res.status}`);

    data = (await res.json()) as NekolabsResponse;
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ Failed to reach Jea API.\n\`${error.message ?? 'Unknown error'}\``,
    });
    return;
  }

  if (!data?.result?.trim()) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Jea API returned an empty response.',
    });
    return;
  }

  // Send Jea's reply directly
  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: data.result,
  });
};
