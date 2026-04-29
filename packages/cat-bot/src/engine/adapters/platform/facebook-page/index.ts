/**
 * Facebook Page Messenger Platform Listener (Webhook)
 *
 * Exposes createFacebookPageListener() which returns an EventEmitter-based platform
 * listener. app.ts registers .on() handlers for typed events then calls
 * listener.start() to boot the Express webhook server.
 *
 * Architecture (modular):
 *   types.ts          — listener-level type definitions (FacebookPageConfig, PlatformEmitter)
 *   event-router.ts   — webhook message routing logic (reaction/postback/message branching)
 *   wrapper.ts        — UnifiedApi class shell (FbPageApi)
 *   pageApi-types.ts  — PageApi/GetMessageResult interfaces
 *   pageApi-helpers.ts — Graph API HTTP transport functions
 *   pageApi.ts        — Graph API factory (createPageApi) with page ID caching
 *   unsupported.ts    — throw-only stubs for unsupported operations
 *
 * Retry architecture:
 *   emitter.start() delegates to runManagedSession() (platform-runner.lib.ts) which
 *   owns the exponential-backoff loop (10 attempts, 3 s → 120 s), isLocked / isRetrying
 *   zombie guards, AbortController cancellation, and markActive / markInactive dashboard
 *   sync. This file provides only boot() and cleanup() hooks to the runner.
 *
 *   The cleanup() hook unregisters the stale page session before each retry attempt —
 *   an improvement over the original design which had no inter-attempt cleanup.
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
import { createLogger } from '@/engine/modules/logger/logger.lib.js';
import { sessionManager } from '@/engine/modules/session/session-manager.lib.js';
import {
  PLATFORM_TO_ID,
  Platforms,
} from '@/engine/modules/platform/platform.constants.js';
import { botRepo } from '@/server/repos/bot.repo.js';
// Centralized retry runner — replaces the inline withRetry + isAuthError + AbortController
// boilerplate that was previously copy-pasted across all four platform listeners.
import { runManagedSession } from '@/engine/lib/platform-runner.lib.js';

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

  // Hoisted to factory scope — constant for the listener's lifetime.
  const smKey = `${config.userId}:${Platforms.FacebookPage}:${config.sessionId}`;

  // Retained so stop() and cleanup() can unregister the correct page session even when
  // credentials change between a start and stop invocation.
  let activePageId = config.pageId;

  emitter.start = async () => {
    /**
     * Unregisters the stale page session before the next retry attempt so the webhook
     * router never dispatches events to a partially-initialised session handler.
     * This cleanup was absent in the original design — now guaranteed by the runner.
     */
    const cleanup = async (): Promise<void> => {
      unregisterPageSession(config.userId, activePageId);
    };

    /**
     * Platform-specific boot routine. Called once per retry attempt under markLocked.
     * markActive is NOT called here — runManagedSession calls it after boot() resolves.
     */
    const boot = async (): Promise<void> => {
      sessionLogger.info('[facebook-page] Starting Listener...');

      // WHY: Fetching inside boot guarantees every attempt uses the latest DB values —
      // covers credential-update auto-restarts triggered via the dashboard.
      const botDetail = await botRepo.getById(config.userId, config.sessionId);
      const pageAccessToken = botDetail
        ? ((botDetail.credentials as any).fbAccessToken ?? config.pageAccessToken)
        : config.pageAccessToken;
      const pageId = botDetail
        ? ((botDetail.credentials as any).fbPageId ?? config.pageId)
        : config.pageId;
      const prefix = botDetail
        ? (botDetail.prefix ?? config.prefix)
        : config.prefix;
      // Capture latest pageId so stop() and cleanup() unregister the correct session key
      // even if credentials change between start() and stop() calls.
      activePageId = pageId;

      // Pass pageId directly — no Graph API fetch required; ID comes from credentials.
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

      sessionLogger.info('[facebook-page] Listener active');
      // markActive NOT called here — runManagedSession calls it after boot() returns.
    };

    await runManagedSession({
      smKey,
      sessionLogger,
      label: '[facebook-page]',
      boot,
      cleanup,
    });
  };

  emitter.stop = async (_signal?: string): Promise<void> => {
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