import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { runAgent } from '@/engine/agent/agent.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { getBotNickname } from '@/engine/repos/session.repo.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';
import { isBotAdmin } from '@/engine/repos/credentials.repo.js';
import { isThreadAdmin } from '@/engine/repos/threads.repo.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import { cooldownStore } from '@/engine/lib/cooldown.lib.js';

export const config: CommandConfig = {
  name: 'ai',
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'System',
  description:
    'Interact with the AI assistant. It can chat and execute commands on your behalf.',
  category: 'AI Chat',
  usage: '<prompt>',
  cooldown: 5,
  hasPrefix: true,
  options: [
    {
      type: OptionType.string,
      name: 'prompt',
      description: 'Your prompt',
      required: false,
    },
  ],
};

// ── Admin-only guard (for onChat path only) ───────────────────────────────────
//
// The /ai command already passes through enforceAdminOnly middleware in the
// command pipeline, so onCommand is already gated. However, the onChat passive
// listener is invoked outside the command middleware chain and therefore needs
// its own equivalent check.
//
// Returns true  → caller should ABORT (user is restricted).
// Returns false → caller may proceed with the agent.
//
// Suppression logic mirrors enforceAdminOnly in on-command.middleware.ts:
//   • Rate-limited to one notification per 15 s per user per mode (prevents flooding).
//   • hideNoti / adminOnlyHideNoti → completely silent rejection.
//   • System admin > bot admin > thread admin bypass (most → least privileged).

async function isBlockedByAdminRestrictions(
  ctx: AppCtx,
  senderID: string,
  threadID: string,
): Promise<{ blocked: boolean; reason: 'adminonly' | 'adminbox' | null; hideNoti: boolean }> {
  const sessionUserId = ctx.native.userId ?? '';
  const sessionId     = ctx.native.sessionId ?? '';
  const platform      = ctx.native.platform;

  // System admins bypass all restrictions unconditionally.
  if (senderID && (await isSystemAdmin(senderID))) {
    return { blocked: false, reason: null, hideNoti: false };
  }

  // Resolve bot-admin status once — reused by both gates below.
  const isAdmin =
    senderID && sessionUserId && sessionId
      ? await isBotAdmin(sessionUserId, platform, sessionId, senderID)
      : false;

  if (isAdmin) {
    return { blocked: false, reason: null, hideNoti: false };
  }

  // ── 1. Session-wide admin-only (adminonly command) ─────────────────────────
  try {
    const botColl = ctx.db.bot;
    if (await botColl.isCollectionExist('session_settings')) {
      const h        = await botColl.getCollection('session_settings');
      const settings = await h.getAll();
      const enabled  = settings['adminOnlyEnabled'] as boolean | null;

      if (enabled === true) {
        const ignoreList = (settings['adminOnlyIgnoreList'] as string[] | null) ?? [];
        // 'ai' is the canonical command name — honour per-command ignore list entries.
        if (!ignoreList.includes('ai')) {
          const hideNoti = (settings['adminOnlyHideNoti'] as boolean | null) === true;
          return { blocked: true, reason: 'adminonly', hideNoti };
        }
      }
    }
  } catch {
    // Fail-open — DB outage must not silently lock out the session
  }

  // ── 2. Per-thread admin-only (onlyadminbox command) ────────────────────────
  if (threadID) {
    try {
      const threadColl = ctx.db.threads.collection(threadID);
      if (await threadColl.isCollectionExist('adminbox_settings')) {
        const h        = await threadColl.getCollection('adminbox_settings');
        const settings = await h.getAll();
        const enabled  = settings['enabled'] as boolean | null;

        if (enabled === true) {
          const ignoreList = (settings['ignoreList'] as string[] | null) ?? [];
          if (!ignoreList.includes('ai')) {
            // Thread admins are also exempt from onlyadminbox restrictions.
            const isThreadAdm =
              senderID ? await isThreadAdmin(threadID, senderID) : false;
            if (!isThreadAdm) {
              const hideNoti = (settings['hideNoti'] as boolean | null) === true;
              return { blocked: true, reason: 'adminbox', hideNoti };
            }
          }
        }
      }
    } catch {
      // Fail-open
    }
  }

  return { blocked: false, reason: null, hideNoti: false };
}

/**
 * Handles explicit command invocation via prefix (e.g., `/ai I want some memes`).
 * Admin restriction enforcement is handled upstream by enforceAdminOnly middleware.
 */
export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const prompt = ctx.args.join(' ').trim();
  if (!prompt) {
    await ctx.chat.replyMessage({
      style: MessageStyle.TEXT,
      message: 'Please provide a prompt. Example: `/ai send a meme`',
    });
    return;
  }

  // Resolve bot nickname and sender display name to inject into the agent's system prompt.
  const senderID = (ctx.event['senderID'] ??
    ctx.event['userID'] ??
    '') as string;
  const nickname =
    ctx.native.userId && ctx.native.sessionId
      ? await getBotNickname(
          ctx.native.userId as string,
          ctx.native.platform,
          ctx.native.sessionId as string,
        )
      : null;
  const userName = senderID ? await ctx.user.getName(senderID) : null;

  try {
    const result = await runAgent(prompt, ctx, nickname, userName);
    if (result) {
      await ctx.chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: result,
      });
    }
  } catch (err) {
    await ctx.chat.replyMessage({
      style: MessageStyle.TEXT,
      message: `AI Error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
};

/**
 * Passive middleware listener. Checks every incoming message.
 * If it matches the bot's name (e.g., "Hey Cat-Bot, do something"), triggers
 * the agent transparently — but ONLY when the user is not restricted by
 * adminonly or onlyadminbox modes.
 */
export const onChat = async (ctx: AppCtx): Promise<void> => {
  const message = ((ctx.event['message'] as string | undefined) || '').trim();
  if (!message) return;

  const nickname =
    ctx.native.userId && ctx.native.sessionId
      ? await getBotNickname(
          ctx.native.userId as string,
          ctx.native.platform,
          ctx.native.sessionId as string,
        )
      : null;

  const senderID = (ctx.event['senderID'] ??
    ctx.event['userID'] ??
    '') as string;
  const threadID = (ctx.event['threadID'] ?? '') as string;
  const userName = senderID ? await ctx.user.getName(senderID) : null;

  const targetName = nickname || 'Cat-Bot';

  if (!message.toLowerCase().includes(targetName.toLowerCase())) return;

  // ── Admin restriction gate ─────────────────────────────────────────────────
  // Must mirror enforceAdminOnly because onChat bypasses the command middleware chain.
  try {
    const { blocked, reason, hideNoti } = await isBlockedByAdminRestrictions(
      ctx,
      senderID,
      threadID,
    );

    if (blocked) {
      if (!hideNoti) {
        // Rate-limit the notification to once per 15 s so a chatty user doesn't
        // flood the thread with rejection messages.
        const sessionUserId = ctx.native.userId ?? '';
        const sessionId     = ctx.native.sessionId ?? '';
        const platform      = ctx.native.platform;
        const now           = Date.now();

        const noticeKey =
          reason === 'adminonly'
            ? `ai_adminonly_noti:${sessionUserId}:${platform}:${sessionId}:${senderID}`
            : `ai_adminbox_noti:${sessionUserId}:${platform}:${sessionId}:${threadID}:${senderID}`;

        if (cooldownStore.check(noticeKey, now) === null) {
          const noticeMsg =
            reason === 'adminonly'
              ? `🤖 Sorry, the AI assistant is currently **restricted to bot admins only**.\nIf you believe this is a mistake, please contact a bot admin.`
              : `🤖 Sorry, the AI assistant is currently **restricted to group admins** in this thread.\nIf you believe this is a mistake, please contact a group admin.`;

          await ctx.chat.replyMessage({
            style: MessageStyle.MARKDOWN,
            message: noticeMsg,
          });
          cooldownStore.record(noticeKey, now, 15_000);
        }
      }
      return; // Abort — do NOT run the agent
    }
  } catch {
    // Fail-open — a DB outage must not silently prevent the AI from responding
  }

  // ── Agent invocation ───────────────────────────────────────────────────────
  const prompt = message;

  try {
    const result = await runAgent(prompt, ctx, nickname, userName);
    if (result) {
      await ctx.chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: result,
      });
    }
  } catch (err) {
    ctx.logger.error('[ai.ts] onChat agent execution failed', { error: err });
  }
};