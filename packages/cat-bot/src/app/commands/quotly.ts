/**
 * Quotly Chat Maker
 *
 * Generates a Telegram-style quoted chat card image from text using the
 * NekoLabs quote-chat canvas API. Includes the sender's display name and
 * profile picture.
 *
 * Source resolution:
 *   - Own text (args):     uses the command sender's name and avatar.
 *   - Quoted text (reply): uses the replied-to message sender's name and avatar.
 *
 * Sticker note:
 *   The original WhatsApp bot used wa-sticker-formatter, which is not a
 *   Cat-Bot dependency. The result is sent as a regular image attachment instead.
 *
 * Usage:
 *   !qc get in the fucking robot, shinji!
 *   [reply to message] !qc
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/utils/api.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_LENGTH = 1000;
const FALLBACK_AVATAR =
  'https://i.pinimg.com/736x/70/dd/61/70dd612c65034b88ebf474a52ccc70c4.jpg';

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'quotlychat',
  aliases: ['qc', 'quotly'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: `Generate a Telegram-style quote card image from text (max ${MAX_LENGTH} chars). Type or reply to a message.`,
  category: 'Maker',
  usage: '<text | reply to message>',
  cooldown: 5,
  hasPrefix: true,
};

// ── Command Entry Point ───────────────────────────────────────────────────────

export const onCommand = async ({ args, event, chat, user, usage }: AppCtx): Promise<void> => {
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

  // Attribute the card to the quoted sender when no own text was typed
  const isQuotedSource = !ownText && !!quotedText;
  const targetSenderID = isQuotedSource
    ? ((messageReply?.['senderID'] as string | undefined) ?? (event['senderID'] as string | undefined))
    : (event['senderID'] as string | undefined);

  const [displayName, avatarUrl] = await Promise.all([
    targetSenderID ? user.getName(targetSenderID).catch(() => 'Unknown') : Promise.resolve('Unknown'),
    targetSenderID ? user.getAvatarUrl(targetSenderID).catch(() => null) : Promise.resolve(null),
  ]);

  try {
    const imageUrl = createUrl('nekolabs', '/canvas/quote-chat', {
      text,
      name: displayName || 'Unknown',
      profile: avatarUrl ?? FALLBACK_AVATAR,
    });
    if (!imageUrl) throw new Error('Failed to build API URL.');

    const { data: imageData } = await axios.get<ArrayBuffer>(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
    });
    const imageBuffer = Buffer.from(imageData);

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `💬 **Quote Card** — ${displayName || 'Unknown'}`,
      attachment: [{ name: 'quotly.png', stream: imageBuffer }],
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ **Failed to generate quote card.**\n\`${error.message ?? 'Unknown error'}\``,
    });
  }
};
