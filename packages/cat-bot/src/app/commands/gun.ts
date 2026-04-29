/**
 * /gun — Gun Threat Image with a Photo or User's Avatar
 *
 * Image source priority:
 *  1. Photo attachment in the replied message        ← required for FB Page non-admin
 *  2. @mention avatar                                ← optional (page admin / other platforms)
 *  3. Replied-to user's avatar                       ← optional (page admin / other platforms)
 *  4. Sender's own avatar (self)                     ← optional (page admin / other platforms)
 *
 * Usage examples:
 *   FB Page non-admin : upload photo → reply to it: !gun <text>
 *   Page admin / other: !gun <text> [@mention | reply]
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
  name: 'gun',
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Generate a gun threat image with a photo or a user\'s avatar and your text.',
  category: 'fun',
  usage: [
    '<text> (reply to uploaded photo)  ← FB Page non-admin: upload a photo then reply to it with this command',
    '<text> <self>                      ← uses your own avatar (page admin / other platforms)',
    '<text> @mention                    ← uses the mentioned user\'s avatar (page admin / other platforms)',
    '<text> (reply to user\'s message)  ← uses the replied user\'s avatar (page admin / other platforms)',
  ],
  cooldown: 5,
  hasPrefix: true,
};

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async ({
  chat,
  user,
  event,
  args,
  usage,
}: AppCtx): Promise<void> => {
  const senderID = event['senderID'] as string;
  const mentions = event['mentions'] as Record<string, string> | undefined;
  const mentionIDs = Object.keys(mentions ?? {});
  const messageReply = event['messageReply'] as
    | Record<string, unknown>
    | null
    | undefined;
  const repliedSenderID = messageReply?.['senderID'] as string | undefined;

  // Strip mention tokens to isolate the text prompt
  const mentionTexts = Object.values(mentions ?? {});
  const text = args
    .join(' ')
    .replace(
      new RegExp(
        mentionTexts
          .map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('|'),
        'g',
      ),
      '',
    )
    .trim();

  if (!text) return usage();

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
      if (!avatar) throw new Error('Could not fetch user avatar.');
      imageUrl = avatar;
    }

    const base = createUrl('popcat', '/v2/gun');
    if (!base) throw new Error('Failed to build Gun API URL.');

    const params = new URLSearchParams({ image: imageUrl, text });
    const res = await fetch(`${base}?${params.toString()}`);
    if (!res.ok) throw new Error(`API responded with status ${res.status}`);

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '🔫 **Gun**',
      attachment: [
        { name: 'gun.png', stream: Buffer.from(await res.arrayBuffer()) },
      ],
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ **Error:** ${error.message ?? 'Unknown error'}`,
    });
  }
};
