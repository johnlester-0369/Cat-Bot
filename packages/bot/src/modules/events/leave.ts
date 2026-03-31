import type { ChatContext } from '@/adapters/models/context.model.js';

export const config = {
  name: 'leave',
  description: 'Sends a goodbye message when members leave the group',
  // 'log:unsubscribe' is the fca-unofficial logMessageType for member-remove events.
  // All platform wrappers map their native leave events to this dispatch key.
  eventType: ['log:unsubscribe'],
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
    const logMessageBody = event['logMessageBody'] as string | undefined;
    const author = event['author'] as string | undefined;

    const leftId = String(logMessageData?.['leftParticipantFbId'] ?? '');

    // wasRemoved: the author is someone other than the person who left.
    // fca provides a real author ID; Discord/Telegram normalizers always emit '' so wasRemoved = false.
    const wasRemoved = Boolean(author && author !== leftId);

    // Prefer logMessageBody when available — fca provides human-readable descriptions
    // (e.g. "Scarlet Smith left the group." / "Elle removed Scarlet from the group.").
    // Discord and Telegram wrappers also construct logMessageBody for consistency.
    const message = logMessageBody
      ? `👋 ${logMessageBody}`
      : wasRemoved
        ? `👋 A member has been removed from the group.`
        : `👋 A member has left the group. Goodbye!`;

    // Send through conversational context to respect threading scopes
    await chat.replyMessage({ message });
  } catch (err) {
    console.error('❌ leave event handler failed:', err);
  }
};
