/**
 * /anime — Anime Search
 *
 * Searches for anime via the Jikan v4 API and presents a numbered list.
 * The user quotes (replies to) the bot's list message with a number to
 * receive the full details + cover image for the selected title.
 *
 * Flow:
 *   User: /anime <title>
 *   Bot:  Numbered list of up to 20 results
 *   User: [quotes bot] 3
 *   Bot:  Full anime details with image
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'anime',
  aliases: ['ani'] as string[],
  version: '1.0.1',
  role: Role.ANYONE,
  author: 'MrkimstersDev, Fixed',
  description: 'Search for anime information using the Jikan API.',
  category: 'Anime',
  usage: '<anime title>',
  cooldown: 10,
  hasPrefix: true,
};

// ── State keys ────────────────────────────────────────────────────────────────

const STATE = {
  awaiting_selection: 'awaiting_selection',
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

interface AnimeEntry {
  title: string;
  type: string;
  episodes: number | null;
  synopsis: string | null;
  status: string;
  duration: string | null;
  images: {
    jpg: {
      large_image_url: string | null;
    };
  };
}

interface JikanResponse {
  data?: AnimeEntry[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchAnimeData(query: string): Promise<AnimeEntry[]> {
  const url = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=20`;
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Jikan API responded with status ${response.status}`);
  const data = (await response.json()) as JikanResponse;
  return data.data ?? [];
}

function formatAnimeList(results: AnimeEntry[]): string {
  const list = results
    .map(
      (anime, index) =>
        ` • ${index + 1}. ${anime.title} (${anime.type ?? 'N/A'}, ${
          anime.episodes ?? 'N/A'
        } eps)`,
    )
    .join('\n');

  return (
    `🎬 Anime Search Results\n\n` +
    `${list}\n\n` +
    `Reply with a number (1–${results.length}) to view details`
  );
}

function formatAnimeDetails(anime: AnimeEntry): string {
  const synopsis = anime.synopsis ?? 'No synopsis available.';

  return (
    `🎬 **Anime Details**\n\n` +
    ` • 🎬 **Title:** ${anime.title}\n` +
    ` • 📅 **Status:** ${anime.status ?? 'N/A'}\n` +
    ` • 🎭 **Type:** ${anime.type ?? 'N/A'}\n` +
    ` • 📺 **Episodes:** ${anime.episodes ?? 'N/A'}\n` +
    ` • ⏱️ **Duration:** ${anime.duration ?? 'N/A'}\n\n` +
    `📝 **Synopsis:**\n${synopsis}`
  );
}

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async ({
  args,
  chat,
  usage,
  state,
}: AppCtx): Promise<void> => {
  if (!args.length) {
    await usage();
    return;
  }

  const query = args.join(' ').trim();

  let results: AnimeEntry[];
  try {
    results = await fetchAnimeData(query);
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ Error fetching anime data: \`${error.message ?? 'Unknown error'}\``,
    });
    return;
  }

  if (!results.length) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `🔍 No anime found for **${query}**.`,
    });
    return;
  }

  const top = results.slice(0, 20);

  const messageID = await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: formatAnimeList(top),
  });

  if (!messageID) return;

  state.create({
    id: state.generateID({ id: String(messageID) }),
    state: STATE.awaiting_selection,
    context: { results: top },
  });
};

// ── Reply Handler ─────────────────────────────────────────────────────────────

export const onReply = {
  /**
   * User quoted the list message and replied with a number.
   * Resolves the selection, deletes state, and sends the detail card.
   */
  [STATE.awaiting_selection]: async ({
    chat,
    session,
    event,
    state,
  }: AppCtx): Promise<void> => {
    const results = session.context['results'] as AnimeEntry[];
    const raw = String(event['message'] ?? '').trim();
    const selection = parseInt(raw, 10);

    // Always clean up state first so no stale entry remains
    state.delete(session.id);

    if (isNaN(selection) || selection < 1 || selection > results.length) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ Please reply with a valid number between **1** and **${results.length}**.`,
      });
      return;
    }

    const anime = results[selection - 1];
    if (!anime) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '❌ Could not find the selected entry. Please try again.',
      });
      return;
    }

    const imageUrl = anime.images?.jpg?.large_image_url;

    // Send image first with a short caption to stay within Telegram's
    // 1024-character caption limit, then send full details separately.
    if (imageUrl) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `🎬 **${anime.title}**`,
        attachment_url: [{ name: 'anime_cover.jpg', url: imageUrl }],
      });
    }

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: formatAnimeDetails(anime),
    });
  },
};
