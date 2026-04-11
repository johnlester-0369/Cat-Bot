/**
 * /daily — Daily Reward Command
 *
 * Claims a daily reward once every 24 hours per user per session.
 * Tracks cooldown and consecutive-day streak inside the user's "daily"
 * collection on their bot_users_session row — no separate DB table needed.
 *
 * Collection schema (stored in bot_users_session.data → "daily" key):
 *   {
 *     lastClaim:  number   — Unix timestamp (ms) of the most recent claim
 *     streak:     number   — consecutive days claimed (resets on miss)
 *   }
 *
 * Streak bonus: +10 coins per additional day, capped at 6 bonus days (day 7 = +60).
 * Coin crediting is intentionally kept as a display-only reward until a coin
 * system is added — this command demonstrates the collection API end-to-end.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';

export const config = {
  name: 'daily',
  aliases: [] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'John Lester',
  description: 'Claim your daily reward (resets every 24 hours)',
  category: 'Economy',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

/** 24-hour cooldown window in milliseconds. */
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Base coins rewarded on every claim. */
const BASE_COINS = 200;

/** Additional coins per streak day beyond the first, capped at MAX_STREAK_BONUS_DAYS. */
const COINS_PER_STREAK_DAY = 10;

/** Streak bonus stops growing after this many consecutive days. */
const MAX_STREAK_BONUS_DAYS = 6;

export const onCommand = async ({ chat, event, db }: AppCtx): Promise<void> => {
  const senderID = event['senderID'] as string | undefined;

  if (!senderID) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Could not identify your user ID on this platform.',
    });
    return;
  }

  // Retrieve the collection manager bound to this user's bot_users_session row.
  // db.users.collection is pre-scoped to (sessionOwnerUserId, platform, sessionId)
  // so the command only needs to supply the platform user ID (senderID).
  const userColl = db.users.collection(senderID);

  if (!(await userColl.isCollectionExist('money'))) {
    await userColl.createCollection('money');
  }

  const daily = await userColl.getCollection('money');

  const lastClaim = (await daily.get('lastClaim')) as number | undefined;
  const now = Date.now();

  // ── Cooldown check ────────────────────────────────────────────────────────
  if (lastClaim !== undefined && now - lastClaim < COOLDOWN_MS) {
    const remaining = COOLDOWN_MS - (now - lastClaim);
    const hours = Math.floor(remaining / (1000 * 60 * 60));
    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((remaining % (1000 * 60)) / 1000);
    const pad = (n: number) => String(n).padStart(2, '0');

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: [
        "⏰ You've already claimed today's reward!",
        `Come back in: ${hours}h ${pad(minutes)}m ${pad(seconds)}s`,
      ].join('\n'),
    });
    return;
  }

  // ── Streak calculation ────────────────────────────────────────────────────
  // Streak increments only when claimed on consecutive calendar days.
  // A missed day resets the streak back to 1 rather than 0 — the current
  // claim always counts as day 1 even after a break.
  const currentStreak =
    ((await daily.get('streak')) as number | undefined) ?? 0;
  const lastClaimDate =
    lastClaim !== undefined ? new Date(lastClaim).toDateString() : null;
  const yesterdayDate = new Date(now - 86_400_000).toDateString();
  const newStreak = lastClaimDate === yesterdayDate ? currentStreak + 1 : 1;

  // ── Compute reward ────────────────────────────────────────────────────────
  // Bonus scales with streak but caps so long-time users don't get unbounded rewards.
  const streakBonusDays = Math.min(newStreak - 1, MAX_STREAK_BONUS_DAYS);
  const streakBonus = streakBonusDays * COINS_PER_STREAK_DAY;
  const totalCoins = BASE_COINS + streakBonus;

  // ── Persist state — write streak before coins message so state is durable even
  //    if the message send fails. Two set calls instead of one update call to keep
  //    intent explicit and avoid accidental merge of the whole collection.
  await daily.set('lastClaim', now);
  await daily.set('streak', newStreak);
  // Persist earned coins so /balance can read the running total from the money collection.
  await daily.increment('coins', totalCoins);

  // ── Respond ───────────────────────────────────────────────────────────────
  const streakLine =
    newStreak > 1
      ? `🔥 Streak: **${newStreak} days** (+${streakBonus} bonus coins)`
      : '🔥 Streak: **1 day** (maintain a streak for bonus coins!)';

  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: [
      '✅ Daily reward claimed!',
      `💰 Coins: **+${totalCoins}**`,
      streakLine,
      '⏰ Come back in 24 hours to keep your streak going!',
    ].join('\n'),
  });
};
