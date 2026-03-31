/**
 * Express Application Factory
 *
 * Responsible for wiring middleware and routes — deliberately does NOT call
 * app.listen(). This separation means:
 *   - Tests can mount the app via supertest without binding a real port.
 *   - server.ts owns the single listen() call, keeping port resolution in one place.
 *   - Future platform webhooks (e.g. Telegram self-hosted) can be added here
 *     as additional app.use() mounts without touching the server bootstrap.
 */

import express, { type Application } from 'express';
import facebookPageRoutes from './routes/v1/facebook-page.routes.js';

// Augment Express Request to carry the raw body buffer for HMAC verification.

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

/**
 * Creates and returns a fully-configured Express application instance.
 * All platform-specific routes live under /v1 — versioning is enforced at
 * the mount point so no individual route file needs to carry the version prefix.
 */
export function createApp(): Application {
  const app = express();

  // Parse JSON bodies before any route handler runs.
  // Raw body capture middleware for HMAC verification can be inserted here
  // in the future without touching routes or controllers.
  app.use(express.json());

  // Mount versioned routes — /v1/facebook-page/:user_id
  app.use('/v1/facebook-page', facebookPageRoutes);

  return app;
}
