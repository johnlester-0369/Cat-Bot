/**
 * Cat-Bot — Attachment Prototype Objects
 *
 * Frozen canonical shapes for every attachment variant.
 * Each PROTO_ATTACHMENT_* object documents every key a handler may safely read.
 * Extracted from event.model.ts for single-responsibility.
 *
 * These prototypes serve as:
 *   1. Reference documentation for attachment shapes
 *   2. Type-safe templates for test fixtures
 *   3. Runtime guards via structural comparison
 */

import { AttachmentType } from '../enums/index.js';

// ── Photo ────────────────────────────────────────────────────────────────────

export const PROTO_ATTACHMENT_PHOTO = Object.freeze({
  type: AttachmentType.PHOTO,
  /** Facebook attachment ID (fbid) as string. */
  ID: '',
  filename: '',
  /** 50×50 crop thumbnail URL. */
  thumbnailUrl: '',
  /** ~280px preview URL. */
  previewUrl: '',
  previewWidth: 0,
  previewHeight: 0,
  largePreviewUrl: '',
  largePreviewWidth: 0,
  largePreviewHeight: 0,
  /** Full-resolution URL. */
  url: '',
  width: 0,
  height: 0,
  name: '',
});

// ── Video ────────────────────────────────────────────────────────────────────

export const PROTO_ATTACHMENT_VIDEO = Object.freeze({
  type: AttachmentType.VIDEO,
  ID: '',
  filename: '',
  previewUrl: '',
  previewWidth: 0,
  previewHeight: 0,
  url: '',
  width: 0,
  height: 0,
  /** Playable duration in milliseconds. */
  duration: 0,
  /** blob.video_type.toLowerCase() — e.g. "video_file", "video_inline". */
  videoType: 'unknown',
  thumbnailUrl: '',
});

// ── Audio ────────────────────────────────────────────────────────────────────

export const PROTO_ATTACHMENT_AUDIO = Object.freeze({
  type: AttachmentType.AUDIO,
  /** url_shimhash used as ID — no fbid available for audio blobs. */
  ID: '',
  filename: '',
  /** e.g. "voice_message" or "audio_file". */
  audioType: '',
  /** Playable duration in milliseconds. */
  duration: 0,
  url: '',
  isVoiceMail: false,
});

// ── File ─────────────────────────────────────────────────────────────────────

export const PROTO_ATTACHMENT_FILE = Object.freeze({
  type: AttachmentType.FILE,
  ID: '',
  filename: '',
  url: '',
  /** True when Facebook's virus scanner flagged the file. */
  isMalicious: false,
  contentType: '',
  name: '',
  mimeType: '',
  /** -1 when size is unknown. */
  fileSize: -1,
});

// ── Sticker ──────────────────────────────────────────────────────────────────

export const PROTO_ATTACHMENT_STICKER = Object.freeze({
  type: AttachmentType.STICKER,
  ID: '',
  url: '',
  /** null if the sticker has no pack (standalone sticker). */
  packID: null as string | null,
  spriteUrl: null as string | null,
  spriteUrl2x: null as string | null,
  width: 0,
  height: 0,
  /** Sticker label / caption. */
  caption: '',
  description: '',
  frameCount: 0,
  frameRate: 0,
  framesPerRow: 0,
  framesPerCol: 0,
  stickerID: '',
  spriteURI: null as string | null,
  spriteURI2x: null as string | null,
});

// ── Animated image ────────────────────────────────────────────────────────────

export const PROTO_ATTACHMENT_ANIMATED_IMAGE = Object.freeze({
  type: AttachmentType.ANIMATED_IMAGE,
  ID: '',
  filename: '',
  previewUrl: '',
  previewWidth: 0,
  previewHeight: 0,
  /** URL of the animated GIF / WebP. */
  url: '',
  width: 0,
  height: 0,
  name: '',
  facebookUrl: '',
  thumbnailUrl: '',
  mimeType: '',
  rawGifImage: '',
  /** May be null for older attachments that only have GIF. */
  rawWebpImage: null as string | null,
  animatedGifUrl: '',
  animatedGifPreviewUrl: '',
  animatedWebpUrl: '',
  animatedWebpPreviewUrl: '',
});

// ── Share / link preview ──────────────────────────────────────────────────────

export const PROTO_ATTACHMENT_SHARE = Object.freeze({
  type: AttachmentType.SHARE,
  ID: '',
  url: '',
  title: '',
  description: '',
  /** Originating domain / publication name; null when absent. */
  source: null as string | null,
  /** Static preview image URI; null when absent. */
  image: null as string | null,
  width: 0,
  height: 0,
  playable: false,
  duration: 0,
  subattachments: [] as unknown[],
  /** Flat key-value map of story attachment properties. */
  properties: {} as Record<string, unknown>,
  animatedImageSize: null as number | null,
  facebookUrl: '',
  target: null as unknown,
  styleList: [] as string[],
  /** Direct playable URL; null for non-video shares. */
  playableUrl: null as string | null,
});

// ── Location ─────────────────────────────────────────────────────────────────

export const PROTO_ATTACHMENT_LOCATION = Object.freeze({
  type: AttachmentType.LOCATION,
  ID: '',
  /** null when coordinates could not be parsed from the URL. */
  latitude: null as number | null,
  longitude: null as number | null,
  /** Static map image URI; null when unavailable. */
  image: null as string | null,
  width: null as number | null,
  height: null as number | null,
  url: '',
  address: '',
  facebookUrl: '',
  target: null as unknown,
  styleList: [] as string[],
});

// ── Error (unclassified attachment) ──────────────────────────────────────────

export const PROTO_ATTACHMENT_ERROR = Object.freeze({
  type: AttachmentType.ERROR,
  /** Raw attachment1 payload from _formatAttachment(); use for debugging. */
  attachment1: null as unknown,
  attachment2: null as unknown,
});

// ── Unknown (formatting threw) ────────────────────────────────────────────────

export const PROTO_ATTACHMENT_UNKNOWN = Object.freeze({
  type: AttachmentType.UNKNOWN,
  /** The exception thrown by _formatAttachment(). */
  error: null as unknown,
});
