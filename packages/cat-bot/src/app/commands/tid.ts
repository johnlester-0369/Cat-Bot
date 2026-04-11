import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';

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
  thread,
}: AppCtx): Promise<void> => {
  const threadID = event['threadID'] as string | undefined;
  if (!threadID) {
    await chat.replyMessage({ style: MessageStyle.MARKDOWN, message: '❌ Could not resolve thread ID for this platform.' });
    return;
  }
  // thread.getName() is cache-first (Discord/Telegram) or DB-backed (FB) — no extra API round-trip
  const threadName = await thread.getName();
  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: `**Thread ID:** \`${threadID}\`\n**Thread Name:** ${threadName}`,
  });
};
