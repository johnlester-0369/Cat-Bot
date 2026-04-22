# Database Package — Architecture

## Overview

The `packages/database/` package is the **raw data layer** for Cat-Bot. It contains four fully independent adapter implementations that expose a uniform function-level API. No caching lives here — all LRU caching is owned exclusively by `packages/cat-bot/src/engine/repos/`. All application code imports from the single package name `'database'`; the active adapter is selected at runtime via the `DATABASE_TYPE` environment variable.

The four adapters are structurally parallel: each implements the same set of repository modules covering the same domain objects (users, threads, sessions, credentials, bans, webhooks, commands, events, system admins). Swapping adapters requires only changing `DATABASE_TYPE` — no application code changes.

---

## Monorepo Position

```
Cat-Bot/
└── packages/
    ├── cat-bot/                         ← Imports from 'database'; owns LRU cache layer in src/engine/repos/
    └── database/                        ← This package — raw repo implementations, no cache
```

`packages/cat-bot` declares `"database": "file:../database"` in its `package.json`. The `database` package's `exports` field maps `"."` to `src/index.ts` (source) and `dist/database/src/index.js` (compiled), so both `tsx --conditions source` (dev) and `node dist/` (prod) resolve correctly.

---

## Package File Tree

```
packages/database/
│
├── src/                                 ← Unified public surface; always import from here
│   ├── index.ts                         ← Entry point: reads DATABASE_TYPE, dynamic-imports the
│   │                                      correct barrel, re-exports every function individually;
│   │                                      never import sub-paths directly from application code
│   │
│   ├── json.ts                          ← Static barrel re-exporting from adapters/json/src/
│   ├── mongodb.ts                       ← Static barrel re-exporting from adapters/mongodb/src/
│   ├── neondb.ts                        ← Static barrel re-exporting from adapters/neondb/src/
│   └── prisma-sqlite.ts                 ← Static barrel re-exporting from adapters/prisma-sqlite/src/
│                                          Also re-exports all generated Prisma types via `export *`
│
├── adapters/
│   │
│   ├── json/                            ← In-memory JSON flat-file adapter (zero dependencies)
│   │   ├── src/
│   │   │   ├── store.ts                 ← getDb() / saveDb(): loads database.json into memory;
│   │   │   │                              DEFAULT_DB backfills missing tables on schema evolution
│   │   │   │                              so older database.json files are never corrupt on upgrade
│   │   │   ├── cat-bot/
│   │   │   │   ├── banned.repo.ts       ← banUser, unbanUser, isUserBanned, banThread, unbanThread, isThreadBanned
│   │   │   │   ├── bot-session-commands.repo.ts  ← upsertSessionCommands, findSessionCommands, setCommandEnabled, isCommandEnabled
│   │   │   │   ├── bot-session-events.repo.ts    ← upsertSessionEvents, findSessionEvents, setEventEnabled, isEventEnabled
│   │   │   │   ├── credentials.repo.ts  ← Discord/Telegram/FB credential state, bot admin, bot premium, session prefix, nickname
│   │   │   │   ├── threads.repo.ts      ← upsertThread, threadSessionExists, upsertThreadSession, isThreadAdmin,
│   │   │   │   │                          getThreadName, getThreadSessionData, setThreadSessionData, getAllGroupThreadIds
│   │   │   │   ├── users.repo.ts        ← upsertUser, userSessionExists, upsertUserSession, getUserName,
│   │   │   │   │                          getUserSessionData, setUserSessionData, getAllUserSessionData
│   │   │   │   └── webhooks.repo.ts     ← getFbPageWebhookVerification, upsertFbPageWebhookVerification
│   │   │   └── server/
│   │   │       ├── bot.repo.ts          ← BotRepo class: create, getById, update, list, updateIsRunning,
│   │   │       │                          getPlatformId, listAll, deleteById
│   │   │       └── system-admin.repo.ts ← listSystemAdmins, addSystemAdmin, removeSystemAdmin, isSystemAdmin
│   │   ├── package.json                 ← name: database-json; type: module; no runtime dependencies
│   │   └── tsconfig.json               ← rootDir: ./src; @cat-bot/* paths alias → ../../../cat-bot/src/*
│   │
│   ├── mongodb/                         ← MongoDB driver adapter
│   │   ├── src/
│   │   │   ├── client.ts               ← MongoClient singleton with globalThis hot-reload guard;
│   │   │   │                              normalizes MONGODB_URI <PASSWORD> placeholder;
│   │   │   │                              getMongoDb(): returns Db for MONGO_DATABASE_NAME
│   │   │   ├── cat-bot/
│   │   │   │   ├── banned.repo.ts       ← upsert-based ban/unban; updateOne no-ops on absent docs
│   │   │   │   ├── bot-session-commands.repo.ts  ← bulkWrite with $setOnInsert preserves isEnable=false rows
│   │   │   │   ├── bot-session-events.repo.ts    ← same $setOnInsert bulkWrite pattern as commands
│   │   │   │   ├── credentials.repo.ts  ← Discord/Telegram/FB credential state; bot admin via botAdmins collection;
│   │   │   │   │                          bot premium via botPremiums collection
│   │   │   │   ├── threads.repo.ts      ← upsertOne with $set/$setOnInsert; participantIDs and adminIDs as flat arrays;
│   │   │   │   │                          getThreadSessionData stores JSON blob as string in data field
│   │   │   │   ├── users.repo.ts        ← upsertOne; getUserSessionData/setUserSessionData JSON blob via data field
│   │   │   │   └── webhooks.repo.ts     ← updateOne with $setOnInsert for idempotent verification
│   │   │   └── server/
│   │   │       ├── bot.repo.ts          ← BotRepo class; non-transactional (Atlas free tier constraint);
│   │   │       │                          listAll() uses userId→user lookup map for O(users+sessions) complexity
│   │   │       └── system-admin.repo.ts ← systemAdmin collection; randomUUID for id field
│   │   ├── package.json                 ← name: database-mongodb; dependencies: mongodb ^7
│   │   └── (no tsconfig — compiled via database/tsconfig.json rootDirs)
│   │
│   ├── neondb/                          ← Neon PostgreSQL adapter (node-postgres)
│   │   ├── src/
│   │   │   ├── client.ts               ← pg.Pool singleton; normalizeConnectionString() strips
│   │   │   │                              sslmode/channel_binding params before Pool construction;
│   │   │   │                              initDb(): idempotent CREATE TABLE IF NOT EXISTS DDL for all tables;
│   │   │   │                              dbReady: Promise<void> — await before first query at boot
│   │   │   ├── index.ts                ← adapter barrel; re-exports pool, initDb, dbReady alongside all repos
│   │   │   ├── schema.sql              ← standalone DDL file; equivalent to initDb(); for psql/SQL editor use
│   │   │   ├── cat-bot/
│   │   │   │   ├── banned.repo.ts       ← INSERT ON CONFLICT DO UPDATE for ban; UPDATE for unban (preserves reason)
│   │   │   │   ├── bot-session-commands.repo.ts  ← multi-row INSERT with ON CONFLICT DO NOTHING; shared $1/$2/$3 params
│   │   │   │   ├── bot-session-events.repo.ts    ← same multi-row INSERT pattern as commands
│   │   │   │   ├── credentials.repo.ts  ← parameterized queries; ON CONFLICT DO NOTHING for admin/premium inserts
│   │   │   │   ├── threads.repo.ts      ← explicit BEGIN/COMMIT for upsertThread (ghost user rows + M:M junction
│   │   │   │   │                          DELETE+INSERT must be atomic to prevent isThreadAdmin race conditions);
│   │   │   │   │                          getThreadSessionData/setThreadSessionData via TEXT data column
│   │   │   │   ├── users.repo.ts        ← ON CONFLICT DO UPDATE SET last_updated_at = NOW() for upsertUserSession;
│   │   │   │   │                          explicit timestamp stamp required (no @updatedAt equivalent in raw SQL)
│   │   │   │   └── webhooks.repo.ts     ← INSERT ON CONFLICT DO UPDATE SET is_verified = TRUE
│   │   │   └── server/
│   │   │       ├── bot.repo.ts          ← BotRepo class; transactional create/update/deleteById via BEGIN/COMMIT;
│   │   │       │                          listAll() uses LEFT JOIN "user" for single-query owner resolution
│   │   │       └── system-admin.repo.ts ← ON CONFLICT DO NOTHING + follow-up SELECT for idempotent addSystemAdmin
│   │   ├── package.json                 ← name: database-neondb; dependencies: pg ^8, dotenv
│   │   └── tsconfig.json
│   │
│   └── prisma-sqlite/                   ← Default adapter; Prisma v7 + better-sqlite3 (no network required)
│       ├── prisma/
│       │   ├── schema.prisma            ← Authoritative schema definition; generator: prisma-client;
│       │   │                              output: ../src/generated/prisma; datasource: sqlite;
│       │   │                              models: BotUser, BotThread, BotUserSession, BotThreadSession,
│       │   │                              BotSession, BotAdmin, BotPremium, BotCredentialDiscord,
│       │   │                              BotCredentialTelegram, BotCredentialFacebookPage,
│       │   │                              BotCredentialFacebookMessenger, FbPageWebhook,
│       │   │                              BotSessionCommand, BotSessionEvent, BotUserBanned,
│       │   │                              BotThreadBanned, SystemAdmin, user, session, account, verification
│       │   └── migrations/              ← Prisma migration history (generated by `prisma migrate dev`)
│       ├── src/
│       │   ├── client.ts               ← PrismaClient singleton with globalThis hot-reload guard;
│       │   │                              resolves database.sqlite absolute path from __dirname to prevent
│       │   │                              accidental CWD-relative db creation in consumer packages;
│       │   │                              applies 7 WAL/performance PRAGMAs once per process via globalThis flag:
│       │   │                              journal_mode=WAL, synchronous=NORMAL, cache_size=-64000,
│       │   │                              temp_store=MEMORY, mmap_size=268435456, busy_timeout=30000, foreign_keys=ON
│       │   ├── index.ts                ← Exports prisma client + re-exports all generated Prisma types
│       │   │                              (BotUser, BotSession, Prisma namespace, etc.) so consumers
│       │   │                              never import from generated/ paths directly
│       │   ├── generated/prisma/       ← Prisma-generated client files (gitignored, rebuilt via `prisma generate`)
│       │   ├── cat-bot/
│       │   │   ├── banned.repo.ts       ← upsert with create/update; updateMany for unban (avoids P2025)
│       │   │   ├── bot-session-commands.repo.ts  ← findMany to get existing, createMany for new only (preserves isEnable=false)
│       │   │   ├── bot-session-events.repo.ts    ← same find-then-createMany pattern as commands
│       │   │   ├── credentials.repo.ts  ← findUnique/update for credential hash; upsert with update:{} for admin/premium
│       │   │   ├── threads.repo.ts      ← upsert with participants/admins M:M { set: [...] }; ghost user rows
│       │   │   │                          pre-created via createMany to satisfy FK constraints; getThreadSessionUpdatedAt
│       │   │   │                          for staleness checks; update: { lastUpdatedAt: new Date() } to advance @updatedAt
│       │   │   ├── users.repo.ts        ← upsert; getUserSessionData/setUserSessionData via JSON string data column;
│       │   │   │                          update: { lastUpdatedAt: new Date() } fix for @updatedAt advancement
│       │   │   └── webhooks.repo.ts     ← upsert with create/update: { isVerified: true }
│       │   └── server/
│       │       ├── bot.repo.ts          ← BotRepo class; $transaction for create/update/deleteById;
│       │       │                          listAll() uses include: { user: true } for single-query owner join
│       │       └── system-admin.repo.ts ← upsert with update: {} for idempotent addSystemAdmin; deleteMany for remove
│       ├── prisma.config.ts             ← Prisma v7 defineConfig: schema path, migrations path, datasource URL
│       ├── package.json                 ← name: database-adapter-prisma-sqlite; dependencies: @prisma/client ^7, better-sqlite3
│       └── tsconfig.json               ← rootDir: ./src; @cat-bot/* alias → ../../../cat-bot/src/*
│
├── scripts/                             ← Cross-adapter data migration utilities
│   ├── load-env.ts                      ← Shared dotenv loader for migration scripts
│   ├── migrate-json-to-sqlite.ts        ← Reads database.json; writes to SQLite via Prisma
│   ├── migrate-json-to-mongodb.ts
│   ├── migrate-json-to-neondb.ts
│   ├── migrate-sqlite-to-json.ts        ← Reads SQLite via Prisma; writes to database.json
│   ├── migrate-sqlite-to-mongodb.ts
│   ├── migrate-sqlite-to-neondb.ts
│   ├── migrate-mongodb-to-json.ts
│   ├── migrate-mongodb-to-sqlite.ts
│   ├── migrate-mongodb-to-neondb.ts
│   ├── migrate-neondb-to-json.ts
│   ├── migrate-neondb-to-sqlite.ts
│   └── migrate-neondb-to-mongodb.ts
│
├── database/                            ← Runtime data directory (gitignored contents)
│   ├── database.sqlite                  ← SQLite database file (prisma-sqlite adapter)
│   └── database.json                    ← JSON flat-file (json adapter)
│
├── package.json                         ← name: database; type: module; main + exports point to dist/database/src/index.js
└── tsconfig.json                        ← rootDir: ".."; rootDirs includes all four adapter src trees;
                                           @/ aliases to ./src/ and ../cat-bot/src/; @cat-bot/* to ../cat-bot/src/*
```

---

## Adapter Contract

Every adapter implements the same set of named exports. The `src/index.ts` entry point re-exports each one individually via `export const name = m.name`, where `m` is the dynamically-imported adapter barrel. This design means:

- Adapters can be loaded lazily — the Prisma client and its generated files are never evaluated when `DATABASE_TYPE=json`
- The TypeScript types used throughout the application are always the prisma-sqlite types (imported at compile time via the static barrel); at runtime only the active adapter's code actually executes
- Adding a new function to all adapters is a four-file change (one repo file per adapter) plus a one-line addition in `src/index.ts`

The full exported API surface covers these domain groups:

```
Bot Session Commands  — upsertSessionCommands, findSessionCommands, setCommandEnabled, isCommandEnabled
Bot Session Events    — upsertSessionEvents, findSessionEvents, setEventEnabled, isEventEnabled
Credentials           — findDiscord/TelegramCredentialState, updateDiscord/TelegramCredentialCommandHash,
                        findAll{Discord,Telegram,FbPage,FbMessenger}Credentials, findAllBotSessions,
                        isBotAdmin, addBotAdmin, removeBotAdmin, listBotAdmins, updateBotSessionPrefix,
                        getBotNickname, isBotPremium, addBotPremium, removeBotPremium, listBotPremiums
Threads               — upsertThread, threadExists, threadSessionExists, upsertThreadSession,
                        getThreadSessionUpdatedAt, isThreadAdmin, getThreadName,
                        getThreadSessionData, setThreadSessionData, getAllGroupThreadIds
Users                 — upsertUser, userExists, userSessionExists, upsertUserSession,
                        getUserSessionUpdatedAt, getUserName, getUserSessionData,
                        setUserSessionData, getAllUserSessionData
Webhooks              — getFbPageWebhookVerification, upsertFbPageWebhookVerification
Bans                  — banUser, unbanUser, isUserBanned, banThread, unbanThread, isThreadBanned
Server Repo           — botRepo (BotRepo class: create, getById, update, list, updateIsRunning,
                        getPlatformId, listAll, deleteById)
System Admin          — listSystemAdmins, addSystemAdmin, removeSystemAdmin, isSystemAdmin
Database Instances    — prisma (prisma-sqlite only), getDb/saveDb (json only),
                        mongoClient/getMongoDb (mongodb only), pool/initDb/dbReady (neondb only)
```

---

## Adapter Implementations

### JSON Adapter (`adapters/json/`)

The JSON adapter has no external runtime dependencies. All data lives in a single `database/database.json` file, loaded once into `dbCache` on first access and flushed to disk on every write via `saveDb()`. The `DEFAULT_DB` constant in `store.ts` backfills any tables absent from older database.json files when they are parsed, making schema evolution backward-compatible without migration scripts.

Concurrency characteristics: single-process safe; no connection pooling; not suitable for distributed deployments. Suited for local development and lightweight single-instance bots.

### MongoDB Adapter (`adapters/mongodb/`)

Uses the official `mongodb` Node.js driver with a `MongoClient` singleton. The singleton is pinned to `globalThis` in development to prevent connection pool exhaustion across tsx hot-reload cycles.

The `botSessions` and credential collections use camelCase field names to mirror the Prisma schema. The `user` collection uses the name `user` (singular) to match better-auth's convention; a fallback to `users` (plural) is included in `listAll()` to handle alternative better-auth MongoDB configurations.

Atlas M0/M2/M5 free-tier clusters do not support multi-document transactions. All BotRepo operations are intentionally non-transactional to ensure compatibility with the free tier.

### NeonDB Adapter (`adapters/neondb/`)

Uses `pg` (node-postgres) with connection pooling via `pg.Pool`. Neon's official guidance for long-lived Node.js server processes recommends `pg` over the `@neondatabase/serverless` driver — the serverless driver is designed for stateless edge runtimes where TCP connections cannot persist.

The `normalizeConnectionString()` function strips `sslmode`, `channel_binding`, and `uselibpqcompat` query parameters from the connection URL before passing it to Pool, because `pg-connection-string` v2 cannot parse these Neon-specific params without corrupting the database name field.

Schema initialization is handled by `initDb()`, which runs all `CREATE TABLE IF NOT EXISTS` DDL on boot. The resulting `dbReady: Promise<void>` is exported and awaited in `packages/cat-bot/src/engine/app.ts` before any session or credential queries land. For non-NeonDB adapters, `dbReady` is `undefined` and the await is a zero-cost no-op.

The NeonDB schema uses snake_case column names for all bot tables and camelCase column names for better-auth tables (`"emailVerified"`, `"createdAt"`, `"updatedAt"`, etc.) — better-auth's Kysely PostgresDialect writes camelCase field names directly to PostgreSQL.

### Prisma-SQLite Adapter (`adapters/prisma-sqlite/`)

The default adapter when `DATABASE_TYPE` is unset. Powered by Prisma v7 with the `@prisma/adapter-better-sqlite3` driver adapter.

The `client.ts` singleton resolves the SQLite file path to an absolute path anchored at the database package root, so consumer packages (like `cat-bot`) never accidentally create a stray `dev.db` in their own working directory. Seven SQLite performance PRAGMAs are applied once per process via a `globalThis.prismaReady` flag: WAL journal mode, NORMAL synchronization, 64 MB page cache, in-memory temp store, 256 MB mmap, 30 s busy timeout, and foreign key enforcement. These are applied through Prisma's `$executeRawUnsafe` interface because Prisma v7's `PrismaBetterSqlite3` adapter accepts only a URL string with no access to the underlying `Database` instance.

`prisma.config.ts` uses the Prisma v7 `defineConfig` API to specify the schema path, migrations path, and datasource URL separately from `schema.prisma` (which declares only the driver and output path).

---

## Dynamic Adapter Selection

`src/index.ts` reads `DATABASE_TYPE` at module evaluation time and dynamic-imports the appropriate barrel:

```
DATABASE_TYPE=json         → src/json.ts         → adapters/json/src/
DATABASE_TYPE=mongodb      → src/mongodb.ts       → adapters/mongodb/src/
DATABASE_TYPE=neondb       → src/neondb.ts        → adapters/neondb/src/
(unset or prisma-sqlite)   → src/prisma-sqlite.ts → adapters/prisma-sqlite/src/
```

Using `await import()` instead of static imports means the Prisma client and its generated files are never evaluated when `DATABASE_TYPE=json`. This is critical because `@prisma/client` cannot be imported if `prisma generate` has not been run — the dynamic import isolates that failure to the adapter selection call site rather than crashing the process at module evaluation.

The `tsconfig.json` at the database package root uses `rootDirs` to merge all four adapter source trees into a single virtual root. This allows `src/index.ts` to use relative imports to adapter files at compile time while keeping each adapter's own `tsconfig.json` independent.

---

## Migration Scripts (`scripts/`)

The twelve migration scripts in `scripts/` provide bidirectional data portability between all four adapters (12 = 4 sources × 3 destinations). Each script reads the full dataset from the source adapter and bulk-writes it to the destination adapter. All scripts are invoked via `tsx` and are registered as `npm run migrate:*` commands in the database `package.json`.

Migration scripts are intended for one-time data transfer operations when switching the active adapter for an existing deployment — they are not part of the normal boot sequence.

---

## Better-Auth Integration

Better-auth requires access to the database to manage `user`, `session`, `account`, and `verification` tables. Integration is handled in `packages/cat-bot/src/server/lib/better-auth.lib.ts`, not inside the database package itself. The integration strategy differs per adapter:

```
prisma-sqlite  → betterAuth({ database: prismaAdapter(prisma, { provider: 'sqlite' }) })
                 The exported `prisma` singleton is passed directly to better-auth's Prisma adapter
json           → betterAuth({ database: customAdapter })
                 better-auth-adapter.lib.ts implements the full CustomAdapter contract using getDb/saveDb
mongodb        → betterAuth({ database: mongodbAdapter(mongoClient, { dbName: MONGO_DATABASE_NAME }) })
                 The exported mongoClient is passed to better-auth's MongoDB adapter
neondb         → betterAuth({ database: pool })
                 The exported pg.Pool is passed directly; better-auth uses Kysely's PostgresDialect internally
```

The four better-auth tables (`user`, `session`, `account`, `verification`) are defined alongside the bot tables in every adapter's schema so auth and bot data coexist in the same database file, connection, or cluster.

---

## Key Design Decisions

**No caching in the database package.** Every function returns raw database results with no in-memory layer. The LRU cache that wraps these functions lives entirely in `packages/cat-bot/src/engine/repos/`. This separation means the cache strategy can change without touching adapter code, and migration scripts can read raw data without inadvertently operating on stale cached values.

**Static barrels for compile-time types, dynamic import for runtime isolation.** Each `src/*.ts` barrel (`json.ts`, `mongodb.ts`, etc.) is a static module that TypeScript resolves at compile time. This gives the rest of the codebase full type safety. The `src/index.ts` entry point wraps the import in `await import()` so only the active adapter's module graph is evaluated at runtime.

**Adapter-parallel structure.** Each adapter has an identical directory layout (`cat-bot/` subdirectory for bot repos, `server/` subdirectory for server-side repos). Adding a new repository function requires one file per adapter plus one re-export line in `src/index.ts` — no other files change.

**DEFAULT_DB backfill in the JSON adapter.** Rather than requiring a schema migration script whenever a new table is added, the JSON adapter's `store.ts` spreads `DEFAULT_DB` under the parsed file content. New tables are silently initialized as empty arrays on first read of an older `database.json`. This makes the JSON adapter effectively schema-migration-free at the cost of a slightly larger initial object allocation.

**Prisma-generated types as the canonical type source.** The `src/prisma-sqlite.ts` barrel re-exports `export * from '../adapters/prisma-sqlite/src/index.js'`, which includes all generated Prisma model types. All four adapters conform to these types at the function signature level. This means the application has a single authoritative set of types even when running a non-Prisma adapter at runtime.

**Explicit `lastUpdatedAt` management across adapters.** Prisma's `@updatedAt` decorator only advances when at least one field is written in an update payload. The empty-update upsert pattern (`upsert({ update: {} })`) used for session deduplication would freeze `lastUpdatedAt` at creation time, causing every subsequent message to appear stale. All adapters explicitly set `lastUpdatedAt: new Date()` (Prisma/JSON) or `SET last_updated_at = NOW()` (NeonDB) on every upsert to ensure the middleware's staleness check works correctly.
