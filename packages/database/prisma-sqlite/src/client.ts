// Load .env before any process.env access — CWD at runtime determines which .env file is read.
// their own .env pointing back to the shared dev.db file.
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from './generated/prisma/client.js';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

// Resolve absolute path to the shared sqlite DB so consumer packages (like cat-bot)
// don't accidentally create an empty dev.db in their own CWD when DATABASE_URL is unset.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultDbPath = path.resolve(__dirname, '../sqlite/dev.sqlite');
const defaultUrl = `file:${defaultDbPath}`;

// globalThis cast avoids TypeScript strict-mode errors while maintaining a true cross-reload singleton.
// Without this guard, tsx --watch / Next.js fast-refresh would spawn a new PrismaClient (and
// open a new SQLite connection) on every hot-reload cycle, exhausting available file handles.
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaBetterSqlite3({
      // Fallback keeps the process runnable even when DATABASE_URL is absent from the environment
      url: process.env['DATABASE_URL'] ?? defaultUrl,
    }),
  });

// Reuse across hot-reloads in dev only; production processes start once and never reassign globalThis
if (process.env['NODE_ENV'] !== 'production') globalForPrisma.prisma = prisma;
