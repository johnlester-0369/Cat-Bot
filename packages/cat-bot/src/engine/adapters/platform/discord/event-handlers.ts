/**
 * Discord Platform — Event Handler Registration
 *
 * Single responsibility: attach all Discord.js event listeners to the Client
 * and emit normalised events on the unified emitter.
 *
 * WHY: index.ts had ~150 lines of .on() registrations mixed with slash command
 * logic and client bootstrapping. Extracting isolates the "what happens when
 * Discord fires an event" concern from "how the bot starts up".
 *
 * Slash command interactions are handled INTERNALLY (not emitted to app.ts)
 * because Discord requires interaction.deferReply() within 3 seconds —
 * delegating to app.ts would risk the async handoff hitting that window.
 */

import { EventEmitter } from 'events';
import type { Client } from 'discord.js';
import type { SessionLogger } from '@/engine/lib/logger.lib.js';
import { Platforms } from '@/engine/constants/platform.constants.js';
import { createDiscordApi, createDiscordChannelApi } from './wrapper.js';
import {
  normalizeInteractionEvent,
  normalizeGuildMemberAddEvent,
  normalizeGuildMemberRemoveEvent,
  normalizeMessageCreateEvent,
  normalizeMessageReactionAddEvent,
  normalizeMessageDeleteEvent
 } from './utils/normalizers.util.js';
import { clearGuildCommands } from './slash-commands.js';
import { OptionType } from '@/engine/constants/command-option.constants.js';

interface AttachEventHandlersOptions {
  client: Client;
  emitter: EventEmitter;
  commands: Map<string, Record<string, unknown>>;
  prefix: string;
  clientId: string;
  token: string;
  userId: string;
  sessionId: string;
  sessionLogger: SessionLogger;
}

/**
 * Attaches all Discord.js event listeners to the client.
 * Each handler normalises the native event and emits on the unified emitter
 * — the emitter surface is identical across all platforms so app.ts needs
 * zero platform branching.
 */
export async function attachEventHandlers(
  options: AttachEventHandlersOptions,
): Promise<void> {
  const {
    client,
    emitter,
    commands,
    prefix,
    clientId,
    token,
    userId,
    sessionId,
    sessionLogger,
  } = options;

  // ── Text-prefix message listener → emit 'message' / 'message_reply' ───────
  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const rawArgs = message.content.trim().split(/\s+/).filter(Boolean);
    const api = createDiscordChannelApi(
      message.channel as import('discord.js').TextChannel,
      message.guild,
      message,
      client,
    );

    // Cache-first reference fetch: Discord's MESSAGE_CREATE payload includes referenced_message
    // inline for reply type (19); discord.js caches it on receipt, so cache.get() has zero REST cost
    let referencedMessage = null;
    if (message.reference?.messageId) {
      try {
        referencedMessage =
          (
            message.channel.messages as unknown as {
              cache: Map<string, import('discord.js').Message>;
            }
          ).cache.get(message.reference.messageId) ??
          (await message.fetchReference());
      } catch {
        /* message deleted or inaccessible — proceed with partial reply data */
      }
    }

    const event = normalizeMessageCreateEvent(
      message,
      rawArgs,
      referencedMessage,
    );
    const native = { platform: Platforms.Discord, userId, sessionId, message };

    // Distinguish replies so app.ts can subscribe granularly via platform.on('message_reply')
    const eventType = message.reference?.messageId
      ? 'message_reply'
      : 'message';
    emitter.emit(eventType, { api, event, native, prefix });
  });

  // ── Slash command interactions — handled internally ─────────────────────────
  // deferReply() MUST be called within 3 s; delegating to app.ts via an emitted
  // event would risk the async handoff hitting Discord's acknowledgment window.
  client.on('interactionCreate', async (interaction) => {
    // ── Button component interactions → emit 'button_action' ───────────────────
    if (interaction.isButton()) {
      await interaction.deferReply();
      const api = createDiscordApi(interaction);
      const event = {
        type: 'button_action',
        platform: Platforms.Discord,
        actionId: interaction.customId,
        threadID: interaction.channelId,
        senderID: interaction.user.id,
        // message.id is the bot message the button is attached to
        messageID: interaction.message.id,
        timestamp: Date.now(),
      };
      const native = { platform: Platforms.Discord, userId, sessionId, interaction };
      emitter.emit('button_action', { api, event, native, prefix });
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    await interaction.deferReply();

    const commandName = interaction.commandName;
    const mod = commands.get(commandName);

    // Pre-resolve interaction.options into a name→value record so validateCommandOptions
    // constructs OptionsMap from interaction values directly, preserving Discord's native type coercion.
    const cfg = (mod?.['config'] as Record<string, unknown>) ?? {};
    const optionDefs = (cfg['options'] as Array<{ name: string; type?: string }>) ?? [];
    const optionsRecord: Record<string, string> = {};
    for (const opt of optionDefs) {
      if (opt.type === OptionType.user) {
        // getUser() returns a Discord User object; extract .id to keep optionsRecord
        // typed as Record<string, string> — OptionsMap and ctx.args both expect string values
        const user = interaction.options.getUser(opt.name);
        if (user) optionsRecord[opt.name] = user.id;
      } else {
        const val = interaction.options.getString(opt.name);
        if (val !== null && val !== undefined) optionsRecord[opt.name] = val;
      }
    }

    // Build args as the space-joined option values — same raw-token convention as
    // text-prefix platforms so command modules can always rely on ctx.args for positional access.
    const args = Object.values(optionsRecord).filter(Boolean);

    const api = createDiscordApi(interaction);
    const event = normalizeInteractionEvent(interaction, args);
    // Embed the pre-resolved options so validateCommandOptions detects the Discord slash path
    // and skips text-body parsing — the optionsRecord field is the detection signal.
    event['optionsRecord'] = optionsRecord;
    // Mock a text message body so `message.handler.ts` routes it correctly through `parseCommand`
    event['message'] = `${prefix}${commandName} ${args.join(' ')}`.trim();
    const native = { platform: Platforms.Discord, userId, sessionId, interaction };
    
    // Emit 'message' so app.ts routes it to message.handler.ts, centralising ctx creation
    emitter.emit('message', { api, event, native, prefix });
  });

  // ── Guild member events → emit 'event' ────────────────────────────────────
  client.on('guildMemberAdd', async (member) => {
    const channel = member.guild.systemChannel;
    if (!channel) return;
    const api = createDiscordChannelApi(
      channel as import('discord.js').TextChannel,
      member.guild,
      null,
      client,
    );
    const event = normalizeGuildMemberAddEvent(member);
    const native = { platform: Platforms.Discord, userId, sessionId, member };
    emitter.emit('event', { api, event, native, prefix });
  });

  client.on('guildMemberRemove', async (member) => {
    const channel = member.guild.systemChannel;
    if (!channel) return;
    const api = createDiscordChannelApi(
      channel as import('discord.js').TextChannel,
      member.guild,
      null,
      client,
    );
    const event = normalizeGuildMemberRemoveEvent(member);
    const native = { platform: Platforms.Discord, userId, sessionId, member };
    emitter.emit('event', { api, event, native, prefix });
  });

  // ── Message reaction → emit 'message_reaction' ──────────────────────────────
  client.on('messageReactionAdd', async (reaction, user) => {
    try {
      if (reaction.partial) await reaction.fetch();
      if (reaction.message.partial) await reaction.message.fetch();
    } catch {
      return;
    }
    if (user.bot) return;

    const api = createDiscordChannelApi(
      reaction.message.channel as import('discord.js').TextChannel,
      reaction.message.guild ?? null,
      null,
      client,
    );
    const event = normalizeMessageReactionAddEvent(
      reaction as import('discord.js').MessageReaction,
      user as import('discord.js').User,
    );
    const native = { platform: Platforms.Discord, userId, sessionId, reaction, user };
    emitter.emit('message_reaction', { api, event, native, prefix });
  });

  // ── Message delete → emit 'message_unsend' ──────────────────────────────────
  client.on('messageDelete', async (message) => {
    if (message.author?.bot) return;
    const api = createDiscordChannelApi(
      message.channel as import('discord.js').TextChannel,
      message.guild ?? null,
      null,
      client,
    );
    const event = normalizeMessageDeleteEvent(message);
    const native = { platform: Platforms.Discord, userId, sessionId, message };
    emitter.emit('message_unsend', { api, event, native, prefix });
  });

  // ── New guild → clear guild-scoped commands to prevent duplicate menus ─────
  // Global commands are already present in new guilds immediately via the global PUT;
  // guild-scoped commands here would create visible duplicates in the '/' menu.
  client.on('guildCreate', async (guild) => {
    if (!clientId) return;
    await clearGuildCommands(guild.id, clientId, token, sessionLogger);
  });

  sessionLogger.info('[discord] Listener active');
}
