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
} from '@/server/lib/facebook-page-session.lib.js';
import { startPageWebhookServer } from '@/server/server.js';
// Re-export types so adapters/platform/index.ts import path stays unchanged
/** Canonical Facebook Page platform identifier — imported by adapters/platform/index.ts to build the PlatformId union. */
export const PLATFORM_ID = 'facebook-page' as const;
export type { FacebookPageConfig, PlatformEmitter } from './types.js';

import type { FacebookPageConfig, PlatformEmitter } from './types.js';
import { createEventRouter } from './event-router.js';
import { createPageApi } from './pageApi.js';

/**
 * Creates a Facebook Page platform listener.
 */
export function createFacebookPageListener(
  config: FacebookPageConfig,
): PlatformEmitter {
  const emitter = new EventEmitter() as PlatformEmitter;

  /**
   * Constructs the Page API adapter, wires the event router callback that
   * emits typed events on this emitter, then starts the Express server.
   * Handlers must be registered on the emitter via .on() BEFORE calling start().
   */
  emitter.start = async () => {
    // Pass pageId directly — no Graph API fetch required; ID comes from credential.json.
    const pageApi = createPageApi(config.pageAccessToken, config.pageId);
    const onMessage = createEventRouter(
      pageApi,
      emitter,
      config.prefix,
      config.userId,
      config.sessionId,
    );
    // Register with the full identity tuple so the singleton server can dispatch incoming
    // webhook entries to the correct session emitter via sessions.get(`userId:pageId`).
    const sessionCfg: PageSessionConfig = {
      userId: config.userId,
      sessionId: config.sessionId,
      pageId: config.pageId,
      verifyToken: config.verifyToken,
      onMessage,
    };
    registerPageSession(sessionCfg);
    // Idempotent — only the first call binds the port; port is owned by webhook.ts via process.env.PORT
    startPageWebhookServer();
  };

  emitter.stop = async (): Promise<void> => {
    unregisterPageSession(config.userId, config.pageId);
  };

  return emitter;
}
