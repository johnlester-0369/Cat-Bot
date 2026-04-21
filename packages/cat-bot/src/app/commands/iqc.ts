/**
 * iPhone Quoted Chat Maker
 *
 * Generates a realistic iPhone iMessage-style chat bubble image from text
 * using the Deline IQC API. The chat time is randomised within the last hour
 * and the status bar clock matches the current local time.
 *
 * Timezone:
 *   Reads from the TZ environment variable; defaults to 'Asia/Jakarta' when
 *   unset. moment-timezone is a first-party Cat-Bot dependency.
 *
 * Usage:
 *   !iqc get in the fucking robot, shinji!
 *   [reply to message] !iqc
 */

import moment from 'moment-timezone';
import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/utils/api.util.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_LENGTH = 1000;
const TIMEZONE = process.env['TZ'] ?? 'Asia/Jakarta';

// ── Config ────────────────────────────────────────────────────────────────────

export const config = {
  name: 'iphonequotedchat',
  aliases: ['iqc'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: `Generate an iPhone iMessage-style chat bubble image from text (max ${MAX_LENGTH} chars). Type or reply to a message.`,
  category: 'Maker',
  usage: ['<text>', '[reply to message]'] as string[],
  cooldown: 5,
  hasPrefix: true,
};

// ── Command Entry Point ───────────────────────────────────────────────────────

export const onCommand = async ({ args, event, chat, usage }: AppCtx): Promise<void> => {
  const ownText = args.join(' ').trim();
  const messageReply = event['messageReply'] as Record<string, unknown> | undefined;
  const quotedText = (messageReply?.['message'] as string | undefined)?.trim() ?? '';
  const text = ownText || quotedText;

  if (!text) return usage();

  if (text.length > MAX_LENGTH) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ **Text too long.** Maximum is **${MAX_LENGTH} characters** (yours: ${text.length}).`,
    });
    return;
  }

  try {
    const now = moment.tz(TIMEZONE);
    const chatTime = now.clone().subtract(Math.floor(Math.random() * 60) + 1, 'minutes').format('HH:mm');
    const statusBarTime = now.format('HH:mm');

    const imageUrl = createUrl('deline', '/maker/iqc', { text, chatTime, statusBarTime });
    if (!imageUrl) throw new Error('Failed to build API URL.');

    const { data: imageData } = await axios.get<ArrayBuffer>(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
    });
    const imageBuffer = Buffer.from(imageData);

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '📱 **iPhone Quoted Chat**',
      attachment: [{ name: 'iqc.png', stream: imageBuffer }],
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ **Failed to generate image.**\n\`${error.message ?? 'Unknown error'}\``,
    });
  }
};