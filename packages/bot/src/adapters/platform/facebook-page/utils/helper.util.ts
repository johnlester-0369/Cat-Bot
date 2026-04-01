/**
 * Facebook Page — Event & Attachment Utilities
 *
 * Contains all transformation logic for converting raw Graph API webhook
 * payloads into the unified event contract. Separated from the class shell
 * so attachment mappers and the event normaliser can be tested independently
 * without constructing a FbPageApi instance.
 *
 * Exports:
 *   mapAttachment            — webhook push attachment → fca-unofficial shape
 *   mapGetApiAttachment      — GET /message attachment → fca-unofficial shape
 *   normalizeFbPageEvent     — top-level webhook messaging → UnifiedMessageEvent shape
 *   normalizeFbPageReactionEvent — reaction webhook → unified message_reaction shape
 */

import { Platforms } from '@/constants/platform.constants.js';

// ── Attachment types ──────────────────────────────────────────────────────────

interface WebhookAttachment {
  type: string;
  payload?: Record<string, unknown>;
}

interface GetApiAttachment {
  id?: string;
  mime_type?: string;
  name?: string;
  image_data?: {
    url?: string;
    preview_url?: string;
    width?: number;
    height?: number;
    max_width?: number;
    max_height?: number;
    render_as_sticker?: boolean;
  };
  file_url?: string;
}

// ── Webhook push attachment mapper ───────────────────────────────────────────

/**
 * Maps a single Facebook Graph API webhook attachment to the fca-unofficial
 * event shape. Graph API only exposes payload.url for binary assets — sub-fields
 * like thumbnailUrl and spriteUrl are Messenger-internal and unavailable via the
 * Page webhook.
 * Reference: developers.facebook.com/docs/messenger-platform/reference/webhook-events/messages
 */
export function mapAttachment(
  attachment: WebhookAttachment,
): Record<string, unknown> {
  const { type, payload = {} } = attachment;

  switch (type) {
    case 'image':
      return {
        type: 'photo',
        ID: payload['attachment_id'] ?? null,
        url: payload['url'] ?? null,
        thumbnailUrl: payload['url'] ?? null,
        previewUrl: payload['url'] ?? null,
        previewWidth: null,
        previewHeight: null,
        largePreviewUrl: payload['url'] ?? null,
        largePreviewWidth: null,
        largePreviewHeight: null,
        filename: null,
      };

    case 'audio':
      return {
        type: 'audio',
        ID: payload['attachment_id'] ?? null,
        url: payload['url'] ?? null,
        filename: null,
      };

    case 'video':
      return {
        type: 'video',
        ID: payload['attachment_id'] ?? null,
        url: payload['url'] ?? null,
        title: null,
        description: null,
        duration: null,
        playable: true,
        playableUrl: payload['url'] ?? null,
      };

    case 'file':
      return {
        type: 'file',
        ID: payload['attachment_id'] ?? null,
        url: payload['url'] ?? null,
        filename: null,
      };

    case 'sticker':
      return {
        type: 'sticker',
        ID: String(payload['sticker_id'] ?? ''),
        url: payload['url'] ?? null,
        packID: null,
        spriteUrl: null,
        spriteUrl2x: null,
        width: null,
        height: null,
        caption: null,
        description: null,
        frameCount: null,
        frameRate: null,
        framesPerRow: null,
        framesPerCol: null,
      };

    case 'location': {
      const coords = payload['coordinates'] as
        | { lat?: number; long?: number }
        | undefined;
      return {
        type: 'location',
        latitude: coords?.lat ?? null,
        longitude: coords?.long ?? null,
      };
    }

    default:
      return {
        type: type || 'unknown',
        ID: payload['attachment_id'] ?? null,
        url: payload['url'] ?? null,
        title: payload['title'] ?? null,
        description: null,
      };
  }
}

// ── GET /message attachment mapper ───────────────────────────────────────────

/**
 * Maps a single attachment from the Graph API GET /{message-id}?fields=attachments
 * response. This shape is completely different from the webhook push shape:
 *   - No `type` enum; type is derived from `mime_type` (e.g. "image/jpeg", "audio/ogg")
 *   - Image data lives in `image_data.url` / `image_data.preview_url`
 *   - Non-image binary files use `file_url` instead of a nested payload object
 */
export function mapGetApiAttachment(
  att: GetApiAttachment,
): Record<string, unknown> {
  const mime = (att.mime_type ?? '').toLowerCase();

  if (mime.startsWith('image/')) {
    const img = att.image_data ?? {};
    if (img.render_as_sticker) {
      return {
        type: 'sticker',
        ID: att.id ?? null,
        url: img.url ?? null,
        packID: null,
        spriteUrl: null,
        spriteUrl2x: null,
        width: img.max_width ?? null,
        height: img.max_height ?? null,
        caption: null,
        description: null,
        frameCount: null,
        frameRate: null,
        framesPerRow: null,
        framesPerCol: null,
      };
    }
    return {
      type: 'photo',
      ID: att.id ?? null,
      url: img.url ?? null,
      filename: att.name ?? null,
      thumbnailUrl: img.preview_url ?? img.url ?? null,
      previewUrl: img.preview_url ?? img.url ?? null,
      previewWidth: img.width ?? null,
      previewHeight: img.height ?? null,
      largePreviewUrl: img.url ?? null,
      largePreviewWidth: img.max_width ?? null,
      largePreviewHeight: img.max_height ?? null,
    };
  }

  if (mime.startsWith('audio/')) {
    return {
      type: 'audio',
      ID: att.id ?? null,
      url: att.file_url ?? null,
      filename: att.name ?? null,
    };
  }

  if (mime.startsWith('video/')) {
    return {
      type: 'video',
      ID: att.id ?? null,
      url: att.file_url ?? null,
      filename: att.name ?? null,
      playable: true,
      playableUrl: att.file_url ?? null,
      duration: null,
      title: null,
      description: null,
    };
  }

  return {
    type: 'file',
    ID: att.id ?? null,
    url: att.file_url ?? null,
    filename: att.name ?? null,
  };
}

// ── Event normaliser ─────────────────────────────────────────────────────────

interface WebhookSender {
  id: string;
}

interface WebhookMessage {
  text?: string;
  mid?: string;
  timestamp?: number;
  attachments?: WebhookAttachment[];
  reply_to?: { mid?: string };
  is_echo?: boolean;
}

export interface MessageReplyData {
  messageID: string;
  body?: string | null;
  attachments?: { data: GetApiAttachment[] } | null;
  from?: { id: string; name?: string } | null;
  createdTime?: string | null;
}

/**
 * Normalises a Facebook Page webhook messaging object into the unified message event shape.
 * messageReply is pre-fetched by index.ts (GET /{message-id}) so this function
 * performs no async I/O and remains a pure transformation.
 */
export function normalizeFbPageEvent(
  sender: WebhookSender,
  message: WebhookMessage,
  messageReply: MessageReplyData | null,
): Record<string, unknown> {
  const msgBody = message.text ?? '';
  const rawAttachments = Array.isArray(message.attachments)
    ? message.attachments
    : [];

  return {
    platform: Platforms.FacebookPage,
    threadID: sender.id,
    senderID: sender.id,
    message: msgBody,
    messageID: message.mid,
    args: msgBody.trim().split(/\s+/).filter(Boolean),
    attachments: rawAttachments.map(mapAttachment),
    isGroup: false, // Page Messenger is always 1:1
    mentions: {},
    timestamp: message.timestamp ?? Date.now(),
    messageReply: messageReply
      ? (() => {
          // index.ts pre-fetches the replied message; build full PROTO_REPLIED_MESSAGE from available Graph API fields
          const replyBody = messageReply.body ?? '';
          return {
            threadID: sender.id, // Page Messenger is always 1:1 — sender PSID doubles as threadID
            messageID: messageReply.messageID,
            senderID: messageReply.from?.id ?? '',
            // Replied message attachments come from GET /{message-id} — use the GET-API mapper
            attachments: Array.isArray(messageReply.attachments?.data)
              ? messageReply.attachments!.data.map(mapGetApiAttachment)
              : [],
            args: replyBody.trim().split(/\s+/).filter(Boolean),
            message: replyBody || null,
            isGroup: false,
            mentions: {},
            // createdTime is ISO 8601 from Graph API — convert to epoch ms to match fca-unofficial convention
            timestamp: messageReply.createdTime
              ? new Date(messageReply.createdTime).getTime()
              : null,
          };
        })()
      : null,
  };
}

// ── Reaction event normaliser ─────────────────────────────────────────────────

interface ReactionWebhookPayload {
  reaction?: string;
  emoji?: string;
  action?: 'react' | 'unreact';
  mid?: string;
}

interface ReactionMessaging {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  reaction?: ReactionWebhookPayload;
}

/**
 * Normalises a Facebook Page message_reactions webhook event into the unified
 * message_reaction shape. Subscribe to 'message_reactions' in the Meta App Dashboard
 * webhook configuration to receive these events.
 */
export function normalizeFbPageReactionEvent(
  messaging: ReactionMessaging,
  originalSenderID = '',
): Record<string, unknown> {
  const r = messaging.reaction ?? {};
  return {
    type: 'message_reaction',
    platform: Platforms.FacebookPage,
    // Page Messenger is always 1:1 — the sender PSID doubles as the threadID
    threadID: messaging.sender?.id ?? '',
    messageID: r.mid ?? '', // the message that was reacted to
    reaction: r.emoji ?? r.reaction ?? '', // prefer UTF-8 emoji; fall back to text label
    // originalSenderID is the author of the reacted-to message, resolved by index.ts before this call
    senderID: originalSenderID,
    userID: messaging.sender?.id ?? '', // PSID of the person who added the reaction
    timestamp: messaging.timestamp ?? null,
    // fca-unofficial MQTT field required by PROTO_EVENT_MESSAGE_REACTION — Page webhook has no equivalent
    offlineThreadingID: '',
  };
}
