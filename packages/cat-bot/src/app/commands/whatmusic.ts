/**
 * /whatmusic — Identify a Song from Audio
 *
 * Reads the audio URL from a direct or quoted audio attachment and passes
 * it to the Deline /tools/whatmusic endpoint. Returns the song title and
 * artist(s) as a formatted markdown reply.
 *
 * Usage: !whatmusic (send or reply to an audio message)
 *
 * ⚠️  `createUrl` registry name 'deline' is assumed — confirm with the
 *     Cat Bot engine team that this registry key exists.
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/utils/api.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface WhatMusicResult {
  title: string;
  artists: string;
}

interface WhatMusicResponse {
  result: WhatMusicResult;
}

// ── Command Config ────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'whatmusic',
  aliases: [] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Identify a song from an audio message.',
  category: 'tools',
  usage: ['(send audio)', '(reply to audio)'],
  cooldown: 5,
  hasPrefix: true,
};

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async ({ chat, event, usage }: AppCtx): Promise<void> => {
  // ── Resolve audio URL ───────────────────────────────────────────────────────
  // Priority: direct attachment → quoted attachment
  const attachments = (event['attachments'] as Record<string, unknown>[]) ?? [];
  const messageReply = event['messageReply'] as Record<string, unknown> | null | undefined;
  const quotedAttachments = (messageReply?.['attachments'] as Record<string, unknown>[]) ?? [];

  const directAudio = attachments.find(
    (att) => (att['type'] as string) === 'audio',
  );
  const quotedAudio = quotedAttachments.find(
    (att) => (att['type'] as string) === 'audio',
  );

  const audioUrl = (directAudio?.['url'] ?? quotedAudio?.['url']) as string | undefined;

  if (!audioUrl) {
    return usage();
  }

  // ── Call the API ────────────────────────────────────────────────────────────
  try {
    const base = createUrl('deline', '/tools/whatmusic');
    if (!base) throw new Error('Failed to build WhatMusic API URL.');

    const apiUrl = `${base}?url=${encodeURIComponent(audioUrl)}`;
    const { data: json } = await axios.get<WhatMusicResponse>(apiUrl);

    const result = json.result;
    if (!result?.title) throw new Error('No result returned from the API.');

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: [
        `🎵 **Title**: ${result.title}`,
        `🎤 **Artist**: ${result.artists}`,
      ].join('\n'),
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ **Error:** ${error.message ?? 'Unknown error'}`,
    });
  }
};