import type { BaseCtx } from '@/types/controller.types.js';

export const config = {
  name: 'example-on-chat',
  description: 'An example passive listener that triggers on every message',
  // hasPrefix is ignored for onChat runners, but defining it is good practice
  // if this file also exported an onCommand handler.
  hasPrefix: false,
};

/**
 * onChat is executed for EVERY incoming message BEFORE prefix parsing and command dispatch.
 *
 * Useful for cross-cutting features like passive word filtering, auto-responders,
 * or experience point (XP) trackers that need to evaluate all conversational traffic.
 */
export const onChat = async ({ event, chat }: BaseCtx): Promise<void> => {
  const message = event['message'] as string;
  if (!message) return;

  // Example functionality: React to any message containing the word "cat"
  if (message.toLowerCase().includes('cat')) {
    await chat.reactMessage('🐱');
  }
};
