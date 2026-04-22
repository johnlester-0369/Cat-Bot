# Cat-Bot — System Architecture

## Overview

Cat-Bot is a multi-platform bot framework that runs simultaneously on Discord, Telegram, Facebook Messenger, and Facebook Page under a single process. The system is organized as an ESM TypeScript monorepo with three packages: `cat-bot` (the bot engine and HTTP server), `database` (raw data adapters), and `web` (the management dashboard).

The runtime event flow follows a strict three-stage pipeline:

```
[Platform Transport] → [Middleware Chain] → [Controller Dispatch]
```

Every incoming message or event from any platform passes through this pipeline identically. Platform differences are absorbed at the transport layer; everything above it sees only unified types.

---

## Monorepo Package Layout

```
Cat-Bot/
│
└── packages/
    │
    ├── cat-bot/                         ← Bot engine + HTTP management server
    │   ├── src/
    │   │   ├── engine/                  ← Core runtime: adapters, middleware, controllers
    │   │   └── server/                  ← Express REST API + Socket.IO for the dashboard
    │   ├── examples/                    ← Reference command and event module implementations
    │   └── agent/                       ← AI agent system prompt
    │
    ├── database/                        ← Raw database adapter implementations (no cache)
    │   ├── adapters/
    │   │   ├── json/                    ← In-memory JSON file store
    │   │   ├── mongodb/                 ← MongoDB adapter
    │   │   ├── neondb/                  ← Neon PostgreSQL adapter
    │   │   └── prisma-sqlite/           ← Prisma + better-sqlite3 adapter (default)
    │   ├── scripts/                     ← Cross-adapter data migration scripts
    │   └── src/
    │       └── index.ts                 ← Unified export surface; consumers import from 'database'
    │
    └── web/                             ← Vite + React management dashboard
```

---

## Engine Layer (`packages/cat-bot/src/engine/`)

The engine is the entire bot runtime. It owns platform lifecycle, event routing, middleware execution, command dispatch, and database access. It is divided into eight sub-systems.

```
src/engine/
│
└── app.ts                               ← Process entry point and orchestration root
    │                                      Loads commands and events from src/app/
    │                                      Creates the unified platform listener
    │                                      Wires all platform EventEmitter handlers
    │                                      Starts the HTTP management server
    │                                      Owns SIGINT / SIGTERM / uncaughtException / unhandledRejection handlers
    │
    ├── adapters/                        ← Platform transport + unified contract layer
    │   │
    │   ├── models/                      ← Unified data contract (the shared vocabulary)
    │   │   ├── api.model.ts             ← UnifiedApi abstract class — every platform extends this
    │   │   ├── context.model.ts         ← Six factory functions producing ctx.thread / ctx.chat /
    │   │   │                              ctx.bot / ctx.user / ctx.state / ctx.button
    │   │   ├── event.model.ts           ← UnifiedEvent discriminated union + formatEvent() normalizer
    │   │   ├── thread.model.ts          ← UnifiedThreadInfo shape + createUnifiedThreadInfo() factory
    │   │   ├── user.model.ts            ← UnifiedUserInfo shape + createUnifiedUserInfo() factory
    │   │   ├── enums/                   ← EventType, AttachmentType, LogMessageType const objects
    │   │   ├── interfaces/              ← SendPayload, ReplyMessageOptions, ButtonItem, context interfaces
    │   │   └── prototypes/              ← Frozen canonical event and attachment reference shapes
    │   │
    │   └── platform/                    ← One directory per supported transport
    │       ├── index.ts                 ← Unified platform aggregator; calls startSessionWithRetry()
    │       │                              for each session config; returns single EventEmitter
    │       ├── discord/                 ← Discord.js transport (see DISCORD_ARCHITECTURE.md)
    │       ├── telegram/                ← Telegraf transport (see TELEGRAM_ARCHITECTURE.md)
    │       ├── facebook-messenger/      ← fca-unofficial MQTT transport (see FACEBOOK-MESSENGER_ARCHITECTURE.md)
    │       └── facebook-page/           ← Graph API webhook transport (see FACEBOOK-PAGE_ARCHITECTURE.md)
    │
    ├── middleware/                      ← Express-style middleware pipeline (registered once at boot)
    │   ├── index.ts                     ← Pipeline wiring — registers all default middlewares
    │   │                                  onCommand: enforceNotBanned → enforcePermission →
    │   │                                             enforceCooldown → validateCommandOptions
    │   │                                  onChat:    chatPassthrough → chatLogThread
    │   │                                  onReply:   replyStateValidation
    │   │                                  onReact:   reactStateValidation
    │   │                                  onButtonClick: enforceButtonScope
    │   ├── on-command.middleware.ts     ← Ban enforcement, role permission gates, cooldown, option parsing
    │   ├── on-chat.middleware.ts        ← Thread + user DB sync on every message (chatPassthrough)
    │   ├── on-reply.middleware.ts       ← Passthrough placeholder for reply flow guards
    │   ├── on-react.middleware.ts       ← Passthrough placeholder for reaction flow guards
    │   └── on-button-click.middleware.ts ← Tilde-scope ownership enforcement for button interactions
    │
    ├── controllers/                     ← Entry points and routing layer for all event types
    │   ├── index.ts                     ← Public barrel — app.ts and platform adapters import from here
    │   ├── handlers/
    │   │   ├── message.handler.ts       ← Entry point for 'message' and 'message_reply' events
    │   │   │                              Runs onChat fan-out → onReply check → prefix parse → command dispatch
    │   │   └── event.handler.ts         ← Entry point for 'event', 'message_reaction', 'message_unsend'
    │   │                                  Checks onReact state → dispatches by logMessageType
    │   ├── dispatchers/
    │   │   ├── command.dispatcher.ts    ← Resolves mod.onCommand; runs onCommand middleware chain
    │   │   ├── event.dispatcher.ts      ← Fans out to all registered onEvent handlers for an event type
    │   │   ├── reply.dispatcher.ts      ← Matches quoted-reply to pending onReply state; runs onReply chain
    │   │   ├── react.dispatcher.ts      ← Matches reaction to pending onReact state; runs onReact chain
    │   │   └── button.dispatcher.ts     ← Routes button_action to mod.button[id].onClick();
    │   │                                  also handles FB Messenger text-menu fallback via numbered replies
    │   ├── factories/
    │   │   └── ctx.factory.ts           ← buildBaseCtx() — single source of truth for BaseCtx construction
    │   │                                  assembles api / thread / chat / bot / user / logger / db / startTime
    │   ├── utils/
    │   │   └── state-lookup.util.ts     ← Three-scope state key resolution (private → public → legacy)
    │   └── on-chat-runner.ts            ← Deduplicates and fans out to every command's onChat handler
    │
    ├── lib/                             ← Stateful singleton utilities used by middleware and dispatchers
    │   ├── state.lib.ts                 ← In-memory stateStore Map for pending onReply / onReact flows
    │   ├── cooldown.lib.ts              ← Per-user command rate-limit tracker (CooldownStore)
    │   ├── middleware.lib.ts            ← MiddlewareRegistry singleton + runMiddlewareChain() runner
    │   ├── module-registry.lib.ts       ← commandRegistry / eventRegistry Maps (populated at boot)
    │   ├── lru-cache.lib.ts             ← Shared 2000-entry LRU cache used by all repo wrappers
    │   ├── db-collection.lib.ts         ← Rich dot-path CRUD surface over bot_users_session.data JSON blob
    │   ├── currencies.lib.ts            ← Economy API (getMoney / increaseMoney / decreaseMoney) built on db-collection
    │   ├── button-context.lib.ts        ← In-memory button context and dynamic override store
    │   └── retry.lib.ts                 ← withRetry() with exponential backoff; isAuthError / isNetworkError classifiers
    │
    ├── repos/                           ← LRU cache wrappers over the 'database' package (cat-bot's caching layer)
    │   ├── users.repo.ts                ← Cached: upsertUser, userExists, getUserName, getUserSessionData, etc.
    │   ├── threads.repo.ts              ← Cached: upsertThread, isThreadAdmin, getThreadSessionData, etc.
    │   ├── banned.repo.ts               ← Cached: isUserBanned, isThreadBanned (write-through on ban/unban)
    │   ├── credentials.repo.ts          ← Cached: isBotAdmin, isBotPremium, findAll*Credentials, etc.
    │   ├── session.repo.ts              ← Cached: getBotNickname
    │   ├── system-admin.repo.ts         ← Cached: isSystemAdmin (single Set<string> key for all admins)
    │   └── webhooks.repo.ts             ← Cached: getFbPageWebhookVerification
    │
    ├── services/                        ← Orchestration: fetch from platform API → persist to database
    │   ├── threads.service.ts           ← syncThreadAndParticipants(): getFullThreadInfo → upsertThread + upsertThreadSession
    │   └── users.service.ts             ← syncUser() / syncUsers(): getFullUserInfo → upsertUser + upsertUserSession
    │
    ├── models/                          ← Data mappers: UnifiedInfo shapes → database record shapes
    │   ├── threads.model.ts             ← toBotThreadData(): UnifiedThreadInfo → BotThreadData
    │   └── users.model.ts               ← toBotUserData(): UnifiedUserInfo → BotUserData
    │
    ├── modules/                         ← Domain-specific engine sub-modules
    │   ├── command/
    │   │   ├── command-parser.util.ts   ← Prefix stripping and token extraction (pure function)
    │   │   ├── command-suggest.util.ts  ← Dice's Coefficient bigram matcher for "did you mean?" suggestions
    │   │   ├── command-hash.util.ts     ← SHA-256 fingerprint of loaded commands for slash-menu idempotency
    │   │   └── command-option.constants.ts ← OptionType registry ('string' | 'user')
    │   ├── logger/
    │   │   ├── logger.lib.ts            ← Winston logger instance + createLogger() factory
    │   │   ├── session-logger.lib.ts    ← Chalk-based per-session logger (bypasses Winston transport pipeline)
    │   │   └── log-relay.lib.ts         ← EventEmitter bridge from Winston → Socket.IO; 100-entry sliding window
    │   ├── options/
    │   │   ├── options-map.lib.ts       ← OptionsMap class (immutable, case-insensitive key→value)
    │   │   └── options.util.ts          ← parseTextOptions() / validateOptions() (pure functions)
    │   ├── platform/
    │   │   ├── platform.constants.ts    ← Platforms enum, PLATFORM_TO_ID / ID_TO_PLATFORM registries
    │   │   ├── platform-id.util.ts      ← toPlatformNumericId() / fromPlatformNumericId()
    │   │   └── platform-filter.util.ts  ← isPlatformAllowed() — enforces config.platform[] allowlists
    │   ├── prefix/
    │   │   ├── prefix-manager.lib.ts    ← In-memory session + thread prefix store; PrefixManager singleton
    │   │   └── slash-sync.lib.ts        ← Registry for live slash-command re-registration callbacks
    │   └── session/
    │       ├── session-loader.util.ts   ← Loads all platform credentials from DB at boot
    │       ├── session-manager.lib.ts   ← SessionManager: start/stop/restart per session; markActive/markInactive
    │       ├── bot-session-commands.repo.ts ← Re-exports from 'database': upsertSessionCommands, isCommandEnabled
    │       ├── bot-session-events.repo.ts   ← Re-exports from 'database': upsertSessionEvents, isEventEnabled
    │       ├── facebook-page-session.lib.ts ← Registry mapping userId:pageId → PageSessionConfig for webhook routing
    │       └── telegram-webhook.registry.ts ← Registry mapping userId:sessionId → Telegraf RequestListener
    │
    ├── agent/                           ← AI agent subsystem (Groq-powered ReAct loop)
    │   ├── agent.ts                     ← runAgent(): ReAct tool-call loop; loads system_prompt.md at boot
    │   ├── agent.util.ts                ← AgentTool interface; resolveAgentContext() helper
    │   ├── agent-command-guard.lib.ts   ← inspectCommandConstraints(): AI-readable pre-flight constraint check
    │   └── tools/
    │       ├── help.ts                  ← Tool: paginated role-filtered command list (mirrors /help output)
    │       ├── execute_command.ts       ← Tool: executes a command on behalf of the user
    │       └── test_command.ts          ← Tool: dry-runs a command with a proxied API to intercept output
    │
    ├── config/
    │   └── env.config.ts                ← Validated EnvConfig singleton; fails fast on missing required vars
    │
    ├── constants/
    │   ├── role.constants.ts            ← Role enum: ANYONE(0) / THREAD_ADMIN(1) / BOT_ADMIN(2) / PREMIUM(3) / SYSTEM_ADMIN(4)
    │   ├── button-style.constants.ts    ← ButtonStyle enum: PRIMARY / SECONDARY / SUCCESS / DANGER
    │   └── message-style.constants.ts   ← MessageStyle enum: TEXT / MARKDOWN
    │
    ├── types/
    │   ├── controller.types.ts          ← BaseCtx, AppCtx, NativeContext, CommandMap, EventModuleMap, ParsedCommand
    │   ├── middleware.types.ts          ← MiddlewareFn, OnCommandCtx, OnChatCtx, OnReplyCtx, OnReactCtx, OnButtonClickCtx
    │   └── module-config.types.ts       ← CommandConfig, EventConfig, CommandOption typed contracts for module authors
    │
    └── utils/                           ← Pure cross-cutting utility functions
        ├── api.util.ts                  ← createUrl(): builds API URLs from a named provider registry
        ├── crypto.util.ts               ← AES-256-GCM encrypt() / decrypt() for credentials at rest
        ├── md-to-text.util.ts           ← mdToText(): Markdown → styled Unicode plain text for FB platforms
        ├── streams.util.ts              ← bufferToStream, urlToStream, streamToBuffer, getMediaTypeFromPath
        ├── ui-capabilities.util.ts      ← hasNativeButtons(): platform capability check
        └── usage.util.ts                ← createUsage(): builds ctx.usage() bound to a command's config
```

---

## Application Modules (`packages/cat-bot/src/app/`)

The `app/` directory contains the user-authored bot logic loaded dynamically at startup.

```
src/app/
│
├── commands/                            ← One file per command module; loaded by app.ts loadCommands()
│   └── *.ts                             ← Each exports: config (CommandConfig), onCommand?, onChat?,
│                                          onReply?, onReact?, button?
│
└── events/                              ← One file per event module; loaded by app.ts loadEventModules()
    └── *.ts                             ← Each exports: config (EventConfig with eventType[]), onEvent
```

Command and event modules are isolated from the engine internals. They author against `AppCtx` and `CommandConfig` / `EventConfig` types only — no platform-specific imports.

---

## Server Layer (`packages/cat-bot/src/server/`)

The server hosts the bot management dashboard API and the Facebook Page / Telegram webhook receivers.

```
src/server/
│
├── server.ts                            ← startServer(): boots Express; mounts all route groups
├── app.ts                               ← Express app factory; applies CORS, body parsers, better-auth
│
├── routes/v1/                           ← Versioned REST API surface
│   ├── bot.routes.ts                    ← CRUD for bot sessions (create, list, detail, update, delete)
│   │                                      also mounts GET/PUT /:id/commands and /:id/events toggles
│   ├── admin.routes.ts                  ← System admin management (protected by admin role)
│   ├── validation.routes.ts             ← Credential validation endpoints (test token before saving)
│   ├── facebook-page.routes.ts          ← GET/POST webhook handler for Facebook Page events
│   └── webhook.routes.ts                ← Facebook webhook info endpoint (generated URL + verify token)
│
├── controllers/                         ← Request handling; delegates to services and repos
│   ├── bot.controller.ts
│   ├── admin.controller.ts
│   ├── bot-session-config.controller.ts ← Calls triggerSlashSync() after command toggle writes
│   ├── facebook-page.controller.ts
│   ├── validation.controller.ts
│   └── webhook.controller.ts
│
├── services/
│   └── bot.service.ts                   ← Business logic: spawnDynamicSession(), stopSession(), restartSession()
│
├── repos/
│   └── bot.repo.ts                      ← LRU-cached DB reads for bot session detail and list views
│
├── socket/
│   ├── socket.lib.ts                    ← Socket.IO server factory
│   ├── bot-monitor.socket.ts            ← Broadcasts sessionManager status + log relay entries to dashboard
│   └── validation.socket.ts            ← Real-time credential validation feedback during bot setup
│
├── lib/
│   ├── better-auth.lib.ts               ← better-auth instance configuration (email/password + admin plugin)
│   └── better-auth-adapter.lib.ts       ← Wires the active database adapter into better-auth
│
├── models/
│   └── page-session.model.ts            ← PageSessionConfig type used by facebook-page-session.lib.ts
│
├── dtos/                                ← Request body validation shapes
│   ├── bot.dto.ts
│   ├── bot-session-config.dto.ts
│   └── admin.dto.ts
│
└── utils/
    └── hash.util.ts                     ← Webhook secret hashing for Facebook Page verification
```

---

## Database Layer (`packages/database/`)

The `database` package contains raw repository implementations with no caching. Cat-bot's `src/engine/repos/` files wrap these with an LRU cache layer. All consumers `import from 'database'` — the active adapter is selected at runtime via the `DATABASE_TYPE` environment variable.

```
packages/database/
│
├── src/
│   └── index.ts                         ← Unified export surface; re-exports from the active adapter
│                                          Resolved at build time or via tsx --conditions source
│
└── adapters/
    │
    ├── prisma-sqlite/                   ← Default adapter; Prisma v7 + better-sqlite3
    │   ├── prisma/
    │   │   └── schema.prisma            ← Authoritative schema: BotUser, BotThread, BotSession,
    │   │                                   BotCredential*, BotAdmin, BotPremium, BotSessionCommand,
    │   │                                   BotSessionEvent, BotUserBanned, BotThreadBanned,
    │   │                                   SystemAdmin, FbPageWebhook, better-auth tables
    │   ├── src/
    │   │   ├── client.ts                ← PrismaClient singleton with WAL + performance PRAGMAs
    │   │   ├── index.ts                 ← Exports: prisma client + all generated types
    │   │   └── cat-bot/ + server/       ← Raw Prisma repo functions (no cache)
    │   └── prisma.config.ts             ← Prisma v7 config: schema path, migrations path, datasource URL
    │
    ├── json/                            ← Flat JSON file store (database.json); no external dependencies
    │   └── src/
    │       ├── store.ts                 ← getDb() / saveDb() with DEFAULT_DB schema backfill
    │       └── cat-bot/ + server/       ← Raw JSON repo functions
    │
    ├── mongodb/                         ← MongoDB driver adapter
    │   └── src/
    │       ├── client.ts                ← MongoClient singleton
    │       └── cat-bot/ + server/       ← Raw MongoDB repo functions
    │
    └── neondb/                          ← Neon PostgreSQL adapter (postgres.js)
        └── src/
            ├── client.ts                ← sql tagged template client
            ├── schema.sql               ← DDL for all tables; applied via dbReady promise at boot
            └── cat-bot/ + server/       ← Raw SQL repo functions
```

### Database Access Pattern

```
packages/cat-bot/src/engine/repos/*.ts   ← LRU cache wrappers (cat-bot caching layer)
    ↓  imports from
packages/database/src/index.ts           ← Unified adapter surface
    ↓  resolves to one of
packages/database/adapters/{adapter}/    ← Raw repos (no cache); selected by DATABASE_TYPE env var
```

The LRU cache layer in `cat-bot/repos/` applies write-through invalidation: every mutation writes the known new value into cache immediately so the next read within the 5-minute TTL window hits memory, not the database.

---

## Platform Adapter Architecture

Each platform adapter follows the same four-layer pattern. Detailed per-platform documentation is in `docs/cat-bot/adapters/`.

```
src/engine/adapters/platform/{platform}/
│
├── index.ts                             ← Orchestrator: sequences boot phases; returns PlatformEmitter
│                                          (EventEmitter augmented with .start() and .stop())
│
├── wrapper.ts                           ← UnifiedApi subclass: delegates every method to lib/ functions
│                                          getUserName() / getThreadName() delegate to database repos
│
├── event-handlers.ts (or event-router.ts) ← Attaches native transport listeners; calls formatEvent();
│                                            emits { api, event, native } on the PlatformEmitter
│
├── unsupported.ts                       ← Throw-only stubs for operations the platform cannot support
│
└── lib/                                 ← One file per UnifiedApi operation; pure functions;
    └── *.ts                               independently testable with minimal mocks
```

All five event types emitted by platform adapters:

```
PlatformEmitter events:
├── 'message'           ← Standard text / attachment message
├── 'message_reply'     ← User quoted (replied to) a message
├── 'event'             ← Thread membership and administrative events (logMessageType keyed)
├── 'message_reaction'  ← Emoji reaction on a message
├── 'message_unsend'    ← Message retraction
└── 'button_action'     ← Interactive button click / callback query / postback
```

---

## Command and Event Module Contract

Authors write against these exported types only. The engine loads modules dynamically from `src/app/commands/` and `src/app/events/` at startup.

```
Command module exports:
├── config: CommandConfig                ← name, version, role, author, description, cooldown
│                                          Optional: aliases, hasPrefix, category, platform[], options[], guide[]
├── onCommand?(ctx: AppCtx)             ← Triggered by prefixed message matching config.name
├── onChat?(ctx: BaseCtx)               ← Triggered on every message (passive listener)
├── onReply?: { [step: string]: (ctx) } ← Triggered when user quotes a registered bot message
├── onReact?: { [emoji: string]: (ctx) }← Triggered when user reacts to a registered bot message
└── button?: { [id: string]: { label, style, onClick(ctx) } }

Event module exports:
├── config: EventConfig                 ← name, eventType[], version, author, description
│                                          Optional: platform[]
└── onEvent(ctx: BaseCtx)              ← Triggered for each matched event type string
```

---

## Key Architectural Invariants

**Single vocabulary.** Every layer above the platform adapters speaks only in `UnifiedApi`, `UnifiedEvent`, and the six context factory outputs. No Discord.js, Telegraf, or fca-unofficial types escape upward.

**Cache ownership.** The `packages/database` adapters are always cache-free. The `packages/cat-bot/src/engine/repos` layer exclusively owns the LRU cache. Adding caching to a new operation means adding it only in the cat-bot repo wrapper — never in the database adapter itself.

**Middleware is the extension point.** Cross-cutting command-level concerns (auth, rate limiting, validation, audit logging) belong in `src/engine/middleware/`. Command modules must not re-implement these concerns internally.

**Platform adapters absorb all differences.** Button UI fallbacks (FB Messenger numbered menus), markdown rendering differences, slash-command idempotency, webhook vs. long-polling — all of these live inside the adapter layer and are invisible to command and event modules.

**State flows are scope-keyed.** Pending onReply and onReact states use composite keys (`messageId:userId` for private, `messageId:threadId` for public) so flows are correctly isolated across simultaneous users in the same group.
