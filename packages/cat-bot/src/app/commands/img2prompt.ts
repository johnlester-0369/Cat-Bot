/**
 * Image to Prompt — Reverse Image Prompt Generator
 *
 * Analyses an image attachment (from the current message or a quoted/replied-to
 * message) and generates a descriptive AI art prompt for it using the Deline API.
 *
 * Supported input:
 *   - Send an image directly with the command as the caption
 *   - Reply to a message that contains an image, then send the command
 *
 * Usage:
 *   [send image] !image2prompt
 *   [reply to image] !image2prompt
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { AttachmentType } from '@/engine/adapters/models/enums/attachment-type.enum.js';
import { createUrl } from '@/engine/utils/api.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface NormalizedAttachment {
  type: string;
  url?: string | null;
  [key: string]: unknown;
}

interface TopPromptResponse {
  result: {
    original: string;
  };
}

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'image2prompt',
  aliases: [
    'imagetoprompt',
    'img2prompt',
    'imgtoprompt',
    'toprompt',
  ] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description:
    'Analyse an image and generate a descriptive AI art prompt for it. ' +
    'Send or reply to an image message.',
  category: 'AI Generate',
  usage: '[send or reply to an image]',
  cooldown: 10,
  hasPrefix: true,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Finds the first PHOTO-type attachment URL from the current message
 * or, if absent, from the quoted/replied-to message.
 *
 * Cat-Bot normalises every platform's native attachment format to the shared
 * AttachmentType schema before the event reaches command handlers. The `url`
 * field on a PHOTO attachment always holds the full-resolution image URL.
 */
function resolveImageUrl(event: Record<string, unknown>): string | null {
  // 1. Attachments on the sender's own message
  const ownAttachments =
    (event['attachments'] as NormalizedAttachment[] | undefined) ?? [];

  const fromOwn = ownAttachments.find(
    (a) =>
      a.type === AttachmentType.PHOTO && typeof a.url === 'string' && a.url,
  );
  if (fromOwn?.url) return fromOwn.url as string;

  // 2. Attachments on the quoted / replied-to message
  const messageReply = event['messageReply'] as
    | Record<string, unknown>
    | undefined;
  const replyAttachments =
    (messageReply?.['attachments'] as NormalizedAttachment[] | undefined) ?? [];

  const fromReply = replyAttachments.find(
    (a) =>
      a.type === AttachmentType.PHOTO && typeof a.url === 'string' && a.url,
  );
  if (fromReply?.url) return fromReply.url as string;

  return null;
}

// ── Command Entry Point ───────────────────────────────────────────────────────

export const onCommand = async ({
  args: _args,
  event,
  chat,
  usage,
}: AppCtx): Promise<void> => {
  // Resolve image URL from own message or quoted message
  const imageUrl = resolveImageUrl(event);

  if (!imageUrl) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        '📎 **No image found.**\n\n' +
        'Please **send an image** with this command as the caption, ' +
        'or **reply to an image message** and then use the command.',
    });
    void usage(); // Also show usage hint
    return;
  }

  const loadingId = (await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: '🔍 **Analysing image...**\nConverting to a prompt, please wait.',
  })) as string | undefined;

  try {
    const apiUrl = createUrl('deline', '/ai/toprompt', { url: imageUrl });
    if (!apiUrl) throw new Error('Failed to build API URL.');

    const { data } = await axios.get<TopPromptResponse>(apiUrl, {
      timeout: 60000,
    });
    const prompt = data?.result?.original;
    if (!prompt) throw new Error('No prompt returned from API.');

    if (loadingId) {
      await chat.unsendMessage(loadingId).catch(() => {});
    }

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `🖼️ **Image → Prompt Result**\n\n` + `${prompt}`,
    });
  } catch (err) {
    const error = err as { message?: string };

    if (loadingId) {
      await chat.unsendMessage(loadingId).catch(() => {});
    }

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ **Failed to analyse image.**\n\`${error.message ?? 'Unknown error'}\``,
    });
  }
};
