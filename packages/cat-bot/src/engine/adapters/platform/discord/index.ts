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

import { createLogger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module
import { createDiscordClient } from './client.js';
import { registerSlashCommands } from './slash-commands.js';
import { attachEventHandlers } from './event-handlers.js';
import { sessionManager } from '@/engine/modules/session/session-manager.lib.js';
import {
  PLATFORM_TO_ID,
  Platforms,
} from '@/engine/modules/platform/platform.constants.js';
// Slash sync: register a re-registration callback so the dashboard toggle can update the live '/' menu
import {
  registerSlashSync,
  unregisterSlashSync,
} from '@/engine/modules/prefix/slash-sync.lib.js';
// Read enabled/disabled state from DB when the dashboard triggers a sync
import { findSessionCommands } from '@/engine/modules/session/bot-session-commands.repo.js';
import { prefixManager } from '@/engine/modules/prefix/prefix-manager.lib.js';

interface DiscordConfig {
  token: string;
  clientId: string;
  prefix: string;
  userId: string;
  sessionId: string;
}

export function createDiscordListener(config: DiscordConfig): EventEmitter & {
  start: (commands: Map<string, Record<string, unknown>>) => Promise<void>;
  stop: (signal?: string) => Promise<void>;
} {
  const emitter = new EventEmitter() as EventEmitter & {
    start: (commands: Map<string, Record<string, unknown>>) => Promise<void>;
    stop: (signal?: string) => Promise<void>;
  };

  const sessionLogger = createLogger({
    userId: config.userId,
    platformId: PLATFORM_TO_ID[Platforms.Discord],
    sessionId: config.sessionId,
  });

  let activeClient: import('discord.js').Client | null = null;

  // Retained across start() calls so the slash-sync callback can always reference the current commands Map
  let activeCommands: Map<string, Record<string, unknown>> | null = null;

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
    // Store for the slash-sync closure — captured by reference so restarts automatically see new maps
    activeCommands = commands;

    const { token, clientId, prefix, userId, sessionId } = config;

    sessionLogger.info('[discord] Starting Listener...');

    // Phase 1: Create and boot the Discord.js client (intents, login, signal handlers)
    // Prefix unused param with _ to satisfy ESLint
    activeClient = await createDiscordClient(token, sessionLogger, (_err) => {
      // Marks UI explicit offline if Discord gateway refuses token post-boot
      sessionManager.markInactive(
        `${userId}:${Platforms.Discord}:${sessionId}`,
      );
    });

    // Phase 2: Register or clear slash commands based on active prefix
    await registerSlashCommands({
      client: activeClient,
      commands,
      prefix,
      clientId,
      token,
      userId,
      sessionId,
      sessionLogger,
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
      sessionLogger,
    });

    // Register the slash sync callback AFTER all three phases succeed.
    // The closure captures activeClient and activeCommands by variable reference so subsequent
    // restarts (stop → start) automatically bind to the new Client instance without re-registering.
    const smKey = `${userId}:${Platforms.Discord}:${sessionId}`;
    registerSlashSync(smKey, async () => {
      if (!activeClient || !activeCommands) return;
      const livePrefix = prefixManager.getPrefix(
        userId,
        Platforms.Discord,
        sessionId,
      );
      // Fetch current enabled/disabled state from DB to filter the slash menu accurately
      const rows = await findSessionCommands(
        userId,
        Platforms.Discord,
        sessionId,
      );
      // WHY: Explicitly cast as Set<string> because database exports fall back to `any`, causing Set<unknown> inference
      const disabledNames = new Set<string>(
        rows
          .filter(
            (r: { isEnable: boolean; commandName: string }) => !r.isEnable,
          )
          .map((r: { commandName: string }) => r.commandName),
      );
      await registerSlashCommands({
        client: activeClient,
        commands: activeCommands,
        prefix: livePrefix,
        clientId,
        token,
        userId,
        sessionId,
        sessionLogger,
        disabledNames,
        forceRegister: true,
      });
    });
  };

  emitter.stop = async (_signal?: string): Promise<void> => {
    sessionLogger.info('[discord] Stopping Listener...');
    // Clean up before destroying the client so stale callbacks don't fire on a dead session
    unregisterSlashSync(
      `${config.userId}:${Platforms.Discord}:${config.sessionId}`,
    );
    activeCommands = null;
    if (activeClient) {
      activeClient.destroy();
      activeClient = null;
      sessionLogger.info('[discord] Session stopped.');
    }
  };

  return emitter;
}
