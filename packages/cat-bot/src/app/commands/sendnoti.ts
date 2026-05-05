/**
 * /sendnoti — Session-Wide Group Broadcast
 *
 * Sends a notification message to every group thread the bot session has ever
 * encountered. Only group threads (isGroup=true in bot_threads) are targeted —
 * 1:1 DMs are excluded because unsolicited broadcasts in private conversations
 * would be intrusive and could get the bot flagged on the platform.
 *
 * Access: BOT_ADMIN only — unrestricted broadcasts could spam hundreds of groups.
 *
 * ── Two-step thread resolution ───────────────────────────────────────────────
 *   1. bot_threads_session  — scoped to (userId, platformId, sessionId) — identifies
 *      which threads THIS session has permission to message.
 *   2. bot_threads          — the shared cross-session source of truth — filters by
 *      isGroup=true so 1:1 DMs and channels are never targeted.
 *
 * ── Rate limiting ────────────────────────────────────────────────────────────
 * A 500ms pause between sends prevents hitting platform rate limits when the
 * session has many group threads. Platforms typically enforce per-second send caps
 * that this delay safely keeps the bot under.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'sendnoti',
  aliases: ['broadcast'] as string[],
  version: '1.0.0',
  role: Role.BOT_ADMIN,
  author: 'John Lester',
  description:
    'Broadcast a notification message to all group threads in this session',
  category: 'Bot Admin',
  usage: '<message>',
  cooldown: 10,
  hasPrefix: true,
  // Exclude Facebook Page since facebook page use PSID (Page-Scoped ID)
  platform: [
    Platforms.Discord,
    Platforms.Telegram,
    Platforms.FacebookMessenger,
  ],
  options: [
    {
      type: OptionType.string,
      name: 'message',
      description: 'Notification text to broadcast',
      required: true,
    },
  ],
};

export const onCommand = async ({
  chat,
  args,
  event,
  db,
  prefix = '',
}: AppCtx): Promise<void> => {
  const text = args.join(' ').trim();
  if (!text) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ Please provide a message to broadcast.\nUsage: ${prefix}sendnoti <message>`,
    });
    return;
  }

  // Resolve group threads via the two-step abstraction in db.threads.getGroupIds().
  // This keeps the command free of session-coordinate knowledge — ctx.factory pre-scopes the closure.
  const groupThreadIds = await db.threads.getGroupIds();

  if (groupThreadIds.length === 0) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        'ℹ️ No group threads found for this session. The bot must have received at least one message in a group before broadcast is available.',
    });
    return;
  }

  const currentThreadID = event['threadID'] as string | undefined;
  let sent = 0;
  const failed: string[] = [];

  for (const threadId of groupThreadIds) {
    // Skip the issuing thread — the admin already sees the command; a second message
    // would be redundant and confusing for group members watching the conversation.
    if (threadId === currentThreadID) continue;

    try {
      await chat.reply({
        thread_id: threadId,
        style: MessageStyle.MARKDOWN,
        message: `**» Notification «**\n\n${text}`,
      });
      sent++;
      // 500ms pause per send — keeps the bot under typical platform rate limits
      // (most enforce 1–2 messages/second per bot token) when broadcasting to many groups.
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
    } catch {
      // Track failures separately so the admin knows which groups were unreachable
      // without aborting the remaining sends — one stale thread should never stop the broadcast.
      failed.push(threadId);
    }
  }

  const lines: string[] = [`✅ Notification sent to ${sent} group thread(s).`];
  if (failed.length > 0) {
    lines.push(
      `⚠️ Failed to reach ${failed.length} thread(s) — they may have removed the bot or blocked sending.`,
    );
  }

  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: lines.join('\n'),
  });
};
