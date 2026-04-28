/**
 * /owner — Session Owner & Admin Information
 *
 * Displays accurate, live information about the current bot session.
 * The admin list returned by listBotAdmins() is ordered: the first entry
 * is the session owner; all subsequent entries are bot admins.
 *
 * Each person is displayed with their full name, @username (if available),
 * and platform user ID — sourced from user.getInfo() → UnifiedUserInfo.
 *
 * A "Refresh" button re-fetches live data in-place on platforms that support
 * native button components (same pattern as system.ts / uptime.ts).
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { getBotNickname } from '@/engine/repos/session.repo.js';
import { listBotAdmins } from '@/engine/repos/credentials.repo.js';
import { sessionManager } from '@/engine/modules/session/session-manager.lib.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';
import type { UnifiedUserInfo } from '@/engine/adapters/models/user.model.js';

// ── Command Config ────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'owner',
  aliases: ['ownerinfo', 'admininfo'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description:
    'Shows the owner and admin information for this bot session.',
  category: 'Info',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatUptime(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = Math.floor(totalSecs % 60);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
}

/**
 * Formats a single person entry using their UnifiedUserInfo.
 * Shows: Full Name | @username (if available) | (userId)
 */
function formatPerson(info: UnifiedUserInfo | null, id: string): string {
  if (!info) return `_(unknown)_ (${id})`;
  const username = info.username ? ` @${info.username}` : '';
  return `**${info.name}**${username} \`${id}\``;
}

// ── Core render function ──────────────────────────────────────────────────────

async function buildOwnerCard(ctx: AppCtx): Promise<string> {
  const { native, user, bot, prefix } = ctx;
  const { userId, platform, sessionId } = native;

  if (!userId || !platform || !sessionId) {
    return '❌ Session identity could not be resolved.';
  }

  // ── Parallel fetch: bot ID, nickname, and ordered admin list ─────────────
  const [botId, nickname, adminIds] = await Promise.all([
    bot.getID().catch(() => 'unknown'),
    getBotNickname(userId, platform, sessionId),
    listBotAdmins(userId, platform, sessionId),
  ]);

  // ── Separate owner (index 0) from admins (index 1+) ──────────────────────
  const ownerID = adminIds[0] as string | undefined;
  const adminOnlyIDs = adminIds.slice(1) as string[];

  // ── Resolve full user info in parallel for everyone ───────────────────────
  const [ownerInfo, ...adminInfos] = await Promise.all([
    ownerID
      ? user.getInfo(ownerID).catch(() => null)
      : Promise.resolve(null),
    ...adminOnlyIDs.map((id) =>
      user.getInfo(id).catch(() => null),
    ),
  ]);

  // ── Session uptime ────────────────────────────────────────────────────────
  const sessionKey = `${userId}:${platform}:${sessionId}`;
  const uptimeMs = sessionManager.getUptime(sessionKey);
  const uptimeStr = uptimeMs !== null ? formatUptime(uptimeMs) : 'unknown';

  // ── Build card lines ──────────────────────────────────────────────────────
  const lines: string[] = [
    `👑 **Owner & Admin Info**`,
    ``,
    `**— Bot —**`,
    `🤖 **Nickname:** ${nickname ?? '_(not set)_'}`,
    `🆔 **Bot ID:** ${botId}`,
    `🌐 **Platform:** ${platform}`,
    `🔑 **Prefix:** \`${prefix ?? '!'}\``,
    `⏱️ **Session Uptime:** ${uptimeStr}`,
    ``,
    `**— Owner —**`,
  ];

  if (ownerID) {
    lines.push(`👑 ${formatPerson(ownerInfo as UnifiedUserInfo | null, ownerID)}`);
  } else {
    lines.push(`_No owner registered for this session._`);
  }

  lines.push(``, `**— Bot Admins (${adminOnlyIDs.length}) —**`);

  if (adminOnlyIDs.length === 0) {
    lines.push(`_No additional admins registered for this session._`);
  } else {
    adminOnlyIDs.forEach((id, i) => {
      const info = (adminInfos[i] as UnifiedUserInfo | null | undefined) ?? null;
      lines.push(`${i + 1}. 🛡️ ${formatPerson(info, id)}`);
    });
  }

  return lines.join('\n');
}

// ── Button definition ─────────────────────────────────────────────────────────

const BUTTON_ID = { refresh: 'refresh' } as const;

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, native, event, button, session } = ctx;

  try {
    const message = await buildOwnerCard(ctx);

    const buttonId =
      event['type'] === 'button_action'
        ? session.id
        : button.generateID({ id: BUTTON_ID.refresh, public: true });

    const payload = {
      style: MessageStyle.MARKDOWN,
      message,
      ...(hasNativeButtons(native.platform) ? { button: [buttonId] } : {}),
    };

    if (event['type'] === 'button_action') {
      await chat.editMessage({
        ...payload,
        message_id_to_edit: event['messageID'] as string,
      });
    } else {
      await chat.replyMessage(payload);
    }
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ **Error:** ${error.message ?? 'Unknown error'}`,
    });
  }
};

export const button = {
  [BUTTON_ID.refresh]: {
    label: '🔄 Refresh',
    style: ButtonStyle.SECONDARY,
    onClick: (ctx: AppCtx) => onCommand(ctx),
  },
};