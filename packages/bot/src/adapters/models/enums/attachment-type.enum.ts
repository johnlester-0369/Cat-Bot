/**
 * Cat-Bot — Attachment Type Enumeration
 *
 * Discriminant strings for the `type` field on every attachment object.
 * Extracted from event.model.ts for single-responsibility and independent consumption.
 *
 * Each platform normalises its native attachment format to one of these types
 * before passing to the handler layer.
 */

export const AttachmentType = Object.freeze({
  /** Static image. */
  PHOTO: 'photo',

  /** Playable video file. */
  VIDEO: 'video',

  /** Playable audio file or voice message. */
  AUDIO: 'audio',

  /** Generic file download (non-media). */
  FILE: 'file',

  /** Messenger sticker from a sticker pack. */
  STICKER: 'sticker',

  /** Animated GIF / WebP image. */
  ANIMATED_IMAGE: 'animated_image',

  /** Link preview card, shared URL, or extensible story attachment. */
  SHARE: 'share',

  /** GPS location pin. */
  LOCATION: 'location',

  /**
   * Attachment that could not be classified; contains raw `attachment1` /
   * `attachment2` payloads for debugging.
   */
  ERROR: 'error',

  /** Catch-all for attachments that threw during _formatAttachment(). */
  UNKNOWN: 'unknown',
} as const);

export type AttachmentTypeValue =
  (typeof AttachmentType)[keyof typeof AttachmentType];
