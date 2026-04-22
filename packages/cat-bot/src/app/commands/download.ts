/**
 * /download — Universal Social Media Downloader (Stabilized + Optimized v3)
 *
 * Changes from previous version:
 *   • onChat now uses `config.name` (the actual command name) instead of a hardcoded string.
 *   • Still uses the exact `prefix` destructured from `ctx` (same as onCommand).
 *   • This makes the skip logic fully dynamic and future-proof if the command name ever changes.
 *   • All previous optimizations (direct attachment_url, try/finally, efficiency, no interruption)
 *     are preserved.
 *   • Facebook downloader now uses the chocomilk API (ZTRdiamond - Zanixon Group).
 *   • YouTube downloader now uses the chocomilk API (ZTRdiamond - Zanixon Group).
 *   • Fixed TS2345 + TS2339 errors: added missing `apiUrl` null-guard in downloadFacebook.
 *   • Updated FacebookDlData interface to match real API response shape (caption, url, media.all).
 *   • Facebook video resolution now falls back to media.all if media.videos is empty.
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/utils/api.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TikTokVideoResult {
  type: 'video';
  download: string;
}
interface TikTokImageResult {
  type: 'image';
  download: string[];
}
type TikTokResult = TikTokVideoResult | TikTokImageResult;
interface TikTokDlResponse {
  result: TikTokResult;
}

interface FacebookDlMediaItem {
  type: string;
  quality: string;
  extension: string;
  url: string;
}
interface FacebookDlData {
  type: string; // e.g. "reel", "video"
  url?: string; // original Facebook URL echoed back
  title?: string;
  caption?: string; // short caption text
  cover?: string;
  media: {
    all?: FacebookDlMediaItem[]; // all media items combined
    videos: FacebookDlMediaItem[];
    images: FacebookDlMediaItem[];
  };
}
interface FacebookDlResponse {
  info?: string; // e.g. "Developed by ZTRdiamond - Zanixon Group"
  code: number;
  success: boolean;
  data: FacebookDlData;
  error: string | null;
}

interface PinterestResult {
  image: string;
  video: string | 'Tidak ada';
  title?: string;
}
interface PinterestDlResponse {
  result: PinterestResult;
}

interface YtDownloadData {
  title: string;
  filename: string;
  thumbnail?: string;
  author?: string;
  duration?: number;
  quality?: number;
  description?: string;
  download: string;
}
interface YtDownloadResponse {
  info?: string;
  code: number;
  success: boolean;
  data: YtDownloadData;
  error: string | null;
}

// ── Platform detection ────────────────────────────────────────────────────────

type SupportedPlatform = 'tiktok' | 'facebook' | 'pinterest' | 'youtube';

function isValidUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function detectPlatform(value: string): SupportedPlatform | null {
  try {
    const { hostname } = new URL(value);
    if (
      hostname === 'tiktok.com' ||
      hostname.endsWith('.tiktok.com') ||
      hostname === 'vm.tiktok.com' ||
      hostname === 'vt.tiktok.com'
    )
      return 'tiktok';

    if (
      hostname === 'facebook.com' ||
      hostname === 'www.facebook.com' ||
      hostname === 'm.facebook.com' ||
      hostname === 'fb.watch'
    )
      return 'facebook';

    if (
      hostname === 'pinterest.com' ||
      hostname.endsWith('.pinterest.com') ||
      hostname === 'pin.it'
    )
      return 'pinterest';

    if (
      hostname === 'youtube.com' ||
      hostname === 'www.youtube.com' ||
      hostname === 'm.youtube.com' ||
      hostname === 'youtu.be' ||
      hostname === 'music.youtube.com'
    )
      return 'youtube';

    return null;
  } catch {
    return null;
  }
}

function extractUrl(message: string): string | null {
  const match = message.match(/https?:\/\/[^\s]+/);
  return match?.[0] ?? null;
}

function safeFilename(title: string, ext: string): string {
  return `${title
    .replace(/[/\\?%*:|"<>]/g, '-')
    .trim()
    .substring(0, 80)}.${ext}`;
}

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'download',
  /*aliases: [ ... ] */
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description:
    'Download media from TikTok, Facebook, Pinterest, or YouTube by URL. ' +
    'Also triggers automatically when a supported link is sent in chat.',
  category: 'Downloader',
  usage: '<url>',
  cooldown: 15,
  hasPrefix: true,
};

// ── Platform downloaders (optimized + stabilized) ─────────────────────────────

async function downloadTikTok(rawUrl: string, ctx: AppCtx): Promise<void> {
  const { chat } = ctx;

  const loadingId = (await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: '⬇️ **Downloading TikTok content...**',
  })) as string | undefined;

  try {
    const apiUrl = createUrl('deline', '/downloader/tiktok', { url: rawUrl });
    if (!apiUrl) throw new Error('Failed to build API URL.');

    const { data } = await axios.get<TikTokDlResponse>(apiUrl, {
      timeout: 30000,
    });
    const result = data?.result;
    if (!result) throw new Error('No content returned from API.');

    if (result.type === 'image') {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `📸 **TikTok Photo Slideshow** (${result.download.length} images)\n🔗 ${rawUrl}`,
        attachment_url: result.download.map((url, i) => ({
          name: `tiktok-slide-${i + 1}.jpg`,
          url,
        })),
      });
    } else {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `🎵 **TikTok Video**\n🔗 ${rawUrl}`,
        attachment_url: [{ name: 'tiktok-video.mp4', url: result.download }],
      });
    }
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        `❌ **TikTok download failed.**\n\`${error.message ?? 'Unknown error'}\`\n\n` +
        `Make sure the video is **public** and the link is valid.`,
    });
  } finally {
    if (loadingId) await chat.unsendMessage(loadingId).catch(() => {});
  }
}

async function downloadFacebook(rawUrl: string, ctx: AppCtx): Promise<void> {
  const { chat } = ctx;

  const loadingId = (await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message:
      '⬇️ **Downloading Facebook video...**\nFetching the best available quality.',
  })) as string | undefined;

  try {
    const apiUrl = createUrl('chocomilk', '/v1/download/facebook', { url: rawUrl });
    if (!apiUrl) throw new Error('Failed to build API URL.');

    const { data: res } = await axios.get<FacebookDlResponse>(apiUrl, {
      timeout: 30000,
      headers: { Accept: 'application/json' },
    });

    if (!res?.success || !res?.data)
      throw new Error('API returned an unsuccessful response.');

    const videos =
      res.data.media?.videos?.length
        ? res.data.media.videos
        : (res.data.media?.all ?? []).filter((m) => m.type === 'video');

    if (videos.length === 0)
      throw new Error(
        'No downloadable video found. The video may be private or unsupported.',
      );

    const best = videos[0]!;
    const quality = best.quality?.toUpperCase() ?? 'HD';
    const title = res.data.title ?? 'Facebook Video';
    const fileName = safeFilename(title, 'mp4');

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        `📥 **Facebook Video**\n\n` +
        `📝 **Title:** ${title}\n` +
        `🎞 **Quality:** ${quality}\n` +
        `🔗 ${rawUrl}`,
      attachment_url: [{ name: fileName, url: best.url }],
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        `❌ **Facebook download failed.**\n\`${error.message ?? 'Unknown error'}\`\n\n` +
        `Make sure the video is **public** and the link is valid.`,
    });
  } finally {
    if (loadingId) await chat.unsendMessage(loadingId).catch(() => {});
  }
}

async function downloadPinterest(rawUrl: string, ctx: AppCtx): Promise<void> {
  const { chat } = ctx;

  const loadingId = (await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: '📌 **Fetching Pinterest content...**',
  })) as string | undefined;

  try {
    const apiUrl = createUrl('deline', '/downloader/pinterest', {
      url: rawUrl,
    });
    if (!apiUrl) throw new Error('Failed to build API URL.');

    const { data } = await axios.get<PinterestDlResponse>(apiUrl, {
      timeout: 30000,
    });
    const result = data?.result;
    if (!result) throw new Error('No content returned from API.');

    const isVideo = result.video && result.video !== 'Tidak ada';
    const mediaUrl = isVideo ? result.video : result.image;
    const fileName = isVideo ? 'pinterest-video.mp4' : 'pinterest-image.png';

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `📌 **Pinterest ${isVideo ? 'Video' : 'Image'}**\n🔗 ${rawUrl}`,
      attachment_url: [{ name: fileName, url: mediaUrl as string }],
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        `❌ **Pinterest download failed.**\n\`${error.message ?? 'Unknown error'}\`\n\n` +
        `Ensure the pin is **public** and the link is valid.`,
    });
  } finally {
    if (loadingId) await chat.unsendMessage(loadingId).catch(() => {});
  }
}

async function downloadYouTube(rawUrl: string, ctx: AppCtx): Promise<void> {
  const { chat } = ctx;

  const loadingId = (await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: '🎬 **Downloading YouTube video...**\nThis may take a moment.',
  })) as string | undefined;

  try {
    const apiUrl = createUrl('chocomilk', '/v1/youtube/download', {
      url: rawUrl,
      quality: '1080',
      mode: 'video',
    });
    if (!apiUrl) throw new Error('Failed to build API URL.');

    const { data } = await axios.get<YtDownloadResponse>(apiUrl, {
      timeout: 120000,
      headers: { Accept: 'application/json' },
    });

    if (!data?.success || !data?.data?.download)
      throw new Error('No video URL returned from API.');

    const result = data.data;
    const fileName = result.filename || safeFilename(result.title ?? 'video', 'mp4');

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        `🎬 **${result.title ?? 'YouTube Video'}**\n` +
        (result.author ? `👤 Author: ${result.author}\n` : '') +
        (typeof result.duration === 'number' ? `⏱ Duration: ${result.duration}s\n` : '') +
        (typeof result.quality === 'number' ? `🎞 Quality: ${result.quality}p\n` : '') +
        `🔗 ${rawUrl}`,
      attachment_url: [{ name: fileName, url: result.download }],
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ **YouTube download failed.**\n\`${error.message ?? 'Unknown error'}\``,
    });
  } finally {
    if (loadingId) await chat.unsendMessage(loadingId).catch(() => {});
  }
}

// ── Shared router ─────────────────────────────────────────────────────────────

async function route(rawUrl: string, ctx: AppCtx): Promise<boolean> {
  const platform = detectPlatform(rawUrl);
  switch (platform) {
    case 'tiktok':
      await downloadTikTok(rawUrl, ctx);
      return true;
    case 'facebook':
      await downloadFacebook(rawUrl, ctx);
      return true;
    case 'pinterest':
      await downloadPinterest(rawUrl, ctx);
      return true;
    case 'youtube':
      await downloadYouTube(rawUrl, ctx);
      return true;
    default:
      return false;
  }
}

// ── Command entry point ───────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { args, chat, usage } = ctx;
  const rawUrl = args[0];

  if (!rawUrl) {
    await usage();
    return;
  }

  if (!isValidUrl(rawUrl)) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ **Invalid URL.** Please provide a valid link.',
    });
    return;
  }

  const handled = await route(rawUrl, ctx);

  if (!handled) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        '❌ **Unsupported platform.**\n\n' +
        'Supported links:\n' +
        '• `tiktok.com` / `vm.tiktok.com`\n' +
        '• `facebook.com` / `fb.watch`\n' +
        '• `pinterest.com` / `pin.it`\n' +
        '• `youtube.com` / `youtu.be`',
    });
  }
};

// ── onChat — passive auto-downloader (NO interruption with command) ───────────

export const onChat = async (ctx: AppCtx): Promise<void> => {
  const message = (ctx.event['message'] as string | undefined) ?? '';
  if (!message) return;

  const trimmed = message.trim();

  const { prefix = '!' } = ctx;
  const commandName = config.name;

  if (
    trimmed.toLowerCase().startsWith(`${prefix}${commandName}`.toLowerCase())
  ) {
    return;
  }

  const rawUrl = extractUrl(message);
  if (!rawUrl || !isValidUrl(rawUrl)) return;

  const platform = detectPlatform(rawUrl);
  if (!platform) return;

  await route(rawUrl, ctx);
};