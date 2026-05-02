import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';

export const config: CommandConfig = {
  name: 'unsend',
  version: '1.0.1',
  role: Role.ANYONE,
  author: 'John Lester',
  description: 'Unsend a message previously sent by the bot',
  category: 'system',
  usage: '<reply to message>',
  cooldown: 3,
  hasPrefix: true,
  platform: [
    Platforms.Discord,
    Platforms.Telegram,
    Platforms.FacebookMessenger,
  ]
};

export const onCommand = async ({
  chat,
  event,
  bot,
}: AppCtx): Promise<void> => {
  // Guard: command must be used as a reply to a message
  if (event['type'] !== 'message_reply') {
    await chat.replyMessage({
      style: MessageStyle.TEXT,
      message: 'Reply to the message you want to unsend.',
    });
    return;
  }

  const messageReply = event['messageReply'] as Record<string, unknown> | null;

  // Guard: the nested reply payload must be present
  if (!messageReply) {
    await chat.replyMessage({
      style: MessageStyle.TEXT,
      message: 'Reply to the message you want to unsend.',
    });
    return;
  }

  // Guard: only bot-sent messages can be unsent
  const botID = await bot.getID();
  if (messageReply['senderID'] !== botID) {
    await chat.replyMessage({
      style: MessageStyle.TEXT,
      message: "Can't unsend a message from another user.",
    });
    return;
  }

  await chat.unsendMessage(messageReply['messageID'] as string);
};
