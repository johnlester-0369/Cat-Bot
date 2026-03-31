import type { ChatContext } from '@/adapters/models/context.model.js';

export const config = {
  name: 'ping',
  description: 'Check if bot is alive',
};

export const onCommand = async ({ chat }: { chat: ChatContext }) => {
  const start = Date.now();
  // Delegate to uniform context to automatically route response back to the origin
  await chat.replyMessage({
    message: `🏓 Pong! Latency: ${Date.now() - start}ms`,
  });
};
