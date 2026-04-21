/**
 * Pollinations AI Image Generator
 * Generates images from a text prompt using Pollinations AI.
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'pollinations',
  aliases: ['imagine', 'imggen', 'generate'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Generate an image using Pollinations AI.',
  category: 'AI Generate',
  usage: '<prompt>',
  cooldown: 10,
  hasPrefix: true,
};

export const onCommand = async ({
  args,
  prefix,
  usage,
  chat,
}: AppCtx): Promise<void> => {
  if (!args.length) {
    await usage();
    return;
  }

  const prompt = args.join(' ');

  const loadingId = await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: '🎨 **Generating image...**',
  });

  const seed = Math.floor(Math.random() * 999999);
  const imageUrl =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
    `?width=512&height=512&nologo=true&seed=${seed}`;

  let buffer: Buffer;
  try {
    const { data } = await axios.get<ArrayBuffer>(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxRedirects: 5,
    });
    buffer = Buffer.from(data);
  } catch {
    // One retry on failure (same URL/seed)
    try {
      const { data } = await axios.get<ArrayBuffer>(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxRedirects: 5,
      });
      buffer = Buffer.from(data);
    } catch (e2) {
      const err = e2 as { message?: string };
      if (loadingId) {
        await chat.editMessage({
          style: MessageStyle.MARKDOWN,
          message_id_to_edit: loadingId as string,
          message: `❌ **Failed to generate image**\n\`${err.message ?? 'Unknown error'}\``,
        });
      }
      return;
    }
  }

  try {
    if (loadingId) {
      await chat.unsendMessage(loadingId as string).catch(() => {});
    }

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `✨ **${prompt}**`,
      attachment: [{ name: 'image.jpg', stream: buffer }],
    });
  } catch (e) {
    const err = e as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ **Failed to send image**\n\`${err.message ?? 'Unknown error'}\``,
    });
  }
};
