/**
 * /bonk — Bonk
 *
 * Sends the sender bonking a target user.
 *
 * avatar1 = sender's avatar
 * avatar2 = @mention avatar OR replied-to user's avatar (required)
 *
 * ⚠️  Not available on Facebook Page — restricted via config.platform.
 *     No non-admin guide applies since Page is fully excluded.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/utils/api.util.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Command Config ────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'bonk',
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Bonk a user with your avatar.',
  category: 'fun',
  usage: [
    '@mention             ← bonks the mentioned user',
    '(reply to message)  ← bonks the replied-to user',
    '<userId>             ← bonks the user with the given ID',
  ],
  cooldown: 5,
  hasPrefix: true,
  platform: [
    Platforms.Discord,
    Platforms.Telegram,
    Platforms.FacebookMessenger,
  ],
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

  if (!event['isGroup']) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ This command can only be used in group chats.',
    });
    return;
  }

  // Resolve target — @mention → reply → raw userId arg
  const targetID = mentionIDs[0] ?? repliedSenderID ?? args[0];

  if (!targetID) {
    await usage();
    return;
  }

  try {
    const [senderAvatar, targetAvatar] = await Promise.all([
      user.getAvatarUrl(senderID),
      user.getAvatarUrl(targetID),
    ]);

    if (!senderAvatar || !targetAvatar) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '❌ Could not resolve one or both avatars. Please try again.',
      });
      return;
    }

    const url = createUrl('wajiro', '/api/v1/bonk', {
      avatar1: targetAvatar,
      avatar2: senderAvatar,
    });
    if (!url) throw new Error('Failed to build API URL.');

    const res = await fetch(url);
    if (!res.ok) throw new Error(`API responded with status ${res.status}`);

    const imageBuffer = Buffer.from(await res.arrayBuffer());

    const targetName = await user.getName(targetID);

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `**Bonk!** ${targetName}`,
      attachment: [{ name: 'bonk.png', stream: imageBuffer }],
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ **Error:** ${error.message ?? 'Unknown error'}`,
    });
  }
};
