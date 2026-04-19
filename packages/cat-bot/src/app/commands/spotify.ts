/**
 * Spotify / Shazam Command
 *
 * Search for a song and get its details and audio preview.
 * Uses the betadash free API via the native api.util URL builder so the base
 * URL is managed centrally in the registry rather than hardcoded here.
 */
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/utils/api.util.js';

export const config = {
  name: 'spotify',
  aliases: ['sp', 'shazam'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Search for a song and get its details and preview.',
  category: 'Media',
  usage: '<song title>',
  cooldown: 5,
  hasPrefix: true,
};

interface ShazamSong {
  title: string;
  artistName: string;
  albumName: string;
  genreNames?: string[];
  durationInMillis?: number;
  releaseDate?: string;
  thumbnail?: string;
  appleMusicUrl?: string;
  previewUrl?: string;
}

interface ShazamResponse {
  results?: ShazamSong[];
}

export const onCommand = async ({
  args,
  chat,
  usage,
}: AppCtx): Promise<void> => {
  if (!args.length) return usage();

  const title = args.join(' ');

  // Build the endpoint URL via the centralised api.util registry —
  // the betadash base URL lives in APIs and is not repeated here.
  const url = createUrl('betadash', '/shazam', { title, limit: '1' });
  if (!url) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Failed to build the API request URL.',
    });
    return;
  }

  let data: ShazamResponse;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API responded with status ${res.status}`);
    data = (await res.json()) as ShazamResponse;
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ Failed to reach the music API.\n\`${error.message ?? 'Unknown error'}\``,
    });
    return;
  }

  if (!data?.results?.length) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `🔍 No results found for **${title}**.`,
    });
    return;
  }

  const song = data.results[0]!;

  const duration = song.durationInMillis
    ? (() => {
        const totalSec = Math.floor(song.durationInMillis! / 1000);
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
      })()
    : 'N/A';

  const releaseYear = song.releaseDate
    ? new Date(song.releaseDate).getFullYear()
    : 'N/A';

  const genres =
    song.genreNames?.filter((g) => g !== 'Music').join(', ') || 'N/A';

  const caption =
    `🎵 **${song.title}**\n` +
    `👤 Artist: ${song.artistName}\n` +
    `💿 Album: ${song.albumName}\n` +
    `🎭 Genre: ${genres}\n` +
    `⏱ Duration: ${duration}\n` +
    `📅 Released: ${releaseYear}`;

  // ── Album art + song details ───────────────────────────────────────────────
  if (song.thumbnail) {
    try {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: caption,
        attachment_url: [{ name: 'album_art.jpg', url: song.thumbnail }],
      });
    } catch {
      // Fall back to text-only when the attachment fails (e.g. expired CDN URL)
      await chat.replyMessage({ style: MessageStyle.MARKDOWN, message: caption });
    }
  } else {
    await chat.replyMessage({ style: MessageStyle.MARKDOWN, message: caption });
  }

  // ── Audio preview ──────────────────────────────────────────────────────────
  if (song.previewUrl) {
    try {
      const audioRes = await fetch(song.previewUrl);
      if (!audioRes.ok)
        throw new Error(`Failed to fetch audio: ${audioRes.status}`);
      const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
      const fileName = `${song.title} - ${song.artistName}.mp3`.replace(
        /[/\\?%*:|"<>]/g,
        '-',
      );
      await chat.reply({
        style: MessageStyle.MARKDOWN,
        message: `🎵 ${song.title} — ${song.artistName}`,
        attachment: [{ name: fileName, stream: audioBuffer }],
      });
    } catch (err) {
      const error = err as { message?: string };
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `⚠️ Could not send audio preview.\n\`${error.message ?? 'Unknown error'}\``,
      });
    }
  }
};
