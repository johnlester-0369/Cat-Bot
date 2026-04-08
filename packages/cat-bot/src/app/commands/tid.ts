import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';

export const config = {
  name: 'tid',
  aliases: [] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'John Lester',
  description: 'Replies with the current thread / group / channel ID',
  category: 'Info',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

export const onCommand = async ({
  chat,
  event,
}: AppCtx): Promise<void> => {
  const threadID = event['threadID'] as string | undefined;
  await chat.replyMessage({
    message: threadID ? `Thread ID: ${threadID}` : '❌ Could not resolve thread ID for this platform.',
  });
};
