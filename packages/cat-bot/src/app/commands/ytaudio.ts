/**
 * YouTube Audio Downloader
 *
 * Downloads the audio track of a YouTube video as an MP3 using the NexRay API.
 * By default the file is sent as a playable audio message. Pass the `-d` or
 * `--document` flag anywhere in the command to send it as a raw document instead
 * (useful for platforms that compress audio or when you want the original file).
 *
 * Flag parsing:
 *   Cat-Bot's ctx.args is a plain string array — there is no built-in ctx.flag().
 *   This command manually scans args for '-d' or '--document', strips the flag
 *   token out, and treats the remaining tokens as the URL.
 *
 * Usage:
 *   !ytaudio https://www.youtube.com/watch?v=0Uhh62MUEic
 *   !ytmp3 https://youtu.be/0Uhh62MUEic -d
 *   !yta https://youtu.be/0Uhh62MUEic --document
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/utils/api.util.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface YtMp3Result {
  url: string;
  title: string;
  duration?: string;
}

interface YtMp3Response {
  result: YtMp3Result;
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

/** Sanitises a string to be safe as a filename. */
function safeFilename(title: string, ext: string): string {
  return `${title.replace(/[/\\?%*:|"<>]/g, '-').trim().substring(0, 80)}.${ext}`;
}

// ── Config ────────────────────────────────────────────────────────────────────

export const config = {
  name: 'youtubeaudio',
  aliases: ['yta', 'ytaudio', 'ytmp3'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description:
    'Download YouTube audio as MP3. ' +
    'Add `-d` or `--document` to send as a file instead of a voice message.',
  category: 'Downloader',
  usage: '<youtube-url> [-d|--document]',
  cooldown: 20,
  hasPrefix: true,
};

// ── Command Entry Point ───────────────────────────────────────────────────────

export const onCommand = async ({ args, chat, usage }: AppCtx): Promise<void> => {
  // ── Flag parsing ───────────────────────────────────────────────────────────
  // Scan args for -d / --document anywhere in the token list.
  // Remaining tokens (non-flag) form the URL.
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
    const apiUrl = createUrl('nexray', '/downloader/ytmp3', { url: rawUrl });
    if (!apiUrl) throw new Error('Failed to build API URL.');

    const { data } = await axios.get<YtMp3Response>(apiUrl, { timeout: 120000 });
    const result = data?.result;
    if (!result?.url) throw new Error('No audio URL returned from API.');

    // Fetch the audio as a binary buffer
    const { data: audioData } = await axios.get<ArrayBuffer>(result.url, {
      responseType: 'arraybuffer',
      timeout: 120000,
    });
    const audioBuffer = Buffer.from(audioData);
    const fileName = safeFilename(result.title ?? 'audio', 'mp3');

    if (loadingId) {
      await chat.unsendMessage(loadingId).catch(() => {});
    }

    const caption =
      `🎵 **${result.title ?? 'YouTube Audio'}**\n` +
      (result.duration ? `⏱ Duration: ${result.duration}\n` : '') +
      `🔗 ${rawUrl}`;

    if (asDocument) {
      // ── Document mode: named file attachment ───────────────────────────────
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: caption,
        attachment: [{ name: fileName, stream: audioBuffer }],
      });
    } else {
      // ── Audio mode: platform sends as playable audio ───────────────────────
      // Naming the file .mp3 signals Cat-Bot's engine to route via sendAudio
      // on Telegram; Discord/FB send it as an audio attachment naturally.
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: caption,
        attachment: [{ name: fileName, stream: audioBuffer }],
      });
    }
  } catch (err) {
    const error = err as { message?: string };

    if (loadingId) await chat.unsendMessage(loadingId).catch(() => {});

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ **Download failed.**\n\`${error.message ?? 'Unknown error'}\``,
    });
  }
};