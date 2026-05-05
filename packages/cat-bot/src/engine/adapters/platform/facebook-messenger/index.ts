/**
 * Facebook Messenger Platform Entry Point (fca-unofficial) — Multi-Session Edition
 *
 * Thin orchestration layer — delegates to focused sub-modules:
 *   - types.ts        → shared type definitions (FcaApi, emitter shape)
 *   - login.ts        → authentication and appstate management
 *   - event-router.ts → fca event type → unified emitter event mapping
 *   - wrapper.ts      → UnifiedApi implementation (delegates to lib/)
 *
 * Retry architecture (unified — replaces previous two-loop design):
 *   One managed retry loop via platform-runner.lib.ts handles BOTH startup failures
 *   AND runtime MQTT reconnects.
 *
 *   WHY the previous design was dangerous:
 *     An inner withRetry loop lived inside the MQTT listenMqtt callback. When MQTT
 *     dropped, that inner loop ran concurrently with the outer startup loop — two
 *     parallel calls to startBot() + listen() on the same session, racing to produce
 *     a live connection. This is undefined behavior: zombie MQTT listeners accumulate,
 *     each receiving a duplicate copy of every event.
 *
 *   NEW design — single path:
 *     When the MQTT listener emits a recoverable error after a successful boot, the
 *     handler stops the stale MQTT connection and calls emitter.start(). The runner's
 *     isLocked / isRetrying guards guarantee exactly one retry loop runs per session
 *     key at any moment — no nested loop, no race.
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

import { createLogger } from '@/engine/modules/logger/logger.lib.js';
import { startBot } from './login.js';
import { routeRawEvent } from './event-router.js';
// isAuthError: still needed here to classify MQTT callback errors as permanent vs recoverable.
// withRetry: removed — runner (platform-runner.lib.ts) now owns all retry loops.
import { isAuthError } from '@/engine/lib/retry.lib.js';
import { sessionManager } from '@/engine/modules/session/session-manager.lib.js';
// Centralized retry runner — replaces the inline withRetry boilerplate AND the nested
// inner withRetry loop that previously lived inside the MQTT listenMqtt callback.
import { runManagedSession } from '@/engine/lib/platform-runner.lib.js';

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

  // Hoisted to factory scope — constant for the listener's lifetime.
  const smKey = `${config.userId}:${Platforms.FacebookMessenger}:${config.sessionId}`;
  // Registry key — stable identity for this session regardless of closure recreation.
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

  emitter.start = async (): Promise<void> => {
    /**
     * Tears down the MQTT listener between retry attempts.
     * Called by runManagedSession before each non-first attempt — never directly.
     * activeFcaApi is intentionally preserved so boot() can reattach without re-login
     * when the appstate cookie is still valid.
     */
    const cleanup = async (): Promise<void> => {
      if (listenerInstances) {
        await listenerInstances.stopListeningAsync();
        listenerInstances = null;
      }
    };

    /**
     * Platform-specific boot routine. Called once per retry attempt under markLocked.
     * markActive is NOT called here — runManagedSession calls it after boot() resolves.
     */
    const boot = async (): Promise<void> => {
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

      // reconnecting flag deduplicates burst MQTT errors — only one restart races at a time.
      let reconnecting = false;
      // Tracks whether MQTT has fired 'connect'. Pre-connect recoverable errors must reject
      // boot() — void emitter.start() is a no-op while isRetrying is true inside the runner,
      // so without this flag the Promise would hang indefinitely on a pre-connect network fault.
      let mqttConnected = false;

      const listen = (fcaApi: FcaApi): Promise<void> => {
        return new Promise<void>((resolve, reject) => {
          listenerInstances = fcaApi.listenMqtt((err, rawEvent, state) => {
            if (err) {
              sessionLogger.error('[facebook-messenger] MQTT error', {
                error: err,
              });

              // Auth errors are unrecoverable — the same appstate will fail again.
              // Flag the session invalid so the next boot() triggers a fresh login.
              if (isAuthError(err)) {
                sessionLogger.error(
                  '[facebook-messenger] Session offline — MQTT auth error (appstate may be expired)',
                  { error: err },
                );
                isInvalidSession = true;
                persistState();
                void sessionManager.markInactive(smKey);
                // Auth errors are permanent — connect will never fire for a revoked appstate.
                // Reject immediately so the runner classifies this as a non-retryable failure.
                reject(err);
                return;
              }

              // Burst-error guard — only one reconnect attempt in flight at a time.
              if (reconnecting) return;
              reconnecting = true;

              sessionLogger.info(
                '[facebook-messenger] MQTT error — triggering managed restart...',
              );

              // Stop the stale MQTT connection then re-enter the centralized runner.
              // The runner provides exponential backoff with isRetrying / isLocked guards —
              // no nested withRetry needed here, eliminating the zombie-listener risk.
              const prev = listenerInstances;
              listenerInstances = null;
              void (async () => {
                try {
                  if (prev) await prev.stopListeningAsync();
                } catch {
                  /* non-fatal — proceed to restart regardless */
                }
                reconnecting = false;
                // Pre-connect error: the Promise is still pending and void emitter.start()
                // would be silently dropped (isRetrying = true). Reject boot() so the runner's
                // retry loop picks it up with backoff from a clean state.
                // Post-connect: MQTT disconnected after a live session — re-enter the runner
                // for normal reconnection as before.
                if (!mqttConnected) {
                  reject(err);
                } else {
                  void emitter.start();
                }
              })();
              return;
            }

            // MQTT lifecycle state changes (connect, disconnect, close, error) are delivered
            // as the third argument — log for operational visibility and return.
            if (state) {
              sessionLogger.info(
                `[facebook-messenger] MQTT state: ${state.type}`,
                { mqttState: state },
              );
              // Resolve once MQTT confirms the connection is live — boot() returns only after
              // the transport is established, making the session startup strictly sequential.
              // runManagedSession calls markActive AFTER boot() resolves, so the dashboard
              // never shows the session as online before events can actually flow.
              if (state.type === 'connect') {
                mqttConnected = true;
                resolve();
              }
              return;
            }

            const apiWrapper = createFacebookApi(fcaApi, config.sessionId, config.userId);
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
        }); // closes new Promise<void>((resolve, reject))
      };

      // start() is the sole owner of the MQTT listener — startBot() deliberately does NOT
      // call listenMqtt so there is exactly one listener on the connection at all times.
      await listen(activeFcaApi!);

      sessionLogger.info('[facebook-messenger] Listener active');
      // markActive NOT called here — runManagedSession calls it after boot() returns.
    };

    await runManagedSession({
      smKey,
      sessionLogger,
      label: '[facebook-messenger]',
      boot,
      cleanup,
    });
  };

  emitter.stop = async (_signal?: string): Promise<void> => {
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
