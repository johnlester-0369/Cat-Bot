import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';

export const config = {
  name: 'uid',
  aliases: [] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'John Lester',
  description: "Replies with the sender's platform user ID, or the replied user's ID",
  category: 'Info',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

export const onCommand = async ({
  chat,
  event,
}: AppCtx): Promise<void> => {
  const messageReply = event['messageReply'] as Record<string, unknown> | undefined;
  
  // Extract replied message's sender ID if available; otherwise fallback to the command sender
  const targetID = (messageReply?.['senderID'] as string | undefined) ?? (event['senderID'] as string | undefined);
  const isReply = !!messageReply?.['senderID'];

  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: targetID
      ? (isReply ? `**Replied user ID:** \`${targetID}\`` : `**Your user ID:** \`${targetID}\``)
      : '❌ Could not resolve user ID for this platform.',
  });
};
