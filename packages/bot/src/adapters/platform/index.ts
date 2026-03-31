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
import {
  createDiscordListener,
  PLATFORM_ID as DISCORD_PLATFORM_ID,
} from './discord/index.js';
import {
  createTelegramListener,
  PLATFORM_ID as TELEGRAM_PLATFORM_ID,
} from './telegram/index.js';
import {
  createFacebookMessengerListener,
  PLATFORM_ID as FB_MESSENGER_PLATFORM_ID,
} from './facebook-messenger/index.js';
import {
  createFacebookPageListener,
  PLATFORM_ID as FB_PAGE_PLATFORM_ID,
} from './facebook-page/index.js';
import { logger } from '@/lib/logger.lib.js';
import { sessionManager } from '@/lib/session-manager.lib.js';

/**
 * Every registered platform ID in one place — derived from each platform's own index.ts constant.
 * Adding a new transport requires only: (1) export PLATFORM_ID from its index.ts and
 * (2) add it to this array. adapters/models/ never needs to change.
 */
export const PLATFORM_IDS = [
  DISCORD_PLATFORM_ID,
  TELEGRAM_PLATFORM_ID,
  FB_MESSENGER_PLATFORM_ID,
  FB_PAGE_PLATFORM_ID,
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
      sessionManager.register(
        `${c.userId}:${DISCORD_PLATFORM_ID}:${c.sessionId}`,
        {
          start: async () => await l.start(commands),
          stop: async () => await l.stop(),
        },
      );
      void Promise.resolve(l.start(commands)).catch((err: Error) => {
        logger.error('[discord] Session failed to start', { error: err });
      });
    });

    config.telegram.forEach((c, i) => {
      const l = telegramListeners[i]!;
      sessionManager.register(
        `${c.userId}:${TELEGRAM_PLATFORM_ID}:${c.sessionId}`,
        {
          start: async () => await l.start(commands),
          stop: async () => await l.stop(),
        },
      );
      void Promise.resolve(l.start(commands)).catch((err: Error) => {
        logger.error('[telegram] Session failed to start', { error: err });
      });
    });

    // Facebook Messenger MQTT login — no commands/prefix needed at transport level
    config.fbMessenger.forEach((c, i) => {
      const l = fbMessengerListeners[i]!;
      sessionManager.register(
        `${c.userId}:${FB_MESSENGER_PLATFORM_ID}:${c.sessionId}`,
        {
          start: async () => await l.start(),
          stop: async () => await l.stop(),
        },
      );
      // Wrap in Promise.resolve to safely catch rejections even if the interface strictly types start() as void
      void Promise.resolve(l.start()).catch((err: Error) => {
        logger.error('[facebook-messenger] Session failed to start', {
          error: err,
        });
      });
    });

    // Facebook Page webhook server — Express startup; no commands/prefix at transport level
    config.fbPage.forEach((c, i) => {
      const l = fbPageListeners[i]!;
      sessionManager.register(
        `${c.userId}:${FB_PAGE_PLATFORM_ID}:${c.sessionId}`,
        {
          start: async () => await l.start(),
          stop: async () => await l.stop(),
        },
      );
      // Wrap in Promise.resolve to safely catch rejections even if the interface strictly types start() as void
      void Promise.resolve(l.start()).catch((err: Error) => {
        logger.error('[facebook-page] Session failed to start', { error: err });
      });
    });
  };

  return emitter;
}
