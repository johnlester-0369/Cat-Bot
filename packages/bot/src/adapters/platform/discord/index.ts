/**
 * Discord Platform Listener — Orchestrator
 *
 * Thin composition layer that wires the modular Discord platform components:
 *   - client.ts          → Discord.js Client creation and lifecycle
 *   - slash-commands.ts  → Application command registration via REST
 *   - event-handlers.ts  → Discord.js event listener attachment
 *
 * WHY: Previously a 360-line monolith mixing client bootstrapping, slash command
 * registration, event handler wiring, and normalizer imports into a single start()
 * function. Each concern now lives in its own module — this file only composes them
 * in the correct order: boot client → register commands → attach handlers.
 *
 * EXTERNAL CONTRACT (unchanged):
 *   - createDiscordListener(config) returns EventEmitter with .start(commands, prefix)
 *   - PLATFORM_ID exported for adapters/platform/index.ts union building
 *   - Emitted events: message, message_reply, event, message_reaction, message_unsend, button_action
 */

import { EventEmitter } from 'events';

import { logger } from '@/lib/logger.lib.js';
import { createDiscordClient } from './client.js';
import { registerSlashCommands } from './slash-commands.js';
import { attachEventHandlers } from './event-handlers.js';

interface DiscordConfig {
  token: string;
  clientId: string;
  prefix: string;
  userId: string;
  sessionId: string;
}

export function createDiscordListener(config: DiscordConfig): EventEmitter & {
  start: (commands: Map<string, Record<string, unknown>>) => Promise<void>;
  stop: () => Promise<void>;
} {
  const emitter = new EventEmitter() as EventEmitter & {
    start: (commands: Map<string, Record<string, unknown>>) => Promise<void>;
    stop: () => Promise<void>;
  };

  let activeClient: import('discord.js').Client | null = null;

  /**
   * Boots the Discord transport in three sequential phases:
   *   1. Client creation + login (client.ts)
   *   2. Slash command registration/clearing (slash-commands.ts)
   *   3. Event handler attachment (event-handlers.ts)
   *
   * Handlers must be registered on the emitter via .on() BEFORE calling start()
   * — this is the existing contract that app.ts depends on.
   */
  emitter.start = async (
    commands: Map<string, Record<string, unknown>>,
  ): Promise<void> => {
    const { token, clientId, prefix, userId, sessionId } = config;

    logger.info('[discord] Starting...');

    // Phase 1: Create and boot the Discord.js client (intents, login, signal handlers)
    activeClient = await createDiscordClient(token);

    // Phase 2: Register or clear slash commands based on active prefix
    await registerSlashCommands({
      client: activeClient,
      commands,
      prefix,
      clientId,
      token,
    });

    // Phase 3: Attach all Discord.js event listeners — each emits normalised events on the emitter
    await attachEventHandlers({
      client: activeClient,
      emitter,
      commands,
      prefix,
      clientId,
      token,
      userId,
      sessionId,
    });
  };

  emitter.stop = async (): Promise<void> => {
    if (activeClient) {
      activeClient.destroy();
      activeClient = null;
      logger.info('[discord] Session stopped.');
    }
  };

  return emitter;
}
