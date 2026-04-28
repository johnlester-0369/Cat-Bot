import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'troll',
  aliases: [],
  version: '1.0.0',
  role: Role.ANYONE,
  author: '@lianecagarah convert by AjiroDesu',
  description: 'Risk your money with this stupid game.',
  category: 'Economy',
  usage: '',
  cooldown: 20,
  hasPrefix: true,
} as const;

const winTexts = [
  'You trolled Kim Jong-un and won <amount> coins.',
  'You slapped the rich guy and got <amount> coins.',
  'You told Donald Trump that you were his missing son and he gave you <amount> coins.',
  'You dated a gay and got <amount> coins.',
  "You challenged Dwayne 'The Rock' Johnson to an arm wrestling match and won <amount> coins.",
  'You convinced Oprah to share her secret to success, earning you <amount> coins.',
  'You played poker with Elon Musk and won <amount> coins in Tesla stock.',
  'You serenaded Beyoncé and she rewarded you with <amount> coins.',
  "You made Gordon Ramsay's favorite dish perfectly and earned <amount> coins.",
  'You impressed Jeff Bezos with your business idea and received <amount> coins in funding.',
  'You taught Taylor Swift a new dance move and she paid you <amount> coins for the lesson.',
  'You challenged Cristiano Ronaldo to a soccer match and scored the winning goal, earning <amount> coins.',
  'You guessed the correct answer on a game show hosted by Ellen DeGeneres, winning <amount> coins.',
  'You gave a fashion tip to Lady Gaga and she gifted you <amount> coins worth of designer clothes.',
] as const;

const loseTexts = [
  'You got caught and lost <amount> coins.',
  'You slipped and fell and lost <amount> coins.',
  'You tried to outsmart Stephen Hawking in a chess game and lost <amount> coins.',
  'You challenged Jackie Chan to a martial arts duel and ended up with <amount> coins in medical bills.',
  'You attempted to race Usain Bolt and lost <amount> coins.',
  'You tried to outeat Joey Chestnut in a hot dog eating contest and lost <amount> coins.',
  'You challenged Simon Cowell to a singing competition and received <amount> coins for earplugs.',
  'You tried to outcook Gordon Ramsay and ended up with <amount> coins in restaurant bills.',
  'You challenged Serena Williams to a tennis match and lost <amount> coins.',
  'You tried to outcode Bill Gates and ended up with <amount> coins in software bugs.',
  'You challenged LeBron James to a basketball game and ended up with <amount> coins for a broken hoop.',
  'You challenged Michael Phelps to a swimming race and ended up with <amount> coins for swim lessons.',
] as const;

const BUTTON_ID = {
  balance: 'balance',
  back: 'back',
} as const;

type TrollButtonContext = {
  trollMessage: string;
  balanceId: string;
  backId: string;
};

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function formatCoins(amount: number): string {
  return Math.floor(amount).toLocaleString('en-US');
}

function buildTrollMessage(text: string): string {
  // Fixed: 'icon' does not exist on AppCtx type → using a perfect troll emoji instead
  const trollIcon = '🤡';
  return `${trollIcon}\n\n${text}`;
}

function buildBalanceMessage(balance: number): string {
  return `💰 **Current Balance:** ${formatCoins(balance)} coins`;
}

function readTrollButtonContext(
  sessionContext: unknown,
): TrollButtonContext | undefined {
  const ctx = sessionContext as Partial<TrollButtonContext> | undefined;
  if (!ctx?.trollMessage || !ctx.balanceId || !ctx.backId) return undefined;

  return {
    trollMessage: ctx.trollMessage,
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

      const context = readTrollButtonContext(session.context);
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
      const context = readTrollButtonContext(session.context);
      if (!context) return;

      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: event['messageID'] as string,
        message: context.trollMessage,
        ...(hasNativeButtons(native.platform)
          ? { button: [context.balanceId] }
          : {}),
      });
    },
  },
};

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, event, currencies, button: btn, native, usage } = ctx; // usage kept for consistency with slot command

  const senderID = event['senderID'] as string | undefined;

  if (!senderID) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Could not identify your account.',
    });
    return;
  }

  // ── Game logic ─────────────────────────────────────────────────────
  const userMoney = await currencies.getMoney(senderID);
  const outcome = Math.random() < 0.5 ? 'win' : 'lose';

  let amount = Math.floor(Math.random() * 100) + 1;
  if (outcome === 'lose' && userMoney < amount) {
    amount = userMoney;
  }

  const text =
    outcome === 'win'
      ? pick(winTexts).replace('<amount>', formatCoins(amount))
      : pick(loseTexts).replace('<amount>', formatCoins(amount));

  // Update balance (exactly like original)
  if (outcome === 'win') {
    await currencies.increaseMoney({ user_id: senderID, money: amount });
  } else {
    await currencies.decreaseMoney({ user_id: senderID, money: amount });
  }

  const trollMessage = buildTrollMessage(text);

  // ── Button setup (same as cleaned slot command) ───────────────────
  const balanceId = btn.generateID({ id: BUTTON_ID.balance, public: false });
  const backId = btn.generateID({ id: BUTTON_ID.back, public: false });

  const buttonContext: TrollButtonContext = {
    trollMessage,
    balanceId,
    backId,
  } satisfies TrollButtonContext;

  btn.update({ id: balanceId, label: '💰 Balance' });
  btn.update({ id: backId, label: '↩️ Back' });

  btn.createContext({ id: balanceId, context: buttonContext });
  btn.createContext({ id: backId, context: buttonContext });

  const payload = {
    style: MessageStyle.MARKDOWN,
    message: trollMessage,
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
