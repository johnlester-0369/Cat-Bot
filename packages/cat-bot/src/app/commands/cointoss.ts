/**
 * /cointoss — Coin Flip Gamble
 *
 * Toss a coin and bet on the outcome. Win to earn 50 % profit on your
 * bet; lose to forfeit the full wager. Supports "all", "half", k/m/b shorthand.
 *
 * Win:  +bet × 0.5 coins added to wallet
 * Lose: −bet      coins removed from wallet
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'cointoss',
  aliases: ['ct', 'coinflip', 'cf'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Toss a coin and bet some of your coins on the outcome.',
  category: 'Economy',
  usage: '<bet> <heads | tails>',
  cooldown: 10,
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
  const rawSide = args[1]?.toLowerCase();

  if (!rawBet || !rawSide) {
    await usage();
    return;
  }

  if (rawSide !== 'heads' && rawSide !== 'tails') {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Invalid side. Choose either **heads** or **tails**.',
    });
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

  const result = Math.random() < 0.5 ? 'heads' : 'tails';
  const won = result === rawSide;
  const profit = won ? r2(bet * 0.5) : 0;
  const newBalance = won
    ? await currencies.increaseMoney({ user_id: senderID, money: profit }).then(() => balance + profit)
    : await currencies.decreaseMoney({ user_id: senderID, money: bet }).then(() => balance - bet);

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const coinEmoji = result === 'heads' ? '🟡' : '⚫';

  const resultMessage = won
    ? [
        `🪙 **Coin Toss**`,
        `The coin has spoken... fortune favors you! 🪙`,
        ``,
        `**Result:**`,
        `${coinEmoji} Side Won: **${cap(result)}**`,
        `💰 Your Bet: **${bet.toLocaleString()}** coins`,
        `🎉 Outcome: **You won!**`,
        ``,
        `**Balance:**`,
        `🪙 ${balance.toLocaleString()} → ${r2(newBalance).toLocaleString()} (**+${profit.toLocaleString()}**)`,
        ``,
        `+${profit.toLocaleString()} coins richer. keep it up! 🤑`,
      ].join('\n')
    : [
        `🪙 **Coin Toss**`,
        `The coin has spoken... luck wasn't on your side. 😔`,
        ``,
        `**Result:**`,
        `${coinEmoji} Side Won: **${cap(result)}**`,
        `💰 Your Bet: **${bet.toLocaleString()}** coins`,
        `💸 Outcome: **You lost!**`,
        ``,
        `**Balance:**`,
        `🪙 ${balance.toLocaleString()} → ${r2(newBalance).toLocaleString()} (**-${bet.toLocaleString()}**)`,
        ``,
        `${bet.toLocaleString()} coins gone. better luck next time! 😬`,
      ].join('\n');

  const balanceId = btn.generateID({ id: BUTTON_ID.balance, public: false });
  const backId = btn.generateID({ id: BUTTON_ID.back, public: false });
  const ctx: CtxData = { resultMessage, balanceId, backId };

  // Cast context payloads to expected generic Record<string, unknown> to resolve TS2322
  btn.createContext({ id: balanceId, context: ctx as unknown as Record<string, unknown> });
  btn.createContext({ id: backId, context: ctx as unknown as Record<string, unknown> });

  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: resultMessage,
    ...(hasNativeButtons(native.platform) ? { button: [balanceId] } : {}),
  });
};
