/**
 * HTTP Server Bootstrap — Singleton Lifecycle
 *
 * Owns the single app.listen() call for the entire process.
 * The `serverStarted` guard exists because the Facebook Page platform adapter
 * calls startPageWebhookServer() once per session (one per discovered session
 * directory) — without the guard every session would attempt to bind the same
 * port and crash with EADDRINUSE.
 *
 * Port is read exclusively from process.env.PORT so all Facebook Page sessions
 * share one Express instance with zero per-session port configuration.
 */

import { logger } from '@/lib/logger.lib.js';
import { env } from '@/config/env.config.js';
import { createApp } from './app.js';
import { getAllUserIds } from './lib/facebook-page-session.lib.js';

// Module-level flag — persists for the lifetime of the process so N concurrent
// start() calls from N sessions only ever bind once.
let serverStarted = false;

/**
 * Starts the singleton Express webhook server.
 * Idempotent — every session emitter's start() can safely call this;
 * only the first invocation actually binds.
 */
export function startPageWebhookServer(): void {
  if (serverStarted) return;
  serverStarted = true;

  const app = createApp();
  const port = parseInt(env.PORT, 10);

  if (Number.isNaN(port) || port < 1 || port > 65535) {
    logger.error(
      `Invalid PORT: "${env.PORT}" — must be a number between 1 and 65535`,
    );
    process.exit(1);
  }

  app.listen(port, () => {
    logger.info(`Webhook server listening on port ${port}`);
    logger.info('Registered session routes:');

    // Log one callback URL per user — each user's multiple Page sessions
    // all share the same /v1/facebook-page/:user_id URL prefix.
    for (const uid of getAllUserIds()) {
      logger.info(`GET/POST https://your-domain.com/v1/facebook-page/${uid}`);
    }

    logger.info(
      'Configure each Page in Meta App Dashboard with its Callback URL above.',
    );
  });
}
