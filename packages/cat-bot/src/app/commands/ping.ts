import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';

export const config = {
  name: 'ping',
  aliases: [] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'John Lester',
  description: 'Check if bot is alive',
  category: '',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

const BUTTON_ID = { refresh: 'refresh' } as const;

// Refresh re-measures round-trip latency on button click so the user gets a
// fresh reading without re-typing the command — common for network spot-checks.
export const button = {
  [BUTTON_ID.refresh]: {
    label: '🔄 Refresh',
    style: ButtonStyle.SECONDARY,
    onClick: async ({
      chat,
      startTime,
      event,
      native,
      session,
      button,
    }: AppCtx) => {
      const scopedRefresh = session.id; // Reuse active instance ID
      const sessionCount = session.context.count || 0; // avoid undefined value
      const count = sessionCount + 1; //increment from the previous context count
      button.update({
        id: scopedRefresh,
        label: `🔄 Refresh (${count})`,
      });

      button.createContext({
        id: scopedRefresh,
        context: {
          count: count,
        },
      });

      // FB Messenger has no native button components — it renders a numbered text-menu
      // fallback which clutters a simple one-liner response. Skip buttons there
      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: event.messageID as string,
        message: `🏓 Pong! Latency: \`${Date.now() - startTime}ms\``,
        ...(hasNativeButtons(native.platform)
          ? { button: [scopedRefresh] }
          : {}),
      });
    },
  },
};

export const onCommand = async ({
  chat,
  startTime,
  native,
  button,
}: AppCtx) => {
  // Scope the Refresh button's button ID to the sender so only the user who issued
  // /ping can click it — prevents other users from hijacking another person's flow.
  const scopedRefresh = button.generateID({ id: BUTTON_ID.refresh });
  const count = 1;
  button.update({
    id: scopedRefresh,
    label: `🔄 Refresh (${count})`,
  });

  button.createContext({
    id: scopedRefresh,
    context: {
      count: count,
    },
  });
  // FB Messenger has no native button components — it renders a numbered text-menu
  // fallback which clutters a simple one-liner response. Skip buttons there.
  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: `🏓 Pong! Latency: \`${Date.now() - startTime}ms\``,
    ...(hasNativeButtons(native.platform) ? { button: [scopedRefresh] } : {}),
  });
};
