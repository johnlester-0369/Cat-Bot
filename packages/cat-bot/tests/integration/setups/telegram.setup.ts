import { Telegraf } from 'telegraf';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { createTelegramApi } from '@/engine/adapters/platform/telegram/wrapper.js';
import {
  createThreadContext,
  createChatContext,
  createBotContext,
  createUserContext,
} from '@/engine/adapters/models/context.model.js';
import {
  TELEGRAM_CHAT_ID,
  TELEGRAM_BOT_ID,
  TELEGRAM_MESSAGE_ID,
  TELEGRAM_TARGET_USER_ID,
} from '../shared/test-ids.js';
import type { PlatformTestContext } from '../shared/test-types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function setupTelegram(): Promise<PlatformTestContext | null> {
  let token: string | undefined;

  try {
    const credPath = path.join(
      __dirname,
      '../../../../session/telegram/credential.json',
    );
    const creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
    token = creds.TELEGRAM_BOT_TOKEN;
  } catch {
    // Graceful fallback
  }

  if (!token) {
    console.warn(
      '[Telegram] TELEGRAM_BOT_TOKEN missing in credential.json — Telegram tests will be skipped',
    );
    return null;
  }

  try {
    const bot = new Telegraf(token);
    const chatId = Number(TELEGRAM_CHAT_ID);

    const mockCtx = {
      telegram: bot.telegram,
      chat: { id: chatId, type: 'supergroup' as const },
      from: {
        id: TELEGRAM_BOT_ID,
        is_bot: true,
        first_name: 'TeleBot',
        last_name: '',
        username: 'johnlester0369_telebot',
      },
      message: { message_id: 0, date: 0, chat: { id: chatId } },
      setChatTitle: (title: string) => bot.telegram.setChatTitle(chatId, title),
      deleteMessage: (msgId: number | string) =>
        bot.telegram.deleteMessage(chatId, Number(msgId)),
      setChatPhoto: (photo: unknown) =>
        bot.telegram.setChatPhoto(chatId, photo as string),
      deleteChatPhoto: () => bot.telegram.deleteChatPhoto(chatId),
    };

    const telegramApi = createTelegramApi(
      mockCtx as unknown as import('telegraf').Context,
    );
    const baseEvent = {
      threadID: TELEGRAM_CHAT_ID,
      messageID: TELEGRAM_MESSAGE_ID,
      senderID: TELEGRAM_TARGET_USER_ID,
      userID: TELEGRAM_TARGET_USER_ID,
    };

    console.info(
      `[Telegram] Context built for chat ${TELEGRAM_CHAT_ID} (bot ${TELEGRAM_BOT_ID})`,
    );

    return {
      platformName: 'Telegram',
      api: telegramApi,
      chatCtx: createChatContext(telegramApi, baseEvent),
      threadCtx: createThreadContext(telegramApi, baseEvent),
      userCtx: createUserContext(telegramApi),
      botCtx: createBotContext(telegramApi),
      botUserId: String(TELEGRAM_BOT_ID),
      targetUserId: TELEGRAM_TARGET_USER_ID,
      threadId: TELEGRAM_CHAT_ID,
      messageId: TELEGRAM_MESSAGE_ID,
      teardown: () => {},
    };
  } catch (err) {
    console.warn(`[Telegram] Setup failed: ${(err as Error).message}`);
    return null;
  }
}
