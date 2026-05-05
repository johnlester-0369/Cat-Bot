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
import { stateStore } from '@/engine/lib/state.lib.js';
import { buttonContextLib } from '@/engine/lib/button-context.lib.js';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';
import type { UnifiedUserInfo } from './user.model.js';

// UnifiedApi is a class defined in api.model, not in the interfaces barrel.
// ButtonItem is used locally in resolveButtons(); others are referenced only in re-exported types.
import type { UnifiedApi } from './api.model.js';
import type { ButtonItem } from './interfaces/index.js';
import { logger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module
import {
  ButtonStyle,
  type ButtonStyleValue,
} from '@/engine/constants/button-style.constants.js';
import {
  createUnifiedThreadInfo,
  type UnifiedThreadInfo,
} from './thread.model.js';

// Re-export interfaces for backward compatibility
export type {
  ThreadContext,
  ReplyOptions,
  EditOptions,
  ChatContext,
  BotContext,
  UserContext,
  StateContext,
  ButtonContext,
} from './interfaces/index.js';

import { Platforms } from '@/engine/modules/platform/platform.constants.js';

// ── getInfo cache TTL — platform-specific expiry for full thread/user info ─────
// Facebook Messenger's high-frequency GraphQL API access risks triggering account
// bans; we cache aggressively (3 h) to minimise API call frequency. Discord and
// Telegram have generous rate-limits, so 30 min balances freshness with efficiency.
// Facebook Page sits in between at 1 h — less ban-sensitive but still cost-aware.
const GETINFO_TTL_MS: Record<string, number> = {
  [Platforms.Discord]: 30 * 60 * 1000,
  [Platforms.Telegram]: 30 * 60 * 1000,
  [Platforms.FacebookPage]: 60 * 60 * 1000,
  [Platforms.FacebookMessenger]: 3 * 60 * 60 * 1000,
};
function getInfoCacheTTL(platform: string): number {
  // Default to 5 min for unrecognised platforms — matches the base lruCache instance TTL.
  return GETINFO_TTL_MS[platform] ?? 5 * 60 * 1000;
}

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
  native?: { userId?: string; platform?: string; sessionId?: string },
): import('./interfaces/index.js').ThreadContext {
  const defaultThreadID = event['threadID'] as string;
  logger.debug('[context.model] createThreadContext called', {
    threadID: defaultThreadID,
  });

  // Extract explicit thread ID from options, fallback to event context
  function getThreadID(opts: unknown): string {
    if (typeof opts === 'object' && opts !== null) {
      const o = opts as Record<string, unknown>;
      return (
        (o.threadID as string) || (o.thread_id as string) || defaultThreadID
      );
    }
    return defaultThreadID;
  }

  return {
    setName: (nameOrOpts) => {
      const name =
        typeof nameOrOpts === 'object' && nameOrOpts !== null
          ? (nameOrOpts as unknown as Record<string, unknown>).name
          : nameOrOpts;
      const targetThreadID = getThreadID(nameOrOpts);
      logger.debug('[context.model] ThreadContext.setName called', {
        threadID: targetThreadID,
        name,
      });
      return api.setGroupName(targetThreadID, name as string);
    },
    setImage: (sourceOrOpts) => {
      const isObj =
        typeof sourceOrOpts === 'object' &&
        sourceOrOpts !== null &&
        !Buffer.isBuffer(sourceOrOpts) &&
        !('pipe' in sourceOrOpts);
      const imageSource = isObj
        ? (sourceOrOpts as unknown as Record<string, unknown>).imageSource
        : sourceOrOpts;
      const targetThreadID = getThreadID(isObj ? sourceOrOpts : null);
      logger.debug('[context.model] ThreadContext.setImage called', {
        threadID: targetThreadID,
      });
      return api.setGroupImage(
        targetThreadID,
        imageSource as Buffer | import('stream').Readable | string,
      );
    },
    removeImage: (opts) => {
      const targetThreadID = getThreadID(opts);
      logger.debug('[context.model] ThreadContext.removeImage called', {
        threadID: targetThreadID,
      });
      return api.removeGroupImage(targetThreadID);
    },
    addUser: (userOrOpts) => {
      const userID =
        typeof userOrOpts === 'object' && userOrOpts !== null
          ? (userOrOpts as unknown as Record<string, unknown>).userID
          : userOrOpts;
      const targetThreadID = getThreadID(userOrOpts);
      logger.debug('[context.model] ThreadContext.addUser called', {
        threadID: targetThreadID,
        userID,
      });
      return api.addUserToGroup(targetThreadID, userID as string);
    },
    removeUser: (userOrOpts) => {
      const userID =
        typeof userOrOpts === 'object' && userOrOpts !== null
          ? (userOrOpts as unknown as Record<string, unknown>).userID
          : userOrOpts;
      const targetThreadID = getThreadID(userOrOpts);
      logger.debug('[context.model] ThreadContext.removeUser called', {
        threadID: targetThreadID,
        userID,
      });
      return api.removeUserFromGroup(targetThreadID, userID as string);
    },
    setReaction: (emojiOrOpts) => {
      const emoji =
        typeof emojiOrOpts === 'object' && emojiOrOpts !== null
          ? (emojiOrOpts as unknown as Record<string, unknown>).emoji
          : emojiOrOpts;
      const targetThreadID = getThreadID(emojiOrOpts);
      logger.debug('[context.model] ThreadContext.setReaction called', {
        threadID: targetThreadID,
        emoji,
      });
      return api.setGroupReaction(targetThreadID, emoji as string);
    },

    /**
     * Set a participant's display nickname in this thread.
     * fca: changeNickname; Discord: member.setNickname; Telegram: setChatAdministratorCustomTitle.
     */
    setNickname: (options) => {
      const targetThreadID = getThreadID(options);
      logger.debug('[context.model] ThreadContext.setNickname called', {
        threadID: targetThreadID,
        user_id: options.user_id,
        nickname: options.nickname,
      });
      return api.setNickname(targetThreadID, options.user_id, options.nickname);
    },

    /**
     * Fetch rich structured information about a thread / group / server.
     * Defaults to the current event thread; pass a different ID to query any accessible thread.
     */
    getInfo: async (targetThreadID): Promise<UnifiedThreadInfo> => {
      const target =
        typeof targetThreadID === 'object' && targetThreadID !== null
          ? getThreadID(targetThreadID)
          : targetThreadID || defaultThreadID;
      logger.debug('[context.model] ThreadContext.getInfo called', {
        threadID: target,
      });

      // Scope cache to (sessionOwner, platform, session, thread) — same composite key
      // structure used by threads.repo.ts to isolate per-session data.
      const nativeUserId = native?.userId ?? '';
      const nativePlatform = native?.platform ?? api.platform;
      const nativeSessionId = native?.sessionId ?? '';
      const cacheEnabled = Boolean(nativeUserId && nativeSessionId);
      if (cacheEnabled) {
        const cached = lruCache.get<UnifiedThreadInfo>(
          `${nativeUserId}:${nativePlatform}:${nativeSessionId}:thread:fullInfo:${target as string}`,
        );
        if (cached !== undefined) return cached;
      }

      // Fallback for 1:1 threads where getFullThreadInfo might not be supported natively.
      // By mapping user metadata to the thread schema, we avoid breaking repository layers.
      // Restricted exclusively to Facebook Messenger; other platforms have robust thread info APIs for 1:1 DMs.
      if (
        target === defaultThreadID &&
        event['isGroup'] === false &&
        api.platform === Platforms.FacebookMessenger
      ) {
        try {
          const targetUserID = (event['senderID'] ??
            event['userID'] ??
            target) as string;
          const userInfo = await api.getFullUserInfo(targetUserID);
          const info = createUnifiedThreadInfo({
            platform: api.platform,
            threadID: target as string,
            name: userInfo.name,
            isGroup: false,
            memberCount: null,
            participantIDs: [targetUserID],
            adminIDs: [],
            avatarUrl: userInfo.avatarUrl,
            serverID: null,
          });
          if (cacheEnabled) {
            lruCache.set(
              `${nativeUserId}:${nativePlatform}:${nativeSessionId}:thread:fullInfo:${target as string}`,
              info,
              getInfoCacheTTL(nativePlatform),
            );
          }
          return info;
        } catch (err: unknown) {
          logger.warn(
            '[context.model] Fallback user.getInfo failed for 1:1 thread, proceeding to getFullThreadInfo',
            {
              error: err instanceof Error ? err.message : String(err),
            },
          );
        }
      }

      const result = await api.getFullThreadInfo(target as string);
      if (cacheEnabled) {
        lruCache.set(
          `${nativeUserId}:${nativePlatform}:${nativeSessionId}:thread:fullInfo:${target as string}`,
          result,
          getInfoCacheTTL(nativePlatform),
        );
      }
      return result;
    },
    /**
     * Cache-first (Discord/Telegram) or DB-backed (FB) display name lookup.
     * Defaults to the triggering event's own threadID so callers can omit the argument.
     */
    getName: (targetThreadID) => {
      const target =
        typeof targetThreadID === 'object' && targetThreadID !== null
          ? getThreadID(targetThreadID)
          : targetThreadID || defaultThreadID;
      logger.debug('[context.model] ThreadContext.getName called', {
        threadID: target,
      });
      return api.getThreadName(target as string);
    },
    // Follows the same optional-target pattern as getName — defaults to event.threadID so
    // callers can omit the argument entirely when querying the current conversation's group size.
    getMemberCount: (targetThreadID) => {
      const target =
        typeof targetThreadID === 'object' && targetThreadID !== null
          ? getThreadID(targetThreadID)
          : targetThreadID || defaultThreadID;
      logger.debug('[context.model] ThreadContext.getMemberCount called', {
        threadID: target,
      });
      return api.getMemberCount(target as string);
    },
  };
}

/**
 * Creates the `chat` context injected as `ctx.chat` in every command.
 *
 * @param commandName - Lowercased command name; when set, button IDs are prefixed
 *                      "commandName:buttonId" so handleButtonAction can reverse-route.
 * @param buttonDef   - The command's exported button object; used to resolve label and style for each button.
 */
export function createChatContext(
  api: UnifiedApi,
  event: Record<string, unknown>,
  commandName = '',
  buttonDef: Record<
    string,
    {
      label?: string;
      style?: ButtonStyleValue;
      onClick?: (...args: unknown[]) => unknown;
    }
  > | null = null,
): import('./interfaces/index.js').ChatContext {
  const defaultThreadID = event['threadID'] as string;
  const defaultMessageID = event['messageID'] as string;
  logger.debug('[context.model] createChatContext called', {
    threadID: defaultThreadID,
    messageID: defaultMessageID,
  });

  // Extract explicit thread ID from options, fallback to event context
  function getThreadID(opts: unknown): string {
    if (typeof opts === 'object' && opts !== null) {
      const o = opts as Record<string, unknown>;
      return (
        (o.threadID as string) || (o.thread_id as string) || defaultThreadID
      );
    }
    return defaultThreadID;
  }

  // Extract explicit message ID from options, fallback to event context
  function getMessageID(opts: unknown): string {
    if (typeof opts === 'object' && opts !== null) {
      const o = opts as Record<string, unknown>;
      return (
        (o.messageID as string) ||
        (o.reply_to_message_id as string) ||
        (o.targetMessageID as string) ||
        defaultMessageID
      );
    }
    return defaultMessageID;
  }

  /**
   * Strips the optional ~userId scope suffix from a raw button ID.
   * Scoped IDs embed the original requester's platform user ID so handleButtonAction
   * can gate button presses — the suffix is routing metadata, not part of the menu key.
   * Example: 'refresh~123456789' → 'refresh'; 'refresh' → 'refresh' (no-op).
   */
  function baseKey(id: string): string {
    const tilde = id.indexOf('~');
    const withoutScope = tilde === -1 ? id : id.slice(0, tilde);
    const hash = withoutScope.indexOf('#');
    return hash === -1 ? withoutScope : withoutScope.slice(0, hash);
  }

  /**
   * Normalises a flat or 2-D button ID layout to an array of rows.
   * A flat string[] is treated as a single row so callers don't need to wrap it.
   * Guards the [0] access explicitly for noUncheckedIndexedAccess compliance.
   */
  function normalizeRows(buttonIds: string[] | string[][]): string[][] {
    if (buttonIds.length === 0) return [];
    const first = buttonIds[0];
    if (first === undefined) return [];
    return Array.isArray(first)
      ? (buttonIds as string[][])
      : [buttonIds as string[]];
  }

  /**
   * Resolves raw button ID strings to ButtonItem rows that platform
   * replyMessage/editMessage implementations consume.
   * Accepts a flat array (single row) or a 2-D array (multiple rows / grid).
   */
  function resolveButtons(buttonIds: string[] | string[][]): ButtonItem[][] {
    logger.debug('[context.model] resolveButtons called', {
      count: buttonIds.length,
    });
    if (!buttonIds.length) return [];
    return normalizeRows(buttonIds).map((row) =>
      row.map((id) => {
        const bKey = baseKey(id);
        // Overlay check — allows dynamic buttons to override static defaults cleanly per-instance or globally
        const overrideFull = buttonContextLib.getOverride(
          `${commandName}:${id}`,
        );
        const overrideBase = buttonContextLib.getOverride(
          `${commandName}:${bKey}`,
        );
        return {
          id: commandName ? `${commandName}:${id}` : id,
          label:
            overrideFull?.label ??
            overrideBase?.label ??
            buttonDef?.[bKey]?.label ??
            id,
          style: (overrideFull?.style ??
            overrideBase?.style ??
            buttonDef?.[bKey]?.style ??
            ButtonStyle.SECONDARY) as ButtonStyleValue,
        };
      }),
    );
  }

  /**
   * Builds a numbered option list appended to the message body.
   * Facebook Messenger (fca-unofficial MQTT) has no interactive button component —
   * we simulate the button UX as a text menu the user replies to with their selection number.
   */

  /**
   * Flattens a flat or 2-D button ID layout to a single ordered list.
   * Grid rows are concatenated left-to-right, top-to-bottom so FB Messenger's
   * numbered text-menu assigns sequential option numbers independent of row grouping.
   */
  function flattenButtonIds(buttonIds: string[] | string[][]): string[] {
    if (buttonIds.length === 0) return [];
    const first = buttonIds[0];
    if (first === undefined) return [];
    return Array.isArray(first)
      ? (buttonIds as string[][]).flat()
      : (buttonIds as string[]);
  }

  function buildButtonFallbackText(
    msg: string,
    buttonIds: string[] | string[][],
  ): string {
    logger.debug('[context.model] buildButtonFallbackText called');
    const flat = flattenButtonIds(buttonIds);
    const lines = flat.map((id, idx) => {
      const bKey = baseKey(id);
      const overrideFull = buttonContextLib.getOverride(`${commandName}:${id}`);
      const overrideBase = buttonContextLib.getOverride(
        `${commandName}:${bKey}`,
      );
      const label =
        overrideFull?.label ??
        overrideBase?.label ??
        buttonDef?.[bKey]?.label ??
        id;
      return `${idx + 1}. ${label}`;
    });
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
    buttonIds: string[] | string[][],
  ): void {
    logger.debug('[context.model] registerButtonFallbackState called', {
      msgId,
    });
    const flat = flattenButtonIds(buttonIds);
    // Private key (msgId:senderID) so only the user who ran the command can select from this menu
    const key = `${msgId}:${event['senderID'] as string}`;
    stateStore.create(key, {
      command: commandName,
      state: 'button_fallback',
      context: {
        type: 'button_fallback',
        buttons: flat.map((id, idx) => {
          const bKey = baseKey(id);
          const overrideFull = buttonContextLib.getOverride(
            `${commandName}:${id}`,
          );
          const overrideBase = buttonContextLib.getOverride(
            `${commandName}:${bKey}`,
          );
          const label =
            overrideFull?.label ??
            overrideBase?.label ??
            buttonDef?.[bKey]?.label ??
            id;
          return {
            number: idx + 1,
            id,
            label,
          };
        }),
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
      style,
      ...opts
    } = {}) => {
      // Guard: platforms uniformly support at most 1 total attachment when button components
      // are present. stream attachments and URL attachments each occupy an attachment slot —
      // 1 stream + 1 URL = 2 total, which is rejected. This is enforced here (earliest
      // interception) before any platform-specific delivery attempt so command authors
      // receive a clear error at the call site rather than a silent or cryptic platform failure.
      const totalAttachCount = attachment.length + attachment_url.length;
      if (button.length > 0 && totalAttachCount > 1) {
        throw new Error(
          `Only 1 attachment (stream or URL, not both) is supported alongside button components. ` +
            `Received ${attachment.length} stream attachment(s) and ${attachment_url.length} URL attachment(s). ` +
            `Reduce to a maximum of 1 total attachment when using buttons.`,
        );
      }
      const targetThreadID = getThreadID(opts);
      const customMessageID = opts.messageID || opts.reply_to_message_id;
      logger.debug('[context.model] ChatContext.reply called', {
        threadID: targetThreadID,
        hasMessage: !!message,
        buttonCount: button.length,
      });
      // Facebook Messenger (fca-unofficial) has no native button components — append a numbered
      // text menu and auto-register an onReply state so user selections route to button[id].onClick().
      // The state is never deleted so the menu remains re-selectable like native button platforms.
      if (
        api.platform === Platforms.FacebookMessenger &&
        button.length > 0 &&
        commandName &&
        buttonDef
      ) {
        const msgId = await api.replyMessage(targetThreadID, {
          message: buildButtonFallbackText(message, button),
          attachment,
          attachment_url,
          ...(customMessageID ? { reply_to_message_id: customMessageID } : {}),
          button: [],
          ...(style !== undefined ? { style } : {}),
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
        ...(style !== undefined ? { style } : {}),
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
      style,
      ...opts
    } = {}) => {
      // Guard: same 1-attachment-maximum constraint as chat.reply — applied independently
      // here so replyMessage (reply-threaded sends) enforces the limit regardless of which
      // chat context path the caller used. Both paths must be guarded because command modules
      // may call either depending on whether they need reply threading.
      const totalAttachCount = attachment.length + attachment_url.length;
      if (button.length > 0 && totalAttachCount > 1) {
        throw new Error(
          `Only 1 attachment (stream or URL, not both) is supported alongside button components. ` +
            `Received ${attachment.length} stream attachment(s) and ${attachment_url.length} URL attachment(s). ` +
            `Reduce to a maximum of 1 total attachment when using buttons.`,
        );
      }
      const targetThreadID = getThreadID(opts);
      const targetMessageID = getMessageID(opts);
      logger.debug('[context.model] ChatContext.replyMessage called', {
        threadID: targetThreadID,
        messageID: targetMessageID,
        hasMessage: !!message,
        buttonCount: button.length,
      });
      // Same FB Messenger fallback as chat.reply() — preserves reply_to_message_id so
      // the numbered menu is threaded to the triggering message for clearer context
      if (
        api.platform === Platforms.FacebookMessenger &&
        button.length > 0 &&
        commandName &&
        buttonDef
      ) {
        const msgId = await api.replyMessage(targetThreadID, {
          message: buildButtonFallbackText(message, button),
          attachment,
          attachment_url,
          reply_to_message_id: targetMessageID,
          button: [],
          ...(style !== undefined ? { style } : {}),
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
        ...(style !== undefined ? { style } : {}),
      });
    },

    /**
     * React to the current event message.
     */
    reactMessage: (options) => {
      const isObj = typeof options === 'object' && options !== null;
      const emoji = isObj
        ? (options as unknown as Record<string, unknown>).emoji
        : options;
      const targetThreadID = getThreadID(isObj ? options : null);
      const targetMessageID = getMessageID(isObj ? options : null);
      logger.debug('[context.model] ChatContext.reactMessage called', {
        threadID: targetThreadID,
        messageID: targetMessageID,
        emoji,
      });
      return api.reactToMessage(
        targetThreadID,
        targetMessageID,
        emoji as string,
      );
    },

    /**
     * Delete / unsend a specific message by its ID.
     * callers must be explicit about which message to remove.
     */
    unsendMessage: (options) => {
      const isObj = typeof options === 'object' && options !== null;
      const targetMessageID = isObj ? getMessageID(options) : options;
      logger.debug('[context.model] ChatContext.unsendMessage called', {
        targetMessageID,
      });
      return api.unsendMessage(targetMessageID as string);
    },

    editMessage: async (
      options: import('./interfaces/index.js').EditOptions,
    ) => {
      const targetMessageID =
        options.message_id_to_edit || getMessageID({ messageID: undefined });
      const targetThreadID = getThreadID(options);
      logger.debug('[context.model] ChatContext.editMessage called', {
        targetMessageID,
      });

      let finalMessage = options.message;
      if (
        api.platform === Platforms.FacebookMessenger &&
        options.button &&
        options.button.length > 0 &&
        commandName &&
        buttonDef
      ) {
        // Facebook Messenger has no native button component support on message edits — fallback to text menu
        finalMessage = buildButtonFallbackText(
          options.message ?? '',
          options.button,
        );
        registerButtonFallbackState(targetMessageID, options.button);
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { message, button, ...restOpts } = options;
      return api.editMessage(targetMessageID, {
        ...restOpts,
        threadID: targetThreadID,
        ...(finalMessage !== undefined ? { message: finalMessage } : {}),
        ...(button ? { button: resolveButtons(button) } : {}),
      });
    },
  };
}

/**
 * Creates a bot-scoped context object that exposes bot-level operations.
 * Injected as `ctx.bot` in every command's context.
 */
export function createBotContext(
  api: UnifiedApi,
  event?: Record<string, unknown>,
): import('./interfaces/index.js').BotContext {
  logger.debug('[context.model] createBotContext called');
  return {
    getID: () => {
      logger.debug('[context.model] BotContext.getID called');
      return api.getBotID();
    },
    leave: async (threadID?: string): Promise<void> => {
      // Resolve threadID: explicit arg wins; fall back to the current event's thread so
      // callers can omit the arg when they want to leave the conversation already in progress.
      const targetThread =
        threadID ?? (event?.['threadID'] as string | undefined) ?? '';
      logger.debug('[context.model] BotContext.leave called', { targetThread });
      return api.leaveThread(targetThread);
    },
  };
}

/**
 * Creates a user-scoped context object for querying user information.
 * Injected as `ctx.user` in every command's context.
 */
export function createUserContext(
  api: UnifiedApi,
  native?: { userId?: string; platform?: string; sessionId?: string },
): import('./interfaces/index.js').UserContext {
  logger.debug('[context.model] createUserContext called');
  return {
    /**
     * Fetch rich structured information about a user on this platform.
     * Returns a UnifiedUserInfo (see models/user.model.ts).
     */
    getInfo: async (userID): Promise<UnifiedUserInfo> => {
      logger.debug('[context.model] UserContext.getInfo called', { userID });
      // Scope cache to session identity — same composite key structure as thread.fullInfo
      // to keep namespace conventions consistent across the engine layer.
      const nativeUserId = native?.userId ?? '';
      const nativePlatform = native?.platform ?? api.platform;
      const nativeSessionId = native?.sessionId ?? '';
      if (nativeUserId && nativeSessionId) {
        const cached = lruCache.get<UnifiedUserInfo>(
          `${nativeUserId}:${nativePlatform}:${nativeSessionId}:user:fullInfo:${userID}`,
        );
        if (cached !== undefined) return cached;
      }
      const info = await api.getFullUserInfo(userID);
      if (nativeUserId && nativeSessionId) {
        lruCache.set(
          `${nativeUserId}:${nativePlatform}:${nativeSessionId}:user:fullInfo:${userID}`,
          info,
          getInfoCacheTTL(nativePlatform),
        );
      }
      return info;
    },
    // Cache-first (Discord/Telegram) or DB-backed (FB) — no external API round-trip on supported platforms
    getName: (userID) => {
      logger.debug('[context.model] UserContext.getName called', { userID });
      return api.getUserName(userID);
    },
    getAvatarUrl: (userID) => {
      logger.debug('[context.model] UserContext.getAvatarUrl called', {
        userID,
      });
      return api.getAvatarUrl(userID);
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
        logger.debug('[context.model] state.generateID called', {
          id,
          isPublic,
        });
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

/**
 * Creates a command-scoped button context injected as `ctx.button` in every command.
 * Bound to the triggering event so generateID() has access to senderID.
 *
 * @param commandName - Lowercased command name as registered in the commands Map
 * @param event       - The triggering message event (senderID source)
 */
export function createButtonContext(
  commandName: string,
  event: Record<string, unknown>,
): import('./interfaces/index.js').ButtonContext {
  logger.debug('[context.model] createButtonContext called', { commandName });
  return {
    button: {
      generateID({ id, public: isPublic = false }) {
        logger.debug('[context.model] button.generateID called', {
          id,
          isPublic,
        });
        // Append a short random string to prevent context collision on repeated command invocations
        const instanceId = Math.random().toString(36).substring(2, 8);
        const baseWithInstance = `${id}#${instanceId}`;

        if (isPublic) return baseWithInstance;
        return `${baseWithInstance}~${event['senderID'] as string}`;
      },
      createContext({ id, context }) {
        logger.debug('[context.model] button.createContext called', { id });
        buttonContextLib.create(`${commandName}:${id}`, context);
      },
      getContext(id) {
        return buttonContextLib.get(`${commandName}:${id}`);
      },
      deleteContext(id) {
        logger.debug('[context.model] button.deleteContext called', { id });
        buttonContextLib.delete(`${commandName}:${id}`);
      },
      update(options) {
        logger.debug('[context.model] button.update called', {
          id: options.id,
        });
        const key = `${commandName}:${options.id}`;
        const existing = buttonContextLib.getOverride(key) || {};
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id, ...payload } = options;
        buttonContextLib.setOverride(key, { ...existing, ...payload });
      },
      create(options) {
        logger.debug('[context.model] button.create called', {
          id: options.id,
        });
        const key = `${commandName}:${options.id}`;
        const existing = buttonContextLib.getOverride(key) || {};
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id, ...payload } = options;
        buttonContextLib.setOverride(key, { ...existing, ...payload });
      },
    },
  };
}
