/**
 * Play / Audio Search Command (Dual API)
 *
 * Searches for a song using TWO free APIs:
 * 1. NexRay (preferred - better metadata + direct MP3)
 * 2. Kuroneko (fallback)
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/utils/api.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'play',
  aliases: ['song', 'music', 'ytplay', 'audio'] as string[],
  version: '1.1.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description:
    'Search for a song and play the audio (tries NexRay first, then Kuroneko fallback).',
  category: 'Music',
  usage: '<song title or artist>',
  cooldown: 8,
  hasPrefix: true,
};

// ── Response types ────────────────────────────────────────────────────────────

interface NexrayPlayResponse {
  status: boolean;
  author: string;
  result: {
    title: string;
    download_url: string;
    duration?: string;
    thumbnail?: string;
  } | null;
}

interface KuronekoPlayResponse {
  status: boolean;
  creator: string;
  input_type: string;
  original_query: string;
  result: {
    status: string;
    url: string;
    filename: string;
  } | null;
}

// ── Resolved track shape ──────────────────────────────────────────────────────

interface ResolvedTrack {
  audioUrl: string;
  title: string;
  filename: string;
}

// ── API resolvers ─────────────────────────────────────────────────────────────

async function tryNexray(query: string): Promise<ResolvedTrack | null> {
  const url = createUrl('nexray', '/downloader/ytplay', { q: query });
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as NexrayPlayResponse;
    if (!data?.status || !data?.result?.download_url) return null;
    const title = data.result.title || query;
    return {
      audioUrl: data.result.download_url,
      title,
      filename: `${title.replace(/[/\\?%*:|"<>]/g, '-')}.mp3`,
    };
  } catch {
    return null;
  }
}

async function tryKuroneko(query: string): Promise<ResolvedTrack | null> {
  const url = createUrl('kuroneko', '/api/search/play', { q: query });
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as KuronekoPlayResponse;
    if (!data?.status || !data?.result?.url) return null;
    const title = data.original_query || query;
    return {
      audioUrl: data.result.url,
      title,
      filename:
        data.result.filename || `${title.replace(/[/\\?%*:|"<>]/g, '-')}.mp3`,
    };
  } catch {
    return null;
  }
}

// ── Command ───────────────────────────────────────────────────────────────────

export const onCommand = async ({
  args,
  chat,
  usage,
}: AppCtx): Promise<void> => {
  if (!args.length) return usage();

  const query = args.join(' ').trim();

  const waitId = await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: `🔍 Searching for **${query}**...\n⏳ Trying NexRay first...`,
  });

  // ── Try NexRay first, fall back to Kuroneko ───────────────────────────
  let track = await tryNexray(query);
  let source = 'NexRay';

  if (!track) {
    await chat.editMessage({
      style: MessageStyle.MARKDOWN,
      message_id_to_edit: waitId as string,
      message: `🔄 NexRay unavailable, trying Kuroneko fallback...`,
    });
    track = await tryKuroneko(query);
    source = 'Kuroneko';
  }

  if (!track) {
    await chat.editMessage({
      style: MessageStyle.MARKDOWN,
      message_id_to_edit: waitId as string,
      message: `❌ No audio found for **${query}**.\nTry a different title or artist name.`,
    });
    return;
  }

  // ── Download the audio buffer ─────────────────────────────────────────
  let audioBuffer: Buffer;
  try {
    const audioRes = await fetch(track.audioUrl, {
      signal: AbortSignal.timeout(15000),
    });
    if (!audioRes.ok)
      throw new Error(`Audio download failed (${audioRes.status})`);
    audioBuffer = Buffer.from(await audioRes.arrayBuffer());
  } catch (err) {
    const error = err as { message?: string };
    await chat.editMessage({
      style: MessageStyle.MARKDOWN,
      message_id_to_edit: waitId as string,
      message: `❌ **Failed to download audio** (${source})\n\`${error.message ?? 'Unknown error'}\``,
    });
    return;
  }

  // ── Clean up wait message, send audio ────────────────────────────────
  await chat.unsendMessage(waitId as string).catch(() => {});

  await chat.reply({
    style: MessageStyle.MARKDOWN,
    message: `🎵 **Now Playing** (${source})\n**${track.title}**`,
    attachment: [{ name: track.filename, stream: audioBuffer }],
  });
};
