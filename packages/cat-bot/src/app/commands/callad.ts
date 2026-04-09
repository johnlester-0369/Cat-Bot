/**
 * /callad — Bidirectional Admin Relay
 *
 * Forwards user messages to all registered bot admins and relays replies
 * back and forth between user and admin indefinitely.
 *
 * ── Conversation Flow ─────────────────────────────────────────────────────────
 *   User: /callad <message>
 *   Bot  → Admin DM:   📨 Message from user...
 *   Admin replies      →
 *   Bot  → User:       📩 Reply from admin...
 *   User replies       →
 *   Bot  → Admin DM:   📨 Reply from user...
 *   (continues bidirectionally until either side stops replying)
 *
 * ── State Key Strategy ────────────────────────────────────────────────────────
 * Uses bare bot-sent messageID as the stateStore key (legacy scope in
 * resolveStateEntry). The private scope (msgId:senderID) and public scope
 * (msgId:threadID) would never match because the replying party lives in a
 * DIFFERENT thread than the state creator. The legacy bare key resolves on
 * messageReply.messageID alone, which is exactly what we need here.
 *
 * ── Multi-Admin Support ───────────────────────────────────────────────────────
 * When multiple admins are registered, each admin receives the message in their
 * own DM and gets an independent relay state. The FIRST admin to reply wins and
 * the conversation continues with that admin. Subsequent admins can still read
 * the message but their replies will only relay if the state hasn't been
 * deleted yet.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { listBotAdmins } from '@/engine/repos/credentials.repo.js';
import { OptionType } from '@/engine/constants/command-option.constants.js';
import { Platforms } from '@/engine/constants/platform.constants.js';

export const config = {
  name: 'callad',
  aliases: ['calladmin'] as string[],
  version: '2.0.0',
  role: Role.ANYONE,
  author: 'John Lester',
  description: 'Send a message or report to the bot admins. Replies are relayed bidirectionally.',
  category: 'Admin',
  usage: '<message>',
  cooldown: 5,
  hasPrefix: true,
  // Exclude Facebook Page since facebook page use PSID (Page-Scoped ID)
  platform: [Platforms.Discord, Platforms.Telegram, Platforms.FacebookMessenger],
  options: [
    {
      type: OptionType.string,
      name: 'message',
      description: 'Your message report',
      required: true,
    }
  ],
};

const STATE = {
  /** Bot forwarded user message to admin — waiting for admin to reply. */
  awaiting_admin_reply: 'awaiting_admin_reply',
  /** Bot relayed admin reply to user — waiting for user to reply. */
  awaiting_user_reply: 'awaiting_user_reply',
} as const;

export const onCommand = async ({
  chat,
  state,
  args,
  event,
  native,
  prefix = '',
}: AppCtx): Promise<void> => {
  const { userId, platform, sessionId } = native;

  // Session identity required to resolve which admins belong to this bot session
  if (!userId || !platform || !sessionId) {
    await chat.replyMessage({ message: '❌ Cannot resolve session identity.' });
    return;
  }

  const userMessage = args.join(' ').trim();
  if (!userMessage) {
    await chat.replyMessage({
      message: `❌ Please provide a message to send to the admin.\nUsage: ${prefix}callad <message>`,
    });
    return;
  }

  // Resolve bot admins dynamically — avoids hardcoding any single admin ID
  // and supports multi-admin setups managed via /admin add
  const admins = await listBotAdmins(userId, platform, sessionId);
  if (admins.length === 0) {
    await chat.replyMessage({
      message: `❌ No bot admins are registered for this session.\nAsk the session owner to run: ${prefix}admin add <uid>`,
    });
    return;
  }

  const senderID = (event['senderID'] as string | undefined) ?? '';
  const userThreadID = (event['threadID'] as string | undefined) ?? '';
  const userMessageID = (event['messageID'] as string | undefined) ?? '';

  // Forward to every registered admin and register an independent relay state
  // per message sent — each admin gets a full conversation slot
  let forwarded = 0;
  for (const adminId of admins) {
    const botMsgId = await chat.reply({
      message: [
        '📨 CALL ADMIN',
        `From: ${senderID}`,
        `Thread: ${userThreadID}`,
        '',
        userMessage,
        '',
        '── Reply to this message to respond to the user ──',
      ].join('\n'),
      thread_id: adminId,
    });

    if (botMsgId) {
      // Composite private key: scoping to the expected respondent's ID ensures
      // only the designated admin can trigger the next step in the flow.
      state.create({
        id: `${botMsgId}:${adminId}`,
        state: STATE.awaiting_admin_reply,
        context: {
          user: {
            threadID: userThreadID,
            messageID: userMessageID,
            senderID,
          },
        },
      });
      forwarded++;
    }
  }

  await chat.replyMessage({
    message: forwarded > 0
      ? `✅ Your message has been forwarded to ${forwarded} admin(s).\nYou will be notified when they reply.`
      : '❌ Failed to reach any admin. Please try again later.',
  });
};

export const onReply = {
  /**
   * Admin replied to the forwarded user message.
   * Relay the admin's reply to the user's thread and register awaiting_user_reply
   * so the user can continue the conversation.
   */
  [STATE.awaiting_admin_reply]: async ({
    chat,
    session,
    event,
    state,
  }: AppCtx): Promise<void> => {
    const adminMessage = (event['message'] as string | undefined) ?? '';

    // Cast through unknown — session.context is Record<string, unknown> under strict mode
    const ctx = session.context as {
      user?: { threadID?: string; messageID?: string; senderID?: string };
    };
    const userThreadID = ctx.user?.threadID ?? '';
    const userMessageID = ctx.user?.messageID ?? '';

    const adminThreadID = (event['threadID'] as string | undefined) ?? '';
    const adminMessageID = (event['messageID'] as string | undefined) ?? '';

    // Relay to user's thread, thread-pinned to their original message for clarity
    const botMsgId = await chat.reply({
      message: [
        '📩 Reply from admin:',
        '',
        adminMessage,
        '',
        '── Reply to this message to continue the conversation ──',
      ].join('\n'),
      thread_id: userThreadID,
      reply_to_message_id: userMessageID,
    });

    // Remove current state before registering the next — prevents double-firing
    // if the admin happens to reply to the same bot message a second time
    state.delete(session.id);

    if (botMsgId) {
      // Register on the bot's message sent to the user so their reply routes back here, no specific user id so anyone in the thread can reply
      state.create({
        id: String(botMsgId),
        state: STATE.awaiting_user_reply,
        context: {
          admin: {
            threadID: adminThreadID,
            messageID: adminMessageID,
          },
        },
      });
    }
  },

  /**
   * User replied to the admin's relayed message.
   * Forward the user's reply back to the admin and re-register awaiting_admin_reply
   * so the admin can continue the conversation — chain is infinite by design.
   */
  [STATE.awaiting_user_reply]: async ({
    chat,
    session,
    event,
    state,
  }: AppCtx): Promise<void> => {
    const userMessage = (event['message'] as string | undefined) ?? '';

     const ctx = session.context as {
       admin?: { threadID?: string; messageID?: string; senderID?: string };
     };
     const adminThreadID = ctx.admin?.threadID ?? '';
     const adminMessageID = ctx.admin?.messageID ?? '';
     const adminSenderID = ctx.admin?.senderID ?? '';

    const userThreadID = (event['threadID'] as string | undefined) ?? '';
    const userMessageID = (event['messageID'] as string | undefined) ?? '';
    const senderID = (event['senderID'] as string | undefined) ?? '';

    // Relay user's reply to admin, thread-pinned to the admin's last message
    const botMsgId = await chat.reply({
      message: [
        `📨 Reply from user (${senderID}):`,
        '',
        userMessage,
        '',
        '── Reply to this message to respond to the user ──',
      ].join('\n'),
      thread_id: adminThreadID,
      reply_to_message_id: adminMessageID,
    });

    state.delete(session.id);

    if (botMsgId) {
       // Re-register awaiting_admin_reply — the conversation chain is symmetrical
       // and continues indefinitely until either party stops replying
       // Re-register composite key scoped to the admin — the conversation chain
       // is symmetrical and continues indefinitely until either party stops
       state.create({
        id: `${botMsgId}:${adminSenderID}`,
        state: STATE.awaiting_admin_reply,
        context: {
          user: {
            threadID: userThreadID,
            messageID: userMessageID,
            senderID,
          },
        },
      });
    }
  },
};