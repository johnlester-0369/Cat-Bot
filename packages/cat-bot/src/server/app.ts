/**
 * Express Application Factory
 *
 * Fully unified server merging the Facebook Page webhook listeners AND
 * the API server for bot management/dashboard administration.
 *
 * Separated from listen() to allow supertest mounts.
 */

import express, { type Application } from 'express';
import { toNodeHandler } from 'better-auth/node';
import { auth } from '@/server/lib/better-auth.lib.js';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

import facebookPageRoutes from './routes/v1/facebook-page.routes.js';
import apiV1Router from './routes/v1/index.js';

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
  app.use(cors({
    // In production, trust same-origin implicitly. In dev, trust VITE_URL.
    origin: process.env['VITE_URL'] ? [process.env['VITE_URL']] : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  // Better Auth must mount BEFORE express.json() — toNodeHandler reads the raw Node.js
  // IncomingMessage stream; json() would consume the body before better-auth can parse it.
  app.all("/api/auth/{*any}", toNodeHandler(auth));

  // Parse JSON bodies before any route handler runs.
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Mount Facebook Page Webhooks
  app.use('/api/v1/facebook-page', facebookPageRoutes);

  // Mount API endpoints for bot administration
  app.use('/api/v1', apiV1Router);

  // Health check
  app.get("/api/v1/health", (_req, res) => {
    res.json({ status: "ok" });
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

export default createApp();
