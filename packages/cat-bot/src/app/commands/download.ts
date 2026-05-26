// /download — Universal Social Media Downloader (Stabilized + Optimized v4)
//
// Changes from v3:
//   YouTube: replaced chocomilk API with yt-dlp-stream.onrender.com API v2.
//            Detection is now strict — only actual video links accepted
//            (watch?v=ID, youtu.be/ID, shorts/ID). Channels and playlists ignored.
//   Facebook: detection is now strict — only actual video URLs matched
//             (videos/ID, watch?v=ID, video.php?v=ID, reel/ID, fb.watch).
//             Profiles, pages, groups, posts and photos are ignored.
//   onChat: existing guard (skip prefixed messages) is preserved.
//   All previous optimizations (direct attachment_url, try/finally) preserved.

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
  type: string;
  url?: string;
  title?: string;
  caption?: string;
  cover?: string;
  media: {
    all?: FacebookDlMediaItem[];
    videos: FacebookDlMediaItem[];
    images: FacebookDlMediaItem[];
  };
}
interface FacebookDlResponse {
  info?: string;
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

// Response shape returned by yt-dlp-stream.onrender.com /api/v2/q
interface YtDlpStreamMedia {
  mp4: string;
  mp3: string;
}
interface YtDlpStreamResponse {
  credit?: string;
  version?: string;
  media: YtDlpStreamMedia;
  ApiCount?: number;
  ms?: number;
  error?: string;
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

// Returns true only for actual YouTube video links.
// Accepts: watch?v=ID, youtu.be/ID, shorts/ID.
// Rejects: channels, playlists, music pages, feeds, etc.
function isYouTubeVideoUrl(url: URL): boolean {
  const { hostname, pathname, searchParams } = url;
  const isYTHost =
    hostname === 'youtube.com' ||
    hostname === 'www.youtube.com' ||
    hostname === 'm.youtube.com';

  if (isYTHost) {
    // Standard watch URL with v= param
    if (pathname === '/watch' && searchParams.has('v')) return true;
    // YouTube Shorts
    if (/^\/shorts\/[^/]+/.test(pathname)) return true;
    // Anything else on youtube.com is NOT a video (channel, playlist, search)
    return false;
  }

  // youtu.be short-links always point to a video
  if (hostname === 'youtu.be' && pathname.length > 1) return true;

  return false;
}

// Returns true only for actual Facebook video links.
// Accepts: /videos/ID, /watch?v=ID, /video.php?v=ID, /reel/ID, fb.watch/slug.
// Rejects: profiles, pages, groups, posts, photos, etc.
function isFacebookVideoUrl(url: URL): boolean {
  const { hostname, pathname, searchParams } = url;

  // fb.watch short-links always point to a video
  if (hostname === 'fb.watch') return true;

  const isFBHost =
    hostname === 'facebook.com' ||
    hostname === 'www.facebook.com' ||
    hostname === 'm.facebook.com';

  if (!isFBHost) return false;

  // /watch or /watch/ with v= param
  if (
    (pathname === '/watch' || pathname === '/watch/') &&
    searchParams.has('v')
  )
    return true;

  // /video.php with v= param
  if (pathname === '/video.php' && searchParams.has('v')) return true;

  // Any path containing /videos/NUMERIC_ID
  if (/\/videos\/\d+/.test(pathname)) return true;

  // /reel/ID
  if (/^\/reel\/[^/]+/.test(pathname)) return true;

  return false;
}

function detectPlatform(value: string): SupportedPlatform | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const { hostname } = url;

  // ── TikTok ────────────────────────────────────────────────────────────────
  if (
    hostname === 'tiktok.com' ||
    hostname.endsWith('.tiktok.com') ||
    hostname === 'vm.tiktok.com' ||
    hostname === 'vt.tiktok.com'
  )
    return 'tiktok';

  // ── Facebook — only actual video links ───────────────────────────────────
  if (isFacebookVideoUrl(url)) return 'facebook';

  // ── Pinterest ─────────────────────────────────────────────────────────────
  if (
    hostname === 'pinterest.com' ||
    hostname.endsWith('.pinterest.com') ||
    hostname === 'pin.it'
  )
    return 'pinterest';

  // ── YouTube — only actual video links ────────────────────────────────────
  if (isYouTubeVideoUrl(url)) return 'youtube';

  return null;
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
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description:
    'Download media from TikTok, Facebook (videos only), Pinterest, or YouTube (videos only). ' +
    'Also triggers automatically when a supported video link is sent in chat.',
  category: 'Downloader',
  usage: '<url>',
  cooldown: 15,
  hasPrefix: true,
};

// ── Platform downloaders ──────────────────────────────────────────────────────

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
    const apiUrl = createUrl('chocomilk', '/v1/download/facebook', {
      url: rawUrl,
    });
    if (!apiUrl) throw new Error('Failed to build API URL.');

    const { data: res } = await axios.get<FacebookDlResponse>(apiUrl, {
      timeout: 30000,
      headers: { Accept: 'application/json' },
    });

    if (!res?.success || !res?.data)
      throw new Error('API returned an unsuccessful response.');

    const videos = res.data.media?.videos?.length
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

// Downloads a YouTube video using the yt-dlp-stream API.
// Endpoint: GET https://yt-dlp-stream.onrender.com/api/v2/q?=YOUTUBE_URL
// Response contains media.mp4 and media.mp3 download URLs.
// The full YouTube URL is passed as the query value so yt-dlp can resolve it.
async function downloadYouTube(rawUrl: string, ctx: AppCtx): Promise<void> {
  const { chat } = ctx;

  const loadingId = (await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: '🎬 **Downloading YouTube video...**\nThis may take a moment.',
  })) as string | undefined;

  try {
    // Build the API URL manually — the query key is an empty string, e.g. "?=VALUE"
    // which axios's params serialiser would omit, so we append it directly.
    const apiBase = 'https://yt-dlp-stream.onrender.com/api/v2/q';
    const apiUrl = `${apiBase}?=${encodeURIComponent(rawUrl)}`;

    const { data } = await axios.get<YtDlpStreamResponse>(apiUrl, {
      timeout: 120_000,
      headers: { Accept: 'application/json' },
    });

    if (data?.error) throw new Error(data.error);

    const mp4Url = data?.media?.mp4;
    if (!mp4Url) throw new Error('No video URL returned from API.');

    // Derive a clean filename from the last URL path segment (the video ID),
    // falling back to a generic name when the segment is absent or unparsable.
    let fileName = 'youtube-video.mp4';
    try {
      const urlObj = new URL(rawUrl);
      const videoId =
        urlObj.searchParams.get('v') ??
        urlObj.pathname.split('/').filter(Boolean).pop();
      if (videoId) fileName = safeFilename(videoId, 'mp4');
    } catch {
      // Keep the fallback name
    }

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `🎬 **YouTube Video**\n🔗 ${rawUrl}`,
      attachment_url: [{ name: fileName, url: mp4Url }],
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
        '❌ **Unsupported or unrecognised link.**\n\n' +
        'Supported links:\n' +
        '• `tiktok.com` / `vm.tiktok.com`\n' +
        '• facebook.com/videos/ID  |  facebook.com/watch?v=ID  |  facebook.com/reel/ID  |  fb.watch\n' +
        '• `pinterest.com` / `pin.it`\n' +
        '• youtube.com/watch?v=ID  |  youtu.be/ID  |  youtube.com/shorts/ID',
    });
  }
};

// ── onChat — passive auto-downloader ─────────────────────────────────────────

export const onChat = async (ctx: AppCtx): Promise<void> => {
  const message = (ctx.event['message'] as string | undefined) ?? '';
  if (!message) return;

  const trimmed = message.trim();
  const { prefix = '!' } = ctx;

  // Skip ANY prefixed message — commands that include a URL
  // (e.g. !youtubesummary https://...) are never intercepted.
  if (trimmed.startsWith(prefix)) return;

  const rawUrl = extractUrl(message);
  if (!rawUrl || !isValidUrl(rawUrl)) return;

  // detectPlatform now returns null for non-video Facebook / YouTube links,
  // so those are silently ignored in passive mode.
  const platform = detectPlatform(rawUrl);
  if (!platform) return;

  await route(rawUrl, ctx);
};