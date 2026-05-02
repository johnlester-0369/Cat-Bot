/**
 * /playlyrics — YouTube Audio + Song Lyrics in One Command
 *
 * Searches YouTube for the top result, downloads it as an MP3, and fetches
 * matching lyrics — both requests fire in parallel against their respective
 * APIs. The result is a single reply containing the audio attachment, video
 * metadata, and lyrics (or a graceful note if either partial fetch fails).
 *
 * If the combined caption exceeds the safe message length threshold the lyrics
 * are sent as a follow-up message so the audio attachment is never dropped.
 *
 * APIs used:
 *   Audio  — https://api.cuki.biz.id/api/search/playyt   (registry: 'cuki')
 *   Lyrics — https://api.popcat.xyz/v2/lyrics            (registry: 'popcat')
 *
 * Usage:
 *   !playlyrics <song name>
 *   !pl Bohemian Rhapsody
 *   !plyr Never Gonna Give You Up
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
      duration: { formatted: string };
      views: number;
      uploaded: string;
      author: { name: string; url: string };
    };
    download: {
      success: boolean;
      metadata: { videoId: string; title: string; channel: string };
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

interface LyricsResponse {
  error: boolean;
  message: {
    title: string;
    image: string;
    artist: string;
    lyrics: string;
    url: string;
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Character threshold above which lyrics are split into a separate follow-up
 * message, keeping the audio attachment message lean and deliverable.
 */
const LYRICS_SPLIT_THRESHOLD = 800;

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'playlyrics',
  aliases: ['pl', 'plyr'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description:
    'Search YouTube and send the top result as an MP3 with matching song lyrics.',
  category: 'Media',
  usage: '<song name>',
  cooldown: 10,
  hasPrefix: true,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format a raw view count to a readable string (e.g. 5,162,917). */
const formatViews = (views: number): string => views.toLocaleString('en-US');

/**
 * Strip the contributor prefix Genius prepends to raw lyrics,
 * e.g. "15 ContributorsNobela Lyrics\n\n…"
 */
const cleanLyrics = (raw: string): string =>
  raw.replace(/^\d+\s+Contributors.+?Lyrics/s, '').trim();

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async ({
  chat,
  args,
  usage,
}: AppCtx): Promise<void> => {
  if (args.length === 0) return usage();

  const query = args.join(' ');

  // ── Loading indicator ──────────────────────────────────────────────────────
  const waitId = await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: `🔍 Searching for **${query}**...`,
  });

  try {
    // ── Step 1: Fire audio-info and lyrics requests in parallel ────────────
    // Both APIs accept the same raw user query, so there is no dependency
    // between them — running them concurrently halves the wait time.
    const audioApiUrl = createUrl('cuki', '/api/search/playyt', { query }, 'apikey');
    if (!audioApiUrl) throw new Error('Failed to build Play API URL.');

    const lyricsBase = createUrl('popcat', '/v2/lyrics');
    if (!lyricsBase) throw new Error('Failed to build Lyrics API URL.');
    const lyricsApiUrl = `${lyricsBase}?song=${encodeURIComponent(query)}`;

    const [audioInfoResult, lyricsResult] = await Promise.allSettled([
      fetch(audioApiUrl).then((r) => {
        if (!r.ok) throw new Error(`Play API: HTTP ${r.status}`);
        return r.json() as Promise<PlayytResponse>;
      }),
      fetch(lyricsApiUrl).then((r) => {
        if (!r.ok) throw new Error(`Lyrics API: HTTP ${r.status}`);
        return r.json() as Promise<LyricsResponse>;
      }),
    ]);

    // ── Step 2: Validate audio (required — fail fast if missing) ───────────
    if (audioInfoResult.status === 'rejected') {
      throw new Error(audioInfoResult.reason?.message ?? 'Audio fetch failed.');
    }

    const json = audioInfoResult.value;

    if (!json.success || !json.data) {
      throw new Error('The Play API returned an unsuccessful response.');
    }

    const { video, download } = json.data;

    if (!download.success || !download.audio?.url) {
      throw new Error('No downloadable audio found for that query.');
    }

    const audio = download.audio;

    // ── Step 3: Update loading message while the audio buffer downloads ────
    if (waitId) {
      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: waitId as string,
        message:
          `🎵 Found: **${video.title}**\n` +
          `👤 ${video.author.name} · ⏱️ ${video.duration.formatted}\n` +
          `⬇️ Downloading audio...`,
      });
    }

    // ── Step 4: Fetch audio as a buffer ────────────────────────────────────
    const audioRes = await fetch(audio.directLink || audio.url, {
      signal: AbortSignal.timeout(30000),
    });
    if (!audioRes.ok) throw new Error(`Audio download failed (${audioRes.status})`);
    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

    if (waitId) await chat.unsendMessage(waitId as string).catch(() => {});

    // ── Step 5: Resolve lyrics (optional — degrade gracefully) ────────────
    let lyricsBlock = '_Lyrics unavailable for this track._';

    if (lyricsResult.status === 'fulfilled') {
      const lyricsJson = lyricsResult.value;
      if (!lyricsJson.error && lyricsJson.message?.lyrics) {
        lyricsBlock = cleanLyrics(lyricsJson.message.lyrics);
      }
    }

    // ── Step 6: Build caption and send ────────────────────────────────────
    const audioCaption = [
      `🎵 **${video.title}**`,
      ``,
      `👤 **Channel:** ${video.author.name}`,
      `⏱️ **Duration:** ${video.duration.formatted}`,
      `👁️ **Views:** ${formatViews(video.views)}`,
      `📅 **Uploaded:** ${video.uploaded}`,
      `🔊 **Quality:** ${audio.bitrate} · ${audio.format.toUpperCase()}`,
      `🔗 **YouTube:** ${video.url}`,
    ].join('\n');

    const attachment = [
      {
        name:
          audio.filename ||
          `${video.title.replace(/[/\\?%*:|"<>]/g, '-')}.mp3`,
        stream: audioBuffer,
      },
    ];

    if (lyricsBlock.length <= LYRICS_SPLIT_THRESHOLD) {
      // ── Short lyrics: single message with audio + caption + lyrics ────────
      await chat.reply({
        style: MessageStyle.MARKDOWN,
        message: `${audioCaption}\n\n📝 **Lyrics**\n${lyricsBlock}`,
        attachment,
      });
    } else {
      // ── Long lyrics: send audio first, then lyrics as a follow-up ────────
      // Keeps the attachment message from being rejected for size.
      await chat.reply({
        style: MessageStyle.MARKDOWN,
        message: audioCaption,
        attachment,
      });
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `📝 **Lyrics — ${video.title}**\n\n${lyricsBlock}`,
      });
    }
  } catch (err) {
    const error = err as { message?: string };
    if (waitId) await chat.unsendMessage(waitId as string).catch(() => {});
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ **Failed to process your request.**\n\`${error.message ?? 'Unknown error'}\``,
    });
  }
};