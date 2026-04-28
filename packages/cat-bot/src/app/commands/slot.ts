import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

const FRUITS = ['🍒', '🍎', '🍓', '🍌', '🍊', '🍇', '🍐', '🍋'] as const;
const HIGH_ROLL_LIMIT = 100_000;
const MAX_BET_PERCENTAGE = 0.75;

type SlotState = {
  wins: number;
  losses: number;
  winStreak: number;
  highRollPass: boolean;
};

type SlotButtonContext = {
  slotMessage: string;
  balanceId: string;
  backId: string;
};

export const config: CommandConfig = {
  name: 'slot',
  aliases: ['slots', 'slotmachine'],
  version: '1.0.0',
  role: Role.ANYONE,
  author: '@lianecagarah convert by AjiroDesu',
  description: 'Play the slot machine game.',
  category: 'Economy',
  usage: '<bet>',
  cooldown: 3,
  hasPrefix: true,
} as const;

const BUTTON_ID = {
  balance: 'balance',
  back: 'back',
} as const;

/** Formats a coin amount with thousands separators. */
function formatCoins(amount: number): string {
  return Math.floor(amount).toLocaleString('en-US');
}

/** Returns a random fruit emoji. */
function randomFruit(): string {
  return FRUITS[Math.floor(Math.random() * FRUITS.length)]!;
}

/**
 * Counts matching fruits in the 3-reel result.
 * - 0 = all different → multiplier 0 (loss)
 * - 1 = exactly one pair → multiplier 2
 * - 2 = all three the same → multiplier 3
 */
function countMatches(result: readonly string[]): number {
  const uniqueCount = new Set(result).size;
  return 3 - uniqueCount; // Optimized & crystal-clear vs original loop
}

/** Parses user bet input (supports numbers, k/m/b, "all"/"max"/"half"). */
function parseBetInput(raw: string, balance: number): number {
  const value = raw.trim().toLowerCase().replace(/,/g, '');

  if (!value) return NaN;
  if (value === 'all' || value === 'max') return Math.floor(balance);
  if (value === 'half') return Math.floor(balance / 2);

  const match = value.match(/^(\d+(?:\.\d+)?)([kmb])?$/i);
  if (!match) return NaN;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return NaN;

  const suffix = match[2]?.toLowerCase();
  const multiplier =
    suffix === 'k'
      ? 1_000
      : suffix === 'm'
        ? 1_000_000
        : suffix === 'b'
          ? 1_000_000_000
          : 1;

  return Math.floor(amount * multiplier);
}

/** Ensures the user's slot collection exists (single source of truth). */
async function getSlotCollection(ctx: AppCtx) {
  const senderID = ctx.event['senderID'] as string;
  const userColl = ctx.db.users.collection(senderID);

  if (!(await userColl.isCollectionExist('slot'))) {
    await userColl.createCollection('slot');
  }
  return userColl.getCollection('slot');
}

async function getSlotState(ctx: AppCtx): Promise<SlotState> {
  const slot = await getSlotCollection(ctx);
  const data = (await slot.get('state')) as Partial<SlotState> | undefined;

  return {
    wins: Number(data?.wins ?? 0),
    losses: Number(data?.losses ?? 0),
    winStreak: Number(data?.winStreak ?? 0),
    highRollPass: Boolean(data?.highRollPass ?? false),
  };
}

async function saveSlotState(ctx: AppCtx, state: SlotState): Promise<void> {
  const slot = await getSlotCollection(ctx);
  await slot.update('state', state);
}

function buildSlotMessage(params: {
  result: string[];
  won: number;
  lost: number;
  total: number;
  winStreak: number;
  gotPass: boolean;
}): string {
  const { result, won, lost, total, winStreak, gotPass } = params;
  const isNetLoss = total < 0;

  return `🎰 **Slot Result**

{ ${result.join(' , ')} }

**You won:** ${formatCoins(won)} coins
**You lost:** ${formatCoins(lost)} coins

**Total ${isNetLoss ? 'Losses' : 'Wins'}:** ${formatCoins(Math.abs(total))} coins
**Win Streak:** ${winStreak}${winStreak > 7 ? '' : '/7'}${gotPass ? '\n🃏 You unlocked a **HighRoll Pass**!' : ''}`;
}

function buildBalanceMessage(balance: number): string {
  return `💰 **Current Balance:** ${formatCoins(balance)} coins`;
}

function readSlotButtonContext(
  sessionContext: unknown,
): SlotButtonContext | undefined {
  const ctx = sessionContext as Partial<SlotButtonContext> | undefined;
  if (!ctx?.slotMessage || !ctx.balanceId || !ctx.backId) return undefined;

  return {
    slotMessage: ctx.slotMessage,
    balanceId: ctx.balanceId,
    backId: ctx.backId,
  };
}

export const button = {
  [BUTTON_ID.balance]: {
    label: '💰 Balance',
    style: ButtonStyle.SECONDARY,
    onClick: async ({ chat, event, native, session, currencies }: AppCtx) => {
      const senderID = event['senderID'] as string | undefined;
      if (!senderID) return;

      const context = readSlotButtonContext(session.context);
      if (!context) return;

      const balance = await currencies.getMoney(senderID);
      const balanceMessage = buildBalanceMessage(balance);

      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: event['messageID'] as string,
        message: balanceMessage,
        ...(hasNativeButtons(native.platform)
          ? { button: [context.backId] }
          : {}),
      });
    },
  },

  [BUTTON_ID.back]: {
    label: '↩️ Back',
    style: ButtonStyle.SECONDARY,
    onClick: async ({ chat, event, native, session }: AppCtx) => {
      const context = readSlotButtonContext(session.context);
      if (!context) return;

      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: event['messageID'] as string,
        message: context.slotMessage,
        ...(hasNativeButtons(native.platform)
          ? { button: [context.balanceId] }
          : {}),
      });
    },
  },
};

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { args, chat, usage, currencies, button: btn, native, event } = ctx;
  const senderID = event['senderID'] as string;

  if (!senderID) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Could not identify your account.',
    });
    return;
  }

  const betRaw = args[0];
  if (!betRaw) {
    await usage();
    return;
  }

  const balance = await currencies.getMoney(senderID);
  const betAmount = parseBetInput(betRaw, balance);

  if (!Number.isFinite(betAmount) || betAmount <= 0) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ Invalid bet amount.\n\nYour current balance is **${formatCoins(balance)} coins**.`,
    });
    return;
  }

  const state = await getSlotState(ctx);

  if (!state.highRollPass && betAmount > HIGH_ROLL_LIMIT) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `🃏 You need a **HighRoll Pass** to place bets over **${formatCoins(HIGH_ROLL_LIMIT)} coins**.`,
    });
    return;
  }

  if (betAmount > balance * MAX_BET_PERCENTAGE) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ You cannot bet more than **${Math.round(MAX_BET_PERCENTAGE * 100)}%** of your balance.`,
    });
    return;
  }

  if (betAmount > balance) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ You do not have enough coins.\n\nYou tried to bet **${formatCoins(betAmount)} coins** but only have **${formatCoins(balance)} coins**.`,
    });
    return;
  }

  // ── Game logic ─────────────────────────────────────────────────────
  const result = [randomFruit(), randomFruit(), randomFruit()];
  const matches = countMatches(result);
  const multipliers: Record<number, number> = { 0: 0, 1: 2, 2: 3 };
  const multiplier = multipliers[matches] ?? 0;

  let won = 0;
  let lost = 0;
  let gotPass = false;

  if (matches > 0) {
    won = betAmount * multiplier;
    state.wins += won;
    state.winStreak += 1;

    if (!state.highRollPass && state.winStreak >= 7) {
      state.highRollPass = true;
      gotPass = true;
    }
  } else {
    lost = betAmount;
    state.losses += lost;
    state.winStreak = Math.max(0, state.winStreak - 1);
  }

  // Parallel DB operations for maximum efficiency (currency + persistent state)
  const currencyUpdate =
    matches > 0
      ? currencies.increaseMoney({ user_id: senderID, money: won })
      : currencies.decreaseMoney({ user_id: senderID, money: lost });

  const totalNet = state.wins - state.losses;
  const slotMessage = buildSlotMessage({
    result,
    won,
    lost,
    total: totalNet,
    winStreak: state.winStreak,
    gotPass,
  });

  await Promise.all([currencyUpdate, saveSlotState(ctx, state)]);

  // ── Button setup ───────────────────────────────────────────────────
  const balanceId = btn.generateID({ id: BUTTON_ID.balance, public: false });
  const backId = btn.generateID({ id: BUTTON_ID.back, public: false });

  const buttonContext: SlotButtonContext = {
    slotMessage,
    balanceId,
    backId,
  } satisfies SlotButtonContext;

  btn.update({ id: balanceId, label: '💰 Balance' });
  btn.update({ id: backId, label: '↩️ Back' });

  btn.createContext({ id: balanceId, context: buttonContext });
  btn.createContext({ id: backId, context: buttonContext });

  const payload = {
    style: MessageStyle.MARKDOWN,
    message: slotMessage,
    ...(hasNativeButtons(native.platform) ? { button: [balanceId] } : {}),
  };

  if (event['type'] === 'button_action') {
    await chat.editMessage({
      ...payload,
      message_id_to_edit: event['messageID'] as string,
    });
    return;
  }

  await chat.replyMessage(payload);
};
