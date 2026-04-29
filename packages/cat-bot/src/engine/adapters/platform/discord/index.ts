/**
 * Discord Platform Listener — Orchestrator
 *
 * Thin composition layer that wires the modular Discord platform components:
 *   - client.ts          → Discord.js Client creation and lifecycle
 *   - slash-commands.ts  → Application command registration via REST
 *   - event-handlers.ts  → Discord.js event listener attachment
 *
 * WHY: Previously a 360-line monolith mixing client bootstrapping, slash command
 * registration, event handler wiring, and a copy-pasted 40-line retry boilerplate.
 * The retry orchestration now lives in platform-runner.lib.ts — a single declaration
 * shared by all four platform listeners. This file provides only boot() and cleanup()
 * hooks to the runner.
 *
 * Retry architecture:
 *   emitter.start() delegates to runManagedSession() which owns exponential-backoff
 *   (10 attempts, 3 s → 120 s), isLocked / isRetrying zombie guards, AbortController
 *   cancellation, and markActive / markInactive dashboard sync.
 *
 * EXTERNAL CONTRACT (unchanged):
 *   - createDiscordListener(config) returns EventEmitter with .start(commands) and .stop()
 *   - Emitted events: message, message_reply, event, message_reaction, message_unsend, button_action
 */

import { EventEmitter } from 'events';

import { createLogger } from '@/engine/modules/logger/logger.lib.js';
import { createDiscordClient } from './client.js';
import { registerSlashCommands } from './slash-commands.js';
import { attachEventHandlers } from './event-handlers.js';
import { sessionManager } from '@/engine/modules/session/session-manager.lib.js';
import {
  PLATFORM_TO_ID,
  Platforms,
} from '@/engine/modules/platform/platform.constants.js';
import {
  registerSlashSync,
  unregisterSlashSync,
} from '@/engine/modules/prefix/slash-sync.lib.js';
import { findSessionCommands } from '@/engine/modules/session/bot-session-commands.repo.js';
import { prefixManager } from '@/engine/modules/prefix/prefix-manager.lib.js';
import { botRepo } from '@/server/repos/bot.repo.js';
// Centralized retry runner — replaces the inline withRetry + AbortController boilerplate
// that was previously copy-pasted across all four platform listeners.
import { runManagedSession } from '@/engine/lib/platform-runner.lib.js';

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

  // Hoisted to factory scope — eliminates duplicate string construction in start() and stop().
  const smKey = `${config.userId}:${Platforms.Discord}:${config.sessionId}`;

  let activeClient: import('discord.js').Client | null = null;

  // Retained across start() calls so the slash-sync callback always references the current Map.
  let activeCommands: Map<string, Record<string, unknown>> | null = null;

  emitter.start = async (
    commands: Map<string, Record<string, unknown>>,
  ): Promise<void> => {
    /**
     * Tears down partial state between retry attempts.
     * Called by runManagedSession before each non-first attempt — never directly.
     */
    const cleanup = async (): Promise<void> => {
      unregisterSlashSync(smKey);
      activeCommands = null;
      if (activeClient) {
        activeClient.destroy();
        activeClient = null;
      }
    };

    /**
     * Platform-specific boot routine. Called once per retry attempt under markLocked.
     * markActive is NOT called here — runManagedSession calls it after boot() resolves.
     */
    const boot = async (): Promise<void> => {
      // Restore from the start() parameter on every attempt — cleanup() sets it to null
      // between retries, so re-assignment here guarantees boot always sees the current Map.
      activeCommands = commands;

      // WHY: Fetching inside boot guarantees every attempt (including credential-update
      // auto-restarts triggered via the dashboard) uses the latest DB values without
      // requiring a process restart.
      const botDetail = await botRepo.getById(config.userId, config.sessionId);
      const token = botDetail
        ? ((botDetail.credentials as any).discordToken ?? config.token)
        : config.token;
      const clientId = botDetail
        ? ((botDetail.credentials as any).discordClientId ?? config.clientId)
        : config.clientId;
      const prefix = botDetail
        ? (botDetail.prefix ?? config.prefix)
        : config.prefix;
      const { userId, sessionId } = config;

      sessionLogger.info('[discord] Starting Listener...');

      // Phase 1: Create and boot the Discord.js client (intents, login, ready event)
      activeClient = await createDiscordClient(
        token,
        sessionLogger,
        (_err) => {
          // Marks the session offline in the dashboard when Discord gateway rejects
          // the token post-boot (e.g. token rotated while the session was running).
          void sessionManager.markInactive(smKey);
        },
      );

      // Phase 2: Register or clear slash commands based on the active prefix
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

      // Phase 3: Attach all Discord.js event listeners — each emits normalised events
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

      // Register the slash-sync callback AFTER all three phases succeed.
      // The closure captures activeClient and activeCommands by variable reference so
      // subsequent dashboard restarts bind to the new Client instance without re-registering.
      registerSlashSync(smKey, async () => {
        if (!activeClient || !activeCommands) return;
        const livePrefix = prefixManager.getPrefix(
          userId,
          Platforms.Discord,
          sessionId,
        );
        const rows = await findSessionCommands(
          userId,
          Platforms.Discord,
          sessionId,
        );
        // Explicitly typed — database exports can fall back to `any`
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

      sessionLogger.info('[discord] Listener active');
    };

    await runManagedSession({
      smKey,
      sessionLogger,
      label: '[discord]',
      boot,
      cleanup,
    });
  };

  emitter.stop = async (_signal?: string): Promise<void> => {
    if (sessionManager.isLocked(smKey)) return;

    sessionManager.markLocked(smKey);
    try {
      sessionLogger.info('[discord] Stopping Listener...');
      unregisterSlashSync(smKey);
      activeCommands = null;
      if (activeClient) {
        activeClient.destroy();
        activeClient = null;
        sessionLogger.info('[discord] Session stopped.');
      }
    } finally {
      sessionManager.markUnlocked(smKey);
    }
  };

  return emitter;
}