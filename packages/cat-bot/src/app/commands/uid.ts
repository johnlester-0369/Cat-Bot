import type { ChatContext } from '@/engine/adapters/models/context.model.js';
import { Role } from '@/engine/constants/role.constants.js';

export const config = {
  name: 'uid',
  aliases: [] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'John Lester',
  description: "Replies with the sender's platform user ID",
  category: 'Info',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

export const onCommand = async ({
  chat,
  event,
}: {
  chat: ChatContext;
  event: Record<string, unknown>;
}): Promise<void> => {
  const senderID = event['senderID'] as string | undefined;
  await chat.replyMessage({
    message: senderID ? `Your user ID: ${senderID}` : '❌ Could not resolve sender ID for this platform.',
  });
};