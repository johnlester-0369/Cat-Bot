/**
 * /profile — Comprehensive User Profile Viewer
 *
 * Displays a fully structured profile for the calling user or an @mentioned
 * user. Combines platform identity data (display name, username, user ID,
 * platform) with bot-system statistics (role, status, economy, progression)
 * in a clean, professional layout.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { isBotAdmin, isBotPremium } from '@/engine/repos/credentials.repo.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import { isUserBanned } from '@/engine/repos/banned.repo.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';
import { formatCoins } from '@/engine/lib/currencies.lib.js';

// ── Level formula ─────────────────────────────────────────────────────────────
const DELTA_NEXT = 5;

function expToLevel(exp: number): number {
  if (exp <= 0) return 0;
  return Math.floor((1 + Math.sqrt(1 + (8 * exp) / DELTA_NEXT)) / 2);
}

function levelToExp(level: number): number {
  if (level <= 0) return 0;
  return Math.floor(((level * level - level) * DELTA_NEXT) / 2);
}

// ── Utility helpers ────────────────────────────────────────────────────────────

function relativeTime(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s ago`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatPlatformLabel(platform: string): string {
  return platform
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function renderProgressBar(percentage: number, length: number = 10): string {
  const clampedPct = Math.max(0, Math.min(100, percentage));
  const filledCount = Math.round((clampedPct / 100) * length);
  const emptyCount = length - filledCount;
  return '█'.repeat(filledCount) + '░'.repeat(emptyCount);
}

// ── Command configuration ──────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'profile',
  aliases: ['me', 'userinfo'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Display a complete profile — identity, role, economy, and progression',
  category: 'Utility',
  usage: '[@mention]',
  cooldown: 5,
  hasPrefix: true,
  options: [
    {
      type: OptionType.user,
      name: 'user',
      description: 'User whose profile to view (defaults to yourself)',
      required: false,
    },
  ],
};

// ── Command handler ────────────────────────────────────────────────────────────

export const onCommand = async ({
  chat,
  event,
  db,
  native,
  user,
  currencies,
}: AppCtx): Promise<void> => {
  const { userId, platform, sessionId } = native;

  const mentions = event['mentions'] as Record<string, string> | undefined;
  const mentionIDs = Object.keys(mentions ?? {});
  const senderID = event['senderID'] as string | undefined;

  const targetID: string | undefined = mentionIDs.length > 0 ? mentionIDs[0] : senderID;

  if (!targetID) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Unable to resolve the target user on this platform.',
    });
    return;
  }

  // ── Platform identity ──
  let displayName = '';
  let username: string | null = null;

  try {
    const info = await user.getInfo(targetID);
    displayName = info.name || '';
    username = info.username ?? null;
  } catch { /* Fallback handled below */ }

  if (mentionIDs.length > 0 && mentions?.[targetID]) {
    displayName = mentions[targetID].replace(/^@/, '');
  }

  if (!displayName) {
    displayName = await user.getName(targetID);
  }

  // ── Bot role and status ──
  let roleLabel = 'Member';
  let statusLabel = '🟢 Active';

  if (userId && platform && sessionId) {
    try {
      const [sysAdmin, botAdmin, premium, banned] = await Promise.all([
        isSystemAdmin(targetID),
        isBotAdmin(userId, platform, sessionId, targetID),
        isBotPremium(userId, platform, sessionId, targetID),
        isUserBanned(userId, platform, sessionId, targetID),
      ]);

      if (sysAdmin) roleLabel = 'System Admin';
      else if (botAdmin) roleLabel = 'Bot Admin';
      else if (premium) roleLabel = 'Premium Member';

      if (banned) statusLabel = '🔴 Banned';
    } catch { /* Fail-open */ }
  }

  // ── Economy data ──
  let coins = 0;
  let streak = 0;
  let lastClaimLabel = 'Never';

  try {
    coins = await currencies.getMoney(targetID);
    const userColl = db.users.collection(targetID);

    if (await userColl.isCollectionExist('money')) {
      const moneyColl = await userColl.getCollection('money');
      const rawStreak = await moneyColl.get('streak');
      const rawLastClaim = await moneyColl.get('lastClaim');

      streak = typeof rawStreak === 'number' ? rawStreak : 0;
      if (typeof rawLastClaim === 'number' && rawLastClaim > 0) {
        lastClaimLabel = relativeTime(Date.now() - rawLastClaim);
      }
    }
  } catch { /* Fail-open */ }

  // ── Progression data ──
  let exp = 0;
  let leaderboardRank = 1;
  let totalRanked = 1;

  try {
    const userColl = db.users.collection(targetID);

    if (await userColl.isCollectionExist('xp')) {
      const xpColl = await userColl.getCollection('xp');
      const rawExp = await xpColl.get('exp');
      exp = typeof rawExp === 'number' ? rawExp : 0;
    }

    const allSessions = await db.users.getAll();
    const leaderboard = allSessions
      .map(({ botUserId, data }) => {
        const xpData = data?.['xp'] as Record<string, unknown> | undefined;
        const userExp = xpData && typeof xpData['exp'] === 'number' ? xpData['exp'] : 0;
        return { botUserId, exp: userExp };
      })
      .sort((a, b) => b.exp - a.exp);

    totalRanked = Math.max(1, leaderboard.length);
    const pos = leaderboard.findIndex((entry) => entry.botUserId === targetID);
    if (pos !== -1) leaderboardRank = pos + 1;
  } catch { /* Fail-open */ }

  const level = expToLevel(exp);
  const currentBase = levelToExp(level);
  const nextBase = levelToExp(level + 1);
  const progressExp = exp - currentBase;
  const expNeeded = nextBase - currentBase;
  const progressPct = expNeeded > 0 ? Math.round((progressExp / expNeeded) * 100) : 100;

  // ── Compose final message ──
  const platformLabel = platform ? formatPlatformLabel(platform) : 'Unknown';
  const usernameTag = username ? ` | 🔗 @${username}` : '';
  const streakUnit = streak === 1 ? 'day' : 'days';
  const progressBar = renderProgressBar(progressPct, 12);

  const lines: string[] = [
    `**👤 Profile: ${displayName}**`,
    `▫️ 🆔 \`${targetID}\`${usernameTag}`,
    '',
    `**🛡️ Account Info**`,
    `▫️ **Platform:** 🌐 ${platformLabel}`,
    `▫️ **Role:** 🎖️ ${roleLabel}`,
    `▫️ **Status:** ${statusLabel}`,
    '',
    `**💼 Economy**`,
    `▫️ **Balance:** 💰 ${formatCoins(coins)} Coins`,
    `▫️ **Streak:** 🔥 ${streak} ${streakUnit}`,
    `▫️ **Last Claim:** ⏱️ ${lastClaimLabel}`,
    '',
    `**📈 Progression**`,
    `▫️ **Level:** ⭐ ${level} *(Rank #${leaderboardRank} of ${totalRanked})*`,
    `▫️ **EXP:** \`[${progressBar}]\` **${progressPct}%**`,
    `▫️ *${progressExp.toLocaleString()} / ${expNeeded.toLocaleString()} to Level ${level + 1}*`,
  ];

  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: lines.join('\n'),
  });
};
