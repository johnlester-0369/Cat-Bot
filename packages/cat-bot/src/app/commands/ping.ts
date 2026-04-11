import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';

export const config = {
  name: 'ping',
  aliases: [] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'John Lester',
  description: 'Check if bot is alive',
  category: '',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

export const onCommand = async ({ chat, startTime }: AppCtx) => {
  // Delegate to uniform context to automatically route response back to the origin
  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: `🏓 Pong! Latency: \`${Date.now() - startTime}ms\``,
  });
};
