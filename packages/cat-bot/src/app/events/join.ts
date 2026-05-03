import type { AppCtx } from '@/engine/types/controller.types.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { EventConfig } from '@/engine/types/module-config.types.js';

export const config: EventConfig = {
  name: 'join',
  eventType: ['log:subscribe'],
  version: '1.0.0',
  author: 'John Lester',
  description: 'Sends a welcome message when members join the group',
};

export const onEvent = async ({ event, chat, bot }: AppCtx) => {
  try {
    const logMessageData = event['logMessageData'] as
      | Record<string, unknown>
      | undefined;
    const added =
      (logMessageData?.['addedParticipants'] as Record<string, unknown>[]) ??
      [];

    if (!added.length) return;

    // The bot joining its own group would trigger a self-welcome — useless noise.
    // Check against bot.getID() so this guard works across all platforms without hardcoding IDs.
    const botId = await bot.getID();
    if (added.some((p) => String(p['userFbId'] ?? '') === botId)) return;

    // Prefer fullName (display name) over firstName (account handle) over ID fallback
    const getName = (p: Record<string, unknown>) =>
      String(p['fullName'] || p['firstName'] || `User ${p['userFbId']}`);

    let message;
    if (added.length === 1) {
      // safe fallback given the preceding length check
      message = `👋 Welcome to the group, **${getName(added[0]!)}**!`;
    } else {
      const names = added.map((p) => `• **${getName(p)}**`).join('\n');
      message = `👋 Welcome to the group!\n\n${names}`;
    }
    // Route event messaging dynamically through chat replies
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message,
    });
  } catch (err) {
    console.error('❌ join event handler failed:', err);
  }
};
