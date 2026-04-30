/**
 * /play — Search YouTube and send the top result as an MP3 audio file.
 *
 * Usage:
 *   /play <search query>
 *
 * Fetches from: https://api.cuki.biz.id/api/search/playyt
 * Returns video metadata + a direct MP3 download link.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/utils/api.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PlayytResponse {
  success: boolean;
  data: {
    searchQuery: string;
    video: {
      title: string;
      url: string;
      duration: {
        formatted: string;
      };
      views: number;
      uploaded: string;
      author: {
        name: string;
        url: string;
      };
    };
    download: {
      success: boolean;
      metadata: {
        videoId: string;
        title: string;
        channel: string;
      };
      audio: {
        quality: string;
        bitrate: string;
        format: string;
        size: number | null;
        sizeUnit: string;
        url: string;
        directLink: string;
        filename: string;
      };
    };
  };
}

// ── Command Config ─────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'play',
  aliases: ['song', 'music'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Search YouTube and send the top result as an MP3 audio file.',
  category: 'media',
  usage: '<search query>',
  cooldown: 10,
  hasPrefix: true,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format a raw view count to a human-readable string (e.g. 5,162,917). */
const formatViews = (views: number): string => views.toLocaleString('en-US');

// ── Command Handler ────────────────────────────────────────────────────────────

export const onCommand = async ({
  chat,
  args,
  usage,
}: AppCtx): Promise<void> => {
  // Require at least one word as the search query
  if (args.length === 0) return usage();

  const query = args.join(' ');

  // ── Loading indicator ────────────────────────────────────────────────────
  const waitId = await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: `🔍 Searching for **${query}**...`,
  });

  try {
    // Step 1 — Query the search + download API
    const apiUrl = createUrl('cuki', '/api/search/playyt', { query }, 'apikey');
    if (!apiUrl) throw new Error('Failed to build Play API URL.');

    const res = await fetch(apiUrl);

    if (!res.ok) {
      throw new Error(`API responded with HTTP ${res.status}`);
    }

    const json = (await res.json()) as PlayytResponse;

    if (!json.success || !json.data) {
      throw new Error('The API returned an unsuccessful response.');
    }

    const { video, download } = json.data;

    if (!download.success || !download.audio?.url) {
      throw new Error('No downloadable audio was found for that query.');
    }

    const audio = download.audio;

    // Step 2 — Show metadata while downloading
    if (waitId) {
      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: waitId as string,
        message:
          `🎵 Found: **${video.title}**\n` +
          `👤 ${video.author.name} · ⏱️ ${video.duration.formatted}\n` +
          `⬇️ Downloading...`,
      });
    }

    // Step 3 — Fetch audio as a buffer
    const audioRes = await fetch(audio.directLink || audio.url, {
      signal: AbortSignal.timeout(30000),
    });
    if (!audioRes.ok)
      throw new Error(`Audio fetch failed (${audioRes.status})`);
    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

    if (waitId) await chat.unsendMessage(waitId as string).catch(() => {});

    // Step 4 — Build the info caption and send with the audio attachment
    const caption = [
      `🎵 **${video.title}**`,
      ``,
      `👤 **Artist/Channel:** ${video.author.name}`,
      `⏱️ **Duration:** ${video.duration.formatted}`,
      `👁️ **Views:** ${formatViews(video.views)}`,
      `📅 **Uploaded:** ${video.uploaded}`,
      `🔊 **Quality:** ${audio.bitrate} · ${audio.format.toUpperCase()}`,
      `🔗 **YouTube:** ${video.url}`,
    ].join('\n');

    await chat.reply({
      style: MessageStyle.MARKDOWN,
      message: caption,
      attachment: [
        {
          name: audio.filename || `${video.title.replace(/[/\\?%*:|"<>]/g, '-')}.mp3`,
          stream: audioBuffer,
        },
      ],
    });
  } catch (err) {
    const error = err as { message?: string };
    if (waitId) await chat.unsendMessage(waitId as string).catch(() => {});
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ **Failed to fetch audio.**\n\`${error.message ?? 'Unknown error'}\``,
    });
  }
};