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
import type { FcaApi } from './types.js';
export type { StartBotConfig, StartBotResult } from './types.js';

import { logger } from '@/lib/logger.lib.js';
import { startBot } from './login.js';
import { routeRawEvent } from './event-router.js';
import { withRetry } from '@/lib/retry.lib.js';

import { Platforms } from '@/constants/platform.constants.js';

// Re-export startBot so integration tests can construct FacebookApi
// directly without going through the platform listener.
export { startBot };

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

    // Extracted so it can be called again on MQTT reconnect without repeating the login flow.
    // reconnecting flag deduplicates burst errors — if MQTT emits multiple errors in rapid
    // succession before the first reconnect attempt lands, only one reconnect races at a time.
    let reconnecting = false;

    const listen = (fcaApi: FcaApi): void => {
      listenerInstances = fcaApi.listenMqtt((err, rawEvent) => {
        if (err) {
          logger.error('[facebook-messenger] MQTT error', { error: err });

          if (reconnecting) return;
          reconnecting = true;

          // Stop the dead listener before attempting to re-login and re-listen.
          // withRetry drives full re-login: a dropped MQTT connection may indicate
          // an expired session cookie that requires a fresh authentication cycle.
          void listenerInstances
            ?.stopListeningAsync()
            .catch(() => undefined)
            .then(async () => {
              await withRetry(
                async () => {
                  const { api: freshApi } = await startBot({
                    sessionPath: config.sessionPath,
                  });
                  // Replace the listener with a fresh MQTT connection after re-login
                  listen(freshApi);
                },
                {
                  maxAttempts: 10,
                  initialDelayMs: 5_000,
                  backoffFactor: 2,
                  maxDelayMs: 120_000,
                  onRetry: (attempt, retryErr) => {
                    logger.warn(
                      `[facebook-messenger] MQTT reconnect attempt ${attempt}/10`,
                      { error: retryErr },
                    );
                  },
                },
              ).catch((finalErr: unknown) => {
                logger.error(
                  '[facebook-messenger] MQTT reconnect exhausted — session offline',
                  { error: finalErr },
                );
              });
              reconnecting = false;
            });
          return;
        }

        const apiWrapper = createFacebookApi(fcaApi);
        const native = {
          userId: config.userId,
          sessionId: config.sessionId,
          platform: Platforms.FacebookMessenger,
          api: fcaApi,
          event: rawEvent,
        };

        // Guard routeRawEvent so a malformed payload never throws through fca-unofficial's
        // synchronous callback and silently kills the entire MQTT connection.
        try {
          routeRawEvent(rawEvent, apiWrapper, native, emitter, config.prefix);
        } catch (routeErr) {
          logger.error('[facebook-messenger] routeRawEvent failed (event dropped)', {
            error: routeErr,
          });
        }
      });
    };

    const { api } = await startBot({ sessionPath: config.sessionPath });
    // start() is the sole owner of the MQTT listener — startBot() deliberately does NOT
    // call listenMqtt so there is exactly one listener on the connection at all times.
    listen(api);

    logger.info('Listener active');
  };

  emitter.stop = async (): Promise<void> => {
    if (listenerInstances) await listenerInstances.stopListeningAsync();
  };

  return emitter;
}
