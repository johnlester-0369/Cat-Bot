/**
 * Facebook Video Downloader
 *
 * Downloads a Facebook reel or video from a given URL and sends it
 * as a video attachment. Prefers HD quality; falls back to SD.
 *
 * Uses the Kuroneko (danzy.web.id) Facebook download endpoint.
 *
 * Usage:
 *   !facebookdl https://www.facebook.com/reel/1112151989983701
 *   !fb https://www.facebook.com/watch?v=123456789
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/utils/api.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FacebookDlResult {
  hd?: string | null;
  sd?: string | null;
  title?: string;
  duration?: string | number;
}

interface FacebookDlResponse {
  data: FacebookDlResult;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true if the string is a valid absolute URL.
 */
function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Returns true if the URL belongs to a Facebook domain.
 */
function isFacebookUrl(value: string): boolean {
  try {
    const { hostname } = new URL(value);
    return (
      hostname === 'facebook.com' ||
      hostname === 'www.facebook.com' ||
      hostname === 'm.facebook.com' ||
      hostname === 'fb.watch'
    );
  } catch {
    return false;
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'facebookdl',
  aliases: ['facebook', 'fb', 'fbdl', 'fbreel'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description:
    'Download a Facebook video or reel by URL and send it as a video attachment.',
  category: 'Downloader',
  usage: '<facebook-url>',
  cooldown: 15,
  hasPrefix: true,
};

// ── Command Entry Point ───────────────────────────────────────────────────────

export const onCommand = async ({
  args,
  chat,
  usage,
}: AppCtx): Promise<void> => {
  const rawUrl = args[0];

  if (!rawUrl) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        '🔗 **Please provide a Facebook video URL.**\n\n' +
        '**Example:**\n' +
        '`!facebookdl https://www.facebook.com/reel/1112151989983701`',
    });
    void usage();
    return;
  }

  if (!isValidUrl(rawUrl)) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        '❌ **Invalid URL.** Please provide a valid Facebook video link.',
    });
    return;
  }

  if (!isFacebookUrl(rawUrl)) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        '❌ **Not a Facebook URL.**\nOnly `facebook.com` and `fb.watch` links are supported.',
    });
    return;
  }

  const loadingId = (await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message:
      '⬇️ **Downloading video...**\nFetching the best available quality.',
  })) as string | undefined;

  try {
    const apiUrl = createUrl('kuroneko', '/api/download/facebook', {
      url: rawUrl,
    });
    if (!apiUrl) throw new Error('Failed to build API URL.');

    const { data: res } = await axios.get<FacebookDlResponse>(apiUrl, {
      timeout: 30000,
    });

    const videoUrl = res?.data?.hd || res?.data?.sd;
    if (!videoUrl)
      throw new Error(
        'No downloadable video URL found. The video may be private or unsupported.',
      );

    const quality = res.data.hd ? 'HD' : 'SD';
    const title = res.data.title ?? 'Facebook Video';

    if (loadingId) {
      await chat.unsendMessage(loadingId).catch(() => {});
    }

    // Fetch video buffer
    const { data: videoData } = await axios.get<ArrayBuffer>(videoUrl, {
      responseType: 'arraybuffer',
      timeout: 120000,
    });
    const videoBuffer = Buffer.from(videoData);

    // Sanitise title for filename
    const safeTitle = title
      .replace(/[/\\?%*:|"<>]/g, '-')
      .trim()
      .substring(0, 50);

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        `📥 **Facebook Video**\n\n` +
        `📝 **Title:** ${title}\n` +
        `🎞 **Quality:** ${quality}\n` +
        `🔗 **URL:** ${rawUrl}`,
      attachment: [
        { name: `${safeTitle || 'facebook-video'}.mp4`, stream: videoBuffer },
      ],
    });
  } catch (err) {
    const error = err as { message?: string };

    if (loadingId) {
      await chat.unsendMessage(loadingId).catch(() => {});
    }

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        `❌ **Download failed.**\n\`${error.message ?? 'Unknown error'}\`\n\n` +
        `Make sure the video is **public** and the link is valid.`,
    });
  }
};
