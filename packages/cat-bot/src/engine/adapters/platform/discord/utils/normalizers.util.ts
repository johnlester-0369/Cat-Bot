/**
 * Discord Platform — Event Normalizers
 *
 * Single responsibility: transform native Discord.js event objects into the
 * unified Cat-Bot event contract (PROTO_EVENT_* shapes from models/prototypes/).
 *
 * WHY: Extracted from helper.util.ts — stream utilities and event normalization
 * are unrelated concerns. Event handlers import only what they need from here;
 * helper.util.ts keeps stream/mention utilities without pulling in 6 normalizers.
 */

import { Platforms } from '@/engine/constants/platform.constants.js';

import type {
  ChatInputCommandInteraction,
  GuildMember,
  Message,
  PartialMessage,
  MessageReaction,
  User,
  PartialGuildMember,
} from 'discord.js';

// ── Slash command interaction ─────────────────────────────────────────────────

/**
 * Normalises a Discord slash command interaction into UnifiedMessageEvent.
 * args is space-split from the joined option values so it matches every other
 * platform's convention — raw tokens, not resolved interaction option objects.
 */
export function normalizeInteractionEvent(
  interaction: ChatInputCommandInteraction,
  args: string[],
): Record<string, unknown> {
  // Re-join resolved option values into a single body string, then re-split —
  // identical to how normalizeMessageCreateEvent and all other platforms populate args.
  const body = args.join(' ');
  return {
    type: 'message',
    platform: Platforms.Discord,
    threadID: interaction.channelId,
    senderID: interaction.user.id,
    // Aligned to PROTO_EVENT_MESSAGE contract — uses message instead of body
    message: body,
    messageID: interaction.id,
    args: body.trim().split(/\s+/).filter(Boolean),
    attachments: [],
    isGroup: !!interaction.guild,
    mentions: {},
    timestamp: null,
    messageReply: null,
  };
}

// ── Guild member events ───────────────────────────────────────────────────────

/**
 * Normalises a Discord guildMemberAdd event into fca log:subscribe shape
 * so all platforms share the same subscribe event contract.
 */
export function normalizeGuildMemberAddEvent(
  member: GuildMember,
): Record<string, unknown> {
  return {
    type: 'event',
    platform: Platforms.Discord,
    threadID: member.guild.systemChannelId || member.guild.id,
    logMessageType: 'log:subscribe',
    logMessageData: {
      addedParticipants: [
        {
          // userFbId maps to the joining user's ID in the unified contract
          userFbId: member.id,
          firstName: member.user.username,
          fullName: member.displayName,
          groupJoinStatus: 'MEMBER',
          initialFolder: 'FOLDER_INBOX',
          initialFolderId: { systemFolderId: 'INBOX' },
          isMessengerUser: false,
          fanoutPolicy: '',
          lastUnsubscribeTimestampMs: '',
        },
      ],
    },
    logMessageBody: `${member.displayName} joined the server.`,
    // guildMemberAdd does not expose who sent the invite without fetching audit logs
    author: '',
  };
}

/**
 * Normalises a Discord guildMemberRemove event into fca log:unsubscribe shape.
 * Does not distinguish kick vs voluntary leave — that requires a separate audit log fetch.
 */
export function normalizeGuildMemberRemoveEvent(
  member: GuildMember | PartialGuildMember,
): Record<string, unknown> {
  return {
    type: 'event',
    platform: Platforms.Discord,
    threadID: member.guild.systemChannelId || member.guild.id,
    logMessageType: 'log:unsubscribe',
    logMessageData: { leftParticipantFbId: member.id },
    logMessageBody: `${member.displayName} left the server.`,
    author: '',
  };
}

// ── Message events ────────────────────────────────────────────────────────────

/**
 * Normalises a Discord messageCreate event into UnifiedMessageEvent.
 * Used by the text-prefix listener path — parallel to normalizeInteractionEvent
 * which handles slash commands. Bot messages are filtered before this is called.
 */
export function normalizeMessageCreateEvent(
  message: Message,
  args: string[],
  referencedMessage: Message | null = null,
): Record<string, unknown> {
  return {
    // Emit 'message_reply' when Discord message.reference is set (user hit "Reply")
    type: message.reference?.messageId ? 'message_reply' : 'message',
    platform: Platforms.Discord,
    threadID: message.channelId,
    senderID: message.author.id,
    message: message.content,
    messageID: message.id,
    args,
    // Map Discord Attachment Collection to unified shape; ID and url are always present on non-partial attachments
    attachments: [...message.attachments.values()].map((att) => ({
      type: 'file',
      ID: att.id,
      url: att.url,
      filename: att.name || null,
    })),
    isGroup: !!message.guild,
    // Map Discord MentionManager.users Collection to { [userId]: '@username' } fca contract shape
    // message.mentions.users is populated only when MessageContent intent is active
    mentions: Object.fromEntries(
      [...message.mentions.users.values()].map((u) => [u.id, `@${u.username}`]),
    ),
    timestamp: message.createdTimestamp || null,
    // message.reference is set when the user hits "Reply" on an existing message
    // referencedMessage is pre-resolved by event-handlers.ts via cache-first fetch
    messageReply: message.reference?.messageId
      ? {
          threadID: message.channelId,
          messageID: message.reference.messageId,
          senderID: referencedMessage?.author?.id ?? '',
          attachments: referencedMessage
            ? [...referencedMessage.attachments.values()].map((att) => ({
                type: 'file',
                ID: att.id,
                url: att.url,
                filename: att.name || null,
              }))
            : [],
          args: referencedMessage?.content
            ? referencedMessage.content.trim().split(/\s+/).filter(Boolean)
            : [],
          message: referencedMessage?.content ?? null,
          isGroup: !!message.guild,
          mentions: {},
          timestamp: referencedMessage?.createdTimestamp ?? null,
        }
      : null,
  };
}

// ── Reaction events ───────────────────────────────────────────────────────────

/**
 * Normalises a Discord messageReactionAdd event into the unified message_reaction shape.
 * Called AFTER partial fetch — reaction.emoji.name and reaction.message.author are
 * only populated once the partial structures have been fetched from Discord's REST API.
 */
export function normalizeMessageReactionAddEvent(
  reaction: MessageReaction,
  user: User,
): Record<string, unknown> {
  return {
    type: 'message_reaction',
    platform: Platforms.Discord,
    threadID: reaction.message.channelId,
    messageID: reaction.message.id,
    // Prefer emoji.name (standard emoji) — toString() covers custom guild emoji objects
    reaction: reaction.emoji.name ?? reaction.emoji.toString() ?? '',
    senderID: reaction.message.author?.id ?? '',
    userID: user.id,
    timestamp: Date.now(), // Discord gateway does not surface a reaction timestamp; wall-clock is best-effort
    // fca-unofficial MQTT field required by PROTO_EVENT_MESSAGE_REACTION — Discord has no equivalent
    offlineThreadingID: '',
  };
}

// ── Message delete (unsend) events ────────────────────────────────────────────

/**
 * Normalises a Discord messageDelete event into the unified message_unsend shape.
 * Partial messages (uncached at deletion time) only guarantee .id and .channelId —
 * author and content fields will be absent when the message was sent before bot restart.
 */
export function normalizeMessageDeleteEvent(
  message: Message | PartialMessage,
): Record<string, unknown> {
  return {
    type: 'message_unsend',
    platform: Platforms.Discord,
    threadID: message.channelId ?? '',
    messageID: message.id,
    senderID: message.author?.id ?? '',
    deletionTimestamp: Date.now(),
    timestamp: undefined,
  };
}
