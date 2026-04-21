/**
 * Emoji Mix Maker
 *
 * Combines two emojis into a single blended image using the Deline EmojiMix
 * API (Google's Emoji Kitchen). The result is sent as a PNG attachment.
 *
 * Sticker note:
 *   The original WhatsApp bot used wa-sticker-formatter, which is not a
 *   Cat-Bot dependency. The result is sent as a regular image attachment.
 *
 * Usage:
 *   !emojimix 😱 🤓
 *   !emix 🔥 ❄️
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/utils/api.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface EmojiMixResponse {
  result: {
    png: string;
  };
}

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'emojimix',
  aliases: ['emix'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Combine two emojis into a blended image using Google Emoji Kitchen.',
  category: 'Maker',
  usage: '<emoji1> <emoji2>',
  cooldown: 5,
  hasPrefix: true,
};

// ── Command Entry Point ───────────────────────────────────────────────────────

export const onCommand = async ({ args, chat, usage }: AppCtx): Promise<void> => {
  const input = args.join(' ');
  const [emoji1, emoji2] = Array.from(input.matchAll(/\p{Emoji}/gu), (m) => m[0]);

  if (!emoji1 || !emoji2) return usage();

  try {
    const apiUrl = createUrl('deline', '/maker/emojimix', { emoji1, emoji2 });
    if (!apiUrl) throw new Error('Failed to build API URL.');

    const { data } = await axios.get<EmojiMixResponse>(apiUrl, { timeout: 30000 });
    const pngUrl = data?.result?.png;
    if (!pngUrl) throw new Error('No image returned. This emoji combination may not be supported.');

    const { data: imgData } = await axios.get<ArrayBuffer>(pngUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
    });
    const imgBuffer = Buffer.from(imgData);

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `${emoji1} + ${emoji2} **Emoji Mix**`,
      attachment: [{ name: 'emojimix.png', stream: imgBuffer }],
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ **Failed to mix emojis.**\n\`${error.message ?? 'Unknown error'}\``,
    });
  }
};
