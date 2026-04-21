import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'example_on_chat',
  aliases: [] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'John Lester',
  description: 'An example passive listener that triggers on every message',
  category: 'Example',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

/**
 * onChat is executed for EVERY incoming message BEFORE prefix parsing and command dispatch.
 *
 * Useful for cross-cutting features like passive word filtering, auto-responders,
 * or experience point (XP) trackers that need to evaluate all conversational traffic.
 */
export const onChat = async ({ event, chat }: AppCtx): Promise<void> => {
  const message = event['message'] as string;
  if (!message) return;

  // Example functionality: React to any message containing the word "heart"
  if (message.toLowerCase().includes('heart')) {
    await chat.reactMessage('❤️');
  }
};
