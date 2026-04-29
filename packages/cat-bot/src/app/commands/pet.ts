/**
 * /pet — Pet a Photo or User's Avatar (GIF)
 *
 * Image source priority:
 *  1. Photo attachment in the replied message        ← required for FB Page non-admin
 *  2. @mention avatar                                ← optional
 *  3. Replied-to user's avatar                       ← optional
 *  4. Sender's own avatar (self)                     ← optional
 *
 * The image is passed to the PopCat /v2/pet endpoint and returned as an
 * animated GIF Buffer attachment.
 *
 * ⚠️  `createUrl` registry name 'popcat' is assumed.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/utils/api.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Command Config ────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'pet',
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: "Pat pat a photo or a user's avatar.",
  category: 'fun',
  usage: [
    '(reply to uploaded photo)  ← FB Page non-admin: upload a photo then reply to it with this command',
    '<self>                      ← uses your own avatar',
    '@mention                    ← uses the mentioned user\'s avatar',
    '(reply to user\'s message)  ← uses the replied user\'s avatar',
  ],
  cooldown: 5,
  hasPrefix: true,
};

// ── Non-Page-Admin Usage Guide ──────────────────────────────────────────────
// Exclusive to Facebook Page non-admin users.
// Page admins and other platform users do not need to follow these steps.

export const nonAdminGuide = (prefix: string): string => [
  `🐾 **How to use /${config.name} (FB Page non-admin only):**`,
  '1️⃣  Send a photo in the conversation (tap the photo/camera icon).',
  `2️⃣  Reply to that photo with the command: \`${prefix}${config.name}\``,
  '3️⃣  The bot will apply the effect to your uploaded photo and reply with the result.',
  '',
  '⚠️ You must reply directly to the photo message — typing the command',
  '   in a new message without replying to a photo will not work.',
].join('\n');

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async ({
  chat,
  user,
  event,
  prefix = '',
}: AppCtx): Promise<void> => {
  const senderID = event['senderID'] as string;
  const mentions = event['mentions'] as Record<string, string> | undefined;
  const mentionIDs = Object.keys(mentions ?? {});
  const messageReply = event['messageReply'] as
    | Record<string, unknown>
    | null
    | undefined;
  const repliedSenderID = messageReply?.['senderID'] as string | undefined;

  // ── Image source resolution ────────────────────────────────────────────────
  // Priority 1: photo attachment in the replied message (FB Page non-admin)
  const repliedAttachments = messageReply?.['attachments'] as
    | Array<{ type?: string; url?: string; previewUrl?: string }>
    | undefined;
  const attachedImageUrl = repliedAttachments?.find(
    (a) => a.type === 'photo' || a.type === 'image',
  )?.url;

  try {
    let imageUrl: string;

    if (attachedImageUrl) {
      imageUrl = attachedImageUrl;
    } else {
      const targetID = mentionIDs[0] ?? repliedSenderID ?? senderID;
      const avatar = await user.getAvatarUrl(targetID);
      if (!avatar) { await chat.replyMessage({ style: MessageStyle.MARKDOWN, message: nonAdminGuide(prefix) }); return; }
      imageUrl = avatar;
    }

    const base = createUrl('popcat', '/v2/pet');
    if (!base) throw new Error('Failed to build Pet API URL.');

    const res = await fetch(`${base}?image=${encodeURIComponent(imageUrl)}`);
    if (!res.ok) throw new Error(`API responded with status ${res.status}`);

    const imageBuffer = Buffer.from(await res.arrayBuffer());

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '🐾 **Pat pat!**',
      attachment: [{ name: 'pet.gif', stream: imageBuffer }],
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ **Error:** ${error.message ?? 'Unknown error'}`,
    });
  }
};
