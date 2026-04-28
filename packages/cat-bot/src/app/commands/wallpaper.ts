/**
 * Wallpaper Command
 * Fetches high-quality wallpapers based on keywords or random generation.
 *
 * Button layout — 2 × 3 grid (two ActionRows on Discord, two keyboard rows on Telegram):
 *   Row 1: [🎲 Random] [🌿 Nature] [🌌 Space]
 *   Row 2: [🏙️ City]  [🌅 Sunset] [✨ Anime]
 *
 * Discord compatibility notes:
 *   - Discord hard-caps ActionRows at 5 buttons each. Passing all 6 IDs in a flat
 *     string[] collapses them into a single row of 6 and Discord rejects the message.
 *     The fix is a string[][] where each inner array is its own ActionRow (row = max 5).
 *   - context.model.normalizeRows() detects the 2-D structure automatically —
 *     the 2-D array passes straight through to resolveButtons() without further wrapping.
 *   - Attachments are downloaded as ArrayBuffer and forwarded as Buffer via `attachment`
 *     rather than `attachment_url` so the platform wrapper never needs a second HTTP trip.
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

const TIMEOUT = 20000;
const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;

function parseArgs(args: string[]): {
  query: string;
  width: number;
  height: number;
} {
  let width = DEFAULT_WIDTH;
  let height = DEFAULT_HEIGHT;
  const parts = [...args];

  const lastArg = parts[parts.length - 1] ?? '';
  const match = /^(\d{3,4})x(\d{3,4})$/i.exec(lastArg);

  if (match) {
    width = Math.min(3840, parseInt(match[1]!, 10));
    height = Math.min(2160, parseInt(match[2]!, 10));
    parts.pop();
  }

  const query = parts.join(' ').trim();
  return { query, width, height };
}

// ── Button IDs ────────────────────────────────────────────────────────────────

const BUTTON_ID = {
  random: 'random',
  nature: 'nature',
  space: 'space',
  city: 'city',
  sunset: 'sunset',
  anime: 'anime',
} as const;

// ── Presets ───────────────────────────────────────────────────────────────────

const PRESETS = {
  [BUTTON_ID.random]: { label: '🎲 Random', query: '' },
  [BUTTON_ID.nature]: { label: '🌿 Nature', query: 'nature' },
  [BUTTON_ID.space]: { label: '🌌 Space', query: 'space' },
  [BUTTON_ID.city]: { label: '🏙️ City', query: 'city' },
  [BUTTON_ID.sunset]: { label: '🌅 Sunset', query: 'sunset' },
  [BUTTON_ID.anime]: { label: '✨ Anime', query: 'anime' },
} as const;

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'wallpaper',
  aliases: ['wp', 'wall', 'background'] as string[],
  version: '1.5.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Get a random wallpaper (optionally specify size/topic).',
  category: 'random',
  usage: '[query] [WxH]',
  cooldown: 5,
  hasPrefix: true,
};

// ── Grid builder ──────────────────────────────────────────────────────────────

/**
 * Builds the 2 × 3 button grid as a string[][].
 *
 *   Row 1: [🎲 Random] [🌿 Nature] [🌌 Space]
 *   Row 2: [🏙️ City]  [🌅 Sunset] [✨ Anime]
 *
 * Each inner array maps to one Discord ActionRow (max 5 buttons each).
 * context.model.normalizeRows() detects the 2-D structure and passes it through
 * unchanged — no extra wrapping needed on the caller's side.
 */
function buildButtonGrid(btn: AppCtx['button']): string[][] {
  return [
    // ── Row 1 ────────────────────────────────────────────────────────────────
    [
      btn.generateID({ id: BUTTON_ID.random, public: true }),
      btn.generateID({ id: BUTTON_ID.nature, public: true }),
      btn.generateID({ id: BUTTON_ID.space, public: true }),
    ],
    // ── Row 2 ────────────────────────────────────────────────────────────────
    [
      btn.generateID({ id: BUTTON_ID.city, public: true }),
      btn.generateID({ id: BUTTON_ID.sunset, public: true }),
      btn.generateID({ id: BUTTON_ID.anime, public: true }),
    ],
  ];
}

// ── Core render logic ─────────────────────────────────────────────────────────

/**
 * Shared render logic used by both onCommand (fresh send) and button onClick (in-place edit).
 *
 * Flow:
 *   isButtonAction = false  →  send loading message → download image → unsend loading → send wallpaper
 *   isButtonAction = true   →  download image → editMessage with new wallpaper (no loading flash)
 */
async function renderWallpaper(
  ctx: AppCtx,
  query: string,
  width: number,
  height: number,
): Promise<void> {
  const { chat, event, native, button: btn } = ctx;
  const isButtonAction = event['type'] === 'button_action';

  // Build grid once — reused in both the success and error payloads.
  const buttonGrid = hasNativeButtons(native.platform)
    ? buildButtonGrid(btn)
    : [];

  // ── Loading indicator (fresh command only) ────────────────────────────────
  let loadingId: string | undefined;

  if (!isButtonAction) {
    loadingId = (await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `🖼️ **Finding wallpaper...**\n🔎 Query: _${query || 'Random'}_ (${width}×${height})`,
    })) as string | undefined;
  }

  try {
    // ── Fetch image ─────────────────────────────────────────────────────────
    let url: string;
    let sourceName: string;

    if (query) {
      url = `https://loremflickr.com/${width}/${height}/${encodeURIComponent(query)}/all`;
      sourceName = 'LoremFlickr';
    } else {
      url = `https://picsum.photos/${width}/${height}`;
      sourceName = 'Picsum';
    }

    const { data } = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: TIMEOUT,
      maxRedirects: 5,
    });

    const caption =
      `🖼️ **Wallpaper Generated**\n` +
      `📐 **Size:** ${width}×${height}\n` +
      `🔎 **Topic:** ${query || 'Random'}\n` +
      `📷 **Source:** ${sourceName}`;

    // `attachment` (Buffer) avoids a second HTTP round-trip on Discord's side and
    // lets discord.js construct an AttachmentBuilder directly from the raw bytes.
    const wallpaperPayload = {
      style: MessageStyle.MARKDOWN,
      message: caption,
      attachment: [
        { name: `wallpaper_${width}x${height}.jpg`, stream: Buffer.from(data) },
      ],
      ...(buttonGrid.length > 0 ? { button: buttonGrid } : {}),
    };

    if (isButtonAction) {
      // Edit the existing message in-place — no new message noise.
      await chat.editMessage({
        ...wallpaperPayload,
        message_id_to_edit: event['messageID'] as string,
      });
      return;
    }

    // Remove the loading message before posting the wallpaper.
    if (loadingId) {
      await chat.unsendMessage(loadingId).catch(() => {});
    }

    await chat.replyMessage(wallpaperPayload);
  } catch (err) {
    // ── Error handling ──────────────────────────────────────────────────────
    const error = err as { message?: string; response?: { status?: number } };
    let errorMsg = `⚠️ **Generation Failed**\n\`${error.message ?? 'Unknown error'}\``;

    if (error.response?.status === 404) {
      errorMsg =
        `⚠️ **Not Found**\n` +
        `Could not find a wallpaper for "_${query}_". Try a simpler term.`;
    }

    const errorPayload = {
      style: MessageStyle.MARKDOWN,
      message: errorMsg,
      // Keep the grid visible even on errors so users can try a different topic.
      ...(buttonGrid.length > 0 ? { button: buttonGrid } : {}),
    };

    if (isButtonAction) {
      await chat.editMessage({
        ...errorPayload,
        message_id_to_edit: event['messageID'] as string,
      });
      return;
    }

    // Replace the loading message with the error so it doesn't linger.
    if (loadingId) {
      await chat.editMessage({
        ...errorPayload,
        message_id_to_edit: loadingId,
      });
    } else {
      await chat.replyMessage(errorPayload);
    }
  }
}

// ── Button definitions ────────────────────────────────────────────────────────

export const button = {
  [BUTTON_ID.random]: {
    label: PRESETS[BUTTON_ID.random].label,
    style: ButtonStyle.PRIMARY,
    onClick: async (ctx: AppCtx) =>
      renderWallpaper(
        ctx,
        PRESETS[BUTTON_ID.random].query,
        DEFAULT_WIDTH,
        DEFAULT_HEIGHT,
      ),
  },

  [BUTTON_ID.nature]: {
    label: PRESETS[BUTTON_ID.nature].label,
    style: ButtonStyle.SECONDARY,
    onClick: async (ctx: AppCtx) =>
      renderWallpaper(
        ctx,
        PRESETS[BUTTON_ID.nature].query,
        DEFAULT_WIDTH,
        DEFAULT_HEIGHT,
      ),
  },

  [BUTTON_ID.space]: {
    label: PRESETS[BUTTON_ID.space].label,
    style: ButtonStyle.SUCCESS,
    onClick: async (ctx: AppCtx) =>
      renderWallpaper(
        ctx,
        PRESETS[BUTTON_ID.space].query,
        DEFAULT_WIDTH,
        DEFAULT_HEIGHT,
      ),
  },

  [BUTTON_ID.city]: {
    label: PRESETS[BUTTON_ID.city].label,
    style: ButtonStyle.DANGER,
    onClick: async (ctx: AppCtx) =>
      renderWallpaper(
        ctx,
        PRESETS[BUTTON_ID.city].query,
        DEFAULT_WIDTH,
        DEFAULT_HEIGHT,
      ),
  },

  [BUTTON_ID.sunset]: {
    label: PRESETS[BUTTON_ID.sunset].label,
    style: ButtonStyle.PRIMARY,
    onClick: async (ctx: AppCtx) =>
      renderWallpaper(
        ctx,
        PRESETS[BUTTON_ID.sunset].query,
        DEFAULT_WIDTH,
        DEFAULT_HEIGHT,
      ),
  },

  [BUTTON_ID.anime]: {
    label: PRESETS[BUTTON_ID.anime].label,
    style: ButtonStyle.SECONDARY,
    onClick: async (ctx: AppCtx) =>
      renderWallpaper(
        ctx,
        PRESETS[BUTTON_ID.anime].query,
        DEFAULT_WIDTH,
        DEFAULT_HEIGHT,
      ),
  },
};

// ── Entry point ───────────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { args } = ctx;
  const { query, width, height } = parseArgs(args);
  await renderWallpaper(ctx, query, width, height);
};
