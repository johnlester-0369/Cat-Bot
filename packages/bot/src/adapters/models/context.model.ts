/**
 * Context factories for Cat-Bot's command execution layer.
 *
 * Each factory creates a scoped interface bound to the triggering event:
 *   createThreadContext  → ctx.thread  — group/server operations
 *   createChatContext    → ctx.chat    — message send/react/unsend
 *   createBotContext     → ctx.bot     — bot identity queries
 *   createUserContext    → ctx.user    — user info queries
 *   createStateContext   → ctx.state   — pending reply/react state management
 *
 * ARCHITECTURE:
 *   - Interfaces  → ./interfaces/ (ThreadContext, ChatContext, etc.)
 *   - Factories   → this file (createXxxContext functions)
 */

// stateStore is a runtime value from lib/ — cannot use `import type`
import { stateStore } from '@/lib/reply-state.lib.js';

// UnifiedApi is a class defined in api.model, not in the interfaces barrel.
// ButtonItem is used locally in resolveButtons(); others are referenced only in re-exported types.
import type { UnifiedApi } from './api.model.js';
import type { ButtonItem } from './interfaces/index.js';

// Re-export interfaces for backward compatibility
export type {
  ThreadContext,
  ReplyOptions,
  ChatContext,
  BotContext,
  UserContext,
  StateContext,
} from './interfaces/index.js';

// ============================================================================
// FACTORIES
// ============================================================================

/**
 * Creates a thread-scoped context object bound to event.threadID.
 * All calls delegate to the platform UnifiedApi with threadID pre-filled.
 */
export function createThreadContext(
  api: UnifiedApi,
  event: Record<string, unknown>,
): import('./interfaces/index.js').ThreadContext {
  const threadID = event['threadID'] as string;
  return {
    setName: (name) => api.setGroupName(threadID, name),
    setImage: (imageSource) => api.setGroupImage(threadID, imageSource),
    removeImage: () => api.removeGroupImage(threadID),
    addUser: (userID) => api.addUserToGroup(threadID, userID),
    removeUser: (userID) => api.removeUserFromGroup(threadID, userID),
    setReaction: (emoji) => api.setGroupReaction(threadID, emoji),

    /**
     * Set a participant's display nickname in this thread.
     * fca: changeNickname; Discord: member.setNickname; Telegram: setChatAdministratorCustomTitle.
     */
    setNickname: ({ nickname, user_id }) =>
      api.setNickname(threadID, user_id, nickname),

    /**
     * Fetch rich structured information about a thread / group / server.
     * Defaults to the current event thread; pass a different ID to query any accessible thread.
     */
    getInfo: (targetThreadID = threadID) =>
      api.getFullThreadInfo(targetThreadID),
  };
}

/**
 * Creates the `chat` context injected as `ctx.chat` in every command.
 *
 * @param commandName - Lowercased command name; when set, button IDs are prefixed
 *                      "commandName:actionId" so handleButtonAction can reverse-route.
 * @param menu        - The command's exported menu object; used to resolve label and style for each button.
 */
export function createChatContext(
  api: UnifiedApi,
  event: Record<string, unknown>,
  commandName = '',
  menu: Record<
    string,
    {
      label?: string;
      button_style?: string;
      run?: (...args: unknown[]) => unknown;
    }
  > | null = null,
): import('./interfaces/index.js').ChatContext {
  const threadID = event['threadID'] as string;
  const messageID = event['messageID'] as string;

  /**
   * Resolves raw action ID strings (from command code) to ButtonItem objects
   * that platform replyMessage implementations consume. Centralising resolution
   * here avoids duplicating label/style lookups in every platform lib.
   */
  function resolveButtons(buttonIds: string[] = []): ButtonItem[] {
    if (!buttonIds.length) return [];
    return buttonIds.map((id) => ({
      // Prefix with commandName so the platform embeds "commandName:actionId" as callback data.
      // handleButtonAction splits on ':' to find the owning command without a global ID registry.
      id: commandName ? `${commandName}:${id}` : id,
      label: menu?.[id]?.label ?? id,
      style: (menu?.[id]?.button_style as ButtonItem['style']) ?? 'secondary',
    }));
  }

  /**
   * Builds a numbered option list appended to the message body.
   * Facebook Messenger (fca-unofficial MQTT) has no interactive button component —
   * we simulate the button UX as a text menu the user replies to with their selection number.
   */
  function buildButtonFallbackText(msg: string, buttonIds: string[]): string {
    const lines = buttonIds.map(
      (id, idx) => `${idx + 1}. ${menu?.[id]?.label ?? id}`,
    );
    const footer = 'Reply with a number to choose an option.';
    return msg
      ? `${msg}\n\n${lines.join('\n')}\n\n${footer}`
      : `${lines.join('\n')}\n\n${footer}`;
  }

  /**
   * Registers a persistent button-fallback state keyed to the sent message ID.
   * Intentionally never auto-deleted — the numbered menu stays selectable for the message's
   * lifetime, mirroring how Discord, Telegram, and FB Page button components persist until
   * the message is deleted or edited.
   */
  function registerButtonFallbackState(
    msgId: string,
    buttonIds: string[],
  ): void {
    // Private key (msgId:senderID) so only the user who ran the command can select from this menu
    const key = `${msgId}:${event['senderID'] as string}`;
    stateStore.create(key, {
      command: commandName,
      state: 'button_fallback',
      context: {
        type: 'button_fallback',
        buttons: buttonIds.map((id, idx) => ({
          number: idx + 1,
          id,
          label: menu?.[id]?.label ?? id,
        })),
      },
    });
  }

  return {
    /**
     * Send a plain message to the thread — no reply threading.
     */
    reply: async ({
      message = '',
      attachment = [],
      attachment_url = [],
      button = [],
    } = {}) => {
      // Facebook Messenger (fca-unofficial) has no native button components — append a numbered
      // text menu and auto-register an onReply state so user selections route to menu[id].run().
      // The state is never deleted so the menu remains re-selectable like native button platforms.
      if (
        api.platform === 'facebook-messenger' &&
        button.length > 0 &&
        commandName &&
        menu
      ) {
        const msgId = await api.replyMessage(threadID, {
          message: buildButtonFallbackText(message, button),
          attachment,
          attachment_url,
          button: [],
        });
        if (msgId) registerButtonFallbackState(String(msgId), button);
        return msgId;
      }
      return api.replyMessage(threadID, {
        message,
        attachment,
        attachment_url,
        button: resolveButtons(button),
      });
    },

    /**
     * Send as a threaded reply pinned to the current event message.
     * Uses event.messageID implicitly so command code never has to reference raw IDs.
     */
    replyMessage: async ({
      message = '',
      attachment = [],
      attachment_url = [],
      button = [],
    } = {}) => {
      // Same FB Messenger fallback as chat.reply() — preserves reply_to_message_id so
      // the numbered menu is threaded to the triggering message for clearer context
      if (
        api.platform === 'facebook-messenger' &&
        button.length > 0 &&
        commandName &&
        menu
      ) {
        const msgId = await api.replyMessage(threadID, {
          message: buildButtonFallbackText(message, button),
          attachment,
          attachment_url,
          reply_to_message_id: messageID,
          button: [],
        });
        if (msgId) registerButtonFallbackState(String(msgId), button);
        return msgId;
      }
      return api.replyMessage(threadID, {
        message,
        attachment,
        attachment_url,
        reply_to_message_id: messageID,
        button: resolveButtons(button),
      });
    },

    /**
     * React to the current event message.
     */
    reactMessage: (emoji) => api.reactToMessage(threadID, messageID, emoji),

    /**
     * Delete / unsend a specific message by its ID.
     * callers must be explicit about which message to remove.
     */
    unsendMessage: (targetMessageID) => api.unsendMessage(targetMessageID),
  };
}

/**
 * Creates a bot-scoped context object that exposes bot-level operations.
 * Injected as `ctx.bot` in every command's context.
 */
export function createBotContext(
  api: UnifiedApi,
): import('./interfaces/index.js').BotContext {
  return {
    getID: () => api.getBotID(),
  };
}

/**
 * Creates a user-scoped context object for querying user information.
 * Injected as `ctx.user` in every command's context.
 */
export function createUserContext(
  api: UnifiedApi,
): import('./interfaces/index.js').UserContext {
  return {
    /**
     * Fetch rich structured information about a user on this platform.
     * Returns a UnifiedUserInfo (see models/user.model.ts).
     */
    getInfo: (userID) => api.getFullUserInfo(userID),
  };
}

/**
 * Creates a command-scoped states context injected as `ctx.state` in every command.
 * Bound to the triggering event at dispatch time so generateID() has access to
 * senderID and threadID without requiring callers to pass the event explicitly.
 *
 * @param commandName - Lowercased command name as registered in the commands Map
 * @param event       - The triggering message event (senderID / threadID source)
 */
export function createStateContext(
  commandName: string,
  event: Record<string, unknown>,
): import('./interfaces/index.js').StateContext {
  return {
    /**
     * Flat state surface — replaces the old onReply/onReact sub-objects.
     * All pending states (reply flows AND react flows) share one store so command
     * modules never need to choose the right sub-object.
     */
    state: {
      /**
       * Builds a composite routing key that scopes a pending state to either
       * the original sender (private) or the whole thread (public).
       *
       * Default (private): `${id}:${senderID}` — only the triggering user can advance.
       * Public: `${id}:${threadID}` — any group member can advance (polls, shared flows).
       */
      generateID({ id, public: isPublic = false }) {
        if (event['type'] === 'message_reaction') {
          return isPublic
            ? `${id}:${event['threadID'] as string}`
            : `${id}:${event['userID'] as string}`;
        }
        return isPublic
          ? `${id}:${event['threadID'] as string}`
          : `${id}:${event['senderID'] as string}`;
      },

      /**
       * Registers a pending state in the unified store.
       */
      create({ id, state, context }) {
        stateStore.create(id, { command: commandName, state, context });
      },

      /**
       * Removes a pending state from the unified store.
       * Call this before registering the next step or after the flow completes
       * to prevent the same bot message from re-triggering a stale handler.
       */
      delete(id) {
        stateStore.delete(id);
      },
    },
  };
}
