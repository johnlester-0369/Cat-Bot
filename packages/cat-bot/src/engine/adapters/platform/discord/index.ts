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
 * Retry architecture:
 *   emitter.start() owns an exponential-backoff retry loop (up to 10 attempts,
 *   3 s → 120 s). Two guards prevent zombie concurrency:
 *     isLocked   — another start/stop transition is actively running
 *     isRetrying — a back-off sleep is already in progress for this session
 *   Clicking Start during retry aborts the loop (via AbortController) and boots
 *   fresh. Stop and Restart are enforced at the service layer during retry.
 *   markActive fires only on a fully successful boot; markInactive fires on every
 *   failed attempt so the dashboard never shows a half-started session as online.
 *
 * EXTERNAL CONTRACT (unchanged):
 *   - createDiscordListener(config) returns EventEmitter with .start(commands) and .stop()
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
import { botRepo } from '@/server/repos/bot.repo.js';
// Retry primitives — this listener owns its own startup retry loop.
import { withRetry, isAuthError } from '@/engine/lib/retry.lib.js';

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

  // Retained across start() calls so the slash-sync callback always references the current commands Map
  let activeCommands: Map<string, Record<string, unknown>> | null = null;

  /**
   * Boots the Discord transport with an internal exponential-backoff retry loop.
   *
   * Spam protection:
   *   isLocked   — another transition is actively running (concurrent op guard)
   *   isRetrying — the back-off loop is sleeping between attempts (idle retry guard)
   * Both checks happen synchronously before any await so there is no race window.
   *
   * The retry slot (markRetrying) is claimed synchronously immediately after the
   * guards so a rapid second call sees isRetrying = true and returns without spawning
   * a second parallel loop.
   */
  emitter.start = async (
    commands: Map<string, Record<string, unknown>>,
  ): Promise<void> => {
    const smKey = `${config.userId}:${Platforms.Discord}:${config.sessionId}`;
    if (sessionManager.isLocked(smKey)) return;
    if (sessionManager.isRetrying(smKey)) return;

    // Claim the retry slot synchronously before any await — prevents a rapid second
    // call from passing the isRetrying guard and spawning a parallel loop.
    const controller = new AbortController();
    const retryToken = sessionManager.markRetrying(smKey, () => controller.abort());

    // Signal the dashboard offline immediately; markActive fires on successful boot only.
    void sessionManager.markInactive(smKey);

    let isFirstAttempt = true;

    try {
      await withRetry(
        async () => {
          // Exit immediately if startBot() aborted this loop to spawn a fresh session.
          if (controller.signal.aborted) throw new Error('Retry aborted');

          // Tear down any partial state from the previous failed attempt before retrying.
          // All stop implementations guard against uninitialized state internally.
          if (!isFirstAttempt) {
            try {
              unregisterSlashSync(smKey);
              activeCommands = null;
              if (activeClient) {
                activeClient.destroy();
                activeClient = null;
              }
            } catch {
              // Non-fatal — a failed cleanup must not block the next start attempt
            }
          }
          isFirstAttempt = false;

          sessionManager.markLocked(smKey);
          try {
            activeCommands = commands;

            // WHY: Fetching inside the retry loop means every attempt (including
            // credential-update triggered auto-restarts) uses the latest DB values
            // without requiring a process restart.
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

            // Phase 1: Create and boot the Discord.js client (intents, login, signal handlers)
            activeClient = await createDiscordClient(token, sessionLogger, (_err) => {
              // Marks UI explicit offline if Discord gateway refuses token post-boot
              void sessionManager.markInactive(smKey);
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

            // Register the slash sync callback AFTER all three phases succeed.
            // The closure captures activeClient and activeCommands by variable reference so
            // subsequent restarts bind to the new Client instance without re-registering.
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
              // WHY: Explicitly cast as Set<string> because database exports fall back to `any`
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

            // markActive only after all three phases succeed so the dashboard never
            // shows an online status for a partially-initialised session.
            await sessionManager.markActive(smKey);
          } finally {
            sessionManager.markUnlocked(smKey);
          }
        },
        {
          signal: controller.signal,
          maxAttempts: 10,
          initialDelayMs: 3_000,
          backoffFactor: 2,
          maxDelayMs: 120_000,
          onRetry: (attempt, err) => {
            sessionLogger.warn(
              `[discord] Start attempt ${attempt}/10 failed — retrying with backoff`,
              { error: err },
            );
            // Keep the dashboard in sync: session remains offline during back-off sleep.
            void sessionManager.markInactive(smKey);
          },
          // Auth errors (TokenInvalid, HTTP 401) are permanent — stop retrying immediately.
          shouldRetry: (err) => !isAuthError(err),
        },
      ).catch((err: unknown) => {
        // Aborted by startBot() which cancelled this loop to spawn a fresh session — skip log.
        if (controller.signal.aborted) return;
        sessionLogger.error(
          `[discord] Permanent startup failure after 10 attempts — session offline`,
          { error: err },
        );
        void sessionManager.markInactive(smKey);
      });
    } finally {
      // Token-gated clear: only removes this invocation's entry so a concurrent
      // startBot() call's newer registration is never accidentally evicted.
      sessionManager.markNotRetrying(smKey, retryToken);
    }
  };

  emitter.stop = async (_signal?: string): Promise<void> => {
    const smKey = `${config.userId}:${Platforms.Discord}:${config.sessionId}`;
    if (sessionManager.isLocked(smKey)) return;

    sessionManager.markLocked(smKey);
    try {
      sessionLogger.info('[discord] Stopping Listener...');
      // Clean up before destroying the client so stale callbacks don't fire on a dead session
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