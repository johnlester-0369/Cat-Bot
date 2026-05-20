/**
 * /megaslot — 5-Reel Mega Slot Machine
 *
 * Spin five reels and win based on how many symbols match.
 * Bigger reels, bigger payouts — and bigger risks.
 *
 * Match table:
 * 2-of-a-kind → ×0.5  (partial return)
 * 3-of-a-kind → ×1    (break even)
 * 4-of-a-kind → ×10   (big win!)
 * 5-of-a-kind → ×25   (JACKPOT!)
 * No match    → ×−1   (full loss)
 *
 * Collection schema (bot_users_session.data → "megaslot" key):
 * { totalSpins: number, totalEarned: number, totalLost: number, jackpots: number }
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const SLOT_EMOJIS = [
  '🍒', '🍋', '🍇', '🍉', '🍀', '⭐', '🌙', '🔔',
  '💰', '💎', '🍍', '🍓', '🎰', '🪙', '🍊',
];
const REEL_COUNT = 5;

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'megaslot',
  aliases: ['megaspin', 'ms'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Spin the 5-reel mega slot machine for massive payouts.',
  category: 'Economy',
  usage: '<bet>',
  cooldown: 5,
  hasPrefix: true,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const r2 = (n: number) => Math.round(n * 100) / 100;

function parseBet(raw: string, balance: number): number {
  const v = raw.trim().toLowerCase().replace(/,/g, '');
  if (v === 'all' || v === 'max') return Math.floor(balance);
  if (v === 'half') return Math.floor(balance / 2);

  const m = v.match(/^(\d+(?:\.\d+)?)([kmb])?$/i);
  if (!m) return NaN;
  const amount = Number(m[1]);
  const suffix = m[2]?.toLowerCase();
  const mult =
    suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : suffix === 'b' ? 1_000_000_000 : 1;
  return Math.floor(amount * mult);
}

function spinReels(): string[] {
  return Array.from({ length: REEL_COUNT }, () =>
    SLOT_EMOJIS[Math.floor(Math.random() * SLOT_EMOJIS.length)]!,
  );
}

function getMaxMatches(reel: string[]): number {
  const freq: Record<string, number> = {};
  for (const s of reel) freq[s] = (freq[s] ?? 0) + 1;
  return Math.max(...Object.values(freq));
}

function getMultiplier(matches: number): number {
  if (matches === 2) return 0.5;
  if (matches === 3) return 1;
  if (matches === 4) return 10;
  if (matches === 5) return 25;
  return -1;
}

function getOutcomeLabel(matches: number): string {
  if (matches === 2) return '2 of a Kind!';
  if (matches === 3) return '3 of a Kind!';
  if (matches === 4) return '4 of a Kind! 🌟';
  if (matches === 5) return '5 of a Kind! 🎉 JACKPOT!';
  return 'No Match';
}

function getHeader(matches: number): string {
  if (matches === 2) return 'A glimmer of luck shines through! ✨';
  if (matches === 3) return 'The stars are aligning...! ⭐';
  if (matches === 4) return 'NICE! 4 of a kind! The machine nods in approval! 👏';
  if (matches === 5) return '🎉 JACKPOT!!! THE MEGA SLOT ERUPTS!!! 🎉';
  return 'The reels are ruthless... 😔';
}

function getFooter(matches: number): string {
  if (matches === 2) return 'A small spark! Two matched! ✨';
  if (matches === 3) return 'Three of a kind! The machine smiles upon you! 🎉';
  if (matches === 4) return 'Four of a kind! The machine is seriously impressed! 🌟';
  if (matches === 5) return 'FIVE OF A KIND!!! THE MEGA MACHINE IS ECSTATIC!!! 🤑🤑🤑';
  return 'The five reels had no mercy... better luck next time! 😬';
}

// ── Mega slot collection helpers ──────────────────────────────────────────────

interface MegaSlotStats {
  totalSpins: number;
  totalEarned: number;
  totalLost: number;
  jackpots: number;
}

async function getStats(db: AppCtx['db'], uid: string): Promise<MegaSlotStats> {
  const userColl = db.users.collection(uid);
  if (!(await userColl.isCollectionExist('megaslot'))) {
    return { totalSpins: 0, totalEarned: 0, totalLost: 0, jackpots: 0 };
  }
  const coll = await userColl.getCollection('megaslot');
  return {
    totalSpins: ((await coll.get('totalSpins')) as number | undefined) ?? 0,
    totalEarned: ((await coll.get('totalEarned')) as number | undefined) ?? 0,
    totalLost: ((await coll.get('totalLost')) as number | undefined) ?? 0,
    jackpots: ((await coll.get('jackpots')) as number | undefined) ?? 0,
  };
}

async function saveStats(db: AppCtx['db'], uid: string, stats: MegaSlotStats): Promise<void> {
  const userColl = db.users.collection(uid);
  if (!(await userColl.isCollectionExist('megaslot'))) {
    await userColl.createCollection('megaslot');
  }
  const coll = await userColl.getCollection('megaslot');
  await coll.set('totalSpins', stats.totalSpins);
  await coll.set('totalEarned', stats.totalEarned);
  await coll.set('totalLost', stats.totalLost);
  await coll.set('jackpots', stats.jackpots);
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
        message: `💰 **Current Balance:** ${coins.toLocaleString()} coins`,
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
  usage,
  db,
  currencies,
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

  const rawBet = args[0];
  if (!rawBet) {
    await usage();
    return;
  }

  const balance = await currencies.getMoney(senderID);
  const bet = parseBet(rawBet, balance);

  if (isNaN(bet) || bet <= 0) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Invalid bet amount. Enter a positive number.',
    });
    return;
  }

  if (balance < bet) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ Not enough coins. You have **${balance.toLocaleString()}** but tried to bet **${bet.toLocaleString()}**.`,
    });
    return;
  }

  // ── Spin ───────────────────────────────────────────────────────────────────
  const reel = spinReels();
  const matches = getMaxMatches(reel);
  const multiplier = getMultiplier(matches);
  const coinDelta = r2(bet * multiplier); // negative when multiplier = -1
  const isWin = coinDelta > 0;
  const isBreakEven = coinDelta === 0;

  const stats = await getStats(db, senderID);
  const newStats: MegaSlotStats = {
    totalSpins: stats.totalSpins + 1,
    totalEarned: stats.totalEarned + (isWin ? coinDelta : 0),
    totalLost: stats.totalLost + (!isWin && !isBreakEven ? Math.abs(coinDelta) : 0),
    jackpots: stats.jackpots + (matches === 5 ? 1 : 0),
  };

  // Apply balance change (note: coinDelta can be negative)
  if (isWin) {
    await currencies.increaseMoney({ user_id: senderID, money: coinDelta });
  } else if (!isBreakEven) {
    await currencies.decreaseMoney({ user_id: senderID, money: Math.abs(coinDelta) });
  }
  await saveStats(db, senderID, newStats);

  const balAfter = balance + coinDelta;
  const deltaStr =
    coinDelta >= 0
      ? `+${coinDelta.toLocaleString()}`
      : coinDelta.toLocaleString();

  const multiplierDisplay = multiplier > 0 ? `×${multiplier}` : '×0 (loss)';

  const resultMessage = [
    `🎰 **Mega Slot Machine**`,
    getHeader(matches),
    ``,
    `**Reels:**`,
    `[ ${reel.join(' | ')} ]`,
    ``,
    `**Result:**`,
    `🎯 Outcome: **${getOutcomeLabel(matches)}**`,
    `💰 Bet: **${bet.toLocaleString()}** coins`,
    `⚖️ Multiplier: **${multiplierDisplay}**`,
    ``,
    `**Balance:**`,
    `🪙 ${balance.toLocaleString()} → ${Math.round(balAfter).toLocaleString()} (**${deltaStr}**)`,
    ``,
    `**Your Stats:**`,
    `🎰 Total Spins: **${newStats.totalSpins.toLocaleString()}**`,
    `💰 Total Earned: **${newStats.totalEarned.toLocaleString()}** coins`,
    `🎉 Jackpots: **${newStats.jackpots.toLocaleString()}**`,
    ``,
    getFooter(matches),
  ].join('\n');

  const balanceId = btn.generateID({ id: BUTTON_ID.balance, public: false });
  const backId = btn.generateID({ id: BUTTON_ID.back, public: false });
  const ctx: CtxData = { resultMessage, balanceId, backId };

  // Cast context payloads to expected generic Record<string, unknown>
  btn.createContext({ id: balanceId, context: ctx as unknown as Record<string, unknown> });
  btn.createContext({ id: backId, context: ctx as unknown as Record<string, unknown> });

  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: resultMessage,
    ...(hasNativeButtons(native.platform) ? { button: [balanceId] } : {}),
  });
};
