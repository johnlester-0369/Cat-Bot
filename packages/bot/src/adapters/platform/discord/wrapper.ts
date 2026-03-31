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

import { UnifiedApi } from '@/adapters/models/api.model.js';
import type {
  SendPayload,
  ReplyMessageOptions,
} from '@/adapters/models/api.model.js';
import type { UnifiedThreadInfo } from '@/adapters/models/thread.model.js';
import type { UnifiedUserInfo } from '@/adapters/models/user.model.js';

import { buildDiscordMentionMsg } from './utils/helper.util.js';

import { PLATFORM_ID } from './index.js';
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

// ── DiscordApi (slash-command / interaction path) ──────────────────────────────

class DiscordApi extends UnifiedApi {
  readonly #interaction: RepliableInteraction;
  // Tracks whether the first send has been dispatched — Discord interactions must
  // use editReply (deferred) or reply (first send) before switching to followUp.
  #firstSend = true;

  constructor(interaction: RepliableInteraction) {
    super();
    this.platform = PLATFORM_ID;
    this.#interaction = interaction;
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

  // #send is passed as a closure so lib functions never reference DiscordApi internals
  override sendMessage(
    msg: string | SendPayload,
    _threadID: string,
  ): Promise<string | undefined> {
    return sendMessageLib(
      async (c, f) => {
        const idInfo = await this.#send(c, f);
        return idInfo ? { id: idInfo.id } : undefined;
      },
      buildDiscordMentionMsg(msg) as string | SendPayload,
    );
  }

  // Slash command replies cannot be deleted via interaction API — channel=null signals no-op
  override unsendMessage(_messageID: string): Promise<void> {
    return unsendMessageLib(null, _messageID);
  }

  override getUserInfo(
    userIds: string[],
  ): Promise<Record<string, { name: string }>> {
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
    return setGroupNameLib(this.#interaction.guild, name);
  }
  override setGroupImage(
    _threadID: string,
    imageSource: Buffer | import('stream').Readable | string,
  ): Promise<void> {
    return setGroupImageLib(this.#interaction.guild, imageSource);
  }
  override removeGroupImage(_threadID: string): Promise<void> {
    return removeGroupImageLib(this.#interaction.guild);
  }
  override addUserToGroup(_threadID: string, _userID: string): Promise<void> {
    return addUserToGroupLib();
  }
  override removeUserFromGroup(
    _threadID: string,
    userID: string,
  ): Promise<void> {
    return removeUserFromGroupLib(this.#interaction.guild, userID);
  }
  override setGroupReaction(_threadID: string, _emoji: string): Promise<void> {
    return setGroupReactionLib();
  }

  override replyMessage(
    _threadID: string,
    options: ReplyMessageOptions = {},
  ): Promise<unknown> {
    // Interaction path silently ignores reply_to_message_id — slash commands reply via interaction API
    // Extract the message string from options; buildDiscordMentionMsg only accepts string | SendPayload
    const msgArg = typeof options.message === 'string' ? options.message : '';
    return replyMessageLib(
      // Forward button components from lib to #send so they appear on the interaction reply/followUp
      (content, files, _replyId, components) =>
        this.#send(content, files, components).then((r) => r?.id),
      { message: buildDiscordMentionMsg(msgArg) as string },
    );
  }

  override reactToMessage(
    _threadID: string,
    messageID: string,
    emoji: string,
  ): Promise<void> {
    return reactToMessageLib(
      this.#interaction.channel as TextChannel,
      messageID,
      emoji,
    );
  }

  override editMessage(messageID: string, newBody: string): Promise<void> {
    return editMessageLib(
      this.#interaction.channel as TextChannel,
      messageID,
      newBody,
    );
  }
  override setNickname(
    _threadID: string,
    userID: string,
    nickname: string,
  ): Promise<void> {
    return setNicknameLib(this.#interaction.guild, userID, nickname);
  }

  override getBotID(): Promise<string> {
    return getBotIDLib(this.#interaction.client, null);
  }

  override getFullThreadInfo(threadID: string): Promise<UnifiedThreadInfo> {
    return getFullThreadInfoLib(
      this.#interaction.client,
      this.#interaction.channel as TextChannel,
      this.#interaction.guild,
      threadID,
    );
  }

  override getFullUserInfo(userID: string): Promise<UnifiedUserInfo> {
    return getFullUserInfoLib(
      this.#interaction.client,
      this.#interaction.guild,
      userID,
      this.#interaction.user, // self-user shortcut avoids a REST fetch for the command sender
    );
  }
}

// ── createDiscordApi (interaction factory) ─────────────────────────────────────

/**
 * Creates a UnifiedApi adapter for a Discord slash command interaction.
 * Caller must have already called interaction.deferReply() before constructing.
 */
export function createDiscordApi(
  interaction: RepliableInteraction,
): UnifiedApi {
  return new DiscordApi(interaction);
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
  api.platform = PLATFORM_ID;

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

  api.sendMessage = (msg, _threadID) =>
    sendMessageLib(
      channelSendFn,
      buildDiscordMentionMsg(msg) as string | SendPayload,
    );
  // TextBasedChannel cast — unsendMessageLib expects TextChannel but the channel path accepts any text channel
  api.unsendMessage = (messageID) =>
    unsendMessageLib(channel as import('discord.js').TextChannel, messageID);

  api.getUserInfo = (userIds) =>
    getUserInfoLib(async (id) => {
      try {
        const member = await guild!.members.fetch(id);
        return { name: member.displayName };
      } catch {
        return { name: `User ${id}` };
      }
    }, userIds);

  api.setGroupName = (_tid, name) => setGroupNameLib(guild, name);
  api.setGroupImage = (_tid, img) => setGroupImageLib(guild, img);
  api.removeGroupImage = (_tid) => removeGroupImageLib(guild);
  api.addUserToGroup = (_tid, _uid) => addUserToGroupLib();
  api.removeUserFromGroup = (_tid, uid) => removeUserFromGroupLib(guild, uid);
  api.setGroupReaction = (_tid, _e) => setGroupReactionLib();

  api.replyMessage = (_threadID, options) =>
    replyMessageLib(
      async (content, files, replyId, components) => {
        const sendOptions: Record<string, unknown> = { content };
        // Create a Discord quote-thread back to the original message when replyId is present
        if (replyId)
          sendOptions['reply'] = {
            messageReference: replyId,
            failIfNotExists: false,
          };
        if (files.length > 0) sendOptions['files'] = files;
        // Attach button ActionRows when present so Discord renders them below the message text
        if (components && components.length > 0)
          sendOptions['components'] = components;
        const sent = await channel.send(
          sendOptions as Parameters<typeof channel.send>[0],
        );
        return (sent as unknown as { id?: string })?.id;
      },
      {
        message: buildDiscordMentionMsg(
          typeof options?.message === 'string' ? options.message : '',
        ) as string,
      },
    );

  api.reactToMessage = (_tid, mid, emoji) =>
    reactToMessageLib(channel, mid, emoji, rawMessage);
  api.editMessage = (mid, body) => editMessageLib(channel, mid, body);
  api.setNickname = (_tid, uid, nick) => setNicknameLib(guild, uid, nick);
  api.getBotID = () => getBotIDLib(client, guild);
  api.getFullThreadInfo = (tid) =>
    getFullThreadInfoLib(client, channel, guild, tid);
  api.getFullUserInfo = (uid) => getFullUserInfoLib(client, guild, uid, null);

  return api;
}
