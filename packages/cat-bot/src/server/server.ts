/**
 * HTTP Server Bootstrap — Singleton Lifecycle
 *
 * Owns the single app.listen() call for the entire process.
 * Handles graceful shutdown and binds the unified Express app.
 */

import { logger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module
import { createServer } from 'node:http';
import { env } from '@/engine/config/env.config.js';
import { createApp } from './app.js';
import { getAllUserIds } from '../engine/modules/session/facebook-page-session.lib.js';
// Socket.IO: attach to the raw HTTP server before listen() so the WS upgrade
// event is captured at the Node.js level rather than going through Express.
import { initSocketIO } from './socket/socket.lib.js';
import { registerValidationHandlers } from './socket/validation.socket.js';
import { registerBotMonitorHandlers } from './socket/bot-monitor.socket.js';

/**
 * Starts the singleton Express webhook & API server.
 * Idempotent — multiple bot adapters can safely call this, only binds once.
 */
export function startServer(): void {
  const app = createApp();
  const port = parseInt(env.PORT, 10);
  // Create the HTTP server explicitly so Socket.IO can attach to it.
  // app.listen() internally does the same thing, but we need the handle before listen().
  const httpServer = createServer(app);

  const corsOrigin = env.VITE_URL ? [env.VITE_URL] : (true as const);
  const io = initSocketIO(httpServer, corsOrigin);
  registerValidationHandlers(io);
  registerBotMonitorHandlers(io);

  const server = httpServer.listen(port, () => {
    logger.info(`Webhook & API server listening on port ${port}`);
    logger.info('Registered Facebook Page session routes:');

    for (const uid of getAllUserIds()) {
      logger.info(
        `GET/POST https://${env.BETTER_AUTH_URL}/api/v1/facebook-page/${uid}`,
      );
    }
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`[server] Port ${port} is already in use`);
    } else {
      logger.error('[server] Fatal server error:', err);
    }
    process.exit(1);
  });

  // Note: SIGTERM handling for graceful shutdown is managed globally by
  // the Cat-Bot orchestrator in packages/bot/src/app.ts.
}
