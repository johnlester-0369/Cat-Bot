import { sessionManager } from '@/engine/modules/session/session-manager.lib.js';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'restart',
  aliases: [] as string[],
  version: '1.0.0',
  role: Role.BOT_ADMIN, // Restricted to bot admins — restarting tears down live transport connections
  author: 'John Lester',
  description: 'Restarts the specific bot listener session seamlessly.',
  category: 'systen',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
  // Exclude Facebook Page since facebook page use PSID (Page-Scoped ID)
  platform: [
    Platforms.Discord,
    Platforms.Telegram,
    Platforms.FacebookMessenger,
  ],
};

export const onCommand = async ({ chat, native }: AppCtx) => {
  const { userId, sessionId, platform } = native;

  if (!userId || !sessionId || !platform) {
    await chat.reply({
      style: MessageStyle.MARKDOWN,
      message:
        '❌ Cannot restart: missing session identity coordinates in the context.',
    });
    return;
  }

  const sessionKey = `${String(userId)}:${String(platform)}:${String(sessionId)}`;

  // The message is dispatched before initiating the shutdown/startup sequence.
  await chat.reply({
    style: MessageStyle.MARKDOWN,
    message: `🔄 **Restarting** listener session...`,
  });

  try {
    // Calling restart() drops the old transport connections, unregisters webhooks,
    // drops pending sockets, and boots a fresh transport logic for THIS target session.
    await sessionManager.restart(sessionKey);
  } catch (err) {
    console.error(`[restart] Failed for session ${sessionKey}:`, err);
  }
};
