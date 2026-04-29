/**
 * Facebook Page — Listener-Level Type Definitions
 *
 * Separated from index.ts so that type consumers (adapters/platform/index.ts,
 * event-router.ts) can import types without pulling in the factory function
 * and its transitive dependencies (Express, webhook server).
 */

import type { EventEmitter } from 'events';

export interface FacebookPageConfig {
  pageAccessToken: string;
  /** Facebook Page ID — sourced from DB (BotCredentialFacebookPage.fbPageId). */
  pageId: string;
  /** Numeric user directory name — matches the :user_id segment in /facebook-page/:user_id. */
  userId: string;
  /** Numeric session directory name — identifies this session within the user namespace. */
  sessionId: string;
  prefix: string;
}

export interface PlatformEmitter extends EventEmitter {
  start(commands?: Map<string, unknown>): Promise<void>;
  stop(signal?: string): Promise<void>;
}
