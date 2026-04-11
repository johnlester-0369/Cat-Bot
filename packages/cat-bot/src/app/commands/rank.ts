/**
 * /rank — Level and EXP Viewer
 *
 * Displays the caller's (or @mentioned user's) current level, EXP progress,
 * and leaderboard rank within the current bot session. XP is accumulated
 * passively via the rankup command's onChat handler (+1 EXP per message sent).
 *
 * Collection schema (bot_users_session.data → "xp" key):
 *   { exp: number }  — raw accumulated experience points
 *
 * Level formula (mirrors GoatBot's rank module):
 *   level  = floor((1 + sqrt(1 + 8 * exp / DELTA_NEXT)) / 2)
 *   expForLevel(n) = floor(((n² - n) * DELTA_NEXT) / 2)
 *
 * Leaderboard: reads all bot_users_session rows for the current session,
 * extracts each user's XP from their data blob, and sorts descending.
 * This is a full-scan approach — acceptable for typical bot session sizes
 * (dozens to low thousands of users).
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';

/** Controls how quickly users level up — higher = slower progression. */
const DELTA_NEXT = 5;

/** Converts raw EXP to a level number. */
function expToLevel(exp: number): number {
  if (exp <= 0) return 0;
  return Math.floor((1 + Math.sqrt(1 + 8 * exp / DELTA_NEXT)) / 2);
}

/** Minimum EXP required to reach a specific level. */
function levelToExp(level: number): number {
  if (level <= 0) return 0;
  return Math.floor(((level * level - level) * DELTA_NEXT) / 2);
}


export const config = {
  name: 'rank',
  aliases: [] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'John Lester',
  description: 'View your level, EXP, and leaderboard rank',
  category: 'Economy',
  usage: '[@mention]',
  cooldown: 5,
  hasPrefix: true,
  options: [
    {
      type: OptionType.user,
      description: 'User to view rank',
      required: false,
    },
  ],
};

export const onCommand = async ({ chat, event, db, native }: AppCtx): Promise<void> => {
  const mentions = event['mentions'] as Record<string, string> | undefined;
  const mentionIDs = Object.keys(mentions ?? {});

  // Priority: first @mention → sender. noUncheckedIndexedAccess: mentionIDs[0] is string | undefined.
  const targetID = mentionIDs[0] ?? (event['senderID'] as string | undefined);

  if (!targetID) {
    await chat.replyMessage({ style: MessageStyle.MARKDOWN, message: '❌ Could not identify the target user on this platform.' });
    return;
  }

  // Read EXP from the user's xp collection — returns 0 when never claimed
  const userColl = db.users.collection(targetID);
  let exp = 0;
  if (await userColl.isCollectionExist('xp')) {
    const xpColl = await userColl.getCollection('xp');
    exp = (await xpColl.get('exp') as number | undefined) ?? 0;
  }

  const level       = expToLevel(exp);
  const currentBase = levelToExp(level);
  const nextBase    = levelToExp(level + 1);
  const currentExp  = exp - currentBase;
  const expNeeded   = nextBase - currentBase;

  // Compute leaderboard rank by scanning all session users' EXP blobs.
  // Fail-open: rank defaults to 1 when session identity is absent or DB query fails.
  let leaderboardRank = 1;
  let totalRanked    = 1;
  const { userId, platform, sessionId } = native;
  if (userId && platform && sessionId) {
    try {
      const allSessions = await db.users.getAll();
      const leaderboard = allSessions
        .map(({ botUserId, data }) => {
          const xpData = data['xp'] as Record<string, unknown> | undefined;
          const userExp = typeof xpData?.['exp'] === 'number' ? (xpData['exp'] as number) : 0;
          return { botUserId, exp: userExp };
        })
        .sort((a, b) => b.exp - a.exp);
      totalRanked = Math.max(1, leaderboard.length);
      const pos = leaderboard.findIndex((u) => u.botUserId === targetID);
      if (pos !== -1) leaderboardRank = pos + 1;
    } catch {
      // Fail-open: leaderboard unavailable — still show level and EXP
    }
  }

  const displayName =
    mentionIDs.length > 0
      ? (mentions?.[targetID] ?? targetID).replace(/^@/, '')
      : await db.users.getName(targetID);

  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: [
      `👤 **${displayName}**`,
      `🏆 Rank: **#${leaderboardRank}**/${totalRanked}`,
      `⭐ Level: **${level}**`,
      `📊 EXP: ${currentExp}/${expNeeded}`,
    ].join('\n'),
  });
};
