/**
 * Facebook Page Session Registry
 *
 * Encapsulates the stateful session Map so HTTP transport code (controller,
 * server) never reaches into raw Map internals. Testable in isolation —
 * no Express dependency anywhere in this module.
 */

import { logger } from '@/lib/logger.lib.js';
import type { PageSessionConfig } from '../models/page-session.model.js';

// Keyed by `userId:pageId` — POST /facebook-page/:user_id resolves sessions via
// (user_id URL param + entry.id page ID from the webhook payload) without iterating.
const sessions = new Map<string, PageSessionConfig>();

/**
 * Registers a Facebook Page session so the webhook server can route
 * /v1/facebook-page/:user_id requests to the correct session emitter.
 *
 * Safe to call before or after startPageWebhookServer() — the sessions Map
 * is checked per-request so late registration takes effect immediately.
 */
export function registerPageSession(config: PageSessionConfig): void {
  const key = `${config.userId}:${config.pageId}`;
  sessions.set(key, config);
  logger.info(
    `[user ${config.userId}][session ${config.sessionId}][page ${config.pageId}] Registered — Callback URL: /v1/facebook-page/${config.userId}`,
  );
}

/**
 * Unregisters a previously configured Facebook Page session (e.g. during /restart logic),
 * preventing the webhook router from directing events towards a dead session instance.
 */
export function unregisterPageSession(userId: string, pageId: string): void {
  sessions.delete(`${userId}:${pageId}`);
}

/**
 * Resolves a session by userId + pageId (O(1) Map lookup).
 * Called by handleWebhookEvent — entry.id in the payload IS the pageId.
 */
export function getSession(
  userId: string,
  pageId: string,
): PageSessionConfig | undefined {
  return sessions.get(`${userId}:${pageId}`);
}

/**
 * Resolves a session by userId + verifyToken (linear scan within that user's sessions).
 * Only used during Facebook's GET verification handshake — Facebook does NOT send
 * the pageId at that stage, only the verifyToken, so we cannot key directly.
 */
export function findSessionByUserId(
  userId: string,
  verifyToken: string,
): PageSessionConfig | undefined {
  for (const [key, s] of sessions) {
    if (key.startsWith(`${userId}:`) && s.verifyToken === verifyToken) {
      return s;
    }
  }
  return undefined;
}

/**
 * Returns deduplicated userIds across all registered sessions.
 * Used by startPageWebhookServer() to log one callback URL line per user
 * rather than one line per pageId.
 */
export function getAllUserIds(): Set<string> {
  const userIds = new Set<string>();
  for (const key of sessions.keys()) {
    // noUncheckedIndexedAccess — split always returns at least one element,
    // but the type is string | undefined so we guard with ?? ''.
    const uid = key.split(':')[0] ?? '';
    if (uid) userIds.add(uid);
  }
  return userIds;
}
