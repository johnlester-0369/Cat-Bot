/**
 * Sticker Meme Maker
 *
 * Overlays top and bottom meme-style captions onto an image using the
 * NexRay Smeme API. The source image can be attached directly with the
 * command or come from a quoted/replied-to message.
 *
 * Text format:
 *   Split on `|` — left side = top text, right side = bottom text.
 *   Without `|` the entire input becomes the bottom caption only.
 *
 * Sticker note:
 *   The original WhatsApp bot used wa-sticker-formatter, which is not a
 *   Cat-Bot dependency. The result is sent as a regular image attachment.
 *
 * Usage:
 *   [send image] !smeme top text|bottom text
 *   [reply to image] !smeme just bottom text
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { AttachmentType } from '@/engine/adapters/models/enums/attachment-type.enum.js';
import { createUrl } from '@/engine/utils/api.util.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface NormalizedAttachment {
  type: string;
  url?: string | null;
  [key: string]: unknown;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveImageUrl(event: Record<string, unknown>): string | null {
  const ownAtts = (event['attachments'] as NormalizedAttachment[] | undefined) ?? [];
  const fromOwn = ownAtts.find(
    (a) => a.type === AttachmentType.PHOTO && typeof a.url === 'string' && a.url,
  );
  if (fromOwn?.url) return fromOwn.url as string;

  const replyAtts =
    ((event['messageReply'] as Record<string, unknown> | undefined)?.[
      'attachments'
    ] as NormalizedAttachment[] | undefined) ?? [];
  const fromReply = replyAtts.find(
    (a) => a.type === AttachmentType.PHOTO && typeof a.url === 'string' && a.url,
  );
  if (fromReply?.url) return fromReply.url as string;

  return null;
}

// ── Config ────────────────────────────────────────────────────────────────────

export const config = {
  name: 'stickermeme',
  aliases: ['smeme', 'stikermeme'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Add meme captions to an image. Send or reply to an image with the caption text.',
  category: 'Maker',
  usage: ['<bottom text>  (send/reply image)', '<top text>|<bottom text>  (send/reply image)'] as string[],
  cooldown: 5,
  hasPrefix: true,
};

// ── Command Entry Point ───────────────────────────────────────────────────────

export const onCommand = async ({ args, event, chat, usage }: AppCtx): Promise<void> => {
  const input = args.join(' ').trim();

  if (!input) return usage();

  const imageUrl = resolveImageUrl(event);

  if (!imageUrl) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '📎 **No image found.** Send an image with this command as the caption, or reply to an image message.',
    });
    return;
  }

  const pipeIndex = input.indexOf('|');
  let topText: string;
  let bottomText: string;

  if (pipeIndex !== -1) {
    topText = input.slice(0, pipeIndex).trim() || ' ';
    bottomText = input.slice(pipeIndex + 1).trim() || ' ';
  } else {
    topText = ' ';
    bottomText = input;
  }

  try {
    const resultUrl = createUrl('nexray', '/maker/smeme', {
      text_atas: topText,
      text_bawah: bottomText,
      background: imageUrl,
    });
    if (!resultUrl) throw new Error('Failed to build API URL.');

    const { data: imageData } = await axios.get<ArrayBuffer>(resultUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
    });
    const imageBuffer = Buffer.from(imageData);

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '😂 **Sticker Meme**',
      attachment: [{ name: 'smeme.png', stream: imageBuffer }],
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ **Failed to generate meme.**\n\`${error.message ?? 'Unknown error'}\``,
    });
  }
};