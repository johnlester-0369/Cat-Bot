/**
 * Lyrics Search Command
 *
 * Searches for song lyrics using the free kuroneko (danzy.web.id) Lyrics API.
 * Returns the best match with title, artist, album, duration and full plain lyrics.
 *
 * Usage:
 *   !lyrics nobela
 *   !lyrics perfect - ed sheeran
 *   !lyrics bahala na
 */
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/utils/api.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'lyrics',
  aliases: ['lyric', 'lirik', 'lyriks'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description:
    'Search for song lyrics and get the full plain lyrics of the best match.',
  category: 'Music',
  usage: '<song title or artist>',
  cooldown: 5,
  hasPrefix: true,
};

interface LyricsSong {
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  plainLyrics: string;
  syncedLyrics?: string | null;
}

interface LyricsResponse {
  status: boolean;
  creator: string;
  result: LyricsSong[];
}

export const onCommand = async ({
  args,
  chat,
  usage,
}: AppCtx): Promise<void> => {
  if (!args.length) return usage();

  const query = args.join(' ');

  // Build the URL using the centralised api.util registry
  // (kuroneko baseURL = https://api.danzy.web.id is already registered)
  const url = createUrl('kuroneko', '/api/search/lyrics', { q: query });
  if (!url) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Failed to build the Lyrics API request URL.',
    });
    return;
  }

  let data: LyricsResponse;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API responded with status ${res.status}`);
    data = (await res.json()) as LyricsResponse;
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ Failed to reach the lyrics API.\n\`${error.message ?? 'Unknown error'}\``,
    });
    return;
  }

  if (!data?.status || !data?.result?.length) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `🔍 No lyrics found for **${query}**.`,
    });
    return;
  }

  // Take the first (best) result
  const song = data.result[0]!;

  // Format duration (seconds → MM:SS)
  const duration = song.duration
    ? (() => {
        const min = Math.floor(song.duration / 60);
        const sec = song.duration % 60;
        return `${min}:${sec.toString().padStart(2, '0')}`;
      })()
    : 'N/A';

  const caption =
    `🎵 **${song.trackName}**\n` +
    `👤 **${song.artistName}**\n` +
    (song.albumName ? `💿 Album: ${song.albumName}\n` : '') +
    `⏱ Duration: ${duration}\n\n` +
    `**Lyrics:**\n\n` +
    `${song.plainLyrics || '*No lyrics available*'}`;

  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: caption,
  });
};
