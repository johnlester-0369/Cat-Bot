import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';

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

export const onCommand = async ({ chat }: AppCtx) => {
  const start = Date.now();
  // Delegate to uniform context to automatically route response back to the origin
  await chat.replyMessage({
    message: `🏓 Pong! Latency: ${Date.now() - start}ms`,
  });
};
