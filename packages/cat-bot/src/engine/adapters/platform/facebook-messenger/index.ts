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
import { routeRawEvent, routeFbClientEvent } from './event-router.js';
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
import { env } from '@/engine/config/env.config.js';
type FBClient = any;

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

// ── E2EE Device Store Memory Cache ─────────────────────────────────────────────
// Protects long-lived Signal identity/keys across temporary connectivity losses.
// Maps sessionId -> JSON device payload.
const e2eeDeviceStoreMap = new Map<string, string>();

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
  // Hoisted to factory scope so emitter.stop() can call fbClient.disconnect() — declaring
  // inside boot() would make it inaccessible from the stop closure (different stack frame).
  let fbClient: any = null;
  // Guards the E2EE onEvent reconnect handler: set to true during emitter.stop() so that
  // the disconnect callbacks fired by fbClient.disconnect() never trigger a reconnect loop.
  let isStopping = false;

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
      // A fresh start() always supersedes any prior stop() — reset so onEvent reconnect logic works normally.
      isStopping = false;
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

            const apiWrapper = createFacebookApi(
              fcaApi,
              config.sessionId,
              config.userId,
            );
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

      // Native FBClient E2EE Session Configuration — runs concurrently with plaintext MQTT
      // to support both transport protocols. fbClient writes to factory-scope let so stop() can disconnect.
      if (env.FCA_ENABLE_E2EE) {
        // Dynamic obscure import prevents tsc from traversing fca-cat-bot and evaluating its broken .ts files
        const pkg = 'fca-cat-bot';
        const { FBClient: FBC, fmeInstance } = (await import(pkg)) as any;
        // Mirror the fcaLogger bridge in login.ts — wire FME structured log output to the session
        // logger BEFORE any FBClient instantiation so no early output is missed. Set up once here
        // so that re-calls to initializeE2EEClient() during reconnect do NOT add duplicate listeners.
        const { fmeLogger } = fmeInstance({ emitLogger: true });
        fmeLogger.on('info', (l: { message: string }) =>
          sessionLogger.info(`[facebook-messenger] [fme] ${l.message}`),
        );
        fmeLogger.on('warn', (l: { message: string }) =>
          sessionLogger.warn(`[facebook-messenger] [fme] ${l.message}`),
        );
        fmeLogger.on('error', (l: { message: string }) =>
          sessionLogger.error(`[facebook-messenger] [fme] ${l.message}`),
        );

        // Prevents concurrent E2EE reconnect attempts — mirrors the MQTT reconnecting flag pattern.
        let e2eeReconnecting = false;

        /**
         * Full E2EE initialization: creates a FRESH FBClient, wires onEvent, then calls
         * connect() + connectE2EE() in sequence. Must be called both on initial boot and on
         * every E2EE reconnect.
         *
         * WHY NOT reuse the disconnected instance: fbClient.disconnect() tears down the internal
         * API reference inside FBClient. Any subsequent connectE2EE() call on the same object
         * throws "Client is not connected (no API instance available)" — the error seen in logs.
         * Re-instantiating a fresh FBClient is the only safe path back to a live E2EE session.
         */
        const initializeE2EEClient = async (): Promise<void> => {
          // Create a fresh FBClient every time — stale instances cannot be resurrected after disconnect().
          fbClient = new FBC({ platform: 'messenger', api: activeFcaApi });

          fbClient.onEvent((event: any) => {
            // FBClient lifecycle events (error, disconnected) are not routable messages —
            // they signal transport failure and require a clean disconnect + full re-initialization.
            if (
              event.type === 'error' ||
              (event.type === 'disconnected' && (event.data as any)?.isE2EE)
            ) {
              // Intentional stop in progress — fbClient.disconnect() in emitter.stop() fires these
              // callbacks; returning here prevents a reconnect loop from racing the teardown sequence.
              if (isStopping) return;
              // Burst guard: only one reconnect attempt in flight at a time.
              if (e2eeReconnecting) return;
              e2eeReconnecting = true;
              sessionLogger.warn(
                `[facebook-messenger] E2EE ${event.type as string} — disconnecting and reconnecting...`,
                { data: event.data as Record<string, unknown> },
              );
              void (async () => {
                try {
                  // Flush pending Signal/Noise state before tearing down the transport.
                  if (fbClient) await fbClient.disconnect();
                  // Null out the dead instance — initializeE2EEClient assigns a fresh one below.
                  fbClient = null;
                } catch {
                  /* non-fatal — proceed to re-initialize regardless */
                }
                try {
                  // activeFcaApi must be alive for E2EE to function — if the MQTT session
                  // has simultaneously dropped, skip and let the MQTT reconnect handle recovery.
                  if (!activeFcaApi) {
                    sessionLogger.error(
                      '[facebook-messenger] E2EE reconnect skipped — MQTT session unavailable',
                    );
                    return;
                  }
                  // Re-instantiate FBClient from scratch: disconnect() tears down the internal
                  // API reference, so connectE2EE() on the old instance always fails.
                  await initializeE2EEClient();
                  sessionLogger.info(
                    '[facebook-messenger] E2EE reconnection successful',
                  );
                } catch (reconnectErr) {
                  const msg =
                    reconnectErr instanceof Error
                      ? reconnectErr.message
                      : String(reconnectErr);
                  sessionLogger.error(
                    `[facebook-messenger] E2EE reconnection failed: ${msg}`,
                  );
                } finally {
                  e2eeReconnecting = false;
                }
              })();
              return;
            }
            try {
              const apiWrapper = createFacebookApi(
                activeFcaApi!,
                config.sessionId,
                config.userId,
              );
              const native = {
                userId: config.userId,
                sessionId: config.sessionId,
                platform: Platforms.FacebookMessenger,
                api: activeFcaApi,
                fbClient,
                event,
              };
              routeFbClientEvent(event, apiWrapper, native, emitter, prefix);
            } catch (routeErr) {
              sessionLogger.error(
                '[facebook-messenger] E2EE routeFbClientEvent failed',
                { error: routeErr },
              );
            }
          });

          const { userId: clientUserId } = await fbClient.connect();
          const deviceData = e2eeDeviceStoreMap.get(config.sessionId);
          await fbClient.connectE2EE({
            userId: clientUserId,
            deviceData,
            onUpdateDevice: (data: string) =>
              e2eeDeviceStoreMap.set(config.sessionId, data),
          });
        };

        try {
          await initializeE2EEClient();
          sessionLogger.info(
            '[facebook-messenger] Native E2EE connection established',
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          sessionLogger.error(
            `[facebook-messenger] Native E2EE connection failed: ${message}`,
          );
        }
      }
    };

    sessionLogger.info('[facebook-messenger] Listener active');
    // markActive NOT called here — runManagedSession calls it after boot() returns.

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
      // Set before fbClient.disconnect() — the disconnect call synchronously fires onEvent callbacks
      // ('error', 'disconnected') which must not attempt reconnection during deliberate teardown.
      isStopping = true;
      // Disconnect the E2EE (Signal/Noise) transport before tearing down MQTT — ensures the
      // FBClient WebSocket handshake state is flushed cleanly before the underlying FCA
      // connection disappears, preventing orphaned Signal sessions on the server side.
      if (fbClient) {
        await fbClient.disconnect();
        fbClient = null;
      }
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
