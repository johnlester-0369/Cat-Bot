/**
 * Carbonify — Code Snapshot Maker
 *
 * Renders a beautiful code snippet image using the NexRay Codesnap API.
 * The input code can come from the command text directly or from a
 * quoted/replied-to message.
 *
 * Usage:
 *   !carbon console.log("hello, world!");
 *   [reply to code message] !carbon
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/utils/api.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'carbonify',
  aliases: ['carbon', 'codesnap'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Generate a beautiful code snapshot image from your code. Type or reply to code.',
  category: 'Maker',
  usage: '<code | reply to code message>',
  cooldown: 5,
  hasPrefix: true,
};

// ── Command Entry Point ───────────────────────────────────────────────────────

export const onCommand = async ({ args, event, chat, usage }: AppCtx): Promise<void> => {
  const ownText = args.join(' ').trim();
  const messageReply = event['messageReply'] as Record<string, unknown> | undefined;
  const quotedText = (messageReply?.['message'] as string | undefined)?.trim() ?? '';
  const code = ownText || quotedText;

  if (!code) return usage();

  try {
    const imageUrl = createUrl('nexray', '/maker/codesnap', { code });
    if (!imageUrl) throw new Error('Failed to build API URL.');

    const { data: imageData } = await axios.get<ArrayBuffer>(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
    });
    const imageBuffer = Buffer.from(imageData);

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '💻 **Code Snapshot**',
      attachment: [{ name: 'carbon.png', stream: imageBuffer }],
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ **Failed to generate snapshot.**\n\`${error.message ?? 'Unknown error'}\``,
    });
  }
};
