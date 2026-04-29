/**
 * /discordmsg — Fake Discord Message Generator
 *
 * Builds a fake Discord message card. The username and avatar are resolved
 * with the same image-source priority as all other commands in this set:
 *
 * Image / identity source priority:
 *  1. Photo attachment in the replied message        ← required for FB Page non-admin
 *     (avatar URL taken from the attachment; username falls back to sender's)
 *  2. @mention user                                  ← optional
 *  3. Replied-to user                                ← optional
 *  4. Sender themselves (self)                       ← optional
 *
 * The message content comes from the args prompt. Color defaults to #ffcc99
 * and timestamp is generated at the moment the command is run.
 *
 * Usage examples:
 *   FB Page non-admin : upload photo → reply to it: !discordmsg <message>
 *   Page admin / other: !discordmsg <message> [@mention | reply | self]
 *
 * ⚠️  `createUrl` registry name 'popcat' is assumed — confirm with the
 *     Cat Bot engine team that this registry key exists.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/utils/api.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Command Config ────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'discordmsg',
  aliases: ['discordmessage'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Generate a fake Discord message card using a photo or avatar.',
  category: 'fun',
  usage: [
    '<message> (reply to uploaded photo)  ← FB Page non-admin: upload a photo then reply to it with this command',
    '<message> <self>                      ← uses your own avatar',
    '<message> @mention                    ← uses the mentioned user\'s avatar',
    '<message> (reply to user\'s message)  ← uses the replied user\'s avatar',
  ],
  cooldown: 5,
  hasPrefix: true,
};

// ── Non-Page-Admin Usage Guide ──────────────────────────────────────────────
// Exclusive to Facebook Page non-admin users.
// Page admins and other platform users do not need to follow these steps.

export const nonAdminGuide: string = [
  '💬 **How to use /discordmsg (FB Page non-admin only):**',
  '1️⃣  Send a photo in the conversation (tap the photo/camera icon).',
  '2️⃣  Reply to that photo with the command: `!discordmsg <message>`',
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
  args,
  usage,
}: AppCtx): Promise<void> => {
  const content = args.join(' ').trim();
  if (!content) return usage();

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
    let avatarUrl: string;
    let username: string | null;

    if (attachedImageUrl) {
      // Non-page-admin FB Page: use the uploaded photo as the avatar
      avatarUrl = attachedImageUrl;
      username = await user.getName(senderID);
    } else {
      // Page admin / other platforms: resolve from mention → reply → self
      const targetID = mentionIDs[0] ?? repliedSenderID ?? senderID;
      [username, avatarUrl] = await Promise.all([
        user.getName(targetID),
        user.getAvatarUrl(targetID),
      ]);
      if (!avatarUrl) throw new Error('Could not fetch user avatar.');
    }

    const base = createUrl('popcat', '/v2/discord-message');
    if (!base) throw new Error('Failed to build Discord Message API URL.');

    const timestamp = new Date().toISOString();
    const color = '#ffcc99';

    const params = new URLSearchParams({
      username: username ?? 'Unknown User',
      content,
      avatar: avatarUrl,
      color,
      timestamp,
    });

    const apiUrl = `${base}?${params.toString()}`;
    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error(`API responded with status ${res.status}`);

    const imageBuffer = Buffer.from(await res.arrayBuffer());

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '💬 **Discord Message**',
      attachment: [{ name: 'discordmsg.png', stream: imageBuffer }],
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ **Error:** ${error.message ?? 'Unknown error'}`,
    });
  }
};
