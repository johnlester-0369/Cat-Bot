/**
 * Telegram — Telegraf Handler Registrations
 *
 * Registers all Telegraf update handlers that emit unified events on the
 * platform emitter. Each handler normalizes its raw Telegram context into
 * the unified event contract before emitting.
 *
 * Separated from listener.ts because handlers are the most frequently modified
 * concern (adding new event types, adjusting normalisation) and benefit from
 * being independently testable without constructing the full listener factory.
 *
 * Handlers attached:
 *   'message'           → emit 'message' or 'message_reply'
 *   'new_chat_members'  → emit 'event' (log:subscribe)
 *   'left_chat_member'  → emit 'event' (log:unsubscribe)
 *   'message_reaction'  → emit 'message_reaction'
 *   'callback_query'    → emit 'button_action'
 */
import type { EventEmitter } from 'events';
import type { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import type { Message } from 'telegraf/types';
import { Platforms } from '@/constants/platform.constants.js';
import { createTelegramApi } from './wrapper.js';
import {
  normalizeTelegramEvent,
  normalizeNewChatMembersEvent,
  normalizeLeftChatMemberEvent,
  normalizeTelegramReactionEvent,
  resolveAttachmentUrls,
} from './utils/helper.util.js';

/**
 * Attaches all Telegraf update handlers to the given bot instance.
 * Each handler normalizes its context and emits a typed event on the emitter.
 *
 * IMPORTANT: Must be called BEFORE bot.launch() per Telegraf documentation.
 */
export function attachHandlers(
  bot: Telegraf,
  emitter: EventEmitter,
  prefix: string,
  userId: string,
  sessionId: string,
): void {
  // ── Message handler → emit 'message' or 'message_reply' ──────────────────
  // Bare 'message' update type catches ALL Telegram message kinds: text, photo,
  // video, audio, document, sticker, voice, video_note, animation. The previous
  // message('text') filter silently dropped every attachment-only message.
  bot.on('message', async (ctx) => {
    const msg = ctx.message as Message & {
      new_chat_members?: unknown[];
      left_chat_member?: unknown;
      reply_to_message?: Message;
    };
    // Service messages (new_chat_members, left_chat_member) have dedicated handlers below;
    // returning here prevents them from being double-processed as regular messages.
    if (msg.new_chat_members || msg.left_chat_member) return;

    const rawText =
      ('text' in msg ? msg.text : undefined) ??
      ('caption' in msg ? msg.caption : undefined) ??
      '';
    const rawArgs = rawText.trim().split(/\s+/).filter(Boolean);
    const api = createTelegramApi(ctx);
    const event = normalizeTelegramEvent(ctx, rawArgs);

    // Resolve file_id → CDN URL for outer message and replied-to message attachments.
    // Telegram Bot API never embeds direct URLs — getFileLink() is the mandatory round-trip.
    // URLs are valid for ~1 hour per Bot API spec.
    await resolveAttachmentUrls(
      (event['attachments'] as Array<
        import('./utils/helper.util.js').TelegramAttachment
      >) ?? [],
      ctx.telegram,
    );
    const replyAtts = (
      event['messageReply'] as Record<string, unknown> | null
    )?.['attachments'] as Array<{ ID: string; url: string | null }> | undefined;
    if (replyAtts?.length) {
      await resolveAttachmentUrls(
        replyAtts as Array<import('./utils/helper.util.js').TelegramAttachment>,
        ctx.telegram,
      );
    }

    const native = { platform: Platforms.Telegram, userId, sessionId, ctx };
    // reply_to_message is set when the user taps "Reply" on an existing message
    const eventType = msg.reply_to_message ? 'message_reply' : 'message';
    emitter.emit(eventType, { api, event, native, prefix });
  });

  // ── Member join → emit 'event' (log:subscribe) ────────────────────────────
  bot.on(message('new_chat_members'), async (ctx) => {
    const api = createTelegramApi(ctx);
    const event = normalizeNewChatMembersEvent(ctx);
    const native = { platform: Platforms.Telegram, userId, sessionId, ctx };
    emitter.emit('event', { api, event, native, prefix });
  });

  // ── Member leave → emit 'event' (log:unsubscribe) ─────────────────────────
  bot.on(message('left_chat_member'), async (ctx) => {
    const api = createTelegramApi(ctx);
    const event = normalizeLeftChatMemberEvent(ctx);
    const native = { platform: Platforms.Telegram, userId, sessionId, ctx };
    emitter.emit('event', { api, event, native, prefix });
  });

  // ── Message reaction → emit 'message_reaction' ───────────────────────────
  // Requires: (1) 'message_reaction' in allowedUpdates below, AND
  //           (2) bot must be a GROUP ADMINISTRATOR — non-admin bots never receive
  //               reaction updates regardless of allowedUpdates setting.
  bot.on('message_reaction', async (ctx) => {
    const api = createTelegramApi(ctx);
    const event = normalizeTelegramReactionEvent(ctx);
    const native = { platform: Platforms.Telegram, userId, sessionId, ctx };
    emitter.emit('message_reaction', { api, event, native, prefix });
  });

  // ── Inline keyboard button press → emit 'button_action' ─────────────────────
  // callback_query fires when a user taps an InlineKeyboardButton sent with callback_data.
  // answerCbQuery() MUST be called to dismiss the loading spinner on the button — Telegram
  // will show an error to the user after ~10 s if the query is not answered.
  bot.on('callback_query', async (ctx) => {
    // Acknowledge first to remove the loading indicator before any async work
    await ctx.answerCbQuery();
    const api = createTelegramApi(ctx);
    const cbq = ctx.callbackQuery as {
      data?: string;
      message?: { chat: { id: number }; message_id: number };
      from: { id: number };
    };
    const event = {
      type: 'button_action',
      platform: Platforms.Telegram,
      actionId: cbq.data ?? '',
      threadID: String(cbq.message?.chat?.id ?? ''),
      senderID: String(cbq.from.id),
      messageID: String(cbq.message?.message_id ?? ''),
      timestamp: Date.now(),
    };
    const native = { platform: Platforms.Telegram, userId, sessionId, ctx };
    emitter.emit('button_action', { api, event, native, prefix });
  });
}
