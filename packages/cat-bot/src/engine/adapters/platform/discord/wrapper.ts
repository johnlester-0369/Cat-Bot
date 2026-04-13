/**
 * Discord Platform Wrapper — UnifiedApi Adapter Factories
 *
 * Single responsibility: create UnifiedApi instances that delegate to lib/ functions.
 *   - DiscordApi: stateful class for slash-command / interaction path (tracks #firstSend)
 *   - createDiscordChannelApi: plain object for non-interaction events (messageCreate, etc.)
 *
 * WHY: Normalizer re-exports were removed — they now live in utils/normalizers.util.ts
 * where event-handlers.ts imports them directly. Wrapper is now a pure API adapter layer.
 *
 * To change any API behaviour, edit the corresponding lib/<method>.ts file.
 */

import type {
  RepliableInteraction,
  TextChannel,
  Guild,
  Client,
  Message,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
} from 'discord.js';

import { UnifiedApi } from '@/engine/adapters/models/api.model.js';
import type {
  SendPayload,
  ReplyMessageOptions,
} from '@/engine/adapters/models/api.model.js';
import type { UnifiedThreadInfo } from '@/engine/adapters/models/thread.model.js';
import type { UnifiedUserInfo } from '@/engine/adapters/models/user.model.js';

import { buildDiscordMentionMsg } from './utils/helper.util.js';
import { logger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module

import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { sendMessage as sendMessageLib } from './lib/sendMessage.js';
import { unsendMessage as unsendMessageLib } from './lib/unsendMessage.js';
import { getUserInfo as getUserInfoLib } from './lib/getUserInfo.js';
import { setGroupName as setGroupNameLib } from './lib/setGroupName.js';
import { setGroupImage as setGroupImageLib } from './lib/setGroupImage.js';
import { removeGroupImage as removeGroupImageLib } from './lib/removeGroupImage.js';
import { replyMessage as replyMessageLib } from './lib/replyMessage.js';
import { reactToMessage as reactToMessageLib } from './lib/reactToMessage.js';
import { editMessage as editMessageLib } from './lib/editMessage.js';
import { setNickname as setNicknameLib } from './lib/setNickname.js';
import { getBotID as getBotIDLib } from './lib/getBotID.js';
import { getFullThreadInfo as getFullThreadInfoLib } from './lib/getFullThreadInfo.js';
import { getFullUserInfo as getFullUserInfoLib } from './lib/getFullUserInfo.js';
import { removeUserFromGroup as removeUserFromGroupLib } from './lib/removeUserFromGroup.js';

// Unsupported operations consolidated into single file
import {
  addUserToGroup as addUserToGroupLib,
  setGroupReaction as setGroupReactionLib,
} from './unsupported.js';

// Database fallbacks for cross-platform unified name resolution
import { getUserName as dbGetUserName } from '@/engine/repos/users.repo.js';
import { getThreadName as dbGetThreadName } from '@/engine/repos/threads.repo.js';

// ── DiscordApi (slash-command / interaction path) ──────────────────────────────

class DiscordApi extends UnifiedApi {
  readonly #interaction: RepliableInteraction;
  // Tracks whether the first send has been dispatched — Discord interactions must
  // use editReply (deferred) or reply (first send) before switching to followUp.
  #firstSend = true;
  // When true this instance was created for a button (component) interaction whose
  // deferUpdate() has already been called. Discord's rule: after deferUpdate() the
  // ONLY way to post a NEW message is followUp() — editReply() would overwrite the
  // original button message, which is wrong for chat.reply / chat.replyMessage calls.
  // chat.editMessage bypasses this path entirely (uses editMessageLib via the channel),
  // so it is unaffected by this flag.
  #isButtonInteraction = false;

  constructor(interaction: RepliableInteraction, isButtonInteraction = false) {
    super();
    this.platform = Platforms.Discord;
    this.#interaction = interaction;
    this.#isButtonInteraction = isButtonInteraction;
  }

  /** Routes to editReply (when deferred), reply (first send), or followUp (subsequent). */
  async #send(
    content: string,
    files: AttachmentBuilder[] = [],
    components: ActionRowBuilder<ButtonBuilder>[] = [],
  ): Promise<{ id: string } | undefined> {
    const i = this.#interaction;
    // Only spread components into the payload when present — passing an empty array
    // triggers a Discord API validation warning on some interaction types.
    const payload: Record<string, unknown> = {
      content,
      files,
      ...(components.length ? { components } : {}),
    };
    // Button interactions: deferUpdate() has already been called, so i.deferred === true.
    // Calling editReply() here would OVERWRITE the original button message — not what
    // chat.reply / chat.replyMessage intend. Use followUp() to post a new message instead.
    if (this.#isButtonInteraction) {
      const sent = await i.followUp(
        payload as Parameters<typeof i.followUp>[0],
      );
      return sent as unknown as { id: string };
    }
    if (this.#firstSend) {
      this.#firstSend = false;
      const sent = await (i.deferred
        ? i.editReply(payload as Parameters<typeof i.editReply>[0])
        : i.reply(payload as Parameters<typeof i.reply>[0]));
      return sent as unknown as { id: string };
    }
    const sent = await i.followUp(payload as Parameters<typeof i.followUp>[0]);
    return sent as unknown as { id: string };
  }

  /**
   * Resolves a cross-channel send target when threadID differs from the interaction channel.
   * Returns null to preserve the interaction API path (#send) for same-channel responses.
   * Tries channels.fetch() first (guild text channels), then user.createDM() — callad passes
   * admin user IDs as thread_id which Discord cannot resolve via channels.fetch() alone.
   */
  async #resolveChannel(
    threadID: string,
  ): Promise<import('discord.js').TextBasedChannel | null> {
    if (!threadID || threadID === this.#interaction.channelId) return null;
    const c = this.#interaction.client;
    try {
      const ch = await c.channels.fetch(threadID);
      if (ch && 'send' in ch)
        return ch as import('discord.js').TextBasedChannel;
    } catch {
      /* not a channel ID — fall through to DM attempt */
    }
    try {
      const u = await c.users.fetch(threadID);
      return await u.createDM();
    } catch {
      return null;
    }
  }

  // #send is passed as a closure so lib functions never reference DiscordApi internals
  override sendMessage(
    msg: string | SendPayload,
    _threadID: string,
  ): Promise<string | undefined> {
    logger.debug('[discord] sendMessage called', { threadID: _threadID });
    return (async () => {
      const crossCh = await this.#resolveChannel(_threadID);
      if (crossCh) {
        // Cross-channel send: bypass the interaction API and route directly to the target channel.
        // Required for callad.ts forwarding user messages to admin DMs on Discord.
        const text =
          typeof msg === 'string'
            ? msg
            : (msg.message ?? (msg as unknown as { body?: string }).body ?? '');
        const sent = await (crossCh as import('discord.js').TextChannel).send(text);
        return (sent as import('discord.js').Message).id;
      }
      return sendMessageLib(
        async (c, f) => {
          const idInfo = await this.#send(c, f);
          return idInfo ? { id: idInfo.id } : undefined;
        },
        buildDiscordMentionMsg(msg) as string | SendPayload,
      );
    })();
  }

  // Slash command replies cannot be deleted via interaction API — channel=null signals no-op
  override unsendMessage(_messageID: string): Promise<void> {
    logger.debug('[discord] unsendMessage called', { messageID: _messageID });
    return unsendMessageLib(null, _messageID);
  }

  override getUserInfo(
    userIds: string[],
  ): Promise<Record<string, { name: string }>> {
    logger.debug('[discord] getUserInfo called', { userCount: userIds.length });
    const interaction = this.#interaction;
    return getUserInfoLib(async (id) => {
      if (interaction.user.id === id) {
        return {
          name:
            (interaction.member as unknown as { displayName?: string })
              ?.displayName ||
            (interaction.user as unknown as { displayName?: string })
              .displayName ||
            interaction.user.username,
        };
      }
      try {
        const member = await interaction.guild?.members.fetch(id);
        return { name: member?.displayName ?? `User ${id}` };
      } catch {
        return { name: `User ${id}` };
      }
    }, userIds);
  }

  override setGroupName(_threadID: string, name: string): Promise<void> {
    logger.debug('[discord] setGroupName called', {
      threadID: _threadID,
      name,
    });
    return setGroupNameLib(this.#interaction.guild, name);
  }
  override setGroupImage(
    _threadID: string,
    imageSource: Buffer | import('stream').Readable | string,
  ): Promise<void> {
    logger.debug('[discord] setGroupImage called', { threadID: _threadID });
    return setGroupImageLib(this.#interaction.guild, imageSource);
  }
  override removeGroupImage(_threadID: string): Promise<void> {
    logger.debug('[discord] removeGroupImage called', { threadID: _threadID });
    return removeGroupImageLib(this.#interaction.guild);
  }
  override addUserToGroup(_threadID: string, _userID: string): Promise<void> {
    logger.debug('[discord] addUserToGroup called', {
      threadID: _threadID,
      userID: _userID,
    });
    return addUserToGroupLib();
  }
  override removeUserFromGroup(
    _threadID: string,
    userID: string,
  ): Promise<void> {
    logger.debug('[discord] removeUserFromGroup called', {
      threadID: _threadID,
      userID,
    });
    return removeUserFromGroupLib(this.#interaction.guild, userID);
  }
  override setGroupReaction(_threadID: string, _emoji: string): Promise<void> {
    logger.debug('[discord] setGroupReaction called', {
      threadID: _threadID,
      emoji: _emoji,
    });
    return setGroupReactionLib();
  }

  override replyMessage(
    _threadID: string,
    options: ReplyMessageOptions = {},
  ): Promise<unknown> {
    logger.debug('[discord] replyMessage called', { threadID: _threadID });
    // Interaction path silently ignores reply_to_message_id — slash commands reply via interaction API
    // Extract the message string from options; buildDiscordMentionMsg only accepts string | SendPayload
    const msgArg =
      typeof options.message === 'string'
        ? options.message
        : (options.message?.message ?? options.message?.body ?? '');
    const payloadWithMentions = buildDiscordMentionMsg({
      message: msgArg,
      // Coalescing undefined to empty array avoids assignment mismatches with strict exactOptionalPropertyTypes
      mentions:
        options.mentions ??
        (typeof options.message === 'object'
          ? (options.message.mentions ?? [])
          : []),
    }) as SendPayload;
    return (async () => {
      const crossCh = await this.#resolveChannel(_threadID);
      const resolvedOpts = {
        message: payloadWithMentions.message ?? '',
        // Forward attachments and buttons — these were previously silently dropped, causing
        // command modules (e.g. /example_buttons) to send messages with no button components.
        // exactOptionalPropertyTypes requires conditional spreads instead of `key: undefined`.
        ...(options.attachment !== undefined
          ? { attachment: options.attachment }
          : {}),
        ...(options.attachment_url !== undefined
          ? { attachment_url: options.attachment_url }
          : {}),
        ...(options.button !== undefined ? { button: options.button } : {}),
        ...(options.reply_to_message_id !== undefined
          ? { reply_to_message_id: options.reply_to_message_id }
          : {}),
      };
      if (crossCh) {
        // Cross-channel reply (e.g. callad relaying to admin DM) — bypass the interaction API
        return replyMessageLib(async (content, files, replyId, components) => {
          const sOpts: Record<string, unknown> = { content };
          if (replyId)
            sOpts['reply'] = {
              messageReference: replyId,
              failIfNotExists: false,
            };
          if (files.length > 0) sOpts['files'] = files;
          if (components && components.length > 0)
            sOpts['components'] = components;
          const sent = await (crossCh as import('discord.js').TextChannel).send(
            sOpts as Parameters<import('discord.js').TextChannel['send']>[0],
          );
          return (sent as unknown as { id?: string })?.id;
        }, resolvedOpts);
      }
      // Same-channel: forward button components from lib to #send so they appear on reply/followUp
      return replyMessageLib(
        (content, files, _replyId, components) =>
          this.#send(content, files, components).then((r) => r?.id),
        resolvedOpts,
      );
    })();
  }

  override reactToMessage(
    _threadID: string,
    messageID: string,
    emoji: string,
  ): Promise<void> {
    logger.debug('[discord] reactToMessage called', {
      threadID: _threadID,
      messageID,
      emoji,
    });
    return reactToMessageLib(
      this.#interaction.channel as TextChannel,
      messageID,
      emoji,
    );
  }

  override editMessage(
    messageID: string,
    options:
      | string
      | import('@/engine/adapters/models/api.model.js').EditMessageOptions,
  ): Promise<void> {
    logger.debug('[discord] editMessage called', { messageID });
    return editMessageLib(
      this.#interaction.channel as TextChannel,
      messageID,
      options,
    );
  }
  override setNickname(
    _threadID: string,
    userID: string,
    nickname: string,
  ): Promise<void> {
    logger.debug('[discord] setNickname called', {
      threadID: _threadID,
      userID,
    });
    return setNicknameLib(this.#interaction.guild, userID, nickname);
  }

  override getBotID(): Promise<string> {
    logger.debug('[discord] getBotID called');
    return getBotIDLib(this.#interaction.client, null);
  }

  override getFullThreadInfo(threadID: string): Promise<UnifiedThreadInfo> {
    logger.debug('[discord] getFullThreadInfo called', { threadID });
    return getFullThreadInfoLib(
      this.#interaction.client,
      this.#interaction.channel as TextChannel,
      this.#interaction.guild,
      threadID,
    );
  }

  override getFullUserInfo(userID: string): Promise<UnifiedUserInfo> {
    logger.debug('[discord] getFullUserInfo called', { userID });
    return getFullUserInfoLib(
      this.#interaction.client,
      this.#interaction.guild,
      userID,
      this.#interaction.user, // self-user shortcut avoids a REST fetch for the command sender
    );
  }

  /**
   * Cache-first user name — hits GuildMemberManager.cache only (zero REST).
   * Interaction path: the command sender is always available via interaction.user; other
   * member IDs are served from the guild member cache populated by GatewayIntentBits.GuildMembers.
   * Falls back to database lookup when a member is not cached (e.g. DMs with no guild context).
   */
  override getUserName(userID: string): Promise<string> {
    logger.debug(
      '[discord] getUserName called (cache-first with db fallback)',
      { userID },
    );
    if (this.#interaction.user.id === userID) {
      // Cast to any-shaped member so we can read displayName without importing GuildMember
      const selfName = (
        this.#interaction.member as Record<string, unknown> | null
      )?.['displayName'] as string | undefined;
      return Promise.resolve(selfName || this.#interaction.user.username);
    }
    const member = this.#interaction.guild?.members.cache.get(userID);
    if (member)
      return Promise.resolve(member.displayName || member.user.username);
    return dbGetUserName(userID);
  }

  /**
   * Cache-first thread name — guild.name is always available in cache when the bot is in a guild.
   * Falls back to database lookup for DM interactions where no guild is present.
   */
  override getThreadName(_threadID: string): Promise<string> {
    logger.debug(
      '[discord] getThreadName called (cache-first with db fallback)',
      { threadID: _threadID },
    );
    const name = this.#interaction.guild?.name;
    if (name) return Promise.resolve(name);
    return dbGetThreadName(_threadID);
  }
}

// ── createDiscordApi (interaction factory) ─────────────────────────────────────

/**
 * Creates a UnifiedApi adapter for a Discord slash command interaction.
 * Caller must have already called interaction.deferReply() before constructing.
 *
 * @param isButtonInteraction - Pass true when the interaction is a button component
 *   interaction (deferUpdate already called). Causes chat.reply/replyMessage to use
 *   followUp() instead of editReply(), posting a new message rather than overwriting
 *   the original button message.
 */
export function createDiscordApi(
  interaction: RepliableInteraction,
  isButtonInteraction = false,
): UnifiedApi {
  return new DiscordApi(interaction, isButtonInteraction);
}

// ── createDiscordChannelApi (channel factory) ──────────────────────────────────

/**
 * Creates a UnifiedApi that sends messages to a guild channel.
 * Used for non-interaction events (guildMemberAdd, guildMemberRemove, messageCreate).
 * Each method delegates to the same lib functions as DiscordApi, supplying channel/guild
 * closures in place of interaction references.
 */
export function createDiscordChannelApi(
  channel: TextChannel,
  guild: Guild | null,
  rawMessage: Message | null = null,
  client: Client | null = null,
): UnifiedApi {
  const api = new UnifiedApi();
  api.platform = Platforms.Discord;

  // sendFn for plain channel sends — returns the Message object so lib can extract .id
  const channelSendFn = async (
    content: string,
    files: AttachmentBuilder[],
  ): Promise<{ id: string } | undefined> => {
    const sent =
      files.length > 0
        ? await channel.send({ content, files })
        : await channel.send(content);
    return sent as unknown as { id: string };
  };

  /**
   * Resolves the target channel for sends in createDiscordChannelApi.
   * Returns the bound channel when targetId matches or client is unavailable.
   * Falls back through guild channel fetch → user.createDM() — callad passes admin user IDs
   * as thread_id and Discord user IDs cannot be resolved via client.channels.fetch() alone.
   */
  async function resolveChannel(
    targetId: string,
  ): Promise<import('discord.js').TextBasedChannel> {
    if (!targetId || targetId === channel.id || !client) return channel;
    try {
      const ch = await client.channels.fetch(targetId);
      if (ch && 'send' in ch)
        return ch as import('discord.js').TextBasedChannel;
    } catch {
      /* not a channel ID — try opening a DM to this user ID */
    }
    try {
      const u = await client.users.fetch(targetId);
      return await u.createDM();
    } catch {
      return channel;
    }
  }

  api.sendMessage = (msg, _threadID) => {
    logger.debug('[discord] sendMessage called', { threadID: _threadID });
    return (async () => {
      const targetCh = await resolveChannel(_threadID);
      if (targetCh !== channel) {
        // Cross-channel: resolve the target and send directly — the primary fix for callad
        // forwarding user messages to admin DMs or relay threads on Discord
        const text =
          typeof msg === 'string'
            ? msg
            : ((buildDiscordMentionMsg(msg) as SendPayload).message ?? '');
        const sent = await (targetCh as import('discord.js').TextChannel).send(
          text,
        );
        return sent.id;
      }
      return sendMessageLib(
        channelSendFn,
        buildDiscordMentionMsg(msg) as string | SendPayload,
      );
    })();
  };
  // TextBasedChannel cast — unsendMessageLib expects TextChannel but the channel path accepts any text channel
  api.unsendMessage = (messageID) => {
    logger.debug('[discord] unsendMessage called', { messageID });
    return unsendMessageLib(
      channel as import('discord.js').TextChannel,
      messageID,
    );
  };

  api.getUserInfo = (userIds) => {
    logger.debug('[discord] getUserInfo called', { userCount: userIds.length });
    return getUserInfoLib(async (id) => {
      try {
        const member = await guild!.members.fetch(id);
        return { name: member.displayName };
      } catch {
        return { name: `User ${id}` };
      }
    }, userIds);
  };

  api.setGroupName = (_tid, name) => {
    logger.debug('[discord] setGroupName called', { threadID: _tid, name });
    return setGroupNameLib(guild, name);
  };
  api.setGroupImage = (_tid, img) => {
    logger.debug('[discord] setGroupImage called', { threadID: _tid });
    return setGroupImageLib(guild, img);
  };
  api.removeGroupImage = (_tid) => {
    logger.debug('[discord] removeGroupImage called', { threadID: _tid });
    return removeGroupImageLib(guild);
  };
  api.addUserToGroup = (_tid, _uid) => {
    logger.debug('[discord] addUserToGroup called', {
      threadID: _tid,
      userID: _uid,
    });
    return addUserToGroupLib();
  };
  api.removeUserFromGroup = (_tid, uid) => {
    logger.debug('[discord] removeUserFromGroup called', {
      threadID: _tid,
      userID: uid,
    });
    return removeUserFromGroupLib(guild, uid);
  };
  api.setGroupReaction = (_tid, _e) => {
    logger.debug('[discord] setGroupReaction called', {
      threadID: _tid,
      emoji: _e,
    });
    return setGroupReactionLib();
  };

  api.replyMessage = async (_threadID, options) => {
    logger.debug('[discord] replyMessage called', { threadID: _threadID });
    const targetCh = await resolveChannel(_threadID);
    const msgBody =
      (
        buildDiscordMentionMsg({
          message:
            typeof options?.message === 'string'
              ? options.message
              : (options?.message?.message ?? options?.message?.body ?? ''),
          mentions:
            options?.mentions ??
            (typeof options?.message === 'object'
              ? (options.message.mentions ?? [])
              : []),
        }) as SendPayload
      ).message ?? '';
    const resolvedOpts = {
      message: msgBody,
      // Forward all option fields — same fix as DiscordApi.replyMessage; buttons, attachments,
      // and reply threading are preserved so callad relay messages are fully featured.
      ...(options?.attachment !== undefined
        ? { attachment: options.attachment }
        : {}),
      ...(options?.attachment_url !== undefined
        ? { attachment_url: options.attachment_url }
        : {}),
      ...(options?.button !== undefined ? { button: options.button } : {}),
      ...(options?.reply_to_message_id !== undefined
        ? { reply_to_message_id: options.reply_to_message_id }
        : {}),
    };
    // Skip thread-pinning when sending cross-channel — the reply_to_message_id references a
    // message in the originating channel which does not exist in the target DM/channel.
    return replyMessageLib(async (content, files, replyId, components) => {
      const sOpts: Record<string, unknown> = { content };
      // Apply reply threading whenever replyId is present, regardless of whether the target is
      // the originating channel or a cross-channel DM/relay. The Discord API requires only that
      // messageReference.message_id points to a message that exists in targetCh — callad.ts
      // always satisfies this contract (userMessageID is in userThreadID, adminMessageID in adminThreadID).
      if (replyId)
        sOpts['reply'] = { messageReference: replyId, failIfNotExists: false };
      if (files.length > 0) sOpts['files'] = files;
      if (components && components.length > 0) sOpts['components'] = components;
      const sent = await (targetCh as import('discord.js').TextChannel).send(
        sOpts as Parameters<import('discord.js').TextChannel['send']>[0],
      );
      return (sent as unknown as { id?: string })?.id;
    }, resolvedOpts);
  };

  api.reactToMessage = (_tid, mid, emoji) => {
    logger.debug('[discord] reactToMessage called', {
      threadID: _tid,
      messageID: mid,
      emoji,
    });
    return reactToMessageLib(channel, mid, emoji, rawMessage);
  };
  api.editMessage = (mid, options) => {
    logger.debug('[discord] editMessage called', { messageID: mid });
    return editMessageLib(channel, mid, options);
  };
  api.setNickname = (_tid, uid, nick) => {
    logger.debug('[discord] setNickname called', {
      threadID: _tid,
      userID: uid,
    });
    return setNicknameLib(guild, uid, nick);
  };
  api.getBotID = () => {
    logger.debug('[discord] getBotID called');
    return getBotIDLib(client, guild);
  };
  api.getFullThreadInfo = (tid) => {
    logger.debug('[discord] getFullThreadInfo called', { threadID: tid });
    return getFullThreadInfoLib(client, channel, guild, tid);
  };
  api.getFullUserInfo = (uid) => {
    logger.debug('[discord] getFullUserInfo called', { userID: uid });
    return getFullUserInfoLib(client, guild, uid, null);
  };
  // Cache-first name resolution — GuildMemberManager.cache is populated by GatewayIntentBits.GuildMembers
  // events so the common case (members who have sent messages recently) requires zero REST.
  api.getUserName = (uid) => {
    logger.debug(
      '[discord] getUserName called (cache-first with db fallback)',
      { userID: uid },
    );
    const member = guild?.members.cache.get(uid);
    if (member)
      return Promise.resolve(member.displayName || member.user.username);
    // client.users.cache holds Users (without guild-specific displayName) as a last resort
    const user = client?.users.cache.get(uid);
    if (user) return Promise.resolve(user.username);
    // Fallback to database lookup if user is entirely uncached
    return dbGetUserName(uid);
  };
  api.getThreadName = (_tid) => {
    logger.debug(
      '[discord] getThreadName called (cache-first with db fallback)',
      { threadID: _tid },
    );
    // guild.name is the server name; channel.name is the channel name — guild is preferred since
    // it represents the broader "thread" concept used in unified commands like /thread
    const name = guild?.name || channel.name;
    if (name) return Promise.resolve(name);
    return dbGetThreadName(_tid);
  };

  return api;
}
