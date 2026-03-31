import type { ChatContext } from '@/adapters/models/context.model.js';

export const config = {
  name: 'example-command',
  description: 'Example command',
  hasPrefix: true, // default — set to false to allow invocation without the prefix (e.g. "hi" instead of "/hi")
  cooldown: 5, // 5-second per-user cooldown; omit or set to 0 to disable
};

export const onCommand = async ({ chat }: { chat: ChatContext }) => {
  // chat.replyMessage threads the response as a quote-reply to the triggering message
  await chat.replyMessage({
    message: 'Hello',
  });
};
