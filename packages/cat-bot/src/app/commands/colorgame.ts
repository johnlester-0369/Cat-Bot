/**
 * /colorgame — Color Betting Game
 *
 * Bet on one or more colors simultaneously. A random color is drawn;
 * winning bets are paid out at the color's multiplier, losing bets
 * are forfeited. Violet is rarer but pays 4.5×.
 *
 * Usage:
 * colorgame <bet> <color>               — single bet
 * colorgame <bet> <color>, <bet> <color> — multiple bets
 * colorgame --list                       — show payout table
 *
 * Payout rates: red/blue/green/yellow/orange × 1.95 | violet × 4.5
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const PAYOUT_RATES: Record<string, number> = {
  red: 1.95,
  blue: 1.95,
  green: 1.95,
  yellow: 1.95,
  orange: 1.95,
  violet: 4.5,
};

const COLOR_EMOJIS: Record<string, string> = {
  red: '🔴',
  green: '🟢',
  blue: '🔵',
  yellow: '🟡',
  orange: '🟠',
  violet: '🟣',
};

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'colorgame',
  aliases: ['cg', 'color'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description:
    'Bet on a color and win based on payout multipliers. Separate multiple bets with commas.',
  category: 'Economy',
  usage: '<bet> <color> [, <bet> <color> ...] | --list',
  cooldown: 10,
  hasPrefix: true,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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

/** Parse "100 red, 50 violet" → [{ bet:100, color:'red' }, { bet:50, color:'violet' }] */
function parseBets(rawArgs: string[]): Array<{ bet: number; color: string }> | null {
  // Re-join all args and split on commas to allow spaces around commas
  const full = rawArgs.join(' ');
  const segments = full.split(',').map((s) => s.trim()).filter(Boolean);

  const results: Array<{ bet: number; color: string }> = [];
  for (const seg of segments) {
    const parts = seg.trim().split(/\s+/);
    if (parts.length < 2) return null;
    const betRaw = parts[0]!;
    const color = parts[1]!.toLowerCase();
    if (!PAYOUT_RATES[color]) return null;
    const bet = parseFloat(betRaw);
    if (isNaN(bet) || bet <= 0) return null;
    results.push({ bet: Math.round(bet * 100) / 100, color });
  }

  return results.length > 0 ? results : null;
}

function getRandomColor(): string {
  const colors = Object.keys(PAYOUT_RATES);
  return colors[Math.floor(Math.random() * colors.length)]!;
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

// ── Color list message ────────────────────────────────────────────────────────

function colorListMessage(): string {
  const body = Object.keys(PAYOUT_RATES)
    .map((c) => `  ${COLOR_EMOJIS[c]} ${cap(c).padEnd(8)} → ${c} (×${PAYOUT_RATES[c]})`)
    .join('\n');

  return [
    `🎡 **Color Game**`,
    `The wheel speaks in six colors… choose your fate wisely.`,
    ``,
    `**Available Colors:**`,
    body,
    ``,
    `Place your bets before the round begins… luck doesn't wait. 🎲`,
  ].join('\n');
}

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

  // ── --list flag ────────────────────────────────────────────────────────────
  if (args[0]?.toLowerCase() === '--list') {
    await chat.replyMessage({ style: MessageStyle.MARKDOWN, message: colorListMessage() });
    return;
  }

  if (args.length === 0) {
    await usage();
    return;
  }

  const betsArr = parseBets(args);
  if (!betsArr) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: [
        `🎡 **Color Game**`,
        `That command didn't quite land right… check the format and try again. 😬`,
        ``,
        `**Help:**`,
        `📌 Format: \`colorgame <bet> <color> [, <bet> <color>]\``,
        `🎨 Colors: \`colorgame --list\``,
      ].join('\n'),
    });
    return;
  }

  // Accumulate same-color bets
  const bets: Record<string, number> = {};
  for (const { bet, color } of betsArr) {
    bets[color] = (bets[color] ?? 0) + bet;
  }

  const totalBet = Object.values(bets).reduce((a, b) => a + b, 0);
  const balance = await currencies.getMoney(senderID);

  if (balance < totalBet) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: [
        `🎡 **Color Game**`,
        `Your pockets aren't deep enough for this bet… 😬`,
        ``,
        `**Error:** Insufficient balance`,
        `💸 Total Bet    : **${totalBet.toLocaleString()}** coins`,
        `🪙 Your Balance : **${balance.toLocaleString()}** coins`,
        ``,
        `Top up and try again… the wheel waits for no one. 🎡`,
      ].join('\n'),
    });
    return;
  }

  // ── Spin the wheel ─────────────────────────────────────────────────────────
  const wonColor = getRandomColor();
  let netDelta = -totalBet;
  if (bets[wonColor] !== undefined) {
    netDelta += bets[wonColor]! * PAYOUT_RATES[wonColor]!;
  }
  const didWin = netDelta > 0;

  if (didWin) {
    await currencies.increaseMoney({ user_id: senderID, money: Math.round(netDelta) });
  } else {
    await currencies.decreaseMoney({ user_id: senderID, money: Math.round(Math.abs(netDelta)) });
  }

  const balAfter = balance + netDelta;
  const deltaSign = netDelta >= 0 ? '+' : '';
  const deltaStr = `${deltaSign}${Math.round(netDelta).toLocaleString()}`;
  const wonEmoji = COLOR_EMOJIS[wonColor];
  const headerFlair = didWin
    ? 'The colors have settled... fortune smiles upon you. ✨'
    : 'The colors have settled... fate has chosen. 🎡';

  const breakdownLines = Object.entries(bets)
    .map(([color, bet]) => {
      const emoji = COLOR_EMOJIS[color];
      const padded = cap(color).padEnd(7);
      if (color === wonColor) {
        const payout = Math.round(bet * PAYOUT_RATES[wonColor]!);
        return `  ${emoji} ${padded} → ${bet.toLocaleString()} ✅ (×${PAYOUT_RATES[wonColor]} = **${payout.toLocaleString()}**)`;
      }
      return `  ${emoji} ${padded} → ${bet.toLocaleString()} ❌`;
    })
    .join('\n');

  const closingLine = didWin
    ? `${wonEmoji} ${cap(wonColor)} hit… luck actually showed up this time! ✨`
    : `${totalBet.toLocaleString()} coins gone in a blink... the wheel showed no mercy. 😬`;

  const resultMessage = [
    `🎡 **Color Game**`,
    headerFlair,
    ``,
    `**Result:**`,
    `🎯 Winning Color: ${wonEmoji} **${cap(wonColor)}**`,
    `💰 Total Bet: **${totalBet.toLocaleString()}** coins`,
    `🧾 Outcome: **${didWin ? 'You won!' : 'You lost!'}**`,
    ``,
    `**Bets Breakdown:**`,
    breakdownLines,
    ``,
    `**Balance:**`,
    `🪙 ${Math.round(balance).toLocaleString()} → ${Math.round(balAfter).toLocaleString()} (**${deltaStr}**)`,
    ``,
    closingLine,
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
