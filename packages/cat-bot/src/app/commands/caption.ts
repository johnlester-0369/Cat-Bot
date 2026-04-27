/**
 * /caption — Add a Caption to a User's Avatar
 *
 * Fetches the target user's avatar (mention or self) and overlays the
 * supplied text prompt using the PopCat /v2/caption endpoint. Hard-coded
 * defaults: bottom=false, dark=true, fontsize=30.
 *
 * Usage: !caption <text> [@user]
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
  name: 'caption',
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: "Add a caption to a user's avatar.",
  category: 'fun',
  usage: ['<text> [@user]', '<text> (reply to a message)'],
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

  // Priority: @mention → replied-to user → self
  const targetID = mentionIDs[0] ?? repliedSenderID ?? senderID;

  // Strip mention tokens from args to isolate the caption text
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

  try {
    const avatarUrl = await user.getAvatarUrl(targetID);
    if (!avatarUrl) throw new Error('Could not fetch user avatar.');

    const base = createUrl('popcat', '/v2/caption');
    if (!base) throw new Error('Failed to build Caption API URL.');

    const params = new URLSearchParams({
      image: avatarUrl,
      text,
      bottom: 'false',
      dark: 'true',
      fontsize: '30',
    });

    const apiUrl = `${base}?${params.toString()}`;
    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error(`API responded with status ${res.status}`);

    const imageBuffer = Buffer.from(await res.arrayBuffer());

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '🖼️ **Caption**',
      attachment: [{ name: 'caption.png', stream: imageBuffer }],
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ **Error:** ${error.message ?? 'Unknown error'}`,
    });
  }
};
