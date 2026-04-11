import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';

export const config = {
  name: 'example_command',
  aliases: [] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'John Lester',
  description: 'Example command',
  category: 'Example',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

export const onCommand = async ({ chat }: AppCtx) => {
  // chat.replyMessage threads the response as a quote-reply to the triggering message
  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: '**Hello**',
  });
};
