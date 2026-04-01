/**
 * Telegram — getFullThreadInfo
 *
 * Fetches chat metadata via getChat; populates adminIDs via getChatAdministrators
 * for groups/supergroups. participantIDs is always empty — the Bot API does not
 * expose full member lists. avatarUrl is null — downloading the chat photo
 * requires a separate getFile call that is intentionally deferred to avoid
 * blocking command responses.
 *
 * Falls back to ctx.chat when getChat fails (e.g., bot is not a member of
 * the target chat but has a reference to it from a forwarded message).
 */
import type { Context } from 'telegraf';
import { Platforms } from '@/constants/platform.constants.js';
import {
  createUnifiedThreadInfo,
  type UnifiedThreadInfo,
} from '@/adapters/models/thread.model.js';

export async function getFullThreadInfo(
  ctx: Context,
  threadID: string,
): Promise<UnifiedThreadInfo> {
  const chatId = Number(threadID) || threadID;
  let chat: Awaited<ReturnType<typeof ctx.telegram.getChat>> | null = null;

  try {
    chat = await ctx.telegram.getChat(chatId);
  } catch {
    // Fall back to the current context chat when getChat fails (e.g., bot not in chat)
    if (String(ctx.chat?.id) === String(threadID)) {
      chat = ctx.chat as typeof chat;
    }
  }

  if (!chat) {
    return createUnifiedThreadInfo({ platform: Platforms.Telegram, threadID });
  }

  const isGroup =
    chat.type === 'group' ||
    chat.type === 'supergroup' ||
    chat.type === 'channel';

  let adminIDs: string[] = [];
  let memberCount: number | null = null;

  if (isGroup) {
    try {
      const admins = await ctx.telegram.getChatAdministrators(chatId);
      adminIDs = admins.map((a) => String(a.user.id));
    } catch {
      /* non-fatal; adminIDs stays empty */
    }
    // getChatMembersCount is the Telegraf v4 method name (note plural "Members")
    try {
      memberCount = await ctx.telegram.getChatMembersCount(chatId);
    } catch {
      /* non-fatal */
    }
  }

  // Build display name: groups have .title; DMs use first_name + last_name
  const name =
    'title' in chat && chat.title
      ? chat.title
      : 'first_name' in chat || 'last_name' in chat
        ? `${'first_name' in chat ? (chat.first_name ?? '') : ''} ${'last_name' in chat ? (chat.last_name ?? '') : ''}`.trim() ||
          null
        : null;

  return createUnifiedThreadInfo({
    platform: Platforms.Telegram,
    threadID,
    name,
    isGroup,
    memberCount,
    participantIDs: [],
    adminIDs,
    avatarUrl: null,
  });
}
