/**
 * Facebook Page Messenger Platform Listener (Webhook)
 *
 * Exposes createFacebookPageListener() which returns an EventEmitter-based platform
 * listener. app.ts registers .on() handlers for typed events then calls
 * listener.start() to boot the Express webhook server.
 *
 * Architecture (modular):
 *   types.ts          — listener-level type definitions (PLATFORM_ID, FacebookPageConfig, PlatformEmitter)
 *   event-router.ts   — webhook message routing logic (reaction/postback/message branching)
 *   wrapper.ts        — UnifiedApi class shell (FbPageApi)
 *   pageApi-types.ts  — PageApi/GetMessageResult interfaces
 *   pageApi-helpers.ts — Graph API HTTP transport functions
 *   pageApi.ts        — Graph API factory (createPageApi) with page ID caching
 *   unsupported.ts    — throw-only stubs for unsupported operations
 *   utils/            — event/attachment normalisation functions
 *   lib/              — individual UnifiedApi method implementations
 *
 * Retry architecture:
 *   emitter.start() owns an exponential-backoff retry loop (up to 10 attempts,
 *   3 s → 120 s). Two guards prevent zombie concurrency:
 *     isLocked   — another start/stop transition is actively running
 *     isRetrying — a back-off sleep is already in progress for this session
 *   Clicking Start during retry aborts the loop and boots fresh with latest credentials.
 *   Stop and Restart are blocked at the service layer during retry.
 *   markActive fires only on a fully successful boot; markInactive fires on every
 *   failed attempt so the dashboard never shows a half-started session as online.
 *
 * All HTTP infrastructure (Express, HMAC verification, process signals)
 * lives in src/server/webhook.ts — this file owns only listener lifecycle.
 */

import { EventEmitter } from 'events';
import type { PageSessionConfig } from '@/server/models/page-session.model.js';
import {
  registerPageSession,
  unregisterPageSession,
} from '@/engine/modules/session/facebook-page-session.lib.js';
// Re-export types so adapters/platform/index.ts import path stays unchanged
export type { FacebookPageConfig, PlatformEmitter } from './types.js';

import type { FacebookPageConfig, PlatformEmitter } from './types.js';
import { createEventRouter } from './event-router.js';
import { createPageApi } from './pageApi.js';
import { createLogger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module
import { sessionManager } from '@/engine/modules/session/session-manager.lib.js';
import {
  PLATFORM_TO_ID,
  Platforms,
} from '@/engine/modules/platform/platform.constants.js';
import { botRepo } from '@/server/repos/bot.repo.js';
import { withRetry, isAuthError } from '@/engine/lib/retry.lib.js';

/**
 * Creates a Facebook Page platform listener.
 */
export function createFacebookPageListener(
  config: FacebookPageConfig,
): PlatformEmitter {
  const emitter = new EventEmitter() as PlatformEmitter;

  const sessionLogger = createLogger({
    userId: config.userId,
    platformId: PLATFORM_TO_ID[Platforms.FacebookPage],
    sessionId: config.sessionId,
  });

  // Retained across start() calls so stop() can unregister the correct page session
  // even when credentials change between a start and stop invocation.
  let activePageId = config.pageId;

  /**
   * Boots the Facebook Page webhook transport with an internal exponential-backoff retry loop.
   *
   * Spam protection:
   *   isLocked   — another transition is actively running (concurrent op guard)
   *   isRetrying — back-off sleep is in progress (idle retry guard)
   * Both checks are synchronous before any await — no race window.
   *
   * The retry slot (markRetrying) is claimed synchronously immediately after the
   * guards so a rapid second call sees isRetrying = true and returns without spawning
   * a second parallel loop.
   */
  emitter.start = async () => {
    const smKey = `${config.userId}:${Platforms.FacebookPage}:${config.sessionId}`;
    if (sessionManager.isLocked(smKey)) return;
    if (sessionManager.isRetrying(smKey)) return;

    // Claim the retry slot synchronously before any await — prevents a rapid second
    // call from passing the isRetrying guard and spawning a parallel loop.
    const controller = new AbortController();
    const retryToken = sessionManager.markRetrying(smKey, () => controller.abort());

    // Signal the dashboard offline immediately; markActive fires on successful boot only.
    void sessionManager.markInactive(smKey);

    try {
      await withRetry(
        async () => {
          // Exit immediately if startBot() aborted this loop to spawn a fresh session.
          if (controller.signal.aborted) throw new Error('Retry aborted');

          sessionManager.markLocked(smKey);
          try {
            sessionLogger.info('[facebook-page] Starting Listener...');

            // WHY: Fetching inside the retry loop guarantees every attempt (including
            // credential-update triggered auto-restarts) uses the latest DB values
            // without requiring a process restart.
            const botDetail = await botRepo.getById(config.userId, config.sessionId);
            const pageAccessToken = botDetail
              ? ((botDetail.credentials as any).fbAccessToken ??
                config.pageAccessToken)
              : config.pageAccessToken;
            const pageId = botDetail
              ? ((botDetail.credentials as any).fbPageId ?? config.pageId)
              : config.pageId;
            const prefix = botDetail
              ? (botDetail.prefix ?? config.prefix)
              : config.prefix;
            activePageId = pageId; // capture for unregisterPageSession in stop()

            // Pass pageId directly — no Graph API fetch required; ID comes from credential.json.
            const pageApi = createPageApi(
              pageAccessToken,
              pageId,
              sessionLogger,
              (err) => {
                sessionLogger.error(
                  '[facebook-page] Session offline — page access token revoked or invalid',
                  { error: err },
                );
                void sessionManager.markInactive(smKey);
              },
            );
            const onMessage = createEventRouter(
              pageApi,
              emitter,
              prefix,
              config.userId,
              config.sessionId,
            );
            // Register so the singleton webhook server can route entries via sessions.get(`userId:pageId`).
            const sessionCfg: PageSessionConfig = {
              userId: config.userId,
              sessionId: config.sessionId,
              pageId,
              onMessage,
            };
            registerPageSession(sessionCfg);

            // markActive only after successful registration so the dashboard never
            // shows an online status for a partially-initialised webhook session.
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
              `[facebook-page] Start attempt ${attempt}/10 failed — retrying with backoff`,
              { error: err },
            );
            // Keep the dashboard in sync: session remains offline during back-off sleep.
            void sessionManager.markInactive(smKey);
          },
          // Revoked or invalid page access tokens cannot be fixed by retrying — bail immediately.
          shouldRetry: (err) => !isAuthError(err),
        },
      ).catch((err: unknown) => {
        // Aborted by startBot() which cancelled this loop to spawn a fresh session — skip log.
        if (controller.signal.aborted) return;
        sessionLogger.error(
          `[facebook-page] Permanent startup failure after 10 attempts — session offline`,
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
    const smKey = `${config.userId}:${Platforms.FacebookPage}:${config.sessionId}`;
    if (sessionManager.isLocked(smKey)) return;

    sessionManager.markLocked(smKey);
    try {
      sessionLogger.info('[facebook-page] Stopping Listener...');
      unregisterPageSession(config.userId, activePageId);
    } finally {
      sessionManager.markUnlocked(smKey);
    }
  };

  return emitter;
}
