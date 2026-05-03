/**
 * /sing — YouTube Music Search & Download
 *
 * Searches YouTube Music for a track, presents up to five results in an
 * interactive numbered list, then waits for the user to reply with their
 * choice. The selected track is downloaded in-memory and sent as an MP3
 * audio attachment.
 *
 * Interactive flow (replaces TXCommand's waitReply):
 *   onCommand  → search → display list → state.create (awaiting_selection)
 *   onReply    → parse index → download → send audio attachment
 *
 * Temp-file note:
 *   The original used CACHE_DIR + fs to store the audio before sending.
 *   Cat Bot's attachment API accepts a Buffer directly, so the download
 *   is kept fully in-memory — no filesystem writes or cleanup needed.
 *
 * APIs:
 *   Search   — https://www.holistic-fitness.ca/explore/{query}/
 *   Download — https://ccproject.serv00.net/ytdl2.php?url=<youtubeUrl>
 *
 * Usage:
 *   !sing Never Gonna Give You Up
 *   !play Bohemian Rhapsody
 */
import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MusicItem {
  id: string;
  title: string;
  artist: string;
  duration?: string;
}

interface SearchResponse {
  data?: MusicItem[];
}

interface DownloadResponse {
  download?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum track duration the command will offer to download (10 minutes). */
const MAX_DURATION_SECONDS = 600;

/** Maximum number of results presented to the user. */
const RESULT_LIMIT = 5;

const STATE = {
  awaiting_selection: 'awaiting_selection',
} as const;

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'sing',
  aliases: ['play'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'TheophilusX',
  description:
    'Search YouTube Music and send the top result as an MP3 audio file.',
  category: 'Media',
  usage: '<song name>',
  cooldown: 25,
  hasPrefix: true,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Parse a "mm:ss" or "hh:mm:ss" duration string into total seconds. */
const parseDurationSeconds = (duration: string): number => {
  const parts = duration.split(':').map(Number);
  if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  if (parts.length === 3)
    return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  return 0;
};

/** Build the formatted search result list sent to the user. */
const formatResults = (query: string, results: MusicItem[]): string => {
  const rows = results
    .map((v, i) => `┊ ${i + 1}: 🎵 ${v.title}\n┊   👤 ${v.artist}`)
    .join('\n├───────────────\n');

  return (
    `‗   ↳ ❝ [ Search Results ] ¡! ❞\n` +
    `ೃ⁀➷ Found matches for "${query}".\n` +
    `Reply with the index number to download.\n\n` +
    `╭┈ results ̗̀➛\n${rows}\n╰─────────┈➤`
  );
};

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async ({
  chat,
  args,
  usage,
  state,
}: AppCtx): Promise<void> => {
  if (args.length === 0) return usage();

  const query = args.join(' ').trim();

  try {
    // ── Step 1: Fetch search results ───────────────────────────────────────
    const { data: raw } = await axios.post<MusicItem[] | SearchResponse>(
      `https://www.holistic-fitness.ca/explore/${encodeURIComponent(query)}/`,
    );

    const data: MusicItem[] = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as SearchResponse).data)
        ? ((raw as SearchResponse).data as MusicItem[])
        : [];

    if (data.length === 0) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '❌ **No results found.**',
      });
      return;
    }

    // ── Step 2: Filter to tracks under 10 minutes ─────────────────────────
    const filtered = data.filter(
      (item) =>
        !item.duration ||
        parseDurationSeconds(item.duration) <= MAX_DURATION_SECONDS,
    );

    if (filtered.length === 0) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '❌ **No results found under 10 minutes.**',
      });
      return;
    }

    const videos = filtered.slice(0, RESULT_LIMIT);

    // ── Step 3: Send the list and open a reply state ───────────────────────
    // state.create() replaces TXCommand's reply.waitReply — the engine will
    // route the user's next reply (in the same thread, same sender) to the
    // awaiting_selection handler in onReply below.
    const msgId = await chat.replyMessage({
      style: MessageStyle.TEXT,
      message: formatResults(query, videos),
    });

    if (!msgId) {
      // Platform did not return a message ID — onReply cannot be registered.
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '❌ **Could not register selection state. Try again.**',
      });
      return;
    }

    state.create({
      id: state.generateID({ id: String(msgId) }),
      state: STATE.awaiting_selection,
      // Carry the video list and the original query into the reply handler.
      context: { videos, query },
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ **Search failed.**\n\`${error.message ?? 'Unknown error'}\``,
    });
  }
};

// ── Reply Handler ─────────────────────────────────────────────────────────────

export const onReply = {
  [STATE.awaiting_selection]: async ({
    chat,
    session,
    event,
    state,
  }: AppCtx): Promise<void> => {
    // Always clean up the state first so a bad reply doesn't leave it open.
    state.delete(session.id);

    const { videos, query } = session.context as {
      videos: MusicItem[];
      query: string;
    };

    // ── Parse and validate the user's index ─────────────────────────────────
    const raw = (event['message'] as string | undefined)?.trim() ?? '';
    const idx = Number(raw) - 1;

    if (!Number.isInteger(idx) || idx < 0 || idx >= videos.length) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ **Invalid choice.** Reply with a number between 1 and ${videos.length}.`,
      });
      return;
    }

    const video = videos[idx];

    if (!video?.id) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '❌ **Selected item is invalid.**',
      });
      return;
    }

    const youtubeUrl = `https://www.youtube.com/watch?v=${video.id}`;

    try {
      // ── Step 4: Resolve the direct MP3 download link ─────────────────────
      const { data: dl } = await axios.get<DownloadResponse>(
        `https://ccproject.serv00.net/ytdl2.php?url=${encodeURIComponent(youtubeUrl)}`,
      );

      if (!dl?.download) {
        await chat.replyMessage({
          style: MessageStyle.MARKDOWN,
          message: '❌ **Download service failed.** Try again.',
        });
        return;
      }

      // ── Step 5: Download the MP3 as an in-memory Buffer ──────────────────
      // The original wrote the file to CACHE_DIR then sent the path.
      // Cat Bot attachment accepts a Buffer directly — no temp file needed.
      const audioResponse = await axios.get<ArrayBuffer>(dl.download, {
        responseType: 'arraybuffer',
        maxRedirects: 10,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          Accept: 'audio/mpeg, audio/*, */*',
        },
      });

      // Guard: reject HTML error pages served at the download URL.
      const contentType: string =
        (audioResponse.headers as Record<string, string>)['content-type'] ?? '';
      if (contentType.includes('text/html')) {
        throw new Error(
          `Download URL returned HTML instead of audio (content-type: ${contentType})`,
        );
      }

      const audioBuffer = Buffer.from(audioResponse.data);

      if (audioBuffer.byteLength === 0) {
        throw new Error('Downloaded file is 0 bytes — download likely failed.');
      }

      // ── Step 6: Send the audio attachment ─────────────────────────────────

      const safeName = query.replace(/[^a-z0-9]/gi, '_').slice(0, 40);

      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `🎵 **${video.title}**\n👤 ${video.artist}`,
        attachment: [{ name: `${safeName}.mp3`, stream: audioBuffer }],
      });
    } catch (err) {
      const error = err as { message?: string };
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ **Failed to download or send the song.**\n\`${error.message ?? 'Unknown error'}\``,
      });
    }
  },
};
