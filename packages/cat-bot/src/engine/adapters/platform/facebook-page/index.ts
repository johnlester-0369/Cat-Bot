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
import { PLATFORM_TO_ID, Platforms } from '@/engine/constants/platform.constants.js';

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

  /**
   * Constructs the Page API adapter, wires the event router callback that
   * emits typed events on this emitter, then starts the Express server.
   * Handlers must be registered on the emitter via .on() BEFORE calling start().
   */
  emitter.start = async () => {
    sessionLogger.info('[facebook-page] Starting Listener...');
    // Pass pageId directly — no Graph API fetch required; ID comes from credential.json.
    const pageApi = createPageApi(config.pageAccessToken, config.pageId, sessionLogger, (err) => {
      sessionLogger.error('[facebook-page] Session offline — page access token revoked or invalid', { error: err });
      sessionManager.markInactive(`${config.userId}:${Platforms.FacebookPage}:${config.sessionId}`);
    });
    const onMessage = createEventRouter(
      pageApi,
      emitter,
      config.prefix,
      config.userId,
      config.sessionId,
    );
    // Register so the singleton webhook server can route entries via sessions.get(`userId:pageId`).
    const sessionCfg: PageSessionConfig = {
      userId: config.userId,
      sessionId: config.sessionId,
      pageId: config.pageId,
      onMessage,
    };
    registerPageSession(sessionCfg);
  };

  emitter.stop = async (_signal?: string): Promise<void> => {
    sessionLogger.info('[facebook-page] Stopping Listener...');
    unregisterPageSession(config.userId, config.pageId);
  };

  return emitter;
}
