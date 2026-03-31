import { sessionManager } from '@/lib/session-manager.lib.js';
import type { ChatContext } from '@/adapters/models/context.model.js';
import type { NativeContext } from '@/types/controller.types.js';

export const config = {
  name: 'restart',
  description: 'Restarts the specific bot listener session seamlessly.',
  hasPrefix: true,
};

export const onCommand = async ({
  chat,
  native,
}: {
  chat: ChatContext;
  native: NativeContext;
}) => {
  const { userId, sessionId, platform } = native;

  if (!userId || !sessionId || !platform) {
    await chat.reply({
      message:
        '❌ Cannot restart: missing session identity coordinates in the context.',
    });
    return;
  }

  const sessionKey = `${String(userId)}:${String(platform)}:${String(sessionId)}`;

  // The message is dispatched before initiating the shutdown/startup sequence.
  await chat.reply({
    message: `🔄 Restarting listener session (${sessionKey})...`,
  });

  try {
    // Calling restart() drops the old transport connections, unregisters webhooks,
    // drops pending sockets, and boots a fresh transport logic for THIS target session.
    await sessionManager.restart(sessionKey);
  } catch (err) {
    console.error(`[restart] Failed for session ${sessionKey}:`, err);
  }
};
