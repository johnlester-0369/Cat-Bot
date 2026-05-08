// src/app/commands/sing.ts

import axios from 'axios';

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';
import { createUrl } from '@/engine/utils/api.util.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface MusicItem {
  id: string;
  title: string;
  duration?: string;
}

interface WajiroYtsResult {
  title: string;
  thumbnail: string;
  duration: string;
  uploaded: string;
  views: string;
  url: string;
  videoId: string;
}

interface WajiroYtsResponse {
  success: boolean;
  data: {
    status: boolean;
    result: WajiroYtsResult[];
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

const STATE = {
  awaiting_selection: 'awaiting_selection',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'sing',
  aliases: ['music', 'song'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'TheophilusX',
  description: 'Searches YouTube for a song and sends it as audio.',
  category: 'Music',
  usage: '<song name>',
  cooldown: 25,
  hasPrefix: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// Command Handler
// ─────────────────────────────────────────────────────────────────────────────

export const onCommand = async ({
  chat,
  args,
  state,
  usage,
}: AppCtx): Promise<void> => {
  if (!args.length) {
    await usage();
    return;
  }

  const query = args.join(' ').trim();

  const loadingId = await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message:
      `🔍 **Searching**\n\n` +
      `Looking up _"${truncate(query, 28)}"_ on YouTube...`,
  });

  const url = createUrl('wajiro', '/api/v1/yts', {
    q: query,
  });

  if (!url) {
    if (loadingId) {
      await chat.unsendMessage(String(loadingId)).catch(() => {});
    }

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        `⚠️ **Internal Error**\n\n` +
        `Failed to build the search URL.`,
    });

    return;
  }

  try {
    const { data: res } = await axios.get<WajiroYtsResponse>(url);

    if (
      !res.success ||
      !res.data.status ||
      !Array.isArray(res.data.result)
    ) {
      if (loadingId) {
        await chat.unsendMessage(String(loadingId)).catch(() => {});
      }

      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message:
          `🔇 **No Results**\n\n` +
          `No results found for _"${query}"_.`,
      });

      return;
    }

    const filtered: MusicItem[] = res.data.result
      .filter((video) => parseDurationSeconds(video.duration) <= 600)
      .slice(0, 5)
      .map((video) => ({
        id: video.videoId,
        title: video.title,
        duration: video.duration,
      }));

    if (!filtered.length) {
      if (loadingId) {
        await chat.unsendMessage(String(loadingId)).catch(() => {});
      }

      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message:
          `🔇 **No Results**\n\n` +
          `All matching tracks exceed 10 minutes.`,
      });

      return;
    }

    if (loadingId) {
      await chat.unsendMessage(String(loadingId)).catch(() => {});
    }

    const messageID = await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: formatSearchResults(query, filtered),
    });

    if (!messageID) return;

    state.create({
      id: state.generateID({ id: String(messageID) }),
      state: STATE.awaiting_selection,
      context: {
        filtered,
        query,
        messageID: String(messageID),
      },
    });
  } catch (err) {
    if (loadingId) {
      await chat.unsendMessage(String(loadingId)).catch(() => {});
    }

    const error = err as { message?: string };

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        `❌ **Search Failed**\n\n` +
        `${error.message ?? 'Unknown error occurred.'}`,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Reply Handler
// ─────────────────────────────────────────────────────────────────────────────

export const onReply = {
  [STATE.awaiting_selection]: async ({
    chat,
    session,
    event,
    state,
  }: AppCtx): Promise<void> => {
    const filtered = session.context['filtered'] as MusicItem[];
    const query = session.context['query'] as string;
    const messageID = session.context['messageID'] as string | undefined;

    const raw = String(event['message'] ?? '').trim();
    const selection = parseInt(raw, 10);

    state.delete(session.id);

    if (
      Number.isNaN(selection) ||
      selection < 1 ||
      selection > filtered.length
    ) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message:
          `⚠️ **Invalid Selection**\n\n` +
          `Reply with a number between **1** and **${filtered.length}**.`,
      });

      return;
    }

    const video = filtered[selection - 1];

    if (!video?.id) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message:
          `⚠️ **Invalid Item**\n\n` +
          `The selected track is unavailable.`,
      });

      return;
    }

    if (messageID) {
      await chat.unsendMessage(messageID).catch(() => {});
    }

    const link = `https://www.youtube.com/watch?v=${video.id}`;

    const safeName = query
      .replace(/[^a-z0-9]/gi, '_')
      .slice(0, 40);

    const downloadingId = await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        `⏳ **Downloading**\n\n` +
        `**Track:** _${truncate(video.title, 36)}_\n` +
        `**Length:** ${video.duration ?? '—'}\n\n` +
        `Please wait while the audio is being prepared...`,
    });

    try {
      const { data: dl } = await axios.get<{
        download?: string;
      }>(
        `https://ccproject.serv00.net/ytdl2.php?url=${encodeURIComponent(link)}`,
      );

      if (!dl?.download) {
        if (downloadingId) {
          await chat.unsendMessage(String(downloadingId)).catch(() => {});
        }

        await chat.replyMessage({
          style: MessageStyle.MARKDOWN,
          message:
            `❌ **Download Failed**\n\n` +
            `The download service did not return a valid audio URL.`,
        });

        return;
      }

      if (downloadingId) {
        await chat.unsendMessage(String(downloadingId)).catch(() => {});
      }

      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message:
          `🎵 **Now Sending**\n\n` +
          `**Track:** _${truncate(video.title, 36)}_\n` +
          `**Length:** ${video.duration ?? '—'}`,
        attachment_url: [
          {
            name: `${safeName}.mp3`,
            url: dl.download,
          },
        ],
      });
    } catch (err) {
      if (downloadingId) {
        await chat.unsendMessage(String(downloadingId)).catch(() => {});
      }

      const error = err as { message?: string };

      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message:
          `❌ **Unexpected Error**\n\n` +
          `${error.message ?? 'Unknown error occurred.'}`,
      });
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatSearchResults(
  query: string,
  results: MusicItem[],
): string {
  const rows = results
    .map((video, index) => {
      const title = truncate(video.title, 38);
      const duration = video.duration ?? '—';

      return (
        `**${index + 1}.** ${title}\n` +
        `⏱️ ${duration}`
      );
    })
    .join('\n\n');

  return (
    `🎵 **Music Search Results**\n\n` +
    `**Query:** _${truncate(query, 28)}_\n` +
    `**Found:** ${results.length} result${
      results.length !== 1 ? 's' : ''
    }\n\n` +
    `${rows}\n\n` +
    `Reply with a number between **1** and **${results.length}**.`
  );
}

function parseDurationSeconds(duration: string): number {
  const parts = duration.split(':').map(Number);

  if (parts.length === 2) {
    const [minutes = 0, seconds = 0] = parts;
    return minutes * 60 + seconds;
  }

  if (parts.length === 3) {
    const [hours = 0, minutes = 0, seconds = 0] = parts;
    return hours * 3600 + minutes * 60 + seconds;
  }

  return 0;
}

function truncate(text: string, max: number): string {
  return text.length > max
    ? `${text.slice(0, max - 1)}…`
    : text;
}