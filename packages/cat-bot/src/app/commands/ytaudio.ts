/**
 * YouTube Audio Downloader
 *
 * Downloads the audio track of a YouTube video as an MP3 using Delirius API.
 * Pass `-d` or `--document` anywhere in the command to send it as a document.
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface YtMp3Data {
  title: string;
  author?: string;
  channel?: string;
  views?: string;
  likes?: string;
  image?: string;
  format?: string;
  download: string;
}

interface YtMp3Response {
  creator?: string;
  status: boolean;
  data: YtMp3Data;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isValidUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function isYouTubeUrl(value: string): boolean {
  try {
    const { hostname } = new URL(value);
    return (
      hostname === 'youtube.com' ||
      hostname === 'www.youtube.com' ||
      hostname === 'm.youtube.com' ||
      hostname === 'youtu.be' ||
      hostname === 'music.youtube.com'
    );
  } catch {
    return false;
  }
}

function safeFilename(title: string, ext: string): string {
  return `${title
    .replace(/[/\\?%*:|"<>]/g, '-')
    .trim()
    .substring(0, 80)}.${ext}`;
}

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'youtubeaudio',
  aliases: ['yta', 'ytaudio', 'ytmp3'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description:
    'Download YouTube audio as MP3. ' +
    'Add `-d` or `--document` to send as a file instead of audio.',
  category: 'Downloader',
  usage: '<youtube-url> [-d|--document]',
  cooldown: 20,
  hasPrefix: true,
};

// ── Command Entry Point ───────────────────────────────────────────────────────

export const onCommand = async ({
  args,
  chat,
  usage,
}: AppCtx): Promise<void> => {
  const FLAG_TOKENS = new Set(['-d', '--document']);
  const asDocument = args.some((a) => FLAG_TOKENS.has(a.toLowerCase()));
  const urlTokens = args.filter((a) => !FLAG_TOKENS.has(a.toLowerCase()));
  const rawUrl = urlTokens[0];

  if (!rawUrl) {
    await usage();
    return;
  }

  if (!isValidUrl(rawUrl)) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ **Invalid URL.** Please provide a valid YouTube link.',
    });
    return;
  }

  if (!isYouTubeUrl(rawUrl)) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        '❌ **Not a YouTube URL.**\nOnly `youtube.com` and `youtu.be` links are supported.',
    });
    return;
  }

  const loadingId = (await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: '🎵 **Downloading audio...**\nThis may take a moment.',
  })) as string | undefined;

  try {
    const apiUrl =
      `https://api.delirius.store/download/ytmp3?url=${encodeURIComponent(rawUrl)}`;

    const { data } = await axios.get<YtMp3Response>(apiUrl, {
      timeout: 120000,
    });

    if (!data?.status || !data?.data?.download) {
      throw new Error('No download URL returned from API.');
    }

    const result = data.data;
    const fileName = safeFilename(result.title || 'audio', 'mp3');

    const { data: audioData } = await axios.get<ArrayBuffer>(result.download, {
      responseType: 'arraybuffer',
      timeout: 120000,
    });

    const audioBuffer = Buffer.from(audioData);

    if (loadingId) {
      await chat.unsendMessage(loadingId).catch(() => {});
    }

    const caption =
      `🎵 **${result.title || 'YouTube Audio'}**\n` +
      (result.author ? `👤 Author: ${result.author}\n` : '') +
      (result.channel ? `📺 Channel: ${result.channel}\n` : '') +
      (result.views ? `👁 Views: ${result.views}\n` : '') +
      (result.likes ? `👍 Likes: ${result.likes}\n` : '') +
      `🔗 ${rawUrl}`;

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: caption,
      attachment: [{ name: fileName, stream: audioBuffer }],
    });
  } catch (err) {
    const error = err as { message?: string };

    if (loadingId) {
      await chat.unsendMessage(loadingId).catch(() => {});
    }

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ **Download failed.**\n\`${error.message ?? 'Unknown error'}\``,
    });
  }
};