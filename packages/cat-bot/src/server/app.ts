/**
 * Express Application Factory
 *
 * Fully unified server merging the Facebook Page webhook listeners AND
 * the API server for bot management/dashboard administration.
 *
 * Separated from listen() to allow supertest mounts.
 */

import express, { type Application } from 'express';
import { env } from '@/engine/config/env.config.js';
import { toNodeHandler } from 'better-auth/node';
import { auth, adminAuth } from '@/server/lib/better-auth.lib.js';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { getTelegramWebhookHandler } from '@/engine/modules/session/telegram-webhook.registry.js';

import facebookPageRoutes from './routes/v1/facebook-page.routes.js';
import apiV1Router from './routes/v1/index.js';
import {
  REST_LIMIT,
  VALIDATE_LIMIT,
  ADMIN_LIMIT,
} from './middleware/rate-limit.middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
 */
export function createApp(): Application {
  const app = express();

  // Trust proxy so req.protocol and req.get('host') accurately reflect external URLs
  app.set('trust proxy', 1);

  // CORS must be registered before better-auth so the browser's OPTIONS preflight receives
  // Access-Control-Allow-* headers before better-auth's own handler processes the request.
  app.use(
    cors({
      // In production, trust same-origin implicitly. In dev, trust VITE_URL.
      origin: env.VITE_URL ? [env.VITE_URL] : true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );

  // Better Auth must mount BEFORE express.json() — toNodeHandler reads the raw Node.js
  // IncomingMessage stream; json() would consume the body before better-auth can parse it.
  app.all('/api/auth/{*any}', toNodeHandler(auth));
  // Admin auth instance — same stream-before-json constraint applies.
  // Mounted at its own path so Express routes admin traffic to the independent betterAuth
  // instance that sets the 'ba-admin.session_token' cookie (not 'better-auth.session_token').
  app.all('/api/admin-auth/{*any}', toNodeHandler(adminAuth));

  // Telegram webhook — mounted BEFORE express.json() for the same reason as better-auth:
  // Telegraf's RequestListener reads the raw body stream itself. If express.json() ran first
  // the stream would be consumed and Telegraf would receive an empty update payload.
  // The handler is registered lazily by listener.ts after bot.createWebhook() resolves,
  // so requests arriving before a session is live receive a 404 (safe no-op).
  app.post('/api/v1/telegram-webhook/:userId/:sessionId', (req, res) => {
    const key = `${String(req.params['userId'])}:${String(req.params['sessionId'])}`;
    const handler = getTelegramWebhookHandler(key);
    if (!handler) {
      res.sendStatus(404);
      return;
    }
    handler(req, res);
  });

  // Parse JSON bodies before any route handler runs.
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Mount Facebook Page Webhooks
  app.use('/api/v1/facebook-page', facebookPageRoutes);

  // Rate limiting — path-specific limiters MUST be registered before the catch-all
  // REST_LIMIT so the stricter per-endpoint ceiling short-circuits first. Each
  // preset owns its own in-memory Map, so counts are tracked independently across stores.
  // A /validate request is counted in both VALIDATE_LIMIT and REST_LIMIT, which is
  // intentional: heavy probing traffic also drains the general budget.
  app.use('/api/v1/validate', VALIDATE_LIMIT); // 20 req / 60 s — protects live credential checks
  app.use('/api/v1/admin', ADMIN_LIMIT); // 60 req / 60 s — reduces admin enumeration blast radius
  app.use('/api/v1', REST_LIMIT); // 120 req / 60 s — general bot management dashboard

  // Mount API endpoints for bot administration
  app.use('/api/v1', apiV1Router);

  // Health check
  app.get('/api/v1/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Serve SPA if the built dist folder exists — fallback for React Router
  const webDistPath = path.resolve(__dirname, '../../../web/dist');
  if (fs.existsSync(webDistPath)) {
    app.use(express.static(webDistPath));
    app.get('/{*splat}', (req, res) => {
      res.sendFile(path.join(webDistPath, 'index.html'));
    });
  }

  return app;
}
