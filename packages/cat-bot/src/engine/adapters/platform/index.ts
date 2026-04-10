/**
 * Unified Platform Aggregator — Multi-Session Edition
 *
 * createUnifiedPlatformListener() accepts arrays of session configs per platform
 * and creates one listener per session. All sessions from all platforms forward
 * their events to the single returned EventEmitter — app.ts sees one uniform
 * event surface regardless of how many accounts are running per transport.
 *
 * Adding a new account for any platform: add a new numbered session directory and
 * re-start the bot. No code changes required here or in app.ts.
 *
 * Forwarded event types (all payloads: { api: UnifiedApi, event: UnifiedEvent, native }):
 *   'message'          — Discord, Telegram, Facebook Messenger, Facebook Page
 *   'message_reply'    — Discord, Telegram, Facebook Messenger
 *   'event'            — Discord, Telegram, Facebook Messenger (join/leave/thread admin)
 *   'message_reaction' — Discord, Telegram, Facebook Messenger, Facebook Page
 *   'message_unsend'   — Discord, Facebook Messenger
 *   'button_action'    — Discord, Telegram, Facebook Page
 *
 * Transports that do not support a given type never emit it — no guards needed in app.ts.
 */

import { EventEmitter } from 'events';
import { createDiscordListener } from './discord/index.js';
import { createTelegramListener } from './telegram/index.js';
import { createFacebookMessengerListener } from './facebook-messenger/index.js';
import { createFacebookPageListener } from './facebook-page/index.js';
import { createLogger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module
import type { SessionLogger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module
import { sessionManager } from '@/engine/modules/session/session-manager.lib.js';
import { withRetry, isAuthError } from '@/engine/lib/retry.lib.js';
import { Platforms, PLATFORM_TO_ID } from '@/engine/constants/platform.constants.js';
import { upsertSessionCommands } from '@/engine/modules/session/bot-session-commands.repo.js';
import { upsertSessionEvents } from '@/engine/modules/session/bot-session-events.repo.js';
import { commandRegistry, eventRegistry } from '@/engine/lib/module-registry.lib.js';

/**
 * Every registered platform ID in one place — derived from each platform's own index.ts constant.
 * Adding a new transport requires only: (1) export PLATFORM_ID from its index.ts and
 * (2) add it to this array. adapters/models/ never needs to change.
 */
export const PLATFORM_IDS = [
  Platforms.Discord,
  Platforms.Telegram,
  Platforms.FacebookMessenger,
  Platforms.FacebookPage,
] as const;

/** Union of all registered platform IDs plus the 'unknown' sentinel for pre-identification contexts. */
export type PlatformId = (typeof PLATFORM_IDS)[number] | 'unknown';

// ── Per-session config shapes — one entry per session directory ───────────────

export interface DiscordConfig {
  token: string;
  clientId: string;
  prefix: string;
  userId: string;
  sessionId: string;
}

export interface TelegramConfig {
  botToken: string;
  prefix: string;
  userId: string;
  sessionId: string;
}

export interface FbPageConfig {
  pageAccessToken: string;
  pageId: string;
  userId: string;
  sessionId: string;
  prefix: string;
}

export interface FbMessengerConfig {
  /** JSON.stringify'd fca-unofficial session cookie blob from the database. */
  appstate: string;
  prefix: string;
  userId: string;
  sessionId: string;
}

/**
 * Per-platform arrays of session configs.
 * An empty array for any platform means that transport is simply not activated —
 * identical to the previous behaviour when a platform was not configured at all.
 */
interface PlatformConfig {
  discord: DiscordConfig[];
  telegram: TelegramConfig[];
  fbPage: FbPageConfig[];
  fbMessenger: FbMessengerConfig[];
}

type UnifiedPlatformEmitter = EventEmitter & {
  start: (commands: Map<string, Record<string, unknown>>) => Promise<void>;
};

/**
 * All event types forwarded verbatim from each individual transport to the
 * unified emitter. Transports that never emit a given type are transparent no-ops.
 */
const FORWARDED_EVENTS = [
  'message',
  'message_reply',
  'event',
  'message_reaction',
  'message_unsend',
  'button_action',
] as const;

/**
 * Starts a single platform session with automatic retry on failure.
 *
 * WHY: A plain .catch(log) leaves the session permanently dead after the
 * first startup error (bad token, temporary network blip at boot time).
 * Wrapping with withRetry means transient errors self-heal without operator intervention.
 *
 * isFirstAttempt guard: on the very first call there is nothing to clean up,
 * so we skip stop() to avoid calling unregisterPageSession (FB Page) or
 * destroy() (Discord) on an object that was never initialized.
 *
 * start/stop accept void | Promise<void> — FB Page's PlatformEmitter.start() is
 * typed as returning void (fire-and-forget webhook server bind), so we normalise
 * both callbacks with Promise.resolve() rather than requiring Promise<void> everywhere.
 */
async function startSessionWithRetry(
  label: string,
  smKey: string,
  start: () => void | Promise<void>,
  stop: (signal?: string) => void | Promise<void>,
  sessionLogger: SessionLogger,
): Promise<void> {
  let isFirstAttempt = true;

  await withRetry(
    async () => {
      // Clean up any partial state from a previous failed attempt before retrying.
      // All stop() implementations guard against being called on uninitialized instances.
      if (!isFirstAttempt) {
        try {
          await Promise.resolve(stop());
        } catch {
          // Non-fatal — a failed stop() should never block the next start() attempt
        }
      }
      isFirstAttempt = false;
      await Promise.resolve(start());
    },
    {
      maxAttempts: 10,
      initialDelayMs: 3_000,
      backoffFactor: 2,
      maxDelayMs: 120_000,
      onRetry: (attempt, err) => {
        sessionLogger.warn(
          `[${label}] Start attempt ${attempt}/10 failed — retrying with backoff`,
          { error: err },
        );
      },
      // Auth errors (TokenInvalid, HTTP 401, bad appstate) are permanent — stop retrying immediately.
      shouldRetry: (err) => !isAuthError(err),
    },
  ).catch((err: unknown) => {
    // All 10 attempts exhausted — log and leave this session offline.
    // Other sessions on other platforms continue running unaffected.
    sessionLogger.error(
      `[${label}] Permanent startup failure after 10 attempts — session offline`,
      { error: err },
    );
    // Ensure dashboard updates to reflect offline status regardless of auth error or exhausted retries
    sessionManager.markInactive(smKey);
  });
}

// Retain singletons so external services (like bot.service.ts) can dynamically
// attach new sessions directly to the running application state.
let globalEmitter: UnifiedPlatformEmitter | null = null;
let activeCommands: Map<string, Record<string, unknown>> | null = null;

/**
 * Creates a unified platform listener that aggregates all configured sessions
 * across all four transport types.
 */
export function createUnifiedPlatformListener(
  config: PlatformConfig,
): UnifiedPlatformEmitter {
  const emitter = new EventEmitter() as UnifiedPlatformEmitter;
  globalEmitter = emitter;

  // Create one listener per session for each platform — empty arrays produce no listeners.
  const discordListeners = config.discord.map((c) => createDiscordListener(c));
  const telegramListeners = config.telegram.map((c) =>
    createTelegramListener(c),
  );
  const fbMessengerListeners = config.fbMessenger.map((c) =>
    createFacebookMessengerListener(c),
  );
  const fbPageListeners = config.fbPage.map((c) =>
    createFacebookPageListener(c),
  );

  // Forward events from every session of every platform to the single unified emitter.
  // The payload shape is identical across all sessions — app.ts needs no per-session branching.
  for (const transport of [
    ...discordListeners,
    ...telegramListeners,
    ...fbMessengerListeners,
    ...fbPageListeners,
  ]) {
    for (const eventType of FORWARDED_EVENTS) {
      transport.on(eventType, (payload: unknown) =>
        emitter.emit(eventType, payload),
      );
    }
  }

  /**
   * Boots all session listeners in parallel.
   * Errors are caught per-session so one failing account never prevents
   * the rest of that platform or other platforms from starting.
   */
  emitter.start = async (
    commands: Map<string, Record<string, unknown>>,
  ): Promise<void> => {
    activeCommands = commands;

    config.discord.forEach((c, i) => {
      const l = discordListeners[i]!;
      const label = `${Platforms.Discord}:${c.userId}:${c.sessionId}`;
      const smKey = `${c.userId}:${Platforms.Discord}:${c.sessionId}`;
      const sessionLogger = createLogger({ userId: c.userId, platformId: PLATFORM_TO_ID[Platforms.Discord], sessionId: c.sessionId });
      // markActive only after start() resolves so status tracks real transport readiness
      const startFn = async () => { await l.start(commands); sessionManager.markActive(smKey); };
      const stopFn = async (signal?: string) => { sessionManager.markInactive(smKey); await l.stop(signal); };
      sessionManager.register(smKey, {
        start: () => startSessionWithRetry(label, smKey, startFn, stopFn, sessionLogger),
        stop: stopFn,
      });
      void startSessionWithRetry(label, smKey, startFn, stopFn, sessionLogger);
    });

    config.telegram.forEach((c, i) => {
      const l = telegramListeners[i]!;
      const label = `${Platforms.Telegram}:${c.userId}:${c.sessionId}`;
      const smKey = `${c.userId}:${Platforms.Telegram}:${c.sessionId}`;
      const sessionLogger = createLogger({ userId: c.userId, platformId: PLATFORM_TO_ID[Platforms.Telegram], sessionId: c.sessionId });
      const startFn = async () => { await l.start(commands); sessionManager.markActive(smKey); };
      const stopFn = async (signal?: string) => { sessionManager.markInactive(smKey); await l.stop(signal); };
      sessionManager.register(smKey, {
        start: () => startSessionWithRetry(label, smKey, startFn, stopFn, sessionLogger),
        stop: stopFn,
      });
      void startSessionWithRetry(label, smKey, startFn, stopFn, sessionLogger);
    });

    // Facebook Messenger MQTT login — no commands/prefix needed at transport level
    config.fbMessenger.forEach((c, i) => {
      const l = fbMessengerListeners[i]!;
      const label = `${Platforms.FacebookMessenger}:${c.userId}:${c.sessionId}`;
      const smKey = `${c.userId}:${Platforms.FacebookMessenger}:${c.sessionId}`;
      const sessionLogger = createLogger({ userId: c.userId, platformId: PLATFORM_TO_ID[Platforms.FacebookMessenger], sessionId: c.sessionId });
      const startFn = async () => { await l.start(); sessionManager.markActive(smKey); };
      const stopFn = async (signal?: string) => { sessionManager.markInactive(smKey); await l.stop(signal); };
      sessionManager.register(smKey, {
        start: () => startSessionWithRetry(label, smKey, startFn, stopFn, sessionLogger),
        stop: stopFn,
      });
      void startSessionWithRetry(label, smKey, startFn, stopFn, sessionLogger);
    });

    // Facebook Page webhook server — Express startup; no commands/prefix at transport level
    config.fbPage.forEach((c, i) => {
      const l = fbPageListeners[i]!;
      const label = `${Platforms.FacebookPage}:${c.userId}:${c.sessionId}`;
      const smKey = `${c.userId}:${Platforms.FacebookPage}:${c.sessionId}`;
      const sessionLogger = createLogger({ userId: c.userId, platformId: PLATFORM_TO_ID[Platforms.FacebookPage], sessionId: c.sessionId });
      const startFn = async () => { await Promise.resolve(l.start()); sessionManager.markActive(smKey); };
      const stopFn = async (signal?: string) => { sessionManager.markInactive(smKey); await l.stop(signal); };
      sessionManager.register(smKey, {
        start: () => startSessionWithRetry(label, smKey, startFn, stopFn, sessionLogger),
        stop: stopFn,
      });
      void startSessionWithRetry(label, smKey, startFn, stopFn, sessionLogger);
    });
  };

  return emitter;
}

/**
 * Dynamically spawns a new session onto the live platform orchestrator without
 * restarting the process. Used exclusively by the web dashboard integration.
 */
export async function spawnDynamicSession(
  platform: string,
  sessionConfig: DiscordConfig | TelegramConfig | FbPageConfig | FbMessengerConfig,
): Promise<void> {
  if (!globalEmitter || !activeCommands) {
    // Application orchestrator has not booted yet (e.g. testing context or pre-init API call).
    return;
  }

  // 1. Sync modules to the DB immediately so the web dashboard's "Commands" and "Events"
  //    tabs populate without requiring a complete process restart.
  const commandNames = Array.from(commandRegistry.keys());
  const eventNames = Array.from(eventRegistry.keys());

  await upsertSessionCommands(sessionConfig.userId, platform, sessionConfig.sessionId, commandNames);
  await upsertSessionEvents(sessionConfig.userId, platform, sessionConfig.sessionId, eventNames);

  // Generic EventEmitter for wiring up to the unified event pipeline
  // Exact listener types are captured locally in startFn/stopFn closures to satisfy strict function types
  let listener: EventEmitter;
  let label = '';
  let smKey = '';
  let startFn: () => Promise<void>;
  let stopFn: (signal?: string) => Promise<void>;
  let sessionLogger: SessionLogger;

  if (platform === Platforms.Discord) {
    const l = createDiscordListener(sessionConfig as DiscordConfig);
    listener = l;
    label = `${Platforms.Discord}:${sessionConfig.userId}:${sessionConfig.sessionId}`;
    smKey = `${sessionConfig.userId}:${Platforms.Discord}:${sessionConfig.sessionId}`;
    sessionLogger = createLogger({ userId: sessionConfig.userId, platformId: PLATFORM_TO_ID[Platforms.Discord], sessionId: sessionConfig.sessionId });
    startFn = async () => { await l.start(activeCommands!); sessionManager.markActive(smKey); };
    stopFn = async (signal?: string) => { sessionManager.markInactive(smKey); await l.stop(signal); };
  } else if (platform === Platforms.Telegram) {
    const l = createTelegramListener(sessionConfig as TelegramConfig);
    listener = l;
    label = `${Platforms.Telegram}:${sessionConfig.userId}:${sessionConfig.sessionId}`;
    smKey = `${sessionConfig.userId}:${Platforms.Telegram}:${sessionConfig.sessionId}`;
    sessionLogger = createLogger({ userId: sessionConfig.userId, platformId: PLATFORM_TO_ID[Platforms.Telegram], sessionId: sessionConfig.sessionId });
    startFn = async () => { await l.start(activeCommands!); sessionManager.markActive(smKey); };
    stopFn = async (signal?: string) => { sessionManager.markInactive(smKey); await l.stop(signal); };
  } else if (platform === Platforms.FacebookMessenger) {
    const l = createFacebookMessengerListener(sessionConfig as FbMessengerConfig);
    listener = l;
    label = `${Platforms.FacebookMessenger}:${sessionConfig.userId}:${sessionConfig.sessionId}`;
    smKey = `${sessionConfig.userId}:${Platforms.FacebookMessenger}:${sessionConfig.sessionId}`;
    sessionLogger = createLogger({ userId: sessionConfig.userId, platformId: PLATFORM_TO_ID[Platforms.FacebookMessenger], sessionId: sessionConfig.sessionId });
    startFn = async () => { await l.start(); sessionManager.markActive(smKey); };
    stopFn = async (signal?: string) => { sessionManager.markInactive(smKey); await l.stop(signal); };
  } else if (platform === Platforms.FacebookPage) {
    const l = createFacebookPageListener(sessionConfig as FbPageConfig);
    listener = l;
    label = `${Platforms.FacebookPage}:${sessionConfig.userId}:${sessionConfig.sessionId}`;
    smKey = `${sessionConfig.userId}:${Platforms.FacebookPage}:${sessionConfig.sessionId}`;
    sessionLogger = createLogger({ userId: sessionConfig.userId, platformId: PLATFORM_TO_ID[Platforms.FacebookPage], sessionId: sessionConfig.sessionId });
    startFn = async () => { await Promise.resolve(l.start()); sessionManager.markActive(smKey); };
    stopFn = async (signal?: string) => { sessionManager.markInactive(smKey); await l.stop(signal); };
  } else {
    throw new Error(`[spawnDynamicSession] Unsupported platform: ${platform}`);
  }

  // 2. Wire the dedicated listener into the unified global emitter pipeline
  for (const eventType of FORWARDED_EVENTS) {
    listener.on(eventType, (payload: unknown) =>
      globalEmitter!.emit(eventType, payload),
    );
  }

  // 3. Register lifecycle so API restarts (/restart) operate correctly
  sessionManager.register(smKey, {
    start: () => startSessionWithRetry(label, smKey, startFn, stopFn, sessionLogger),
    stop: stopFn,
  });

  // 4. Boot the session transport
  void startSessionWithRetry(label, smKey, startFn, stopFn, sessionLogger);
}
