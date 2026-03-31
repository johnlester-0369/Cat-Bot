import type { ChatContext } from '@/adapters/models/context.model.js';

export const config = {
  name: 'join',
  description: 'Sends a welcome message when members join the group',
  // 'log:subscribe' is the fca-unofficial logMessageType for member-add events.
  // All platform wrappers map their native join events to this dispatch key.
  eventType: ['log:subscribe'],
};

export const onEvent = async ({
  event,
  chat,
}: {
  event: Record<string, unknown>;
  chat: ChatContext;
}) => {
  try {
    const logMessageData = event['logMessageData'] as
      | Record<string, unknown>
      | undefined;
    const added =
      (logMessageData?.['addedParticipants'] as Record<string, unknown>[]) ??
      [];

    if (!added.length) return;

    // Prefer fullName (display name) over firstName (account handle) over ID fallback
    const getName = (p: Record<string, unknown>) =>
      String(p['fullName'] || p['firstName'] || `User ${p['userFbId']}`);

    let message;
    if (added.length === 1) {
      // safe fallback given the preceding length check
      message = `👋 Welcome to the group, ${getName(added[0]!)}!`;
    } else {
      const names = added.map((p) => `• ${getName(p)}`).join('\n');
      message = `👋 Welcome to the group!\n\n${names}`;
    }

    // Route event messaging dynamically through chat replies
    await chat.replyMessage({ message });
  } catch (err) {
    console.error('❌ join event handler failed:', err);
  }
};
