/**
 * Facebook Page — Webhook Event Router
 *
 * Transforms raw Facebook Graph API webhook messaging objects into typed
 * unified events and emits them on the platform EventEmitter. Separated
 * from index.ts so the routing logic can be tested independently of the
 * listener lifecycle (Express server startup/shutdown).
 *
 * Routing order matters: reaction and postback checks MUST appear before
 * the `!message` guard because those webhook entries carry a 'reaction' or
 * 'postback' field instead of a 'message' field — a naive `!message` check
 * would silently drop them.
 *
 * Emitted event types:
 *   'message_reaction' — message_reactions webhook field
 *   'button_action'    — messaging_postbacks webhook field
 *   'message'          — standard messaging entry with text/attachments
 */

import type { EventEmitter } from 'events';
import type { PageApi } from './pageApi-types.js';
import { createFbPageApi } from './wrapper.js';
import {
  normalizeFbPageEvent,
  normalizeFbPageReactionEvent,
} from './utils/helper.util.js';
import type { MessageReplyData } from './utils/helper.util.js';
import { Platforms } from '@/engine/constants/platform.constants.js';
import { EventType } from '@/engine/adapters/models/enums/index.js';
/**
 * Creates the onMessage callback consumed by startServer().
 * Each call to the returned function processes one webhook messaging entry.
 */
export function createEventRouter(
  pageApi: PageApi,
  emitter: EventEmitter,
  prefix: string,
  userId: string,
  sessionId: string,
): (messaging: Record<string, unknown>) => Promise<void> {
  return async (messaging: Record<string, unknown>): Promise<void> => {
    const sender = messaging['sender'] as { id: string } | undefined;
    const message = messaging['message'] as Record<string, unknown> | undefined;

    // ── Reaction event ──────────────────────────────────────────────────────
    // Delivered as a separate messaging[] entry with 'reaction' instead of 'message'.
    // Must be checked BEFORE the !message guard below.
    if (messaging['reaction']) {
      const unifiedApi = createFbPageApi(pageApi);
      const r = messaging['reaction'] as Record<string, unknown>;
      let originalSenderID = '';
      // Resolve the reacted-to message author so handlers know WHOSE message was reacted to.
      // Non-fatal if the message was deleted — originalSenderID stays ''.
      if (r['mid']) {
        try {
          const original = await pageApi.getMessage(r['mid'] as string);
          originalSenderID = original?.from?.id ?? '';
        } catch {
          // Non-fatal — senderID remains '' if the message has been deleted or is inaccessible
        }
      }
      const event = normalizeFbPageReactionEvent(
        messaging as Parameters<typeof normalizeFbPageReactionEvent>[0],
        originalSenderID,
      );
      const native = { platform: Platforms.FacebookPage, userId, sessionId, messaging };
      emitter.emit('message_reaction', {
        api: unifiedApi,
        event,
        native,
        prefix,
      });
      return;
    }

    // ── Postback (button click) ─────────────────────────────────────────────
    // The Page webhook delivers postback events when a user taps a Button Template button.
    // Must be checked BEFORE the !message guard which would silently drop postbacks.
    if (messaging['postback']) {
      const postback = messaging['postback'] as Record<string, unknown>;
      const unifiedApi = createFbPageApi(pageApi);
      const event = {
        type: EventType.BUTTON_ACTION,
        platform: Platforms.FacebookPage,
        actionId: postback['payload'] ?? '',
        // Page Messenger is always 1:1 — sender PSID is both senderID and threadID
        threadID: sender?.id ?? '',
        senderID: sender?.id ?? '',
        messageID: '',
        timestamp: messaging['timestamp'] ?? null,
      };
      const native = { platform: Platforms.FacebookPage, userId, sessionId, messaging };
      emitter.emit('button_action', { api: unifiedApi, event, native, prefix });
      return;
    }

    // ── Standard message ────────────────────────────────────────────────────
    // Echo messages (bot's own sends) and missing message objects are ignored.
    if (!message || message['is_echo']) return;

    const unifiedApi = createFbPageApi(pageApi);

    // Pre-fetch the replied-to message so normalizeFbPageEvent remains a pure
    // synchronous transformation — no async I/O leaks into the normaliser.
    let messageReply: Parameters<typeof normalizeFbPageEvent>[2] = null;
    const replyTo = message['reply_to'] as { mid?: string } | undefined;
    if (replyTo?.mid) {
      const replied = await pageApi.getMessage(replyTo.mid);
      messageReply = replied
        ? ({
            messageID: replyTo.mid,
            body: replied.text,
            attachments: replied.attachments,
            // Forward sender and timestamp so normalizeFbPageEvent can build the full PROTO_REPLIED_MESSAGE shape
            from: replied.from,
            createdTime: replied.createdTime,
          } as MessageReplyData)
        : null;
    }

    const event = normalizeFbPageEvent(
      sender as Parameters<typeof normalizeFbPageEvent>[0],
      message as Parameters<typeof normalizeFbPageEvent>[1],
      messageReply,
    );
    const native = { platform: Platforms.FacebookPage, userId, sessionId, messaging };
    emitter.emit(event.type as string, { api: unifiedApi, event, native, prefix });
  };
}
