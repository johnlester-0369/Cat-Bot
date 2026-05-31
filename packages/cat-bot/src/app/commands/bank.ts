import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { formatCoins } from '@/engine/lib/currencies.lib.js';

const TAX_RATE = 0.05;
const r2 = (n: number) => Math.round(n * 100) / 100;

export const config: CommandConfig = {
  name: 'bank',
  aliases: [] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description:
    'Deposit coins into or withdraw coins from your bank account. Withdrawals have a 5% tax.',
  category: 'Economy',
  usage: '<deposit | withdraw> <amount>',
  cooldown: 5,
  hasPrefix: true,
  options: [
    {
      type: OptionType.string,
      name: 'action',
      description: 'deposit or withdraw',
      required: true,
    },
    {
      type: OptionType.string,
      name: 'amount',
      description: 'Amount to deposit or withdraw (e.g. 100, 1k, all)',
      required: true,
    },
  ],
};

async function getBankBalance(db: AppCtx['db'], uid: string): Promise<number> {
  const userColl = db.users.collection(uid);
  if (!(await userColl.isCollectionExist('bank'))) return 0;
  const bankColl = await userColl.getCollection('bank');
  return ((await bankColl.get('balance')) as number | undefined) ?? 0;
}

async function setBankBalance(
  db: AppCtx['db'],
  uid: string,
  amount: number,
): Promise<void> {
  const userColl = db.users.collection(uid);
  if (!(await userColl.isCollectionExist('bank'))) {
    await userColl.createCollection('bank');
  }
  const bankColl = await userColl.getCollection('bank');
  await bankColl.set('balance', r2(amount));
}

const BUTTON_ID = { overview: 'overview', back: 'back' } as const;

export const button = {
  [BUTTON_ID.overview]: {
    label: '💳 Bank Overview',
    style: ButtonStyle.SECONDARY,
    onClick: async ({ chat, event, db, currencies, native, button: btn }: AppCtx) => {
      const senderID = event['senderID'] as string | undefined;
      const backId = btn.generateID({ id: BUTTON_ID.back });

      if (!senderID) {
        await chat.editMessage({
          style: MessageStyle.MARKDOWN,
          message_id_to_edit: event['messageID'] as string,
          message: '❌ Could not identify your user ID on this platform.',
          ...(hasNativeButtons(native.platform) ? { button: [backId] } : {}),
        });
        return;
      }

      const wallet = await currencies.getMoney(senderID);
      const bank = await getBankBalance(db, senderID);
      // wallet + bank: if wallet is Infinity the total is also Infinity
      const total = wallet === Infinity ? Infinity : r2(wallet + bank);

      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: event['messageID'] as string,
        message: [
          `🏦 **Bank Overview**`,
          ``,
          `💰 Wallet : **${formatCoins(wallet)}** coins`,
          `🏦 Bank   : **${formatCoins(bank)}** coins`,
          `💎 Total  : **${formatCoins(total)}** coins`,
          ``,
          `_5% tax applies on withdrawals._`,
        ].join('\n'),
        ...(hasNativeButtons(native.platform) ? { button: [backId] } : {}),
      });
    },
  },
  [BUTTON_ID.back]: {
    label: '⬅ Back',
    style: ButtonStyle.SECONDARY,
    onClick: async ({ chat, event, db, native, button: btn }: AppCtx) => {
      const senderID = event['senderID'] as string | undefined;
      const overviewId = btn.generateID({ id: BUTTON_ID.overview });

      if (!senderID) {
        await chat.editMessage({
          style: MessageStyle.MARKDOWN,
          message_id_to_edit: event['messageID'] as string,
          message: '❌ Could not identify your user ID on this platform.',
          ...(hasNativeButtons(native.platform) ? { button: [overviewId] } : {}),
        });
        return;
      }

      const userColl = db.users.collection(senderID);

      if (!(await userColl.isCollectionExist('bank'))) {
        await chat.editMessage({
          style: MessageStyle.MARKDOWN,
          message_id_to_edit: event['messageID'] as string,
          message: [
            `🏦 **Bank**`,
            ``,
            `You don't have a bank account yet. Use \`/bank deposit <amount>\` to start!`,
          ].join('\n'),
          ...(hasNativeButtons(native.platform) ? { button: [overviewId] } : {}),
        });
        return;
      }

      const bankColl = await userColl.getCollection('bank');
      const lastReceipt = (await bankColl.get('lastReceipt')) as string | undefined;

      // Restores the last successful transaction receipt if it exists
      if (!lastReceipt) {
        await chat.editMessage({
          style: MessageStyle.MARKDOWN,
          message_id_to_edit: event['messageID'] as string,
          message: [
            `🏦 **Bank**`,
            ``,
            `Use \`/bank deposit <amount>\` or \`/bank withdraw <amount>\` to manage your coins.`,
          ].join('\n'),
          ...(hasNativeButtons(native.platform) ? { button: [overviewId] } : {}),
        });
        return;
      }

      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: event['messageID'] as string,
        message: lastReceipt,
        ...(hasNativeButtons(native.platform) ? { button: [overviewId] } : {}),
      });
    },
  },
};

export const onCommand = async ({
  chat,
  event,
  args,
  db,
  currencies,
  native,
  button: btn,
  usage,
}: AppCtx): Promise<void> => {
  const senderID = event['senderID'] as string | undefined;
  if (!senderID) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Could not identify your user ID on this platform.',
    });
    return;
  }

  const operation = args[0]?.toLowerCase();
  const rawAmount = args[1];

  if (operation !== 'deposit' && operation !== 'withdraw') {
    await usage();
    return;
  }

  const amount = r2(parseFloat(rawAmount ?? ''));
  if (isNaN(amount) || amount <= 0) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Invalid amount. Please enter a positive number.',
    });
    return;
  }

  const walletCoins = await currencies.getMoney(senderID);
  const bankBalance = await getBankBalance(db, senderID);

  const overviewId = btn.generateID({ id: BUTTON_ID.overview });

  // Ensure bank collection exists to save lastReceipt safely
  const userColl = db.users.collection(senderID);
  if (!(await userColl.isCollectionExist('bank'))) {
    await userColl.createCollection('bank');
  }
  const bankColl = await userColl.getCollection('bank');

  if (operation === 'deposit') {
    if (walletCoins === Infinity) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `♾️ Your wallet already has **∞** coins — depositing into the bank isn't needed.`,
      });
      return;
    }
    if (walletCoins < amount) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ Not enough coins — you have **${formatCoins(walletCoins)}** but tried to deposit **${amount.toLocaleString()}**.`,
      });
      return;
    }

    await currencies.decreaseMoney({ user_id: senderID, money: amount });
    const newBank = r2(bankBalance + amount);
    const newWallet = r2(walletCoins - amount);
    await setBankBalance(db, senderID, newBank);

    const receiptMsg = [
      `🏦 **Bank — Deposit**`,
      ``,
      `💰 Deposited : **${amount.toLocaleString()}** coins`,
      `🏦 Bank      : **${formatCoins(newBank)}** coins`,
      `🪙 Wallet    : **${formatCoins(newWallet)}** coins`,
    ].join('\n');

    // Store the formatted string directly in the session database so the Back button can reconstruct the exact view later
    await bankColl.set('lastReceipt', receiptMsg);

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: receiptMsg,
      ...(hasNativeButtons(native.platform) ? { button: [overviewId] } : {}),
    });
    return;
  }

  if (bankBalance < amount) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ Not enough bank balance — you have **${formatCoins(bankBalance)}** but tried to withdraw **${amount.toLocaleString()}**.`,
    });
    return;
  }

  const tax = r2(amount * TAX_RATE);
  const received = r2(amount - tax);
  const newBank = r2(bankBalance - amount);
  const newWallet = walletCoins === Infinity ? Infinity : r2(walletCoins + received);

  await setBankBalance(db, senderID, newBank);
  await currencies.increaseMoney({ user_id: senderID, money: received });

  const receiptMsg = [
    `🏦 **Bank — Withdrawal**`,
    ``,
    `💸 Withdrew : **${amount.toLocaleString()}** coins`,
    `🧾 Tax (5%) : **${tax.toLocaleString()}** coins`,
    `✅ Received : **${received.toLocaleString()}** coins`,
    `🏦 Bank     : **${formatCoins(newBank)}** coins`,
    `🪙 Wallet   : **${formatCoins(newWallet)}** coins`,
  ].join('\n');

  // Store the formatted string for the Back button
  await bankColl.set('lastReceipt', receiptMsg);

  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: receiptMsg,
    ...(hasNativeButtons(native.platform) ? { button: [overviewId] } : {}),
  });
};
