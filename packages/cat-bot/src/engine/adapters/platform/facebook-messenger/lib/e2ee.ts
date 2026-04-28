/**
 * Facebook Messenger — E2EE (End-to-End Encrypted) Send Helpers
 *
 * Meta enabled E2EE by default for Messenger private chats, introducing a
 * parallel set of fca-unofficial API methods that require chatJid format
 * ("{numericThreadID}@msgr") instead of the plain numeric threadID, and
 * that accept Buffer data instead of streaming uploads.
 *
 * E2EEApiProxy wraps an existing UnifiedApi (the session-level FacebookApi)
 * for all non-send operations (getUserInfo, getFullThreadInfo, etc.) and
 * overrides only the send surface to route through E2EE-specific methods.
 * It is created per-event in event-router.ts and discarded after emission —
 * no shared mutable state.
 */

import type { Readable } from 'stream';
import { UnifiedApi } from '@/engine/adapters/models/api.model.js';
import type {
  SendPayload,
  ReplyMessageOptions,
} from '@/engine/adapters/models/api.model.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import type { FcaApi } from '../types.js';
import { urlToStream } from '../utils/index.js';
import { mdToText } from '@/engine/utils/md-to-text.util.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
// ── Stream → Buffer conversion ─────────────────────────────────────────────────

/**
 * Drains a Readable stream into a single contiguous Buffer.
 * Required because sendMediaE2EE accepts only Buffer data — unlike the regular
 * fca sendMessage path which pipes streams directly to the Graph API.
 */
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise<Buffer>((resolve, reject) => {
    stream.on('data', (chunk: unknown) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', (err: Error) => reject(err));
  });
}

// ── Media type detection ───────────────────────────────────────────────────────

type E2EEMediaType = 'image' | 'video' | 'audio' | 'document' | 'sticker';

/**
 * Derives the sendMediaE2EE mediaType string from a filename extension.
 * Falls back to 'document' for any unrecognised extension so uploads never
 * fail silently with an unsupported type string from the fca layer.
 */
function detectMediaType(name: string): E2EEMediaType {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp'].includes(ext)) return 'image';
  // WebP is the WhatsApp-compatible animated sticker format used by Messenger
  if (ext === 'webp') return 'sticker';
  if (['mp4', 'mov', 'avi', 'webm', 'mkv', '3gp'].includes(ext)) return 'video';
  if (['mp3', 'ogg', 'wav', 'm4a', 'aac', 'opus', 'flac'].includes(ext)) return 'audio';
  return 'document';
}

// ── E2EE send primitives ───────────────────────────────────────────────────────

async function e2eeSendText(
  api: FcaApi,
  chatJid: string,
  message: string,
  replyToId?: string,
): Promise<string | undefined> {
  return new Promise<string | undefined>((resolve, reject) => {
    api.sendMessageE2EE(
      chatJid,
      { body: message, ...(replyToId !== undefined ? { replyToId } : {}) },
      (err, info) => (err ? reject(err) : resolve(info?.messageID)),
    );
  });
}

async function e2eeSendMedia(
  api: FcaApi,
  chatJid: string,
  buffer: Buffer,
  name: string,
  caption?: string,
  replyToId?: string,
): Promise<string | undefined> {
  const mediaType = detectMediaType(name);
  return new Promise<string | undefined>((resolve, reject) => {
    api.sendMediaE2EE(
      chatJid,
      mediaType,
      buffer,
      {
        ...(caption !== undefined ? { caption } : {}),
        ...(replyToId !== undefined ? { replyToId } : {}),
      },
      (err, info) => (err ? reject(err) : resolve(info?.messageID)),
    );
  });
}

// ── E2EEApiProxy ────────────────────────────────────────────────────────────────

/**
 * Per-event proxy that overrides the send surface of the regular FacebookApi
 * to use E2EE fca methods. All other operations delegate to the wrapped base.
 */
export class E2EEApiProxy extends UnifiedApi {
  readonly #base: UnifiedApi;
  readonly #api: FcaApi;
  readonly #chatJid: string;

  constructor(base: UnifiedApi, api: FcaApi, chatJid: string) {
    super();
    this.platform = Platforms.FacebookMessenger;
    this.#base = base;
    this.#api = api;
    this.#chatJid = chatJid;
  }

  // ── E2EE send overrides ────────────────────────────────────────────────────────

  /**
   * Routes to sendMessageE2EE (text) or sendMediaE2EE (first attachment wins).
   * Streams are converted to Buffer because sendMediaE2EE requires Buffer input.
   * E2EE does not support multi-file sends — only the first attachment is transmitted.
   */
  override async replyMessage(
    _threadID: string,
    options: ReplyMessageOptions = {},
  ): Promise<unknown> {
    const rawMessage =
      typeof options.message === 'string'
        ? options.message
        : ((options.message as SendPayload | undefined)?.message ?? '');
    // Mirror standard replyMessage capabilities: parse and apply Unicode markdown fonts if specified
    const message = options.style === MessageStyle.MARKDOWN ? mdToText(rawMessage) : rawMessage;
    const replyToId = options.reply_to_message_id;
    const attachment = options.attachment ?? [];
    const attachment_url = options.attachment_url ?? [];

    if (attachment.length > 0) {
      const first = attachment[0];
      if (first === undefined) {
        return e2eeSendText(this.#api, this.#chatJid, message, replyToId);
      }
      const buf = Buffer.isBuffer(first.stream)
        ? first.stream
        : await streamToBuffer(first.stream as Readable);
      return e2eeSendMedia(
        this.#api,
        this.#chatJid,
        buf,
        first.name,
        message || undefined,
        replyToId,
      );
    }

    if (attachment_url.length > 0) {
      const first = attachment_url[0];
      if (first === undefined) {
        return e2eeSendText(this.#api, this.#chatJid, message, replyToId);
      }
      // Download URL attachment then convert to Buffer — E2EE API requires Buffer, not a stream
      const readable = await urlToStream(first.url, first.name);
      const buf = await streamToBuffer(readable as Readable);
      return e2eeSendMedia(
        this.#api,
        this.#chatJid,
        buf,
        first.name,
        message || undefined,
        replyToId,
      );
    }

    return e2eeSendText(this.#api, this.#chatJid, message, replyToId);
  }

  override async sendMessage(
    msg: string | SendPayload,
    _threadID: string,
  ): Promise<string | undefined> {
    if (typeof msg === 'string') {
      return e2eeSendText(this.#api, this.#chatJid, msg);
    }
    
    // Cast appropriately: styles may be implicitly bound on incoming unflattened payloads
    const payload = msg as SendPayload & { style?: string };
    const rawText = payload.message ?? payload.body ?? '';
    const text = payload.style === MessageStyle.MARKDOWN ? mdToText(rawText) : rawText;
    const attachment = Array.isArray(payload.attachment) ? payload.attachment : [];
    const attachment_url = payload.attachment_url ?? [];

    if (attachment.length > 0) {
      const first = attachment[0];
      if (first === undefined) {
        return e2eeSendText(this.#api, this.#chatJid, text);
      }
      const buf = Buffer.isBuffer(first.stream)
        ? first.stream
        : await streamToBuffer(first.stream as Readable);
      return e2eeSendMedia(
        this.#api,
        this.#chatJid,
        buf,
        first.name,
        text || undefined,
      );
    }

    if (attachment_url.length > 0) {
      const first = attachment_url[0];
      if (first === undefined) {
        return e2eeSendText(this.#api, this.#chatJid, text);
      }
      const readable = await urlToStream(first.url, first.name);
      const buf = await streamToBuffer(readable as Readable);
      return e2eeSendMedia(
        this.#api,
        this.#chatJid,
        buf,
        first.name,
        text || undefined,
      );
    }

    return e2eeSendText(this.#api, this.#chatJid, text);
  }

  override unsendMessage(messageID: string): Promise<void> {
    // unsendMessageE2EE requires chatJid, not plain threadID
    return new Promise<void>((resolve, reject) => {
      this.#api.unsendMessageE2EE(this.#chatJid, messageID, (err) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  // ── Delegated operations — non-send methods ────────────────────────────────────

  override getUserInfo(userIds: string[]) {
    return this.#base.getUserInfo(userIds);
  }
  override getBotID() {
    return this.#base.getBotID();
  }
  override getFullThreadInfo(threadID: string) {
    return this.#base.getFullThreadInfo(threadID);
  }
  override getFullUserInfo(userID: string) {
    return this.#base.getFullUserInfo(userID);
  }
  override getUserName(userID: string) {
    return this.#base.getUserName(userID);
  }
  override getThreadName(threadID: string) {
    return this.#base.getThreadName(threadID);
  }
  override getAvatarUrl(userID: string) {
    return this.#base.getAvatarUrl(userID);
  }
  override reactToMessage(threadID: string, messageID: string, emoji: string) {
    return this.#base.reactToMessage(threadID, messageID, emoji);
  }
  override setGroupName(threadID: string, name: string) {
    return this.#base.setGroupName(threadID, name);
  }
  override setGroupImage(
    threadID: string,
    imageSource: Buffer | Readable | string,
  ) {
    return this.#base.setGroupImage(threadID, imageSource);
  }
  override removeGroupImage(threadID: string) {
    return this.#base.removeGroupImage(threadID);
  }
  override addUserToGroup(threadID: string, userID: string) {
    return this.#base.addUserToGroup(threadID, userID);
  }
  override removeUserFromGroup(threadID: string, userID: string) {
    return this.#base.removeUserFromGroup(threadID, userID);
  }
  override setGroupReaction(threadID: string, emoji: string) {
    return this.#base.setGroupReaction(threadID, emoji);
  }
  override setNickname(threadID: string, userID: string, nickname: string) {
    return this.#base.setNickname(threadID, userID, nickname);
  }
}
