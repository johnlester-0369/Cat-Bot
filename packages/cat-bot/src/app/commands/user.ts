/**
 * /user — Bot-Admin User Management
 *
 * Sub-commands:
 *   /user ban <uid> [reason]     — Ban a platform user from using this bot session
 *   /user unban <uid>            — Lift an existing ban
 *   /user list [page]            — Paginated list of all users in this session (default: page 1)
 *   /user search <query|uid>     — Search a user by name/text or exact user ID
 *
 * ── Output Format (list) ──────────────────────────────────────────────────────
 *
 *   Users
 *   ─────────────────
 *    1. John Doe — 10012345678
 *    2. Jane Smith — 10087654321
 *   ─────────────────
 *   Page (1/3)
 *   Currently the bot has 25 user(s)
 *   » !user list <page> to navigate pages
 *   » !user search <query|id> to find a user
 *
 * ── Output Format (search detail) ────────────────────────────────────────────
 *
 *   『 John Doe 』
 *   » User found in this session
 *
 *   ─────────────────
 *   ID       : 10012345678
 *   Name     : John Doe
 *   Username : @johndoe
 *   Platform : facebook-messenger
 *   ─────────────────
 *   Banned   : No
 *
 * Ban enforcement lives in on-command.middleware.ts (enforceNotBanned) — it checks
 * isUserBanned on every command invocation so banned users are silently blocked
 * without needing any special-casing in individual command modules.
 *
 * Access: role BOT_ADMIN — enforcePermission middleware blocks non-admins before
 * this handler ever executes.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import {
  banUser,
  unbanUser,
  isUserBanned,
} from '@/engine/repos/banned.repo.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'user',
  aliases: [] as string[],
  version: '1.1.0',
  role: Role.BOT_ADMIN,
  author: 'John Lester',
  description:
    'Manage session users: ban, unban, list all, or search by name/ID',
  category: 'Bot Admin',
  usage: '<ban|unban|list|search> [uid|page|query]',
  guide: [
    'ban <uid> [reason]   — Ban a user from this session',
    'unban <uid>          — Lift an existing user ban',
    'list [page]          — Paginated list of all users (default page 1)',
    'search <query|id>    — Search a user by name or exact ID',
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
      description: 'User ID, page number, or search query depending on action',
      required: false,
    },
  ],
};

/** Users shown per page in list view — matches help.ts density. */
const USERS_PER_PAGE = 10;

/** Thin horizontal rule — same style as help.ts. */
const HR = '─────────────────';

const BUTTON_ID = { prev: 'user_prev', next: 'user_next' } as const;

/**
 * Crop a string to `max` characters, appending "..." when truncated.
 * Keeps user name rows from wrapping across chat lines.
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
  user,
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
      message: '❌ Cannot resolve session identity.',
      style: MessageStyle.MARKDOWN,
    });
    return;
  }

  const sub = args[0]?.toLowerCase();

  // ── /user ban <uid> [reason] ───────────────────────────────────────────────
  if (sub === 'ban') {
    const uid = args[1];
    if (!uid) {
      await chat.replyMessage({
        message: `❌ Usage: ${prefix}user ban <uid> [reason]`,
        style: MessageStyle.MARKDOWN,
      });
      return;
    }
    const reason = args.slice(2).join(' ') || undefined;
    await banUser(userId, platform, sessionId, uid, reason);
    const userName = (await user.getName(uid)) || uid;
    const reasonSuffix = reason ? ` — Reason: ${reason}` : '';
    await chat.replyMessage({
      message: `🚫 **${userName}** has been banned from this session.${reasonSuffix}`,
      style: MessageStyle.MARKDOWN,
    });
    return;
  }

  // ── /user unban <uid> ──────────────────────────────────────────────────────
  if (sub === 'unban') {
    const uid = args[1];
    if (!uid) {
      await chat.replyMessage({
        message: `❌ Usage: ${prefix}user unban <uid>`,
        style: MessageStyle.MARKDOWN,
      });
      return;
    }
    await unbanUser(userId, platform, sessionId, uid);
    const userName = (await user.getName(uid)) || uid;
    await chat.replyMessage({
      message: `✅ **${userName}** has been unbanned from this session.`,
      style: MessageStyle.MARKDOWN,
    });
    return;
  }

  // ── /user list [page] ──────────────────────────────────────────────────────
  if (sub === 'list') {
    let allUsers: Array<{ botUserId: string; data: Record<string, unknown> }> =
      [];
    try {
      allUsers = await db.users.getAll();
    } catch {
      await chat.replyMessage({
        message: '❌ Failed to retrieve user list. Please try again.',
        style: MessageStyle.MARKDOWN,
      });
      return;
    }

    const totalUsers = allUsers.length;
    const totalPages = Math.max(1, Math.ceil(totalUsers / USERS_PER_PAGE));

    // args[1] is the page number; clamp to [1, totalPages]
    const pageArg = args[1];
    const page = pageArg
      ? Math.min(Math.max(1, parseInt(pageArg, 10) || 1), totalPages)
      : 1;

    const startIdx = (page - 1) * USERS_PER_PAGE;
    const pageUsers = allUsers.slice(startIdx, startIdx + USERS_PER_PAGE);

    // Resolve display names for the current page concurrently
    const nameResults = await Promise.allSettled(
      pageUsers.map((u) => db.users.getName(u.botUserId)),
    );

    const userLines = pageUsers.map((u, i) => {
      const nameResult = nameResults[i];
      const name =
        nameResult?.status === 'fulfilled'
          ? nameResult.value
          : `User ${u.botUserId}`;
      const num = startIdx + i + 1;
      const padNum = String(num).padStart(2, ' ');
      return `${padNum}. ${crop(name, 24)} — \`${u.botUserId}\``;
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
        `Users`,
        HR,
        ...(userLines.length > 0 ? userLines : ['  (no users found)']),
        HR,
        `Page (${page}/${totalPages})`,
        `Currently the bot has ${totalUsers} user(s)`,
        `» ${prefix}user list <page> to navigate pages`,
        `» ${prefix}user search <query|id> to find a user`,
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

  // ── /user search <query|uid> ───────────────────────────────────────────────
  if (sub === 'search') {
    const query = args.slice(1).join(' ').trim();
    if (!query) {
      await chat.replyMessage({
        message: `❌ Usage: ${prefix}user search <query|id>`,
        style: MessageStyle.MARKDOWN,
      });
      return;
    }

    const queryLower = query.toLowerCase();

    // Fetch all session users to search through
    let allUsers: Array<{ botUserId: string; data: Record<string, unknown> }> =
      [];
    try {
      allUsers = await db.users.getAll();
    } catch {
      await chat.replyMessage({
        message: '❌ Failed to retrieve user data. Please try again.',
        style: MessageStyle.MARKDOWN,
      });
      return;
    }

    // --- Resolve target user ID ---
    // Priority 1: Exact ID match (query IS the botUserId)
    let targetId: string | null = null;
    const exactMatch = allUsers.find(
      (u) => u.botUserId.toLowerCase() === queryLower,
    );
    if (exactMatch) {
      targetId = exactMatch.botUserId;
    }

    // Priority 2: Name-based search across all session users
    if (!targetId) {
      const nameResults = await Promise.allSettled(
        allUsers.map((u) => db.users.getName(u.botUserId)),
      );
      const nameMatch = allUsers.find((_, i) => {
        const r = nameResults[i];
        return (
          r?.status === 'fulfilled' &&
          r.value.toLowerCase().includes(queryLower)
        );
      });
      if (nameMatch) targetId = nameMatch.botUserId;
    }

    if (!targetId) {
      await chat.replyMessage({
        message: `🔍 No user found matching **"${query}"**.\nTry a different name or use the exact user ID.`,
        style: MessageStyle.MARKDOWN,
      });
      return;
    }

    // Fetch detailed info and ban status for the resolved user
    let info: Awaited<ReturnType<typeof user.getInfo>> | null = null;
    try {
      info = await user.getInfo(targetId);
    } catch {
      // getInfo may fail for users not resolvable via platform API; fall back gracefully
    }

    let banned = false;
    try {
      banned = await isUserBanned(userId, platform, sessionId, targetId);
    } catch {
      // Fail-open — ban status remains false if DB is unreachable
    }

    const displayName = info?.name ?? (await db.users.getName(targetId)) ?? targetId;
    const username = info?.username ? `@${info.username}` : 'N/A';
    const firstName = info?.firstName ?? 'N/A';
    const infoPlatform = info?.platform ?? platform;
    const bannedLabel = banned ? '🚫 Yes' : '✅ No';

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: [
        `『 **${displayName}** 』`,
        `» User found in this session`,
        HR,
        `**ID:** \`${targetId}\``,
        `**Name:** ${displayName}`,
        `**First Name:** ${firstName}`,
        `**Username:** ${username}`,
        `**Platform:** ${infoPlatform}`,
        HR,
        `**Banned:** ${bannedLabel}`,
      ].join('\n'),
    });
    return;
  }

  // ── Unknown or missing sub-command ────────────────────────────────────────
  await usage();
};
