/**
 * Telegram — Avatar URL Resolution via getUserProfilePhotos + getFileLink (Telegraf v4)
 *
 * The Telegram Bot API does not expose a direct avatar URL on the User object.
 * Profile photos must be fetched in two steps:
 *   1. getUserProfilePhotos(userId, offset, limit) — returns an array of PhotoSize arrays
 *      (outer array = each uploaded profile photo; inner array = size variants of that photo)
 *   2. getFileLink(file_id) — resolves a file_id to a temporary CDN HTTPS URL (~1 hour TTL
 *      per Telegram Bot API specification)
 *
 * We request only the first photo (offset=0, limit=1) and pick the largest size variant
 * to maximise image quality without fetching all historical profile photos.
 *
 * Reference: https://core.telegram.org/bots/api#getuserprofilephotos
 *            https://core.telegram.org/bots/api#getfile
 */

import type { Context } from 'telegraf';

/**
 * Fetches the user's most recent Telegram profile photo URL.
 *
 * @param ctx    - Current Telegraf context (provides ctx.telegram for Bot API calls)
 * @param userID - Telegram numeric user ID as string
 * @returns CDN URL string (~1 hour TTL), or null when the user has no photos or the call fails
 */
export async function getAvatarUrl(
  ctx: Context,
  userID: string,
): Promise<string | null> {
  try {
    const numericId = Number(userID);
    // Telegram user IDs are always positive integers — reject malformed inputs early
    if (!Number.isFinite(numericId) || numericId <= 0) return null;

    // Limit=1 fetches only the most recent profile photo, minimising payload size
    const photos = await ctx.telegram.getUserProfilePhotos(numericId, 0, 1);
    if (photos.total_count === 0) return null;

    // photos.photos is PhotoSize[][] — outer=each upload, inner=resolution variants
    // PhotoSize variants are ordered smallest-to-largest; pick last for best quality
    const firstPhotoSizes = photos.photos[0];
    if (!firstPhotoSizes?.length) return null;
    const bestSize = firstPhotoSizes[firstPhotoSizes.length - 1];
    if (!bestSize) return null;

    // getFileLink resolves the file_id to a temporary CDN URL (~1 hour TTL per Bot API spec)
    const link = await ctx.telegram.getFileLink(bestSize.file_id);
    return link.href;
  } catch {
    // Non-fatal: user may have privacy settings blocking profile photo access
    return null;
  }
}