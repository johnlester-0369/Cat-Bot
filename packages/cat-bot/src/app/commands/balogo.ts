/**
 * Blue Archive Logo Maker
 *
 * Generates a Blue Archive-style logo image from two text parts using the
 * NekoLabs canvas API. The input is split on `|` — text to the left becomes
 * the white portion of the logo and text to the right becomes the cyan portion.
 * If no `|` separator is supplied, the entire input is used as the left side.
 *
 * Usage:
 *   !balogo evang|elion
 *   !balogo Cat|Bot
 *   !bluearchivelogo just left text
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/utils/api.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'bluearchivelogo',
  aliases: ['balogo', 'balgo'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Generate a Blue Archive-style logo. Split text with | for left (white) and right (cyan) portions.',
  category: 'Maker',
  usage: '<left text>|<right text>',
  cooldown: 5,
  hasPrefix: true,
};

// ── Command Entry Point ───────────────────────────────────────────────────────

export const onCommand = async ({ args, chat, usage }: AppCtx): Promise<void> => {
  const input = args.join(' ').trim();

  if (!input) return usage();

  const pipeIndex = input.indexOf('|');
  const textL = pipeIndex !== -1 ? input.slice(0, pipeIndex).trim() || ' ' : input;
  const textR = pipeIndex !== -1 ? input.slice(pipeIndex + 1).trim() || ' ' : ' ';

  try {
    const imageUrl = createUrl('nekolabs', '/canvas/ba-logo', { textL, textR });
    if (!imageUrl) throw new Error('Failed to build API URL.');

    const { data: imageData } = await axios.get<ArrayBuffer>(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
    });
    const imageBuffer = Buffer.from(imageData);

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `🎮 **Blue Archive Logo**\n**${textL}**${textR !== ' ' ? `|**${textR}**` : ''}`,
      attachment: [{ name: 'balogo.png', stream: imageBuffer }],
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ **Failed to generate logo.**\n\`${error.message ?? 'Unknown error'}\``,
    });
  }
};
