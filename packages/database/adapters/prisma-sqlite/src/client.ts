// Load .env before any process.env access — CWD at runtime determines which .env file is read.
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from './generated/prisma/client.js';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

// Resolve absolute path to the shared sqlite DB so consumer packages (like cat-bot)
// don't accidentally create an empty dev.db in their own CWD when DATABASE_URL is unset.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let dbRoot = path.resolve(__dirname, '../../..');
// If compiled into dist/database/adapters/..., go up two more levels to exit dist/
if (path.basename(dbRoot) === 'database' && path.basename(path.dirname(dbRoot)) === 'dist') {
  dbRoot = path.resolve(dbRoot, '../..');
}
const defaultDbPath = path.resolve(dbRoot, 'database/database.sqlite');
const defaultUrl = `file:${defaultDbPath}`;

// globalThis cast avoids TypeScript strict-mode errors while maintaining a true cross-reload singleton.
// Without this guard, tsx --watch / Next.js fast-refresh would spawn a new PrismaClient (and
// open a new SQLite connection) on every hot-reload cycle, exhausting available file handles.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaReady: boolean;
};

const dbUrl = process.env['DATABASE_URL'] ?? defaultUrl;

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaBetterSqlite3({
      // Fallback keeps the process runnable even when DATABASE_URL is absent from the environment
      url: dbUrl,
    }),
  });

// Reuse across hot-reloads in dev only; production processes start once and never reassign globalThis
if (process.env['NODE_ENV'] !== 'production') globalForPrisma.prisma = prisma;

// ── SQLite Performance PRAGMAs ────────────────────────────────────────────────
// Applied once per process via a globalThis flag so hot-reload cycles in dev
// don't re-run them on every module evaluation (they're idempotent, but noisy).
//
// PrismaBetterSqlite3 v7 accepts only a URL string — no access to the raw
// Database instance — so PRAGMAs are set through Prisma's raw query interface
// immediately after the singleton is constructed.
if (!globalForPrisma.prismaReady) {
  globalForPrisma.prismaReady = true;

  // WAL (Write-Ahead Log): the single most impactful SQLite setting for web apps.
  // Allows concurrent reads while a write is in progress — without WAL, every
  // write exclusively locks the file and blocks all readers until it commits.
  prisma.$executeRawUnsafe('PRAGMA journal_mode = WAL')
    .then(() =>
      // NORMAL sync is safe with WAL and dramatically faster than FULL (the default).
      // Data survives OS crashes and process kills; only a sudden hardware power-cut
      // risks losing the very last committed transaction — acceptable for a bot DB.
      prisma.$executeRawUnsafe('PRAGMA synchronous = NORMAL'),
    )
    .then(() =>
      // 64 MB page cache in RAM. Negative value = kilobytes, so -64000 = 64 MB.
      // Keeps hot rows (active bot sessions, recent user/thread lookups) in memory
      // and cuts disk reads on every repeated findUnique / findMany call.
      prisma.$executeRawUnsafe('PRAGMA cache_size = -64000'),
    )
    .then(() =>
      // Temp tables, sort buffers, and intermediate GROUP BY results go to RAM
      // instead of a temp file on disk. Speeds up rank leaderboard queries and
      // any ORDER BY / aggregation that spills intermediate data.
      prisma.$executeRawUnsafe('PRAGMA temp_store = MEMORY'),
    )
    .then(() =>
      // Memory-mapped I/O: maps 256 MB of the DB file into virtual address space.
      // Read-heavy paths (session lookups, isCommandEnabled, isUserBanned) skip
      // the read() syscall entirely and access pages directly from the mmap region.
      prisma.$executeRawUnsafe('PRAGMA mmap_size = 268435456'),
    )
    .then(() =>
      // Retry for up to 30 s when a write lock is contested rather than immediately
      // returning SQLITE_BUSY. Prevents spurious errors during concurrent bot message
      // bursts where multiple platform sessions write at the same time.
      prisma.$executeRawUnsafe('PRAGMA busy_timeout = 30000'),
    )
    .then(() =>
      // SQLite defaults foreign key enforcement to OFF for backwards compatibility.
      // Turning it ON here mirrors the schema's @relation / onDelete: Cascade intent
      // and catches referential integrity bugs at the DB layer rather than silently
      // leaving orphaned rows.
      prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON'),
    )
    .catch((err: unknown) => {
      // PRAGMAs failing is non-fatal — the DB is still usable, just unoptimised.
      // Log loudly so it's visible in dev but don't crash the process.
      console.error('[prisma] Failed to apply performance PRAGMAs:', err);
    });
}