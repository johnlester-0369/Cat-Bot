/**
 * /discordmsg — Fake Discord Message Generator
 *
 * Builds a fake Discord message card using the sender's username and avatar.
 * The message content comes from the args prompt. Color defaults to #ffcc99
 * and timestamp is generated at the moment the command is run.
 *
 * Usage: !discordmsg <message content>
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
  description: 'Generate a fake Discord message card.',
  category: 'fun',
  usage: ['<message content>', '(reply to a message)'],
  cooldown: 5,
  hasPrefix: true,
};

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async ({ chat, user, event, args, usage }: AppCtx): Promise<void> => {
  const content = args.join(' ').trim();
  if (!content) return usage();

  const senderID = event['senderID'] as string;
  const mentions = event['mentions'] as Record<string, string> | undefined;
  const mentionIDs = Object.keys(mentions ?? {});
  const messageReply = event['messageReply'] as Record<string, unknown> | null | undefined;
  const repliedSenderID = messageReply?.['senderID'] as string | undefined;

  // Priority: @mention → replied-to user → self
  const targetID = mentionIDs[0] ?? repliedSenderID ?? senderID;

  try {
    const [username, avatarUrl] = await Promise.all([
      user.getName(targetID),
      user.getAvatarUrl(targetID),
    ]);

    if (!avatarUrl) throw new Error('Could not fetch your avatar.');

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