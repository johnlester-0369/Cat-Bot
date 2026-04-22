# Cat-Bot — Monorepo Architecture

## Overview

Cat-Bot is a multi-platform bot framework that runs concurrently on Discord, Telegram, Facebook Messenger, and Facebook Page inside a single Node.js process. The project is organized as an ESM TypeScript monorepo with three independent packages: the bot engine and HTTP management server (`cat-bot`), the raw data persistence layer (`database`), and the React management dashboard (`web`).

The three packages have a strict one-directional dependency chain: `web` communicates with `cat-bot` exclusively over HTTP, `cat-bot` imports `database` as a local file package, and `database` has no knowledge of either consumer. This separation means the persistence backend can be swapped (SQLite ↔ MongoDB ↔ PostgreSQL ↔ JSON) without touching a single line of engine or dashboard code.

---

## Monorepo Structure

```
Cat-Bot/
│
├── packages/
│   ├── cat-bot/                         — Bot engine + HTTP management server
│   │   ├── agent/                       — AI agent system prompt (Groq-powered ReAct loop)
│   │   ├── examples/                    — Reference command and event module implementations
│   │   ├── scripts/                     — Admin seeding and password reset utilities
│   │   └── src/
│   │       ├── engine/                  — Core bot runtime (adapters, middleware, controllers, repos)
│   │       └── server/                  — Express REST API + Socket.IO for the web dashboard
│   │
│   ├── database/                        — Raw database adapter implementations; no caching
│   │   ├── adapters/
│   │   │   ├── json/                    — In-memory JSON flat-file store; zero runtime dependencies
│   │   │   ├── mongodb/                 — MongoDB driver adapter
│   │   │   ├── neondb/                  — Neon PostgreSQL adapter (node-postgres)
│   │   │   └── prisma-sqlite/           — Prisma v7 + better-sqlite3 (default)
│   │   ├── scripts/                     — Twelve bidirectional cross-adapter migration scripts
│   │   └── src/
│   │       └── index.ts                 — Unified export surface; consumers always import from 'database'
│   │
│   └── web/                             — Vite + React 19 management dashboard SPA
│       └── src/
│           ├── components/ui/           — Design system component library (Material Design 3 tokens)
│           ├── contexts/                — Auth, theme, and snackbar global state
│           ├── features/                — Domain-scoped hooks, services, and components
│           ├── guards/                  — Route-level auth enforcement
│           ├── lib/                     — API client, Socket.IO client, better-auth client singletons
│           ├── pages/                   — Route-level page components
│           └── routes/                  — React Router v7 browser router configuration
│
├── docs/
│   ├── ARCHITECTURE.md                  — This file — monorepo-level overview
│   ├── cat-bot/
│   │   ├── ARCHITECTURE.md              — Engine and server sub-system detail
│   │   └── adapters/
│   │       ├── DISCORD_ARCHITECTURE.md
│   │       ├── TELEGRAM_ARCHITECTURE.md
│   │       ├── FACEBOOK-MESSENGER_ARCHITECTURE.md
│   │       ├── FACEBOOK-PAGE_ARCHITECTURE.md
│   │       └── MODELS_ARCHITECTURE.md
│   ├── database/
│   │   └── ARCHITECTURE.md
│   └── web/
│       └── ARCHITECTURE.md
│
└── package.json                         — Workspace root; packages are standalone (no npm workspaces hoisting)
```

---

## Cross-Package Dependency Map

`web` never imports from `database` or `cat-bot` source code. All data access goes through the `cat-bot` HTTP API, which the Vite dev server proxies same-origin.

```
packages/web/
  └── vite.config.ts proxy: /api/* → http://localhost:3000
      └── packages/cat-bot/src/server/   (REST + Socket.IO)
              └── package.json: "database": "file:../database"
                      └── packages/database/src/index.ts   (active adapter, selected by DATABASE_TYPE env var)
```

At production build time, `cat-bot` serves the compiled `web/dist/` as static files from the same Express process, making the whole system a single deployable unit.

---

## `packages/cat-bot/` — Bot Engine and Server

```
src/
├── engine/
│   ├── app.ts                       — Process entry point; loads commands and events, wires platform
│   │                                  listeners, starts the HTTP server, owns OS signal handlers
│   │
│   ├── adapters/                    — Platform transport and unified data contract layers
│   │   ├── models/                  — Shared vocabulary: abstract API class, context factories,
│   │   │                              event discriminated union, thread/user info shapes, enums, prototypes
│   │   └── platform/                — One transport per supported platform
│   │       ├── index.ts             — Unified aggregator; calls startSessionWithRetry() per session config
│   │       ├── discord/             — discord.js gateway transport
│   │       ├── telegram/            — Telegraf long-poll or webhook transport
│   │       ├── facebook-messenger/  — fca-unofficial MQTT transport
│   │       └── facebook-page/       — Graph API webhook transport (stateless)
│   │
│   ├── middleware/                  — Express-style pipeline registered once at boot; runs on every event
│   │   ├── on-command.middleware.ts — Ban enforcement, role permission, cooldown, option parsing
│   │   ├── on-chat.middleware.ts    — Thread and user DB sync on every message
│   │   ├── on-reply.middleware.ts   — Reply flow guards
│   │   ├── on-react.middleware.ts   — Reaction flow guards
│   │   └── on-button-click.middleware.ts — Button scope ownership enforcement
│   │
│   ├── controllers/                 — Entry points and routing for all event types
│   │   ├── handlers/                — message.handler.ts and event.handler.ts (platform event entry points)
│   │   ├── dispatchers/             — command, event, reply, react, button dispatchers
│   │   ├── factories/               — ctx.factory.ts: assembles the BaseCtx injected into every handler
│   │   └── on-chat-runner.ts        — Deduplicates and fans out to every command's onChat handler
│   │
│   ├── lib/                         — Stateful singleton utilities: state store, cooldown, middleware
│   │                                  registry, module registry, LRU cache, db-collection, currencies,
│   │                                  button-context, retry-with-backoff
│   │
│   ├── repos/                       — LRU cache wrappers over the 'database' package; this is the only
│   │                                  layer that owns caching — users, threads, banned, credentials,
│   │                                  session, system-admin, webhooks
│   │
│   ├── services/                    — Orchestration: fetch from platform API then persist to database
│   │                                  (threads.service.ts, users.service.ts)
│   │
│   ├── models/                      — Data mappers: UnifiedInfo shapes → database record shapes
│   │
│   ├── modules/                     — Domain sub-modules: command parsing, logger, options, platform
│   │                                  constants, prefix manager, session loader and manager
│   │
│   ├── agent/                       — Groq-powered ReAct loop; tools: help, execute_command, test_command
│   │
│   ├── config/
│   │   └── env.config.ts            — Validated EnvConfig singleton; fails fast on missing required vars
│   │
│   ├── constants/                   — Role, ButtonStyle, MessageStyle enums
│   ├── types/                       — BaseCtx, AppCtx, NativeContext, middleware and module-config types
│   └── utils/                       — Pure utilities: URL builder, AES-256-GCM crypto, markdown-to-text,
│                                      stream helpers, platform capability check, usage builder
│
└── server/
    ├── server.ts                    — HTTP server bootstrap; Socket.IO attached to raw http.Server
    ├── app.ts                       — Express app factory; strict middleware registration order
    │                                  (CORS → better-auth → body parsers → routes → SPA static serve)
    ├── routes/v1/                   — Versioned REST API: bots, admin, validation, facebook-page, webhook
    ├── controllers/                 — Request handlers; enforce auth then delegate to services/repos
    ├── services/
    │   └── bot.service.ts           — Bot lifecycle orchestration (create, start, stop, restart, delete)
    ├── repos/
    │   └── bot.repo.ts              — LRU-cached DB reads for dashboard list and detail views
    ├── socket/                      — Socket.IO handlers: bot status monitor, log relay, FB Page validation
    ├── lib/
    │   ├── better-auth.lib.ts       — Two independent auth instances: user portal + admin portal
    │   └── better-auth-adapter.lib.ts — JSON file adapter for better-auth when DATABASE_TYPE=json
    ├── dtos/                        — Request and response type contracts
    └── utils/
        └── hash.util.ts             — Deterministic webhook secret utilities for Facebook Page
```

**Application modules** (user-authored bot logic loaded dynamically at startup):

```
src/app/
├── commands/                        — One file per command module; exports config + onCommand/onChat/onReply/onReact/button
└── events/                          — One file per event module; exports config (eventType[]) + onEvent
```

---

## `packages/database/` — Data Persistence Layer

```
src/
└── index.ts                         — Entry point: reads DATABASE_TYPE, dynamic-imports the correct barrel,
                                       re-exports every function individually so consumers are adapter-agnostic

adapters/
├── json/
│   └── src/
│       ├── store.ts                 — getDb()/saveDb(); DEFAULT_DB backfill makes schema evolution backward-compatible
│       ├── cat-bot/                 — banned, credentials, threads, users, session-commands, session-events, webhooks repos
│       └── server/                  — bot repo (BotRepo class), system-admin repo
│
├── mongodb/
│   └── src/
│       ├── client.ts                — MongoClient singleton with globalThis hot-reload guard
│       ├── cat-bot/                 — same repo surface as json adapter
│       └── server/                  — bot repo, system-admin repo
│
├── neondb/
│   └── src/
│       ├── client.ts                — pg.Pool singleton; normalizes Neon-specific connection string params
│       ├── schema.sql               — standalone DDL file; initDb() runs this at boot via dbReady: Promise<void>
│       ├── index.ts                 — exports pool, initDb, dbReady alongside all repos
│       ├── cat-bot/                 — same repo surface; explicit BEGIN/COMMIT transactions for atomicity
│       └── server/                  — bot repo, system-admin repo
│
└── prisma-sqlite/
    ├── prisma/
    │   └── schema.prisma            — Authoritative schema (BotUser, BotThread, BotSession, BotCredential*,
    │                                  BotAdmin, BotPremium, BotSessionCommand, BotSessionEvent,
    │                                  BotUserBanned, BotThreadBanned, SystemAdmin, FbPageWebhook,
    │                                  better-auth tables: user, session, account, verification)
    ├── src/
    │   ├── client.ts                — PrismaClient singleton; seven SQLite performance PRAGMAs on boot (WAL, synchronous=NORMAL, cache_size, temp_store, mmap_size, busy_timeout, foreign_keys=ON)
    │   ├── index.ts                 — exports prisma client + all generated Prisma types
    │   ├── generated/prisma/        — Prisma-generated client (gitignored; rebuilt via `prisma generate`)
    │   ├── cat-bot/                 — same repo surface as other adapters
    │   └── server/                  — bot repo, system-admin repo
    └── prisma.config.ts             — Prisma v7 defineConfig: schema path, migrations path, datasource URL

scripts/                             — Twelve bidirectional migration scripts (json↔sqlite↔mongodb↔neondb)
```

All four adapters expose the same named export surface. The `src/index.ts` dynamic import isolates adapter module graphs — the Prisma client is never evaluated when `DATABASE_TYPE=json`.

---

## `packages/web/` — Management Dashboard

```
src/
├── main.tsx                         — Bootstrap: synchronous theme init, provider tree, mount to #root
├── App.tsx                          — RouterProvider wrapper
│
├── routes/
│   └── router.tsx                   — Three sibling top-level route trees (public shell, dashboard, admin)
│                                      All page bundles are lazy-loaded; initial payload is layout shells only
│
├── components/
│   ├── layout/
│   │   └── Layout.tsx               — Public shell for marketing and auth routes
│   └── ui/                          — Design system: buttons, data-display, feedback, forms,
│                                      navigation, overlay, typography components
│                                      All components reference CSS custom property tokens; Tailwind is
│                                      a utility layer on top — no hardcoded color values in components
│
├── contexts/
│   ├── ThemeContext.tsx             — Light/dark state; toggles .dark on <html>; persists to localStorage
│   ├── UserAuthContext.tsx          — User portal session (better-auth.session_token cookie)
│   ├── AdminAuthContext.tsx         — Admin portal session (ba-admin.session_token; scoped to admin subtree)
│   └── SnackbarContext.tsx          — Global toast; one-at-a-time Material Design convention
│
├── guards/                          — UserProtectedRoute, PublicRoute, AdminProtectedRoute, AdminPublicRoute
│
├── lib/
│   ├── api-client.lib.ts            — fetch singleton; credentials: include; AbortController timeout
│   ├── better-auth-client.lib.ts    — User portal auth client (basePath: /api/auth)
│   ├── better-auth-admin-client.lib.ts — Admin portal auth client (basePath: /api/admin-auth)
│   └── socket.lib.ts               — Socket.IO client singleton; lazy connect; withCredentials: true
│
├── features/
│   ├── admin/                       — Admin portal: AdminSidebarLayout, useAdminBots, admin.service
│   └── users/                       — User portal: DashboardLayout, DashboardBotLayout, PlatformFieldInputs,
│                                      hooks (useBotList, useBotDetail, useBotCreate, useBotUpdate,
│                                      useBotCommands, useBotEvents, useBotStatus, useBotLogs,
│                                      useBotValidation, useFbWebhook), services (bot, validation, webhook)
│
├── pages/
│   ├── Home.tsx, Login.tsx, Signup.tsx
│   ├── admin/                       — Admin login, dashboard overview, users table, bots table, settings
│   └── dashboard/                   — Bot manager, settings, create-new-bot wizard, bot detail tabs
│                                      (console with live log stream, commands toggle, events toggle, settings)
│
├── constants/
│   ├── platform.constants.ts        — Mirrors cat-bot engine platform identifiers (discord, telegram, etc.)
│   └── routes.constants.ts          — ROUTES (absolute) and ROUTE_SEGMENTS (relative); one-file rename
│
└── styles/
    ├── globals.css                  — PostCSS entry; imports all layers in dependency order
    ├── theme/                       — light.css and dark.css CSS custom property definitions
    ├── tokens.css                   — Typography, spacing, motion, z-index, shadows, state-layer opacities
    ├── base.css                     — HTML element defaults; global scrollbar; focus-visible ring
    ├── utilities.css                — Custom scrollbar utility classes
    └── animations.css               — @keyframes library (30+ named animations)
```

---

## Platform Event Model

Every platform adapter produces a uniform payload shape emitted on a shared EventEmitter. All five event types are emitted by all adapters; transports that cannot produce a given type simply never emit it.

```
PlatformEmitter event types and their payloads:

├── 'message'           — { api: UnifiedApi, event: UnifiedEvent, native: NativeContext }
│                         Standard text or attachment message; prefix-based command routing
│
├── 'message_reply'     — { api, event (with messageReply inner object), native }
│                         User quoted an existing message; reply-state flow routing
│
├── 'event'             — { api, event (logMessageType keyed), native }
│                         Thread membership and administrative events
│                         (log:subscribe, log:unsubscribe, log:thread-name, etc.)
│
├── 'message_reaction'  — { api, event, native }
│                         Emoji reaction; react-state flow routing
│
├── 'message_unsend'    — { api, event, native }
│                         Message retracted by sender
│
└── 'button_action'     — { api, event (buttonId = commandName:buttonId), native }
│                         Interactive button click, callback query, or postback
```

The `UnifiedApi` abstract class is the platform write surface. Every platform wrapper overrides the methods its transport supports; unsupported operations throw descriptive errors. Command and event modules never import platform-specific types — they call `ctx.chat.replyMessage()`, `ctx.thread.setName()`, etc., and the adapter underneath handles the rest.

---

## Boot Sequence

`packages/cat-bot/src/engine/app.ts` is the process entry point. On startup it runs these phases in order:

1. **Environment validation** — `env.config.ts` reads and validates all required environment variables; throws immediately on any missing required variable before any other module evaluates.

2. **Database readiness** — If `DATABASE_TYPE=neondb`, awaits `dbReady` (the schema-init Promise). For all other adapters, `dbReady` is `undefined` and this step is a zero-cost no-op.

3. **Module loading** — `loadCommands()` and `loadEventModules()` dynamically import every `.js`/`.ts` file from `src/app/commands/` and `src/app/events/`. Invalid or incomplete modules are skipped with a warning so one broken command never prevents startup.

4. **Session loading** — `loadSessionConfigs()` queries the database for all active credentials across all four platforms.

5. **Command/event sync** — `syncCommandsAndEvents()` upserts command and event module names into the database for every active session, enabling the web dashboard to list and toggle them without knowing which modules are installed.

6. **Middleware registration** — The side-effect import of `src/engine/middleware/index.ts` populates the `MiddlewareRegistry` before any transport starts.

7. **Platform listener creation** — `createUnifiedPlatformListener()` constructs the per-platform transports. Each session wraps in `startSessionWithRetry()` with exponential backoff; a permanent auth error stops retrying immediately.

8. **Event wiring** — `platform.on('message')`, `platform.on('event')`, etc. are registered. Transports then call `.start(commands)` and begin emitting events.

9. **HTTP server start** — `startServer()` boots Express, attaches Socket.IO to the raw `http.Server`, and begins accepting dashboard and webhook connections.

---

## Middleware Pipeline

Every incoming platform event that reaches the controller layer runs through a chain registered at startup via `MiddlewareRegistry`. The chain runs in middleware order and short-circuits on rejection.

```
onCommand chain:
├── enforceNotBanned       — checks isUserBanned and isThreadBanned; rejects banned senders
├── enforcePermission      — checks sender role against config.role (ANYONE/THREAD_ADMIN/BOT_ADMIN/PREMIUM/SYSTEM_ADMIN)
├── enforceCooldown        — per-user cooldown; config.cooldown controls the window in seconds
└── validateCommandOptions — parses and type-checks command options against config.options[]

onChat chain:
├── chatPassthrough        — upserts user and thread records into the database on every message
└── chatLogThread          — logs thread activity for debug purposes

onReply chain:
└── replyStateValidation   — passthrough placeholder for reply-flow guards

onReact chain:
└── reactStateValidation   — passthrough placeholder for reaction-flow guards

onButtonClick chain:
└── enforceButtonScope     — tilde-scope (~) ownership check; prevents cross-user button hijacking
```

---

## Authentication Architecture

Two independent `betterAuth()` instances share the same database adapter but use separate cookie names, separate base paths, and separate server instances. This makes the user portal and admin portal session surfaces structurally isolated — a compromised user-portal session has zero leverage on admin endpoints.

```
User portal
├── basePath:  /api/auth (default)
├── Cookie:    better-auth.session_token
└── Scoped to: entire app (UserAuthProvider in main.tsx)

Admin portal
├── basePath:  /api/admin-auth
├── Cookie:    ba-admin.session_token
└── Scoped to: admin route subtree only (AdminAuthProvider inside AdminLayout in router.tsx)
```

---

## Documentation Index

Each sub-system has detailed architecture documentation:

| Document | Contents |
|---|---|
| `docs/cat-bot/ARCHITECTURE.md` | Full engine and server module tree with per-file annotations, database access pattern, platform adapter pattern, command and event module contract, key architectural invariants |
| `docs/cat-bot/adapters/MODELS_ARCHITECTURE.md` | Unified data contract layer — `UnifiedApi`, context factories, event discriminated union, prototypes, four-layer dependency stack |
| `docs/cat-bot/adapters/DISCORD_ARCHITECTURE.md` | Discord.js transport — slash command idempotency, dual-path API design, boot sequence, event routing |
| `docs/cat-bot/adapters/TELEGRAM_ARCHITECTURE.md` | Telegraf transport — MarkdownV2 pipeline, four-scope slash menu management, pre-launch token validation |
| `docs/cat-bot/adapters/FACEBOOK-MESSENGER_ARCHITECTURE.md` | fca-unofficial MQTT transport — reconnect strategy, dynamic import isolation, database name delegation |
| `docs/cat-bot/adapters/FACEBOOK-PAGE_ARCHITECTURE.md` | Graph API webhook transport — stateless design, two attachment shape mappers, Button Template strategy |
| `docs/database/ARCHITECTURE.md` | All four adapter implementations, dynamic adapter selection, migration scripts, better-auth integration per adapter |
| `docs/server/ARCHITECTURE.md` | Express registration order, dual better-auth instances, Socket.IO auth middleware, DB-first lifecycle ordering, cache cross-invalidation |
| `docs/web/ARCHITECTURE.md` | Routing architecture, feature-based directory structure, design system token layers, real-time Socket.IO pattern, polymorphic component system |
