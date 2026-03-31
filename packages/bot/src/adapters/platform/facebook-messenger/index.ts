/**
 * Facebook Messenger Platform Entry Point (fca-unofficial) — Multi-Session Edition
 *
 * Thin orchestration layer — delegates to focused sub-modules:
 *   - types.ts        → shared type definitions (FcaApi, emitter shape)
 *   - logger.ts       → platform-prefixed logging
 *   - login.ts        → authentication and appstate management
 *   - event-router.ts → fca event type → unified emitter event mapping
 *   - wrapper.ts      → UnifiedApi implementation (delegates to lib/)
 *
 * Each call to createFacebookMessengerListener() creates an independent MQTT
 * connection for one Facebook account. Multiple sessions run in parallel without
 * sharing state; each has its own appstate.json derived from config.sessionPath.
 *
 * Architecture: platform listener emits typed events; app.ts owns routing, platform owns transport.
 *
 * Emitted events (all payloads: { api: UnifiedApi, event: UnifiedEvent, native }):
 *   'message'          — standard text/attachment messages
 *   'message_reply'    — reply to a specific earlier message (fca type: 'message_reply')
 *   'message_reaction' — emoji reaction added to a message
 *   'message_unsend'   — a sent message retracted by its sender
 *   'event'            — thread admin events (join, leave, rename, theme, etc.)
 *
 * Unlike the Page webhook, fca-unofficial delivers events over a persistent MQTT
 * connection which DOES surface message_reaction and message_unsend.
 */

import { EventEmitter } from 'events';

import type { FacebookMessengerEmitter } from './types.js';
export type { StartBotConfig, StartBotResult } from './types.js';

import { logger } from '@/lib/logger.lib.js';
import { startBot } from './login.js';
import { routeRawEvent } from './event-router.js';

// Re-export startBot so integration tests can construct FacebookApi
// directly without going through the platform listener.
export { startBot };

/** Canonical Facebook Messenger platform identifier — imported by adapters/platform/index.ts to build the PlatformId union. */
export const PLATFORM_ID = 'facebook-messenger' as const;

// ── Listener config ────────────────────────────────────────────────────────────

/**
 * Per-session configuration for createFacebookMessengerListener().
 * Each session directory must contain an appstate.json with valid fca-unofficial cookies.
 */
export interface FbMessengerListenerConfig {
  /** Absolute path to the session directory (e.g. packages/bot/session/facebook-messenger/2). */
  sessionPath: string;
  prefix: string;
  userId: string;
  sessionId: string;
}

// ── Platform Listener ──────────────────────────────────────────────────────────

/**
 * Creates a Facebook Messenger platform listener for one account session.
 * Call .start() to log in via fca-unofficial and begin emitting events.
 *
 * Signal handlers (SIGINT, SIGTERM, uncaughtException) are registered inside
 * start() rather than at module scope so importing this module for types alone
 * never installs process-level side effects.
 */
export function createFacebookMessengerListener(
  config: FbMessengerListenerConfig,
): FacebookMessengerEmitter {
  const emitter = new EventEmitter() as FacebookMessengerEmitter;

  let listenerInstances: { stopListeningAsync: () => Promise<void> } | null =
    null;

  emitter.start = async (): Promise<void> => {
    // Dynamic import: wrapper.js pulls in all lib/* files which may fail at
    // evaluation time — deferring keeps module load safe and isolates failures to start().
    const { createFacebookApi } = await import('./wrapper.js');

    // Pass sessionPath so login.ts reads/writes appstate.json in the correct directory,

    const { api } = await startBot({ sessionPath: config.sessionPath });

    // start() is the sole owner of the MQTT listener — startBot() deliberately does NOT
    // call listenMqtt so there is exactly one listener on the connection at all times.
    listenerInstances = api.listenMqtt((err, rawEvent) => {
      if (err) {
        logger.error('MQTT error', { error: err });
        return;
      }

      const apiWrapper = createFacebookApi(api);
      const native = {
        userId: config.userId,
        sessionId: config.sessionId,
        platform: PLATFORM_ID,
        api,
        event: rawEvent,
      };

      routeRawEvent(rawEvent, apiWrapper, native, emitter, config.prefix);
    });

    logger.info('Listener active');
  };

  emitter.stop = async (): Promise<void> => {
    if (listenerInstances) await listenerInstances.stopListeningAsync();
  };

  return emitter;
}
