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
 * Retry architecture (two independent loops):
 *   1. Startup retry (outer loop in emitter.start):
 *        Exponential backoff, up to 10 attempts, 3 s → 120 s.
 *        Handles initial login failures (bad appstate, network down at boot).
 *        Controlled by AbortController — startBot() aborts + spawns fresh session.
 *        Guards: isLocked (concurrent op) + isRetrying (idle back-off).
 *        Cleanup between attempts: stopListeningAsync() on the previous MQTT listener.
 *
 *   2. MQTT reconnect (inner loop inside listen()):
 *        Handles runtime connection drops AFTER a successful login.
 *        Independent of the outer retry — runs only while the session is "active".
 *        Not abortable from outside (self-contained inside the listener callback).
 *
 * Smart restart (isInvalidSession):
 *   Avoids unnecessary re-login when the appstate cookie is still valid.
 *   Full re-login is triggered when: auth error flagged, appstate rotated via dashboard,
 *   or no FcaApi exists yet (first boot). All other restarts reattach the MQTT listener.
 *
 * Emitted events (all payloads: { api: UnifiedApi, event: UnifiedEvent, native }):
 *   'message', 'message_reply', 'message_reaction', 'message_unsend', 'event'
 */

import { EventEmitter } from 'events';

import type { FacebookMessengerEmitter } from './types.js';
import type { FcaApi } from './types.js';
export type { StartBotConfig, StartBotResult } from './types.js';

import { createLogger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module
import { startBot } from './login.js';
import { routeRawEvent } from './event-router.js';
import { withRetry, isAuthError } from '@/engine/lib/retry.lib.js';
import { sessionManager } from '@/engine/modules/session/session-manager.lib.js';

import {
  PLATFORM_TO_ID,
  Platforms,
} from '@/engine/modules/platform/platform.constants.js';
import { botRepo } from '@/server/repos/bot.repo.js';

// Re-export startBot so integration tests can construct FacebookApi directly.
export { startBot };

// ── Listener config ────────────────────────────────────────────────────────────

export interface FbMessengerListenerConfig {
  /** JSON.stringify'd fca-unofficial session cookie blob from the database. */
  appstate: string;
  prefix: string;
  userId: string;
  sessionId: string;
}

// ── Module-level session state registry ───────────────────────────────────────

/**
 * Persists fca-unofficial session state across listener closure recreations.
 *
 * WHY: The slow-path restart (spawnDynamicSession → new closure) produces a brand-new
 * closure where activeFcaApi would always be null, forcing an unnecessary startBot()
 * re-login on every dashboard restart — burning 2 round-trips and risking Meta account
 * suspension even when the session cookie is perfectly valid.
 */
interface FbMessengerSessionState {
  activeFcaApi: FcaApi | null;
  activeAppstate: string | null;
  isInvalidSession: boolean;
}

const sessionStateRegistry = new Map<string, FbMessengerSessionState>();

// ── Platform Listener ──────────────────────────────────────────────────────────

/**
 * Creates a Facebook Messenger platform listener for one account session.
 * Call .start() to log in via fca-unofficial and begin emitting events.
 */
export function createFacebookMessengerListener(
  config: FbMessengerListenerConfig,
): FacebookMessengerEmitter {
  const emitter = new EventEmitter() as FacebookMessengerEmitter;

  let listenerInstances: { stopListeningAsync: () => Promise<void> } | null =
    null;

  const sessionLogger = createLogger({
    userId: config.userId,
    platformId: PLATFORM_TO_ID[Platforms.FacebookMessenger],
    sessionId: config.sessionId,
  });

  // Registry key — stable identity for this session regardless of closure recreation
  const stateKey = `${config.userId}:${config.sessionId}`;

  // Reuse existing session state when the closure is recreated (slow-path restart).
  const existingState = sessionStateRegistry.get(stateKey);
  let activeFcaApi: FcaApi | null = existingState?.activeFcaApi ?? null;
  let activeAppstate: string | null = existingState?.activeAppstate ?? null;
  let isInvalidSession: boolean = existingState?.isInvalidSession ?? false;

  /** Writes current closure state back to the registry so future closures inherit it. */
  function persistState(): void {
    sessionStateRegistry.set(stateKey, {
      activeFcaApi,
      activeAppstate,
      isInvalidSession,
    });
  }

  /**
   * Boots the FB Messenger transport with an internal exponential-backoff retry loop.
   *
   * Outer retry (this function): handles startup / login failures.
   * Inner retry (inside listen()): handles runtime MQTT reconnects — unchanged.
   *
   * Spam protection:
   *   isLocked   — another transition is actively running
   *   isRetrying — back-off sleep in progress
   * Both checks are synchronous before any await.
   */
  emitter.start = async (): Promise<void> => {
    const smKey = `${config.userId}:${Platforms.FacebookMessenger}:${config.sessionId}`;
    if (sessionManager.isLocked(smKey)) return;
    if (sessionManager.isRetrying(smKey)) return;

    // Claim retry slot synchronously so a rapid second call sees isRetrying = true.
    const controller = new AbortController();
    const retryToken = sessionManager.markRetrying(smKey, () => controller.abort());

    // Signal the dashboard offline immediately; markActive fires on successful boot only.
    void sessionManager.markInactive(smKey);

    let isFirstAttempt = true;

    try {
      await withRetry(
        async () => {
          if (controller.signal.aborted) throw new Error('Retry aborted');

          // Stop the previous MQTT listener before retrying the login flow.
          // Only runs when a previous attempt got far enough to call listen().
          if (!isFirstAttempt) {
            try {
              if (listenerInstances) {
                await listenerInstances.stopListeningAsync();
                listenerInstances = null;
              }
            } catch {
              // Non-fatal — a failed stop must not block the next start attempt
            }
          }
          isFirstAttempt = false;

          sessionManager.markLocked(smKey);
          try {
            // Dynamic import: wrapper.js pulls in all lib/* files which may fail at
            // evaluation time — deferring keeps module load safe.
            const { createFacebookApi } = await import('./wrapper.js');
            sessionLogger.info('[facebook-messenger] Starting Listener...');

            let appstate = config.appstate;
            let prefix = config.prefix;

            // WHY: Refresh credentials before every attempt so credential-update
            // auto-restarts always use the latest appstate from the database.
            const refreshConfig = async () => {
              const botDetail = await botRepo.getById(
                config.userId,
                config.sessionId,
              );
              if (botDetail) {
                appstate = (botDetail.credentials as any).appstate ?? appstate;
                prefix = botDetail.prefix ?? prefix;
              }
            };
            await refreshConfig();

            // Smart restart gate — only call startBot() when strictly required.
            const appstateChanged =
              activeAppstate !== null && appstate !== activeAppstate;
            const needsLogin =
              isInvalidSession || appstateChanged || activeFcaApi === null;

            if (needsLogin) {
              if (isInvalidSession) {
                sessionLogger.info(
                  '[facebook-messenger] Re-login required — previous session was flagged invalid',
                );
              } else if (appstateChanged) {
                sessionLogger.info(
                  '[facebook-messenger] Re-login required — appstate updated via dashboard',
                );
              } else {
                sessionLogger.info(
                  '[facebook-messenger] No existing session — initial login',
                );
              }

              const { api } = await startBot({ appstate }, sessionLogger);
              activeFcaApi = api;
              activeAppstate = appstate;
              isInvalidSession = false;
              persistState();
            } else {
              sessionLogger.info(
                '[facebook-messenger] Session intact — reattaching MQTT listener without re-login',
              );
            }

            // Extracted so it can be called again on MQTT reconnect without repeating login.
            // reconnecting flag deduplicates burst errors — only one reconnect races at a time.
            let reconnecting = false;

            const listen = (fcaApi: FcaApi): void => {
              listenerInstances = fcaApi.listenMqtt((err, rawEvent, state) => {
                if (err) {
                  sessionLogger.error('[facebook-messenger] MQTT error', {
                    error: err,
                  });

                  // Auth errors are unrecoverable — reconnecting with the same appstate fails.
                  if (isAuthError(err)) {
                    sessionLogger.error(
                      '[facebook-messenger] Session offline — MQTT auth error (appstate may be expired)',
                      { error: err },
                    );
                    // Flag so the next external start() runs a full re-login.
                    isInvalidSession = true;
                    persistState();
                    void sessionManager.markInactive(smKey);
                    return;
                  }

                  if (reconnecting) return;
                  reconnecting = true;

                  sessionLogger.info('[facebook-messenger] Restarting Listener...');
                  void listenerInstances
                    ?.stopListeningAsync()
                    .catch(() => undefined)
                    .then(async () => {
                      await withRetry(
                        async () => {
                          await refreshConfig();
                          const { api: freshApi } = await startBot(
                            { appstate },
                            sessionLogger,
                          );
                          activeFcaApi = freshApi;
                          activeAppstate = appstate;
                          isInvalidSession = false;
                          persistState();
                          listen(freshApi);
                        },
                        {
                          maxAttempts: 10,
                          initialDelayMs: 5_000,
                          backoffFactor: 2,
                          maxDelayMs: 120_000,
                          onRetry: (attempt, retryErr) => {
                            sessionLogger.warn(
                              `[facebook-messenger] MQTT reconnect attempt ${attempt}/10`,
                              { error: retryErr },
                            );
                          },
                          shouldRetry: (err) => !isAuthError(err),
                        },
                      ).catch((finalErr: unknown) => {
                        sessionLogger.error(
                          '[facebook-messenger] MQTT reconnect exhausted — session offline',
                          { error: finalErr },
                        );
                        void sessionManager.markInactive(smKey);
                      });
                      reconnecting = false;
                    });
                  return;
                }

                // MQTT lifecycle state changes (connect, disconnect, close, error) are delivered
                // as the third argument — log for operational visibility and return.
                if (state) {
                  sessionLogger.info(
                    `[facebook-messenger] MQTT state: ${state.type}`,
                    { mqttState: state },
                  );
                  return;
                }

                const apiWrapper = createFacebookApi(fcaApi, config.sessionId);
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
                  routeRawEvent(rawEvent, apiWrapper, native, emitter, prefix);
                } catch (routeErr) {
                  sessionLogger.error(
                    '[facebook-messenger] routeRawEvent failed (event dropped)',
                    { error: routeErr },
                  );
                }
              });
            };

            // start() is the sole owner of the MQTT listener — startBot() deliberately does NOT
            // call listenMqtt so there is exactly one listener on the connection at all times.
            listen(activeFcaApi!);

            sessionLogger.info('[facebook-messenger] Listener active');

            // markActive only after listen() succeeds so the dashboard never shows an
            // online status for a session that hasn't established the MQTT listener.
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
              `[facebook-messenger] Start attempt ${attempt}/10 failed — retrying with backoff`,
              { error: err },
            );
            // Keep the dashboard in sync: session remains offline during back-off.
            void sessionManager.markInactive(smKey);
          },
          // Expired/blocked session cookies cannot be fixed by retrying — bail immediately.
          shouldRetry: (err) => !isAuthError(err),
        },
      ).catch((err: unknown) => {
        if (controller.signal.aborted) return;
        sessionLogger.error(
          `[facebook-messenger] Permanent startup failure after 10 attempts — session offline`,
          { error: err },
        );
        void sessionManager.markInactive(smKey);
      });
    } finally {
      sessionManager.markNotRetrying(smKey, retryToken);
    }
  };

  emitter.stop = async (_signal?: string): Promise<void> => {
    const smKey = `${config.userId}:${Platforms.FacebookMessenger}:${config.sessionId}`;
    if (sessionManager.isLocked(smKey)) return;
    sessionManager.markLocked(smKey);
    try {
      sessionLogger.info('[facebook-messenger] Stopping Listener...');
      // Only tear down the MQTT listener — activeFcaApi is intentionally preserved in the
      // registry so a subsequent start() (dashboard Restart, process restart) can reattach
      // without re-login when the session cookie is still valid.
      if (listenerInstances) await listenerInstances.stopListeningAsync();
      listenerInstances = null;
    } finally {
      sessionManager.markUnlocked(smKey);
    }
  };

  return emitter;
}