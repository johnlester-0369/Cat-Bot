/**
 * Facebook Page Session — Canonical Data Contract
 *
 * Single source of truth for the session shape shared between the session lib,
 * the webhook controller, and the Facebook Page platform adapter.
 * Kept in models/ so the type is importable without pulling in any runtime
 * Map state or Express dependencies.
 */

/** Per-session configuration registered with the singleton webhook server. */
export interface PageSessionConfig {
  /** Numeric user directory name (e.g. "1") — matches the :user_id URL segment. */
  userId: string;
  /** Numeric session directory name (e.g. "1", "2") — identifies the session within the user namespace. */
  sessionId: string;
  /** Page ID fetched from the Graph API — used to route POST webhook entries to the correct session emitter. */
  pageId: string;
  verifyToken: string;
  onMessage: (messaging: Record<string, unknown>) => Promise<void>;
}

/**
 * Facebook webhook request body — mirrors the Graph API delivery payload.
 * Kept loose at the messaging level because Facebook sends many event shapes
 * (message, postback, account_linking, etc.) that the adapter normalises.
 */
export interface FacebookWebhookBody {
  object?: string;
  entry?: Array<{
    id?: string;
    messaging?: Array<Record<string, unknown>>;
  }>;
}
