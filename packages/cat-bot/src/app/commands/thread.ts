/**
 * /thread — Bot-Admin Thread Management
 *
 * Sub-commands:
 *   /thread ban <tid> [reason]   — Ban a thread from using this bot session
 *   /thread unban <tid>          — Lift an existing thread ban
 *   /thread list [page]          — Paginated list of all group threads in this session (default: page 1)
 *   /thread search <query|tid>   — Search a thread by name/text or exact thread ID
 *
 * ── Output Format (list) ──────────────────────────────────────────────────────
 *
 *   Threads
 *   ─────────────────
 *    1. My Group — 10012345678
 *    2. Dev Chat — 10087654321
 *   ─────────────────
 *   Page (1/3)
 *   Currently the bot has 25 thread(s)
 *   » !thread list <page> to navigate pages
 *   » !thread search <query|id> to find a thread
 *
 * ── Output Format (search detail) ────────────────────────────────────────────
 *
 *   『 My Group 』
 *   » Thread found in this session
 *
 *   ─────────────────
 *   ID       : 10012345678
 *   Name     : My Group
 *   Platform : facebook-messenger
 *   Is Group : Yes
 *   Members  : 12
 *   ─────────────────
 *   Admins   : 3 admin(s)
 *   Banned   : No
 *
 * Ban enforcement lives in on-command.middleware.ts (enforceNotBanned) — it checks
 * isThreadBanned on every command invocation so all commands in a banned thread
 * are silently dropped without any special-casing in individual command modules.
 *
 * Access: role BOT_ADMIN — enforcePermission middleware blocks non-admins before
 * this handler ever executes.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import {
  banThread,
  unbanThread,
  isThreadBanned,
} from '@/engine/repos/banned.repo.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'thread',
  aliases: [] as string[],
  version: '1.1.0',
  role: Role.BOT_ADMIN,
  author: 'John Lester',
  description:
    'Manage session threads: ban, unban, list all group threads, or search by name/ID',
  category: 'Bot Admin',
  usage: '<ban|unban|list|search> [tid|page|query]',
  guide: [
    'ban <tid> [reason] — Ban a thread from this session',
    'unban <tid> — Lift an existing thread ban',
    'list [page] — Paginated list of all group threads (default page 1)',
    'search <query|id> — Search a thread by name or exact ID',
  ],
  cooldown: 5,
  hasPrefix: true,
  // Exclude Facebook Page since it uses PSID (Page-Scoped ID)
  platform: [
    Platforms.Discord,
    Platforms.Telegram,
    Platforms.FacebookMessenger,
  ],
  options: [
    {
      type: OptionType.string,
      name: 'action',
      description: 'Action to perform: ban, unban, list, or search',
      required: true,
    },
    {
      type: OptionType.string,
      name: 'target',
      description: 'Thread ID, page number, or search query depending on action',
      required: false,
    },
  ],
};

/** Threads shown per page in list view — matches help.ts density. */
const THREADS_PER_PAGE = 10;

/** Thin horizontal rule — same style as help.ts. */
const HR = '─────────────────';

const BUTTON_ID = { prev: 'thread_prev', next: 'thread_next' } as const;

/**
 * Crop a string to `max` characters, appending "..." when truncated.
 * Keeps thread name rows from wrapping across chat lines.
 */
function crop(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

// Exported button map routes interactive prev/next clicks back to this module
export const button = {
  [BUTTON_ID.prev]: {
    label: '◀ Prev',
    style: ButtonStyle.SECONDARY,
    onClick: async (ctx: AppCtx) => {
      ctx.args = ['list', String(ctx.session?.context?.['page'] || 1)];
      await onCommand(ctx);
    },
  },
  [BUTTON_ID.next]: {
    label: 'Next ▶',
    style: ButtonStyle.SECONDARY,
    onClick: async (ctx: AppCtx) => {
      ctx.args = ['list', String(ctx.session?.context?.['page'] || 2)];
      await onCommand(ctx);
    },
  },
};

export const onCommand = async ({
  chat,
  thread,
  args,
  native,
  usage,
  event,
  button,
  prefix = '',
  db,
}: AppCtx): Promise<void> => {
  const { userId, platform, sessionId } = native;

  if (!userId || !platform || !sessionId) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Cannot resolve session identity.',
    });
    return;
  }

  const sub = args[0]?.toLowerCase();

  // ── /thread ban <tid> [reason] ────────────────────────────────────────────
  if (sub === 'ban') {
    const tid = args[1];
    if (!tid) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ Usage: ${prefix}thread ban <tid> [reason]`,
      });
      return;
    }
    // Remaining args after tid are joined as the reason so multi-word reasons work
    const reason = args.slice(2).join(' ') || undefined;
    await banThread(userId, platform, sessionId, tid, reason);
    const threadName = (await thread.getName(tid)) || tid;
    const reasonSuffix = reason ? ` — Reason: ${reason}` : '';
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `🚫 **${threadName}** (\`${tid}\`) has been banned from this session.${reasonSuffix}`,
    });
    return;
  }

  // ── /thread unban <tid> ───────────────────────────────────────────────────
  if (sub === 'unban') {
    const tid = args[1];
    if (!tid) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ Usage: ${prefix}thread unban <tid>`,
      });
      return;
    }
    await unbanThread(userId, platform, sessionId, tid);
    const threadName = (await thread.getName(tid)) || tid;
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `✅ **${threadName}** (\`${tid}\`) has been unbanned from this session.`,
    });
    return;
  }

  // ── /thread list [page] ───────────────────────────────────────────────────
  if (sub === 'list') {
    let threadIds: string[] = [];
    try {
      threadIds = await db.threads.getGroupIds();
    } catch {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '❌ Failed to retrieve thread list. Please try again.',
      });
      return;
    }

    const totalThreads = threadIds.length;
    const totalPages = Math.max(1, Math.ceil(totalThreads / THREADS_PER_PAGE));

    // args[1] is the page number; clamp to [1, totalPages]
    const pageArg = args[1];
    const page = pageArg
      ? Math.min(Math.max(1, parseInt(pageArg, 10) || 1), totalPages)
      : 1;

    const startIdx = (page - 1) * THREADS_PER_PAGE;
    const pageIds = threadIds.slice(startIdx, startIdx + THREADS_PER_PAGE);

    // Resolve display names for the current page concurrently
    const nameResults = await Promise.allSettled(
      pageIds.map((tid) => db.threads.getName(tid)),
    );

    const threadLines = pageIds.map((tid, i) => {
      const nameResult = nameResults[i];
      const name =
        nameResult?.status === 'fulfilled'
          ? nameResult.value
          : `Thread ${tid}`;
      const num = startIdx + i + 1;
      const padNum = String(num).padStart(2, ' ');
      return `${padNum}. ${crop(name, 24)} — \`${tid}\``;
    });

    // Build prev/next navigation buttons
    const activeButtons: string[] = [];
    if (page > 1) {
      const prevId = button.generateID({ id: BUTTON_ID.prev });
      button.createContext({ id: prevId, context: { page: page - 1 } });
      activeButtons.push(prevId);
    }
    if (page < totalPages) {
      const nextId = button.generateID({ id: BUTTON_ID.next });
      button.createContext({ id: nextId, context: { page: page + 1 } });
      activeButtons.push(nextId);
    }

    const payload = {
      style: MessageStyle.MARKDOWN,
      message: [
        `Threads`,
        HR,
        ...(threadLines.length > 0 ? threadLines : ['  (no threads found)']),
        HR,
        `Page (${page}/${totalPages})`,
        `Currently the bot has ${totalThreads} thread(s)`,
        `» ${prefix}thread list <page> to navigate pages`,
        `» ${prefix}thread search <query|id> to find a thread`,
      ].join('\n'),
      ...(hasNativeButtons(native.platform) && activeButtons.length > 0
        ? { button: activeButtons }
        : {}),
    };

    // Edit in-place when triggered from a button action
    if (event?.type === 'button_action') {
      await chat.editMessage({
        ...payload,
        message_id_to_edit: event['messageID'] as string,
      });
    } else {
      await chat.replyMessage(payload);
    }
    return;
  }

  // ── /thread search <query|tid> ────────────────────────────────────────────
  if (sub === 'search') {
    const query = args.slice(1).join(' ').trim();
    if (!query) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ Usage: ${prefix}thread search <query|id>`,
      });
      return;
    }

    const queryLower = query.toLowerCase();

    // Fetch all group thread IDs to search through
    let threadIds: string[] = [];
    try {
      threadIds = await db.threads.getGroupIds();
    } catch {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '❌ Failed to retrieve thread data. Please try again.',
      });
      return;
    }

    // --- Resolve target thread ID ---
    // Priority 1: Exact ID match (query IS the threadId)
    let targetId: string | null = null;
    const exactMatch = threadIds.find(
      (tid) => tid.toLowerCase() === queryLower,
    );
    if (exactMatch) {
      targetId = exactMatch;
    }

    // Priority 2: Name-based search across all session threads
    if (!targetId) {
      const nameResults = await Promise.allSettled(
        threadIds.map((tid) => db.threads.getName(tid)),
      );
      const nameMatchIdx = threadIds.findIndex((_, i) => {
        const r = nameResults[i];
        return (
          r?.status === 'fulfilled' &&
          r.value.toLowerCase().includes(queryLower)
        );
      });
      if (nameMatchIdx !== -1) targetId = threadIds[nameMatchIdx] ?? null;
    }

    if (!targetId) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `🔍 No thread found matching **"${query}"**.\nTry a different name or use the exact thread ID.`,
      });
      return;
    }

    // Fetch detailed info and ban status for the resolved thread
    let info: Awaited<ReturnType<typeof thread.getInfo>> | null = null;
    try {
      info = await thread.getInfo(targetId);
    } catch {
      // getInfo may fail for threads not resolvable via platform API; fall back gracefully
    }

    let banned = false;
    try {
      banned = await isThreadBanned(userId, platform, sessionId, targetId);
    } catch {
      // Fail-open — ban status remains false if DB is unreachable
    }

    const displayName =
      info?.name ?? (await db.threads.getName(targetId)) ?? targetId;
    const infoPlatform = info?.platform ?? platform;
    const isGroup = info?.isGroup ? 'Yes' : 'No';
    const memberCount =
      info?.memberCount != null ? String(info.memberCount) : 'N/A';
    const adminCount =
      info?.adminIDs && info.adminIDs.length > 0
        ? `${info.adminIDs.length} admin(s)`
        : 'N/A';
    const bannedLabel = banned ? '🚫 Yes' : '✅ No';

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: [
        `『 **${displayName}** 』`,
        `» Thread found in this session`,
        HR,
        `**ID:** \`${targetId}\``,
        `**Name:** ${displayName}`,
        `**Platform:** ${infoPlatform}`,
        `**Is Group:** ${isGroup}`,
        `**Members:** ${memberCount}`,
        HR,
        `**Admins:** ${adminCount}`,
        `**Banned:** ${bannedLabel}`,
      ].join('\n'),
    });
    return;
  }

  // ── Unknown or missing sub-command ────────────────────────────────────────
  await usage();
};
