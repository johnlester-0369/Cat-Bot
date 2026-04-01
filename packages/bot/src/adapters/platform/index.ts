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
import { logger } from '@/lib/logger.lib.js';
import { sessionManager } from '@/lib/session-manager.lib.js';
import { withRetry } from '@/lib/retry.lib.js';
import { Platforms } from '@/constants/platform.constants.js';

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

interface DiscordConfig {
  token: string;
  clientId: string;
  prefix: string;
  userId: string;
  sessionId: string;
}

interface TelegramConfig {
  botToken: string;
  prefix: string;
  userId: string;
  sessionId: string;
}

interface FbPageConfig {
  pageAccessToken: string;
  verifyToken: string;
  pageId: string;
  userId: string;
  sessionId: string;
  prefix: string;
}

interface FbMessengerConfig {
  /** Absolute path to the session directory (contains appstate.json). */
  sessionPath: string;
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
  start: () => void | Promise<void>,
  stop: () => void | Promise<void>,
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
        logger.warn(
          `[${label}] Start attempt ${attempt}/10 failed — retrying with backoff`,
          { error: err },
        );
      },
    },
  ).catch((err: unknown) => {
    // All 10 attempts exhausted — log and leave this session offline.
    // Other sessions on other platforms continue running unaffected.
    logger.error(
      `[${label}] Permanent startup failure after 10 attempts — session offline`,
      { error: err },
    );
  });
}

/**
 * Creates a unified platform listener that aggregates all configured sessions
 * across all four transport types.
 */
export function createUnifiedPlatformListener(
  config: PlatformConfig,
): UnifiedPlatformEmitter {
  const emitter = new EventEmitter() as UnifiedPlatformEmitter;

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
    config.discord.forEach((c, i) => {
      const l = discordListeners[i]!;
      const label = `${Platforms.Discord}:${c.userId}:${c.sessionId}`;
      sessionManager.register(
        `${c.userId}:${Platforms.Discord}:${c.sessionId}`,
        {
          start: () => startSessionWithRetry(label, () => l.start(commands), () => l.stop()),
          stop: async () => await l.stop(),
        },
      );
      void startSessionWithRetry(label, () => l.start(commands), () => l.stop());
    });

    config.telegram.forEach((c, i) => {
      const l = telegramListeners[i]!;
      const label = `${Platforms.Telegram}:${c.userId}:${c.sessionId}`;
      sessionManager.register(
        `${c.userId}:${Platforms.Telegram}:${c.sessionId}`,
        {
          start: () => startSessionWithRetry(label, () => l.start(commands), () => l.stop()),
          stop: async () => await l.stop(),
        },
      );
      void startSessionWithRetry(label, () => l.start(commands), () => l.stop());
    });

    // Facebook Messenger MQTT login — no commands/prefix needed at transport level
    config.fbMessenger.forEach((c, i) => {
      const l = fbMessengerListeners[i]!;
      const label = `${Platforms.FacebookMessenger}:${c.userId}:${c.sessionId}`;
      sessionManager.register(
        `${c.userId}:${Platforms.FacebookMessenger}:${c.sessionId}`,
        {
          start: () => startSessionWithRetry(label, () => l.start(), () => l.stop()),
          stop: async () => await l.stop(),
        },
      );
      void startSessionWithRetry(label, () => l.start(), () => l.stop());
    });

    // Facebook Page webhook server — Express startup; no commands/prefix at transport level
    config.fbPage.forEach((c, i) => {
      const l = fbPageListeners[i]!;
      const label = `${Platforms.FacebookPage}:${c.userId}:${c.sessionId}`;
      sessionManager.register(
        `${c.userId}:${Platforms.FacebookPage}:${c.sessionId}`,
        {
          start: () => startSessionWithRetry(label, () => l.start(), () => l.stop()),
          stop: async () => await l.stop(),
        },
      );
      void startSessionWithRetry(label, () => l.start(), () => l.stop());
    });
  };

  return emitter;
}
