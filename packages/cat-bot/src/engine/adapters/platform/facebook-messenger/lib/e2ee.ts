/**
 * Facebook Messenger — E2EE (End-to-End Encrypted) Send Helpers
 *
 * Meta enabled E2EE by default for Messenger private chats, introducing a
 * parallel layer via FBClient that natively handles E2EE sessions.
 *
 * E2EEApiProxy wraps an existing UnifiedApi (the session-level FacebookApi)
 * for all non-send operations, while delegating the send surface directly to
 * the `FBClient` instance attached to the connection.
 */

import type { Readable } from 'stream';
import { UnifiedApi } from '@/engine/adapters/models/api.model.js';
import type {
  SendPayload,
  ReplyMessageOptions,
  EditMessageOptions,
} from '@/engine/adapters/models/api.model.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { urlToStream } from '../utils/index.js';
import { mdToText } from '@/engine/utils/md-to-text.util.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
type FBClient = any;
// ── Stream → Buffer conversion ─────────────────────────────────────────────────

/**
 * Drains a Readable stream into a single contiguous Buffer.
 * Required because FBClient E2EE media uploads accept only Buffer data.
 */
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise<Buffer>((resolve, reject) => {
    stream.on('data', (chunk: unknown) => {
      chunks.push(
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string),
      );
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', (err: Error) => reject(err));
  });
}

/**
 * Derives the FBClient E2EE media method name from a filename extension.
 * Falls back to 'sendFile' for unrecognised formats.
 */
function detectMediaMethod(
  name: string,
): 'sendImage' | 'sendVideo' | 'sendAudio' | 'sendFile' {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp'].includes(ext)) return 'sendImage';
  if (['mp4', 'mov', 'avi', 'webm', 'mkv', '3gp'].includes(ext))
    return 'sendVideo';
  if (['mp3', 'ogg', 'wav', 'm4a', 'aac', 'opus', 'flac'].includes(ext))
    return 'sendAudio';
  return 'sendFile';
}

// ── E2EE send primitives ───────────────────────────────────────────────────────

async function e2eeSendText(
  fbClient: FBClient,
  threadId: string,
  message: string,
  replyToId?: string,
): Promise<string | undefined> {
  const res = await fbClient.sendMessage({
    threadId,
    text: message,
    replyToMessageId: replyToId,
  });
  return res?.messageId as string | undefined;
}

async function e2eeSendMedia(
  fbClient: FBClient,
  threadId: string,
  buffer: Buffer,
  name: string,
  caption?: string,
  replyToId?: string,
): Promise<string | undefined> {
  const method = detectMediaMethod(name);

  const res = await fbClient[method]({
    threadId,
    data: buffer,
    fileName: name,
    caption,
    replyToMessageId: replyToId,
  });
  return res?.messageId as string | undefined;
}

// ── E2EEApiProxy ────────────────────────────────────────────────────────────────

/**
 * Per-event proxy that overrides the send surface of the regular FacebookApi
 * to use native FBClient E2EE methods. All other operations delegate to the wrapped base.
 */
export class E2EEApiProxy extends UnifiedApi {
  readonly #base: UnifiedApi;
  readonly #fbClient: FBClient;
  readonly #threadId: string;

  constructor(base: UnifiedApi, fbClient: FBClient, threadId: string) {
    super();
    this.platform = Platforms.FacebookMessenger;
    this.#base = base;
    this.#fbClient = fbClient;
    this.#threadId = threadId;
  }

  // ── E2EE send overrides ────────────────────────────────────────────────────────

  /**
   * Routes to fbClient.sendMessage (text) or media methods (first attachment wins).
   * Streams are converted to Buffer because E2EE native media requires Buffer input.
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
    const message =
      options.style === MessageStyle.MARKDOWN
        ? mdToText(rawMessage)
        : rawMessage;
    const replyToId = options.reply_to_message_id;
    const attachment = options.attachment ?? [];
    const attachment_url = options.attachment_url ?? [];

    if (attachment.length > 0) {
      const first = attachment[0];
      if (first === undefined) {
        return e2eeSendText(this.#fbClient, this.#threadId, message, replyToId);
      }
      const buf = Buffer.isBuffer(first.stream)
        ? first.stream
        : await streamToBuffer(first.stream as Readable);
      return e2eeSendMedia(
        this.#fbClient,
        this.#threadId,
        buf,
        first.name,
        message || undefined,
        replyToId,
      );
    }

    if (attachment_url.length > 0) {
      const first = attachment_url[0];
      if (first === undefined) {
        return e2eeSendText(this.#fbClient, this.#threadId, message, replyToId);
      }
      // Download URL attachment then convert to Buffer
      const readable = await urlToStream(first.url, first.name);
      const buf = await streamToBuffer(readable as Readable);
      return e2eeSendMedia(
        this.#fbClient,
        this.#threadId,
        buf,
        first.name,
        message || undefined,
        replyToId,
      );
    }

    return e2eeSendText(this.#fbClient, this.#threadId, message, replyToId);
  }

  override async sendMessage(
    msg: string | SendPayload,
    _threadID: string,
  ): Promise<string | undefined> {
    // Cast appropriately: styles may be implicitly bound on incoming unflattened payloads
    const payload = msg as SendPayload & { style?: string };
    const rawText = payload.message ?? payload.body ?? '';
    const text =
      payload.style === MessageStyle.MARKDOWN ? mdToText(rawText) : rawText;
    const attachment = Array.isArray(payload.attachment)
      ? payload.attachment
      : [];
    const attachment_url = payload.attachment_url ?? [];

    if (attachment.length > 0) {
      const first = attachment[0];
      if (first === undefined) {
        return e2eeSendText(this.#fbClient, this.#threadId, text);
      }
      const buf = Buffer.isBuffer(first.stream)
        ? first.stream
        : await streamToBuffer(first.stream as Readable);
      return e2eeSendMedia(
        this.#fbClient,
        this.#threadId,
        buf,
        first.name,
        text || undefined,
      );
    }

    if (attachment_url.length > 0) {
      const first = attachment_url[0];
      if (first === undefined) {
        return e2eeSendText(this.#fbClient, this.#threadId, text);
      }
      const readable = await urlToStream(first.url, first.name);
      const buf = await streamToBuffer(readable as Readable);
      return e2eeSendMedia(
        this.#fbClient,
        this.#threadId,
        buf,
        first.name,
        text || undefined,
      );
    }

    return e2eeSendText(this.#fbClient, this.#threadId, text);
  }

  override async editMessage(
    messageID: string,
    options: string | EditMessageOptions,
  ): Promise<void> {
    // FBClient native E2EE does not support message editing; safely fallback to standard message send
    await this.sendMessage(options as any, this.#threadId);
  }

  override async unsendMessage(messageID: string): Promise<void> {
    await this.#fbClient.unsendMessage(messageID, this.#threadId);
  }

  override async reactToMessage(
    threadID: string,
    messageID: string,
    emoji: string,
  ): Promise<void> {
    await this.#fbClient.sendReaction({
      threadId: this.#threadId,
      messageId: messageID,
      reaction: emoji,
    } as any);
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
