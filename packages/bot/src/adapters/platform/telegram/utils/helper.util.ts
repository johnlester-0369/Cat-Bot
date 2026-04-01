/**
 * Telegram — Event Normalisation Utilities
 *
 * Pure transformation functions that map raw Telegraf context objects into
 * the unified event contract. Separated from the class shell so normalizers
 * can be unit-tested by supplying a mock ctx without constructing a TelegramApi.
 *
 * Exports:
 *   normalizeTelegramEvent         — text message ctx → UnifiedMessageEvent
 *   normalizeNewChatMembersEvent   — new_chat_members ctx → log:subscribe event
 *   normalizeLeftChatMemberEvent   — left_chat_member ctx → log:unsubscribe event
 *   normalizeTelegramReactionEvent — message_reaction ctx → unified reaction event
 *   resolveAttachmentUrls          — resolves file_id → CDN URL in-place
 *   buildTelegramMentionEntities   — builds Bot API text_mention entity array
 */
import type { Context } from 'telegraf';
import { Platforms } from '@/constants/platform.constants.js';
import type { Message, MessageEntity, PhotoSize } from 'telegraf/types';
import type { MentionEntry } from '@/adapters/models/api.model.js';

// ── Attachment shape used before CDN URL resolution ────────────────────────────

export interface TelegramAttachment {
  type: string;
  ID: string;
  url: string | null;
}

// ── Attachment extractor ──────────────────────────────────────────────────────

/**
 * Derives a flat attachments array from a raw Telegram Bot API message object.
 * Telegram does not expose direct CDN URLs without a getFile() round-trip — file_id
 * is stored as ID so command modules can resolve the URL via ctx.telegram.getFile(ID)
 * when they actually need to download the asset.
 */
function extractAttachments(
  msg: Message | null | undefined,
): TelegramAttachment[] {
  if (!msg) return [];
  const atts: TelegramAttachment[] = [];

  if ('photo' in msg && msg.photo?.length) {
    // Telegram sends multiple PhotoSize resolutions — the last entry is the highest resolution
    const p = msg.photo[msg.photo.length - 1] as PhotoSize;
    atts.push({ type: 'photo', ID: p.file_id, url: null });
  }
  if ('video' in msg && msg.video) {
    atts.push({ type: 'video', ID: msg.video.file_id, url: null });
  }
  if ('animation' in msg && msg.animation) {
    atts.push({ type: 'gif', ID: msg.animation.file_id, url: null });
  }
  if ('audio' in msg && msg.audio) {
    atts.push({ type: 'audio', ID: msg.audio.file_id, url: null });
  }
  if ('voice' in msg && msg.voice) {
    atts.push({ type: 'audio', ID: msg.voice.file_id, url: null });
  }
  if ('document' in msg && msg.document) {
    atts.push({ type: 'file', ID: msg.document.file_id, url: null });
  }
  if ('sticker' in msg && msg.sticker) {
    atts.push({ type: 'sticker', ID: msg.sticker.file_id, url: null });
  }
  if ('video_note' in msg && msg.video_note) {
    atts.push({ type: 'video', ID: msg.video_note.file_id, url: null });
  }

  return atts;
}

// ── Text message normaliser ───────────────────────────────────────────────────

/**
 * Maps a Telegraf text-message context into UnifiedMessageEvent.
 * messageReply is derived from ctx.message.reply_to_message (Telegram pushes
 * the replied-to message inline — no extra API call needed).
 */
export function normalizeTelegramEvent(
  ctx: Context,
  args: string[],
): Record<string, unknown> {
  const msg = ctx.message as
    | (Message & { reply_to_message?: Message })
    | undefined;
  const chatType = ctx.chat?.type;
  const isGroup = chatType === 'group' || chatType === 'supergroup';

  let messageReply: Record<string, unknown> | null = null;

  if (msg?.reply_to_message) {
    const r = msg.reply_to_message;
    // Telegram delivers reply_to_message inline — extract as much of PROTO_REPLIED_MESSAGE as the Bot API provides
    const replyBody =
      ('text' in r ? r.text : undefined) ||
      ('caption' in r ? r.caption : undefined) ||
      '';
    messageReply = {
      threadID: String(ctx.chat?.id ?? ''), // same thread — Bot API always delivers reply in parent chat
      messageID: String(r.message_id),
      senderID: String(r.from?.id ?? ''), // from absent on anonymous channel posts
      attachments: extractAttachments(r),
      args: (replyBody ?? '').trim().split(/\s+/).filter(Boolean),
      message: replyBody ?? null,
      isGroup,
      mentions: {},
    };
  }

  const body =
    ('text' in (msg ?? {}) ? (msg as Message.TextMessage).text : undefined) ||
    ('caption' in (msg ?? {})
      ? (msg as Message.CaptionableMessage).caption
      : undefined) ||
    '';

  return {
    // Emit 'message_reply' when user tapped "Reply" so handler and command modules can distinguish
    type: msg?.reply_to_message ? 'message_reply' : 'message',
    platform: Platforms.Telegram,
    threadID: String(ctx.chat?.id ?? ''),
    senderID: String(ctx.from?.id ?? ''),
    // Media messages carry text in .caption, not .text — fall back so commands always have a body to parse
    message: body,
    messageID: String(msg?.message_id ?? ''),
    args,
    attachments: extractAttachments(msg),
    isGroup,
    // Extract Telegram @mention entities into { [userId|username]: mentionText } fca contract shape
    mentions: (() => {
      const result: Record<string, string> = {};
      const allEnts: MessageEntity[] = [
        ...((msg as Message.TextMessage | undefined)?.entities ?? []),
        ...((msg as Message.CaptionableMessage | undefined)?.caption_entities ??
          []),
      ];
      for (const ent of allEnts) {
        if (ent.type === 'mention') {
          const handle = body.slice(ent.offset, ent.offset + ent.length);
          result[handle] = handle;
        } else if (ent.type === 'text_mention' && ent.user) {
          result[String(ent.user.id)] =
            ent.user.first_name || String(ent.user.id);
        }
      }
      return result;
    })(),
    timestamp: msg?.date ? msg.date * 1000 : null, // Telegram date is Unix seconds; multiply for ms to match fca contract
    messageReply,
  };
}

// ── Join event normaliser ─────────────────────────────────────────────────────

/**
 * Normalises a Telegram new_chat_members update into the fca-unofficial
 * EventType.EVENT shape with logMessageType 'log:subscribe'.
 * Bots are filtered out — only human member joins trigger the handler.
 */
export function normalizeNewChatMembersEvent(
  ctx: Context,
): Record<string, unknown> {
  const newMembers =
    (
      ctx.message as
        | (Message & {
            new_chat_members?: Array<{
              id: number;
              is_bot: boolean;
              first_name?: string;
              last_name?: string;
              username?: string;
            }>;
          })
        | undefined
    )?.new_chat_members ?? [];

  const addedParticipants = newMembers
    .filter((m) => !m.is_bot)
    .map((m) => ({
      // userFbId maps to fca's concept of the joining user's ID
      userFbId: String(m.id),
      firstName: m.first_name || '',
      fullName:
        `${m.first_name || ''} ${m.last_name || ''}`.trim() ||
        m.username ||
        String(m.id),
      groupJoinStatus: 'MEMBER',
      initialFolder: 'FOLDER_INBOX',
      initialFolderId: { systemFolderId: 'INBOX' },
      isMessengerUser: false,
      fanoutPolicy: '',
      lastUnsubscribeTimestampMs: '',
    }));

  const names = addedParticipants.map((p) => p.fullName).join(', ');

  return {
    type: 'event',
    platform: Platforms.Telegram,
    threadID: String(ctx.chat?.id ?? ''),
    logMessageType: 'log:subscribe',
    logMessageData: { addedParticipants },
    logMessageBody: names ? `${names} joined the group.` : '',
    // Telegram new_chat_members does not expose who added the member
    author: '',
  };
}

// ── Leave event normaliser ────────────────────────────────────────────────────

/**
 * Normalises a Telegram left_chat_member update into the fca-unofficial
 * EventType.EVENT shape with logMessageType 'log:unsubscribe'.
 * Does not distinguish kick vs voluntary leave — the Bot API does not surface
 * that distinction at the basic event level.
 */
export function normalizeLeftChatMemberEvent(
  ctx: Context,
): Record<string, unknown> {
  const m = (
    ctx.message as
      | (Message & {
          left_chat_member?: {
            id?: number;
            first_name?: string;
            last_name?: string;
            username?: string;
          };
        })
      | undefined
  )?.left_chat_member;

  const fullName =
    `${m?.first_name || ''} ${m?.last_name || ''}`.trim() ||
    m?.username ||
    String(m?.id ?? '');

  return {
    type: 'event',
    platform: Platforms.Telegram,
    threadID: String(ctx.chat?.id ?? ''),
    logMessageType: 'log:unsubscribe',
    logMessageData: { leftParticipantFbId: String(m?.id ?? '') },
    logMessageBody: `${fullName} left the group.`,
    // Telegram left_chat_member does not distinguish kick vs voluntary leave
    author: '',
  };
}

// ── Reaction event normaliser ─────────────────────────────────────────────────

/**
 * Normalises a Telegram message_reaction update into the unified message_reaction shape.
 * Bot API 7.0+ delivers these updates only when:
 *   1. The bot is a GROUP ADMINISTRATOR in the chat
 *   2. 'message_reaction' is explicitly listed in allowedUpdates for bot.launch()
 */
export function normalizeTelegramReactionEvent(
  ctx: Context,
): Record<string, unknown> {
  // message_reaction is a non-standard update type — access via raw update object
  const mr = (ctx.update as unknown as Record<string, unknown>)[
    'message_reaction'
  ] as {
    chat: { id: number };
    message_id: number;
    user?: { id: number };
    actor_chat?: { id: number };
    date?: number;
    new_reaction?: Array<{
      type: string;
      emoji?: string;
      custom_emoji_id?: string;
    }>;
    old_reaction?: Array<{
      type: string;
      emoji?: string;
      custom_emoji_id?: string;
    }>;
  };

  // Extract the primary emoji: prefer new_reaction (react action) else old_reaction (unreact)
  const reactionEntry = mr.new_reaction?.[0] ?? mr.old_reaction?.[0];
  const reactionEmoji =
    reactionEntry?.emoji ?? reactionEntry?.custom_emoji_id ?? '';

  return {
    type: 'message_reaction',
    platform: Platforms.Telegram,
    threadID: String(mr.chat.id),
    messageID: String(mr.message_id),
    reaction: reactionEmoji,
    // Telegram Bot API does not include the original message author in MessageReactionUpdated.
    // Resolving it would require a separate getChatHistory call — left empty per API limitation.
    senderID: '',
    // user is present for named reactions; actor_chat is used for anonymous (channel) reactions
    userID: String(mr.user?.id ?? mr.actor_chat?.id ?? ''),
    timestamp: mr.date ? mr.date * 1000 : null, // Bot API 7.0 message_reaction update carries date (Unix seconds)
    // fca-unofficial MQTT field required by PROTO_EVENT_MESSAGE_REACTION — Telegram has no equivalent
    offlineThreadingID: '',
  };
}

// ── File URL resolver ─────────────────────────────────────────────────────────

/**
 * Resolves Telegram file_id → CDN download URL for every attachment in the array.
 * Mutates each entry in-place: url stays null on non-fatal failures (expired file,
 * file > 20 MB Bot API limit, or transient network error) so callers can always
 * safely read att.url without additional null-guards beyond what they already have.
 *
 * Fires all getFileLink requests in parallel — typical message has 0–1 attachments
 * so Promise.all overhead is negligible versus sequential await.
 */
export async function resolveAttachmentUrls(
  attachments: TelegramAttachment[],
  telegram: Context['telegram'],
): Promise<void> {
  await Promise.all(
    attachments
      .filter((a) => a.ID && a.url === null)
      .map(async (a) => {
        try {
          const link = await telegram.getFileLink(a.ID);
          // Telegraf v4 getFileLink returns a URL object, not a plain string
          a.url = typeof link === 'string' ? link : link.href;
        } catch {
          // File > 20 MB or expired — leave url: null so downstream code handles gracefully
        }
      }),
  );
}

// ── Mention entity builder ────────────────────────────────────────────────────

/**
 * Converts the unified mentions array into a Telegram Bot API entities array using
 * the 'text_mention' entity type. text_mention tags users by their numeric ID without
 * requiring them to have a public @username — the Telegram client renders it as a
 * highlighted, tappable name linked to the user's profile.
 *
 * All occurrences of each tag string are indexed so repeated mentions in the same message
 * (e.g. "Hey @User, @User called") each generate their own correctly-offset entity.
 */
export function buildTelegramMentionEntities(
  text: string,
  mentions: MentionEntry[] = [],
): Array<{
  type: 'text_mention';
  offset: number;
  length: number;
  user: { id: number; is_bot: boolean; first_name: string };
}> {
  const entities: Array<{
    type: 'text_mention';
    offset: number;
    length: number;
    user: { id: number; is_bot: boolean; first_name: string };
  }> = [];

  for (const { tag, user_id } of mentions) {
    let searchFrom = 0;
    // indexOf loop finds every occurrence — fca-unofficial uses fromIndex for the same reason
    while (searchFrom < text.length) {
      const idx = text.indexOf(tag, searchFrom);
      if (idx === -1) break;
      entities.push({
        type: 'text_mention',
        offset: idx,
        length: tag.length,
        user: { id: Number(user_id), is_bot: false, first_name: tag },
      });
      searchFrom = idx + tag.length; // advance past this occurrence to avoid re-matching
    }
  }

  return entities;
}
