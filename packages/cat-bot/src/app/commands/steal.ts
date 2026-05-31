/**
 * /steal — Steal Coins from Another User
 *
 * Attempt to steal coins from a mentioned user. Success depends on the amount
 * attempted — the higher the steal, the lower the chance of success.
 *
 * Success: attacker receives the stolen amount from the victim.
 * Failure: attacker pays a 20% penalty; 10% of that goes to the victim.
 *
 * Steal-protection: if the victim owns a "steal-protection" item, the steal 
 * is blocked, protection is consumed, and the attacker's steal counter 
 * increments by 2.
 *
 * Daily limit: 5 steals per 24-hour window. Resets automatically.
 *
 * Success chance formula:
 * chance = clamp(0.75 − 0.13 × log10(max(1, amount)), 0.10, 0.55)
 * (admin bypass: flat 0.65)
 *
 * Collection schema (bot_users_session.data → "steal" key):
 * { stealCount: number, lastStealAt: number }
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { formatCoins } from '@/engine/lib/currencies.lib.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_DAILY_STEALS = 5;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'steal',
  aliases: ['rob'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description:
    'Steal coins from another user. High chance of failure — and a penalty if caught!',
  category: 'Economy',
  usage: '@user <amount>',
  cooldown: 10,
  hasPrefix: true,
  options: [
    {
      type: OptionType.user,
      name: 'target',
      description: '@mention or reply to the user to steal from',
      required: true,
    },
    {
      type: OptionType.string,
      name: 'amount',
      description: 'Amount to steal (e.g. 100, 1k, all)',
      required: true,
    },
  ],
};

// ── Database Collection Helpers ───────────────────────────────────────────────

interface StealStats {
  stealCount: number;
  lastStealAt: number;
}

async function getStealStats(db: AppCtx['db'], uid: string): Promise<StealStats> {
  const userColl = db.users.collection(uid);
  if (!(await userColl.isCollectionExist('steal'))) {
    return { stealCount: 0, lastStealAt: 0 };
  }
  const coll = await userColl.getCollection('steal');
  return {
    stealCount: ((await coll.get('stealCount')) as number | undefined) ?? 0,
    lastStealAt: ((await coll.get('lastStealAt')) as number | undefined) ?? 0,
  };
}

async function saveStealStats(
  db: AppCtx['db'],
  uid: string,
  stats: StealStats,
): Promise<void> {
  const userColl = db.users.collection(uid);
  if (!(await userColl.isCollectionExist('steal'))) {
    await userColl.createCollection('steal');
  }
  const coll = await userColl.getCollection('steal');
  await coll.set('stealCount', stats.stealCount);
  await coll.set('lastStealAt', stats.lastStealAt);
}

async function getStealProtection(db: AppCtx['db'], uid: string): Promise<number> {
  const userColl = db.users.collection(uid);
  if (!(await userColl.isCollectionExist('inventory'))) return 0;

  const coll = await userColl.getCollection('inventory');
  return ((await coll.get('steal-protection')) as number | undefined) ?? 0;
}

async function consumeStealProtection(db: AppCtx['db'], uid: string, currentAmount: number): Promise<void> {
  const userColl = db.users.collection(uid);
  if (!(await userColl.isCollectionExist('inventory'))) {
    await userColl.createCollection('inventory');
  }

  const coll = await userColl.getCollection('inventory');
  await coll.set('steal-protection', Math.max(0, currentAmount - 1));
}

// ── Game logic helpers ────────────────────────────────────────────────────────

function getSuccessChance(amount: number, isAdmin: boolean): number {
  if (isAdmin) return 0.65;
  const raw = 0.75 - 0.13 * Math.log10(Math.max(1, amount));
  return Math.min(0.55, Math.max(0.1, raw));
}

function resolveEffectiveSteals(stats: StealStats, now: number): number {
  const windowExpired = now - stats.lastStealAt >= WINDOW_MS;
  return windowExpired ? 0 : stats.stealCount;
}

// ── Button definitions ────────────────────────────────────────────────────────

interface CtxData {
  resultMessage: string;
  balanceId: string;
  backId: string;
}

const BUTTON_ID = { balance: 'balance', back: 'back' } as const;

export const button = {
  [BUTTON_ID.balance]: {
    label: '💰 My Balance',
    style: ButtonStyle.SECONDARY,
    onClick: async ({ chat, event, currencies, native, session }: AppCtx) => {
      const senderID = event['senderID'] as string | undefined;
      if (!senderID) return;

      const ctx = session.context as unknown as CtxData | undefined;
      if (!ctx) return;

      const coins = await currencies.getMoney(senderID);
      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: event['messageID'] as string,
        message: `💰 **Current Balance:** ${formatCoins(coins)} coins`,
        ...(hasNativeButtons(native.platform) ? { button: [ctx.backId] } : {}),
      });
    },
  },

  [BUTTON_ID.back]: {
    label: '⬅ Back',
    style: ButtonStyle.SECONDARY,
    onClick: async ({ chat, event, native, session }: AppCtx) => {
      const ctx = session.context as unknown as CtxData | undefined;
      if (!ctx) return;

      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: event['messageID'] as string,
        message: ctx.resultMessage,
        ...(hasNativeButtons(native.platform) ? { button: [ctx.balanceId] } : {}),
      });
    },
  },
};

// ── Command handler ───────────────────────────────────────────────────────────

export const onCommand = async ({
  chat,
  event,
  args,
  db,
  usage,
  currencies,
  user,
  native,
  button: btn,
}: AppCtx): Promise<void> => {
  const senderID = event['senderID'] as string | undefined;
  if (!senderID) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Could not identify your user ID on this platform.',
    });
    return;
  }

  // ── Resolve victim from @mention ───────────────────────────────────────────
  const mentions = event['mentions'] as Record<string, string> | undefined;
  const mentionIDs = Object.keys(mentions ?? {});

  if (mentionIDs.length === 0) {
    await usage();
    return;
  }

  const victimID = mentionIDs[0]!;
  const victimName = (mentions?.[victimID] ?? victimID).replace(/^@/, '');

  // ── Self-steal guard ───────────────────────────────────────────────────────
  if (victimID === senderID) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: [
        `🥷 **Steal**`,
        `You attempt to steal from yourself...`,
        ``,
        `That's just called moving money around, genius.`,
      ].join('\n'),
    });
    return;
  }

  // ── Parse amount (last numeric arg, since args[0] may be the @mention text) ─
  const rawAmount = args[args.length - 1];
  const amount = r2(parseFloat(rawAmount ?? ''));

  if (isNaN(amount) || amount <= 0) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Invalid amount. Enter a positive number. Usage: `steal @user <amount>`',
    });
    return;
  }

  const penalty = r2(amount * 0.2);
  const fee = r2(penalty * 0.1);

  // ── Load balances ──────────────────────────────────────────────────────────
  const authorCoins = await currencies.getMoney(senderID);
  const victimCoins = await currencies.getMoney(victimID);

  if (victimCoins <= 0) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: [
        `🥷 **Steal**`,
        `You reached into their pockets and found... lint.`,
        ``,
        `**Result:**`,
        `🎯 Target: **${victimName}**`,
        `🪙 Balance: **0** coins`,
        ``,
        `Can't rob the already broke.`,
      ].join('\n'),
    });
    return;
  }

  if (victimCoins !== Infinity && victimCoins < amount) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ **${victimName}** only has **${formatCoins(victimCoins)}** coins — lower your steal amount.`,
    });
    return;
  }

  if (authorCoins !== Infinity && authorCoins < penalty) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: [
        `🥷 **Steal**`,
        `Hold on... you can't even afford to fail this heist.`,
        ``,
        `**Info:**`,
        `💸 Penalty if caught: **${penalty.toLocaleString()}** coins`,
        `🪙 Your balance: **${formatCoins(authorCoins)}** coins`,
        ``,
        `Get more coins before attempting this steal.`,
      ].join('\n'),
    });
    return;
  }

  // ── Daily limit check ─────────────────────────────────────────────────────
  const now = Date.now();
  const stealStats = await getStealStats(db, senderID);
  const effectiveSteals = resolveEffectiveSteals(stealStats, now);

  if (effectiveSteals >= MAX_DAILY_STEALS) {
    const msLeft = WINDOW_MS - (now - stealStats.lastStealAt);
    const hoursLeft = Math.floor(msLeft / (1000 * 60 * 60));
    const minsLeft = Math.floor((msLeft % (1000 * 60 * 60)) / (1000 * 60));
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: [
        `🥷 **Steal**`,
        `Slow down, you've been busy today...`,
        ``,
        `**Daily Limit:**`,
        `📊 Steals used: **${effectiveSteals}** / **${MAX_DAILY_STEALS}**`,
        `⏳ Resets in: **${hoursLeft}h ${minsLeft}m**`,
        ``,
        `Come back later, klepto.`,
      ].join('\n'),
    });
    return;
  }

  // ── Steal-protection check ─────────────────────────────────────────────────
  const protectionCount = await getStealProtection(db, victimID);
  if (protectionCount > 0) {
    // Consume the protection directly
    await consumeStealProtection(db, victimID, protectionCount);

    // Penalty: steal count +2
    const newCount = effectiveSteals + 2;
    await saveStealStats(db, senderID, {
      stealCount: newCount,
      lastStealAt: now,
    });

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: [
        `🥷 **Steal**`,
        `Oops! **${victimName}** has a 🛡️ **Steal Protection** equipped!`,
        ``,
        `**Steal Blocked:**`,
        `📊 Steals used: **${newCount}** / **${MAX_DAILY_STEALS}** (+2 penalty)`,
        ``,
        `Their shield is now gone though. Try again?`,
      ].join('\n'),
    });
    return;
  }

  // ── Attempt the steal ─────────────────────────────────────────────────────
  const chance = getSuccessChance(amount, false); // isAdmin check not available without role context
  const success = Math.random() <= chance;
  const newCount = effectiveSteals + 1;

  await saveStealStats(db, senderID, { stealCount: newCount, lastStealAt: now });

  const balanceId = btn.generateID({ id: BUTTON_ID.balance, public: false });
  const backId = btn.generateID({ id: BUTTON_ID.back, public: false });

  if (success) {
    await currencies.increaseMoney({ user_id: senderID, money: amount });
    await currencies.decreaseMoney({ user_id: victimID, money: amount });

    // increaseMoney is a no-op for infinity authors; balance stays Infinity
    const newAuthorBal = authorCoins === Infinity ? Infinity : r2(authorCoins + amount);

    const resultMessage = [
      `🥷 **Steal**`,
      `Slick hands, empty pockets... theirs! 🤑`,
      ``,
      `**Result:**`,
      `🎯 Target: **${victimName}**`,
      `💰 Stolen: **${amount.toLocaleString()}** coins`,
      `🎲 Chance: **${(chance * 100).toFixed(0)}%**`,
      ``,
      `**Balance:**`,
      `🪙 ${formatCoins(authorCoins)} → **${formatCoins(newAuthorBal)}** (**+${amount.toLocaleString()}**)`,
      ``,
      `**Daily Steals:**`,
      `📊 **${newCount}** / **${MAX_DAILY_STEALS}** used`,
      ``,
      `Crime pays... this time.`,
    ].join('\n');

    const ctx: CtxData = { resultMessage, balanceId, backId };

    // Cast context payloads to expected generic Record<string, unknown>
    btn.createContext({ id: balanceId, context: ctx as unknown as Record<string, unknown> });
    btn.createContext({ id: backId, context: ctx as unknown as Record<string, unknown> });

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: resultMessage,
      ...(hasNativeButtons(native.platform) ? { button: [balanceId] } : {}),
    });
  } else {
    await currencies.decreaseMoney({ user_id: senderID, money: penalty });
    await currencies.increaseMoney({ user_id: victimID, money: fee });

    // decreaseMoney is a no-op for infinity authors; balance stays Infinity
    const newAuthorBal = authorCoins === Infinity ? Infinity : r2(authorCoins - penalty);

    const resultMessage = [
      `🥷 **Steal**`,
      `Caught red-handed! You tripped on the way out. 😬`,
      ``,
      `**Result:**`,
      `🎯 Target: **${victimName}**`,
      `💸 Penalty: **${penalty.toLocaleString()}** coins`,
      `🧾 Fee (10%): **${fee.toLocaleString()}** → returned to target`,
      `🎲 Chance: **${(chance * 100).toFixed(0)}%**`,
      ``,
      `**Balance:**`,
      `🪙 ${formatCoins(authorCoins)} → **${formatCoins(newAuthorBal)}** (**-${penalty.toLocaleString()}**)`,
      ``,
      `**Daily Steals:**`,
      `📊 **${newCount}** / **${MAX_DAILY_STEALS}** used`,
      ``,
      `Better luck next time, clumsy.`,
    ].join('\n');

    const ctx: CtxData = { resultMessage, balanceId, backId };

    // Cast context payloads to expected generic Record<string, unknown>
    btn.createContext({ id: balanceId, context: ctx as unknown as Record<string, unknown> });
    btn.createContext({ id: backId, context: ctx as unknown as Record<string, unknown> });

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: resultMessage,
      ...(hasNativeButtons(native.platform) ? { button: [balanceId] } : {}),
    });
  }
};
