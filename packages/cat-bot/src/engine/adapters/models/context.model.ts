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
import { stateStore } from '@/engine/lib/reply-state.lib.js';

// UnifiedApi is a class defined in api.model, not in the interfaces barrel.
// ButtonItem is used locally in resolveButtons(); others are referenced only in re-exported types.
import type { UnifiedApi } from './api.model.js';
import type { ButtonItem } from './interfaces/index.js';
import { logger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module
import { ButtonStyle, type ButtonStyleValue } from '@/engine/constants/button-style.constants.js';

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
  const defaultThreadID = event['threadID'] as string;
  logger.debug('[context.model] createThreadContext called', { threadID: defaultThreadID });

  // Extract explicit thread ID from options, fallback to event context
  function getThreadID(opts: unknown): string {
    if (typeof opts === 'object' && opts !== null) {
      const o = opts as any;
      return o.threadID || o.thread_id || defaultThreadID;
    }
    return defaultThreadID;
  }

  return {
    setName: (nameOrOpts) => {
      const name = typeof nameOrOpts === 'object' && nameOrOpts !== null ? (nameOrOpts as any).name : nameOrOpts;
      const targetThreadID = getThreadID(nameOrOpts);
      logger.debug('[context.model] ThreadContext.setName called', { threadID: targetThreadID, name });
      return api.setGroupName(targetThreadID, name as string);
    },
    setImage: (sourceOrOpts) => {
      const isObj = typeof sourceOrOpts === 'object' && sourceOrOpts !== null && !Buffer.isBuffer(sourceOrOpts) && !('pipe' in sourceOrOpts);
      const imageSource = isObj ? (sourceOrOpts as any).imageSource : sourceOrOpts;
      const targetThreadID = getThreadID(isObj ? sourceOrOpts : null);
      logger.debug('[context.model] ThreadContext.setImage called', { threadID: targetThreadID });
      return api.setGroupImage(targetThreadID, imageSource as Buffer | import('stream').Readable | string);
    },
    removeImage: (opts) => {
      const targetThreadID = getThreadID(opts);
      logger.debug('[context.model] ThreadContext.removeImage called', { threadID: targetThreadID });
      return api.removeGroupImage(targetThreadID);
    },
    addUser: (userOrOpts) => {
      const userID = typeof userOrOpts === 'object' && userOrOpts !== null ? (userOrOpts as any).userID : userOrOpts;
      const targetThreadID = getThreadID(userOrOpts);
      logger.debug('[context.model] ThreadContext.addUser called', { threadID: targetThreadID, userID });
      return api.addUserToGroup(targetThreadID, userID as string);
    },
    removeUser: (userOrOpts) => {
      const userID = typeof userOrOpts === 'object' && userOrOpts !== null ? (userOrOpts as any).userID : userOrOpts;
      const targetThreadID = getThreadID(userOrOpts);
      logger.debug('[context.model] ThreadContext.removeUser called', { threadID: targetThreadID, userID });
      return api.removeUserFromGroup(targetThreadID, userID as string);
    },
    setReaction: (emojiOrOpts) => {
      const emoji = typeof emojiOrOpts === 'object' && emojiOrOpts !== null ? (emojiOrOpts as any).emoji : emojiOrOpts;
      const targetThreadID = getThreadID(emojiOrOpts);
      logger.debug('[context.model] ThreadContext.setReaction called', { threadID: targetThreadID, emoji });
      return api.setGroupReaction(targetThreadID, emoji as string);
    },

    /**
     * Set a participant's display nickname in this thread.
     * fca: changeNickname; Discord: member.setNickname; Telegram: setChatAdministratorCustomTitle.
     */
    setNickname: (options) => {
      const targetThreadID = getThreadID(options);
      logger.debug('[context.model] ThreadContext.setNickname called', { threadID: targetThreadID, user_id: options.user_id, nickname: options.nickname });
      return api.setNickname(targetThreadID, options.user_id, options.nickname);
    },

    /**
     * Fetch rich structured information about a thread / group / server.
     * Defaults to the current event thread; pass a different ID to query any accessible thread.
     */
    getInfo: (targetThreadID) => {
      const target = typeof targetThreadID === 'object' && targetThreadID !== null ? getThreadID(targetThreadID) : (targetThreadID || defaultThreadID);
      logger.debug('[context.model] ThreadContext.getInfo called', { threadID: target });
      return api.getFullThreadInfo(target as string);
    },
    /**
     * Cache-first (Discord/Telegram) or DB-backed (FB) display name lookup.
     * Defaults to the triggering event's own threadID so callers can omit the argument.
     */
    getName: (targetThreadID) => {
      const target = typeof targetThreadID === 'object' && targetThreadID !== null ? getThreadID(targetThreadID) : (targetThreadID || defaultThreadID);
      logger.debug('[context.model] ThreadContext.getName called', { threadID: target });
      return api.getThreadName(target as string);
    },
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
      button_style?: ButtonStyleValue;
      run?: (...args: unknown[]) => unknown;
    }
  > | null = null,
): import('./interfaces/index.js').ChatContext {
  const defaultThreadID = event['threadID'] as string;
  const defaultMessageID = event['messageID'] as string;
  logger.debug('[context.model] createChatContext called', { threadID: defaultThreadID, messageID: defaultMessageID });

  // Extract explicit thread ID from options, fallback to event context
  function getThreadID(opts: unknown): string {
    if (typeof opts === 'object' && opts !== null) {
      const o = opts as any;
      return o.threadID || o.thread_id || defaultThreadID;
    }
    return defaultThreadID;
  }

  // Extract explicit message ID from options, fallback to event context
  function getMessageID(opts: unknown): string {
    if (typeof opts === 'object' && opts !== null) {
      const o = opts as any;
      return o.messageID || o.reply_to_message_id || o.targetMessageID || defaultMessageID;
    }
    return defaultMessageID;
  }

  /**
   * Resolves raw action ID strings (from command code) to ButtonItem objects
   * that platform replyMessage implementations consume. Centralising resolution
   * here avoids duplicating label/style lookups in every platform lib.
   */
  function resolveButtons(buttonIds: string[] = []): ButtonItem[] {
    logger.debug('[context.model] resolveButtons called', { count: buttonIds.length });
    if (!buttonIds.length) return [];
    return buttonIds.map((id) => ({
      // Prefix with commandName so the platform embeds "commandName:actionId" as callback data.
      // handleButtonAction splits on ':' to find the owning command without a global ID registry.
      id: commandName ? `${commandName}:${id}` : id,
      label: menu?.[id]?.label ?? id,
      // Optional style defaults to Neutral/Secondary to ensure cross-platform safety
      // where applicable, and provides a default visual baseline for Discord.
      style: menu?.[id]?.button_style ?? ButtonStyle.SECONDARY,
    }));
  }

  /**
   * Builds a numbered option list appended to the message body.
   * Facebook Messenger (fca-unofficial MQTT) has no interactive button component —
   * we simulate the button UX as a text menu the user replies to with their selection number.
   */
  function buildButtonFallbackText(msg: string, buttonIds: string[]): string {
    logger.debug('[context.model] buildButtonFallbackText called');
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
    logger.debug('[context.model] registerButtonFallbackState called', { msgId });
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
      ...opts
    } = {}) => {
      const targetThreadID = getThreadID(opts);
      const customMessageID = opts.messageID || opts.reply_to_message_id;
      logger.debug('[context.model] ChatContext.reply called', { threadID: targetThreadID, hasMessage: !!message, buttonCount: button.length });
      // Facebook Messenger (fca-unofficial) has no native button components — append a numbered
      // text menu and auto-register an onReply state so user selections route to menu[id].run().
      // The state is never deleted so the menu remains re-selectable like native button platforms.
      if (
        api.platform === 'facebook-messenger' &&
        button.length > 0 &&
        commandName &&
        menu
      ) {
        const msgId = await api.replyMessage(targetThreadID, {
          message: buildButtonFallbackText(message, button),
          attachment,
          attachment_url,
          ...(customMessageID ? { reply_to_message_id: customMessageID } : {}),
          button: [],
        });
        if (msgId) registerButtonFallbackState(String(msgId), button);
        return msgId;
      }
      return api.replyMessage(targetThreadID, {
        message,
        attachment,
        attachment_url,
        ...(customMessageID ? { reply_to_message_id: customMessageID } : {}),
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
      ...opts
    } = {}) => {
      const targetThreadID = getThreadID(opts);
      const targetMessageID = getMessageID(opts);
      logger.debug('[context.model] ChatContext.replyMessage called', { threadID: targetThreadID, messageID: targetMessageID, hasMessage: !!message, buttonCount: button.length });
      // Same FB Messenger fallback as chat.reply() — preserves reply_to_message_id so
      // the numbered menu is threaded to the triggering message for clearer context
      if (
        api.platform === 'facebook-messenger' &&
        button.length > 0 &&
        commandName &&
        menu
      ) {
        const msgId = await api.replyMessage(targetThreadID, {
          message: buildButtonFallbackText(message, button),
          attachment,
          attachment_url,
          reply_to_message_id: targetMessageID,
          button: [],
        });
        if (msgId) registerButtonFallbackState(String(msgId), button);
        return msgId;
      }
      return api.replyMessage(targetThreadID, {
        message,
        attachment,
        attachment_url,
        reply_to_message_id: targetMessageID,
        button: resolveButtons(button),
      });
    },

    /**
     * React to the current event message.
     */
    reactMessage: (options) => {
      const isObj = typeof options === 'object' && options !== null;
      const emoji = isObj ? (options as any).emoji : options;
      const targetThreadID = getThreadID(isObj ? options : null);
      const targetMessageID = getMessageID(isObj ? options : null);
      logger.debug('[context.model] ChatContext.reactMessage called', { threadID: targetThreadID, messageID: targetMessageID, emoji });
      return api.reactToMessage(targetThreadID, targetMessageID, emoji as string);
    },

    /**
     * Delete / unsend a specific message by its ID.
     * callers must be explicit about which message to remove.
     */
    unsendMessage: (options) => {
      const isObj = typeof options === 'object' && options !== null;
      const targetMessageID = isObj ? getMessageID(options) : options;
      logger.debug('[context.model] ChatContext.unsendMessage called', { targetMessageID });
      return api.unsendMessage(targetMessageID as string);
    },
  };
}

/**
 * Creates a bot-scoped context object that exposes bot-level operations.
 * Injected as `ctx.bot` in every command's context.
 */
export function createBotContext(
  api: UnifiedApi,
): import('./interfaces/index.js').BotContext {
  logger.debug('[context.model] createBotContext called');
  return {
    getID: () => {
      logger.debug('[context.model] BotContext.getID called');
      return api.getBotID();
    },
  };
}

/**
 * Creates a user-scoped context object for querying user information.
 * Injected as `ctx.user` in every command's context.
 */
export function createUserContext(
  api: UnifiedApi,
): import('./interfaces/index.js').UserContext {
  logger.debug('[context.model] createUserContext called');
  return {
    /**
     * Fetch rich structured information about a user on this platform.
     * Returns a UnifiedUserInfo (see models/user.model.ts).
     */
    getInfo: (userID) => {
      logger.debug('[context.model] UserContext.getInfo called', { userID });
      return api.getFullUserInfo(userID);
    },
    // Cache-first (Discord/Telegram) or DB-backed (FB) — no external API round-trip on supported platforms
    getName: (userID) => {
      logger.debug('[context.model] UserContext.getName called', { userID });
      return api.getUserName(userID);
    },
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
  logger.debug('[context.model] createStateContext called', { commandName });
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
        logger.debug('[context.model] state.generateID called', { id, isPublic });
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
        logger.debug('[context.model] state.create called', { id, state });
        stateStore.create(id, { command: commandName, state, context });
      },

      /**
       * Removes a pending state from the unified store.
       * Call this before registering the next step or after the flow completes
       * to prevent the same bot message from re-triggering a stale handler.
       */
      delete(id) {
        logger.debug('[context.model] state.delete called', { id });
        stateStore.delete(id);
      },
    },
  };
}
