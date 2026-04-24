/**
 * /whatanime — Anime Scene Finder
 *
 * Identifies an anime from a screenshot or image using the trace.moe API.
 * Supports images sent directly with the command or replied-to messages.
 *
 * Supported input:
 *   - Send an image with !whatanime as the caption
 *   - Reply to a message that contains an image, then send !whatanime
 *
 * Usage:
 *   [send image] !whatanime
 *   [reply to image] !whatanime
 *
 * API: https://trace.moe — free, no auth required for URL-based lookups
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { AttachmentType } from '@/engine/adapters/models/enums/attachment-type.enum.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Base URL for the trace.moe search API */
const TRACE_MOE_API = 'https://api.trace.moe/search';

/** Maximum similarity percentage to flag a match as low-confidence */
const LOW_SIMILARITY_THRESHOLD = 0.75;

/** Fetch timeout in milliseconds */
const REQUEST_TIMEOUT_MS = 30_000;

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'whatanime',
  aliases: ['tracemoe', 'findsource', 'animesource'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description:
    'Identify an anime from a screenshot or image. ' +
    'Send or reply to an image to find the anime title, episode, and scene timestamp.',
  category: 'Anime',
  usage: '[send or reply to an anime screenshot]',
  cooldown: 10,
  hasPrefix: true,
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface NormalizedAttachment {
  type: string;
  url?: string | null;
  [key: string]: unknown;
}

interface AnilistTitle {
  native: string | null;
  romaji: string | null;
  english: string | null;
}

interface AnilistInfo {
  id: number;
  idMal: number | null;
  title: AnilistTitle;
  synonyms: string[];
  isAdult: boolean;
}

interface TraceMoeResult {
  anilist: AnilistInfo | number; // number when anilistInfo param is absent
  filename: string;
  episode: number | null;
  duration: number;
  from: number;
  to: number;
  at: number;
  similarity: number;
  video: string;
  image: string;
}

interface TraceMoeResponse {
  frameCount: number;
  error: string;
  result: TraceMoeResult[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Finds the first PHOTO-type attachment URL from the current message or,
 * if absent, from the quoted / replied-to message.
 *
 * Cat-Bot normalises every platform's native attachment format to the shared
 * AttachmentType schema before the event reaches command handlers.
 */
function resolveImageUrl(event: Record<string, unknown>): string | null {
  // 1. Attachments on the sender's own message
  const ownAttachments =
    (event['attachments'] as NormalizedAttachment[] | undefined) ?? [];

  const fromOwn = ownAttachments.find(
    (a) =>
      a.type === AttachmentType.PHOTO && typeof a.url === 'string' && a.url,
  );
  if (fromOwn?.url) return fromOwn.url as string;

  // 2. Attachments on the quoted / replied-to message
  const messageReply = event['messageReply'] as
    | Record<string, unknown>
    | undefined;
  const replyAttachments =
    (messageReply?.['attachments'] as NormalizedAttachment[] | undefined) ?? [];

  const fromReply = replyAttachments.find(
    (a) =>
      a.type === AttachmentType.PHOTO && typeof a.url === 'string' && a.url,
  );
  if (fromReply?.url) return fromReply.url as string;

  return null;
}

/**
 * Searches trace.moe for the anime scene matching the given image URL.
 * Requests full AniList metadata via the `anilistInfo` query flag.
 *
 * @throws {Error} On network failure or a non-OK HTTP status.
 */
async function searchTraceMoe(imageUrl: string): Promise<TraceMoeResponse> {
  const endpoint = `${TRACE_MOE_API}?anilistInfo&url=${encodeURIComponent(imageUrl)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`trace.moe returned HTTP ${response.status}`);
    }
    return (await response.json()) as TraceMoeResponse;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Converts a raw seconds value (e.g. 98.2231) to a human-readable MM:SS string.
 */
function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Formats a similarity float (0–1) as a percentage string with one decimal place.
 */
function formatSimilarity(sim: number): string {
  return `${(sim * 100).toFixed(1)}%`;
}

/**
 * Resolves the display title from an AniList info block.
 * Priority: english → romaji → native → 'Unknown Title'
 */
function resolveTitle(anilist: AnilistInfo): string {
  return (
    anilist.title.english ??
    anilist.title.romaji ??
    anilist.title.native ??
    'Unknown Title'
  );
}

/**
 * Builds the formatted result message for the top match.
 */
function buildResultMessage(result: TraceMoeResult): string {
  const anilist = result.anilist as AnilistInfo;

  const title = resolveTitle(anilist);
  const nativeTitle = anilist.title.native ?? null;
  const romaji = anilist.title.romaji ?? null;
  const similarity = formatSimilarity(result.similarity);
  const isLowConfidence = result.similarity < LOW_SIMILARITY_THRESHOLD;
  const episode =
    result.episode !== null && result.episode !== undefined
      ? String(result.episode)
      : 'Unknown / Movie';
  const timestamp = formatTimestamp(result.at);
  const anilistId = anilist.id;
  const malId = anilist.idMal;
  const isAdult = anilist.isAdult;

  // Confidence badge
  const confidenceBadge = isLowConfidence
    ? '⚠️ _Low confidence — result may be inaccurate_\n\n'
    : '';

  // Build title line with native subtitle if it differs
  const titleLine =
    nativeTitle && nativeTitle !== title
      ? `${title}\n  _(${nativeTitle})_`
      : title;

  const romajiLine =
    romaji && romaji !== title ? ` • 🔤 **Romaji:** ${romaji}\n` : '';

  const links =
    `[AniList](https://anilist.co/anime/${anilistId})` +
    (malId ? ` · [MAL](https://myanimelist.net/anime/${malId})` : '');

  return (
    `🔍 **Anime Scene Identified!**\n\n` +
    confidenceBadge +
    ` • 🎬 **Title:** ${titleLine}\n` +
    romajiLine +
    ` • 📺 **Episode:** ${episode}\n` +
    ` • ⏱️ **Timestamp:** ${timestamp}\n` +
    ` • 🎯 **Similarity:** ${similarity}\n` +
    (isAdult ? ` • 🔞 **Rating:** Adult\n` : '') +
    ` • 🔗 **Links:** ${links}`
  );
}

// ── Command Entry Point ───────────────────────────────────────────────────────

export const onCommand = async ({
  event,
  chat,
  usage,
}: AppCtx): Promise<void> => {
  // ── Step 1: Resolve image URL ─────────────────────────────────────────────

  const imageUrl = resolveImageUrl(event);

  if (!imageUrl) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        '📎 **No image found.**\n\n' +
        'Please **send an anime screenshot** with this command as the caption, ' +
        'or **reply to an image message** and then run the command.',
    });
    void usage();
    return;
  }

  // ── Step 2: Send loading indicator ────────────────────────────────────────

  const loadingId = (await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message:
      '🔍 **Searching trace.moe...**\nIdentifying anime scene, please wait.',
  })) as string | undefined;

  // ── Step 3: Query trace.moe ───────────────────────────────────────────────

  let data: TraceMoeResponse;
  try {
    data = await searchTraceMoe(imageUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (loadingId) await chat.unsendMessage(loadingId).catch(() => {});
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ **Failed to contact trace.moe.**\n\`${msg}\``,
    });
    return;
  }

  // ── Step 4: Handle API-level errors ──────────────────────────────────────

  if (data.error) {
    if (loadingId) await chat.unsendMessage(loadingId).catch(() => {});
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ **trace.moe error:** \`${data.error}\``,
    });
    return;
  }

  // ── Step 5: Handle no results ─────────────────────────────────────────────

  const topResult = data.result?.[0];

  if (!topResult) {
    if (loadingId) await chat.unsendMessage(loadingId).catch(() => {});
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        '🔍 **No match found.**\n\n' +
        'trace.moe could not identify this scene. ' +
        'Make sure the image is a clear anime screenshot without heavy filters or edits.',
    });
    return;
  }

  // ── Step 6: Dismiss loading message ──────────────────────────────────────

  if (loadingId) await chat.unsendMessage(loadingId).catch(() => {});

  // ── Step 7: Send scene preview image ─────────────────────────────────────

  // The `image` field is a direct scene-still URL from trace.moe — no auth needed.
  // We send it first so the image leads the reply, then follow with the text card.
  if (topResult.image) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '🖼️ **Scene Preview**',
      attachment_url: [{ name: 'scene_preview.jpg', url: topResult.image }],
    });
  }

  // ── Step 8: Send result card ──────────────────────────────────────────────

  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: buildResultMessage(topResult),
  });
};
