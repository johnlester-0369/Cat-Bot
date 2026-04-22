# Server Layer — Architecture

## Overview

The server layer (`packages/cat-bot/src/server/`) is the HTTP and WebSocket surface of Cat-Bot. It hosts the bot management REST API, the web dashboard authentication system, Facebook Page webhook delivery, and real-time browser communication via Socket.IO. It runs as a unified Express application inside the same Node.js process as the bot engine — `app.ts` in the engine layer calls `startServer()` once after all platform transports are wired.

The server is organized into eight sub-systems: bootstrap, auth, routes, controllers, services, repos, sockets, and data contracts.

---

## Module File Tree

```
src/server/
│
├── server.ts                                ← HTTP server bootstrap and Socket.IO initializer
│                                              Creates the Node.js http.Server from the Express app;
│                                              attaches Socket.IO to the raw HTTP server before listen()
│                                              so WebSocket upgrade events are captured below Express;
│                                              registers all Socket.IO handler groups;
│                                              idempotent — multiple callers from engine adapters are safe
│
├── app.ts                                   ← Express application factory (createApp)
│                                              Applies CORS before better-auth (OPTIONS preflight ordering);
│                                              mounts better-auth and adminAuth via toNodeHandler BEFORE
│                                              express.json() so auth reads the raw body stream;
│                                              mounts the Telegram webhook route before json() for the same
│                                              stream-before-parser reason;
│                                              serves the built React SPA from web/dist when present;
│                                              separated from listen() to allow supertest test mounts
│
├── lib/
│   ├── better-auth.lib.ts                   ← Dual better-auth instance configuration
│   │                                          auth → user portal sessions (/api/auth, cookie: better-auth.*)
│   │                                          adminAuth → admin portal sessions (/api/admin-auth, cookie: ba-admin.*)
│   │                                          Both instances share the same underlying DB adapter;
│   │                                          database adapter is selected at runtime by DATABASE_TYPE env var
│   │                                          (prisma-sqlite / json / mongodb / neondb);
│   │                                          both carry a before-hook that checks banned status before
│   │                                          any session row is written; adminAuth additionally gates
│   │                                          sign-in to role === 'admin' users only
│   │
│   └── better-auth-adapter.lib.ts           ← JSON file database adapter for better-auth
│                                              Used when DATABASE_TYPE=json; implements the full
│                                              CustomAdapter contract (create, findOne, findMany,
│                                              update, updateMany, delete, deleteMany, count);
│                                              shares the same store.ts (getDb/saveDb) as the rest
│                                              of the JSON adapter layer so auth and bot tables
│                                              coexist in one file; lives in the server package because
│                                              it imports from better-auth/adapters (not available in
│                                              the zero-dependency json adapter package)
│
├── routes/
│   └── v1/
│       ├── index.ts                         ← API v1 router aggregator; mounts all domain routers
│       │                                      under /api/v1; stable mount point — adding new resource
│       │                                      groups never touches app.ts
│       │
│       ├── bot.routes.ts                    ← Bot session CRUD + command/event toggle endpoints
│       │                                      POST   /bots              — create new bot session
│       │                                      GET    /bots              — list sessions for auth user
│       │                                      GET    /bots/:id          — single session detail
│       │                                      PUT    /bots/:id          — update session config
│       │                                      DELETE /bots/:id          — permanently destroy session
│       │                                      POST   /bots/:id/start    — boot transport; set isRunning=true
│       │                                      POST   /bots/:id/stop     — tear down transport; isRunning=false
│       │                                      POST   /bots/:id/restart  — restart transport; isRunning unchanged
│       │                                      GET    /bots/:id/commands — list commands + isEnable per session
│       │                                      PUT    /bots/:id/commands/:name — toggle command on/off
│       │                                      GET    /bots/:id/events   — list event modules + isEnable
│       │                                      PUT    /bots/:id/events/:name — toggle event module on/off
│       │
│       ├── admin.routes.ts                  ← Admin-only endpoints; every handler enforces
│       │                                      adminAuth session + role=admin internally
│       │                                      GET    /admin/bots                        — all sessions across all users
│       │                                      GET    /admin/system-admins               — global system admin list
│       │                                      POST   /admin/system-admins               — register new system admin
│       │                                      DELETE /admin/system-admins/:adminId      — revoke system admin
│       │                                      POST   /admin/users/:userId/ban-sessions  — halt user's transports
│       │                                      POST   /admin/users/:userId/unban-sessions — restart user's transports
│       │
│       ├── validation.routes.ts             ← Pre-save credential validation (auth required)
│       │                                      POST /validate/discord           — test Discord bot token via REST
│       │                                      POST /validate/telegram          — test Telegram token via getMe
│       │                                      POST /validate/facebook-messenger — structural parse of appstate
│       │                                      Facebook Page validation is Socket.IO-based (OTP flow),
│       │                                      not a REST endpoint
│       │
│       ├── facebook-page.routes.ts          ← Facebook Page webhook delivery receiver
│       │                                      GET  /facebook-page/:user_id — ownership verification handshake
│       │                                      POST /facebook-page/:user_id — incoming messaging event delivery
│       │                                      Mounted directly on app.ts, not under /api/v1,
│       │                                      because Facebook's webhook subscription only accepts
│       │                                      a single base path per app configuration
│       │
│       └── webhook.routes.ts                ← Facebook Page webhook metadata endpoint
│                                              GET /webhooks/facebook — returns generated webhook URL,
│                                              verify token, and current isVerified handshake status
│                                              for the authenticated user's Facebook Page integration
│
├── controllers/
│   ├── bot.controller.ts                    ← Bot session lifecycle request handlers
│   │                                          Auth enforced per-method via better-auth getSession();
│   │                                          delegates all business logic to botService;
│   │                                          service layer is auth-agnostic and independently testable
│   │
│   ├── admin.controller.ts                  ← Admin-only request handlers
│   │                                          Auth enforced via adminAuth (not auth) — the admin portal
│   │                                          cookie is never accepted on user-facing routes and vice versa;
│   │                                          delegates to botRepo (list) and botService (ban/unban flows)
│   │
│   ├── bot-session-config.controller.ts     ← Commands and events toggle request handlers
│   │                                          Verifies session ownership via botRepo.getPlatformId() before
│   │                                          any DB write; filters commands and events by isPlatformAllowed()
│   │                                          so disallowed entries never appear in API responses;
│   │                                          triggers slash command re-registration on Discord/Telegram
│   │                                          sessions fire-and-forget after a command toggle write
│   │
│   ├── facebook-page.controller.ts          ← Facebook Page webhook event handlers
│   │                                          handleVerification: validates hub.verify_token using a
│   │                                          deterministic HMAC of userId; persists isVerified to DB
│   │                                          and notifies waiting Socket.IO clients on success
│   │                                          handleWebhookEvent: responds 200 immediately (20 s Facebook
│   │                                          deadline); dispatches OTP intercept before session routing
│   │                                          so credential validation receives messages before a live
│   │                                          bot session is registered
│   │
│   ├── validation.controller.ts             ← Credential validation handlers
│   │                                          Discord: GET /v10/users/@me with Bot token; retry on network
│   │                                          faults, immediate failure on 401
│   │                                          Telegram: GET /bot{token}/getMe; same retry strategy
│   │                                          Facebook Messenger: structural JSON parse + c_user/xs cookie
│   │                                          presence check + live fca-unofficial login verification;
│   │                                          all three respond HTTP 200 with { valid, error? } so the
│   │                                          React hook distinguishes network failure (throws) from
│   │                                          credential rejection (valid: false) without branching
│   │
│   └── webhook.controller.ts                ← Facebook Page webhook metadata handler
│                                              Returns the webhook URL, verify token, and isVerified status
│                                              for the authenticated user; URL is derived from req.protocol
│                                              and req.get('host') so it reflects the external proxy address
│
├── services/
│   └── bot.service.ts                       ← Bot lifecycle orchestration
│                                              createBot: generates UUID sessionId; fetches Discord clientId
│                                              automatically from the token; writes to DB then spawns
│                                              the platform transport fire-and-forget
│                                              updateBot: detects credential changes; triggers slash sync
│                                              only when credentials are unchanged (credential change
│                                              requires a full restart that re-registers on boot)
│                                              startBot: fast path via SessionManager.start() if the
│                                              session closure is still registered; slow path rebuilds
│                                              config from DB credentials and calls spawnDynamicSession
│                                              stopBot: persists isRunning=false then tears down transport;
│                                              swallows "not found" from manager (session may already be stopped)
│                                              restartBot: forces stop + unregister so startBot always
│                                              spawns a fresh transport with current DB credentials
│                                              deleteBot: drains transport before DB writes so in-flight
│                                              messages do not crash against deleted credential rows
│                                              stopAllUserSessions / startAllUserSessions: ban/unban
│                                              orchestrators; stop-then-persist ordering prevents
│                                              session-loader from booting banned sessions on next restart
│
├── repos/
│   └── bot.repo.ts                          ← LRU-cached database reads for the server layer
│                                              Wraps the raw database botRepo with the shared 2000-entry
│                                              LRU cache singleton from lru-cache.lib;
│                                              cache keys: bot:detail:{userId}:{sessionId},
│                                              bot:list:{userId}, bot:platformId:{userId}:{sessionId};
│                                              write-through invalidation on every mutation so dashboard
│                                              reads never serve stale state;
│                                              also invalidates SESSIONS_ALL_KEY on mutations since
│                                              credentials.repo (the session-loader cache) reads the
│                                              same DB rows;
│                                              clearUserCache(): evicts all LRU entries for a userId
│                                              in one sweep; called by the ban orchestrator
│
├── socket/
│   ├── socket.lib.ts                        ← Socket.IO server singleton
│   │                                          initSocketIO(): creates and stores the Server instance
│   │                                          bound to the Node.js HTTP server; CORS config mirrors
│   │                                          the Express CORS config to satisfy browser preflight;
│   │                                          getSocketIO(): safe accessor returning null before init;
│   │                                          callers guard against null for safety
│   │
│   ├── bot-monitor.socket.ts                ← Real-time bot status and log streaming handlers
│   │                                          Log broadcast: subscribes to logRelay EventEmitter and
│   │                                          forwards every entry to all authenticated sockets as bot:log;
│   │                                          also routes keyed session log entries to the bot-log:{key}
│   │                                          Socket.IO room so subscribers only receive their bot's stream;
│   │                                          Status broadcast: subscribes to sessionManager status events
│   │                                          and pushes bot:status:change to all connected clients;
│   │                                          bot:status:request: per-connection handler for page-load
│   │                                          status queries — returns {active, startedAt} per sessionId;
│   │                                          bot:log:subscribe: joins the bot-log:{key} room and hydrates
│   │                                          the client with the server-side sliding window history
│   │                                          immediately so the console is never blank on page load;
│   │                                          bot:log:clear: purges the server-side history buffer for a
│   │                                          session when the client requests a log clear
│   │
│   └── validation.socket.ts                 ← Facebook Page credential validation socket handlers
│                                              Authentication middleware (io.use()) rejects unauthenticated
│                                              connections before any event handler fires, reusing the
│                                              better-auth session cookie so no separate auth mechanism needed;
│                                              validate:fbpage:init: starts the FB Page OTP verification flow;
│                                              second verification layer: sends a reply message via the
│                                              Graph API to prove the fbAccessToken is scoped to the
│                                              declared pageId (a token for a different page returns
│                                              error code 100 on send);
│                                              isPendingFbPageValidation(): allows the webhook controller
│                                              to accept messages during validation before a live bot
│                                              session is registered;
│                                              10-minute OTP TTL; expired entries pruned lazily on init
│
├── models/
│   └── page-session.model.ts                ← Facebook Page session data contracts
│                                              PageSessionConfig: per-session registration shape
│                                              stored in the facebook-page-session.lib registry;
│                                              FacebookWebhookBody: typed webhook delivery payload;
│                                              kept in models/ so the type is importable without
│                                              pulling in session registry or Express dependencies
│
├── dtos/
│   ├── bot.dto.ts                           ← Bot session request and response type contracts
│   │                                          PlatformCredentials: discriminated union on platform field;
│   │                                          TypeScript exhaustiveness forces every consumer to handle
│   │                                          all four platforms at compile time;
│   │                                          CreateBotRequestDto / UpdateBotRequestDto / GetBot*Dto
│   │
│   ├── bot-session-config.dto.ts            ← Commands and events toggle API type contracts
│   │                                          Kept separate from bot.dto because these model operational
│   │                                          runtime toggles rather than identity/credential configuration
│   │
│   └── admin.dto.ts                         ← Admin-only API type contracts
│                                              Exposes cross-user data (listAll bots) and global config
│                                              (system admins) that user-facing endpoints must never return;
│                                              separation enforces the boundary at the type level
│
└── utils/
    └── hash.util.ts                         ← Deterministic webhook secret utilities
                                               generateVerifyToken(userId): SHA-256 of userId+'verify'
                                               truncated to 10 hex chars; used as the Facebook webhook
                                               verify_token so Meta can prove ownership without storing
                                               a separate secret; generateShortId(userId): 8-char hex
                                               prefix of SHA-256 of userId for short identifier use
```

---

## Architectural Layers

### Bootstrap Layer (`server.ts`, `app.ts`)

`startServer()` is the single call-site for the entire HTTP lifecycle. It constructs the Express app via `createApp()`, then wraps it in a raw `http.Server` before calling `.listen()`. Socket.IO is attached to the raw server — not the Express app — so WebSocket upgrade requests are handled at the Node.js HTTP level before Express routing runs.

`createApp()` enforces a strict middleware registration order that is not stylistic but structurally required:

```
src/server/app.ts registration order:
│
├── cors()                         ← Must precede all handlers so OPTIONS preflight
│                                    receives Access-Control-Allow-* before any auth
│
├── toNodeHandler(auth)            ← better-auth reads the raw IncomingMessage stream;
│   /api/auth/{*any}                 express.json() must not run first or the body is consumed
│
├── toNodeHandler(adminAuth)       ← Same stream constraint; separate basePath so Express
│   /api/admin-auth/{*any}           routes admin traffic to the independent betterAuth instance
│
├── POST /api/v1/telegram-webhook  ← Telegraf RequestListener reads the raw stream;
│      /:userId/:sessionId           registered before express.json() for the same reason;
│                                    handler resolved lazily from telegram-webhook.registry
│
├── express.json()                 ← All routes below here safely read req.body
│   express.urlencoded()
│
├── /api/v1/facebook-page          ← Facebook Page webhook delivery
│
├── /api/v1                        ← All other REST API routes
│
├── GET /api/v1/health             ← Simple liveness check
│
└── SPA static serve               ← Serves React build from web/dist when present;
    GET /{*splat}                    catch-all for React Router client-side navigation
```

### Auth Layer (`lib/better-auth.lib.ts`)

Two independent `betterAuth()` instances share the same underlying database adapter but write session cookies under separate prefixes, making the user portal and admin portal session surfaces structurally isolated:

```
lib/better-auth.lib.ts:
│
├── auth                           ← User portal
│   basePath: /api/auth (default)
│   cookie: better-auth.session_token
│   plugins: [admin()]             ← Adds /api/auth/admin/* endpoints
│   before-hook: ban check before session creation
│
└── adminAuth                      ← Admin portal
    basePath: /api/admin-auth
    cookie: ba-admin.session_token
    cookiePrefix: 'ba-admin'
    plugins: [admin()]
    before-hook: ban check + role=admin gate;
                 unknown emails fall through to "invalid credentials"
                 rather than "not an admin" to avoid leaking email enumeration
```

The active database backend is selected at runtime by `DATABASE_TYPE` and the same adapter instance is passed to both `betterAuth()` calls. Signing out of one portal never invalidates the other's session row.

### Route Layer (`routes/v1/`)

All REST API routes are versioned under `/api/v1`. The Facebook Page webhook receiver is mounted directly on the Express app (not under `/api/v1`) because it is a delivery endpoint subscribed to by Meta's infrastructure using a fixed URL configured at app setup time.

```
routes/v1/index.ts mounts:
│
├── /bots      → bot.routes.ts         ← Session CRUD + command/event toggles
├── /webhooks  → webhook.routes.ts     ← Facebook webhook metadata
├── /validate  → validation.routes.ts  ← Pre-save credential checks
└── /admin     → admin.routes.ts       ← System administration (role=admin required)

app.ts mounts separately:
└── /api/v1/facebook-page → facebook-page.routes.ts
```

### Controller Layer (`controllers/`)

Controllers own the auth enforcement and request/response boundary. They extract session information from the request headers, verify it against the appropriate better-auth instance, and then delegate to the service or repo layer. The service layer is intentionally auth-agnostic — auth is always enforced in the controller, never inside a service method.

The Facebook Messenger validation controller (`validation.controller.ts`) performs a live `fca-unofficial` login as the final validation step. `startBot()` authenticates via the cookie blob without calling `listenMqtt`, so no persistent MQTT connection is opened during the validation call.

### Service Layer (`services/bot.service.ts`)

`BotService` is the only orchestration layer that touches both the database (via `botRepo`) and the runtime engine (via `spawnDynamicSession`, `sessionManager`, `prefixManager`). Every lifecycle operation follows a DB-first, transport-second ordering — state is persisted before the transport change takes effect so a process restart always reflects the last committed intent.

```
services/bot.service.ts lifecycle order:
│
├── createBot  → UUID generation → DB write → spawnDynamicSession (fire-and-forget)
├── updateBot  → fetchDiscordClientId → DB update → slash sync (if credentials unchanged)
├── startBot   → DB isRunning=true → SessionManager.start() fast path
│               → spawnDynamicSession slow path (rebuild from DB credentials)
├── stopBot    → DB isRunning=false → SessionManager.stop()
├── restartBot → SessionManager.stop() → unregister → startBot (fresh spawn)
└── deleteBot  → SessionManager.stop() → unregister → DB delete
```

### Repository Layer (`repos/bot.repo.ts`)

The server-layer `botRepo` wraps the raw database adapter with the same LRU cache singleton used by the engine's repo layer. Cache key cross-invalidation with `SESSIONS_ALL_KEY` is the coordination point: mutations in `botRepo` (create, update, updateIsRunning, deleteById) also evict the session-loader's credential cache so a process restart after a dashboard mutation reads fresh data.

### Socket Layer (`socket/`)

Socket.IO is initialized once in `server.ts` after the HTTP server is created. Two handler groups are registered immediately after initialization:

```
server.ts socket registration:
│
├── registerValidationHandlers(io) ← Authentication middleware (io.use()) runs first;
│                                    rejects unauthenticated connections before any
│                                    event handler can fire;
│                                    owns validate:fbpage:init event flow and
│                                    the in-memory OTP/webhook-waiter state
│
└── registerBotMonitorHandlers(io) ← Subscribes to logRelay and sessionManager at the
                                     process level; all authenticated connections see
                                     the same log stream and status changes
```

The authentication middleware in `validation.socket.ts` extracts the better-auth session cookie from the socket handshake headers. This means the Socket.IO auth check reuses the same `auth` instance as the REST endpoints — a valid browser session cookie grants WebSocket access automatically.

### Data Contracts

```
dtos/ and models/ dependency directions:
│
├── dtos/bot.dto.ts                ← Controllers read this; service + repo implement it
├── dtos/admin.dto.ts              ← Admin controller reads this; admin-scoped repo implements it
├── dtos/bot-session-config.dto.ts ← Config controller reads this; session command/event repos implement it
└── models/page-session.model.ts  ← FB Page controller reads this; session lib produces it
```

DTOs are plain TypeScript interfaces with no runtime behavior. The discriminated union `PlatformCredentials` (keyed on `platform`) is the critical compile-time boundary: TypeScript exhaustiveness checking forces every consumer of credential shapes to handle all four platforms without relying on runtime guards.

---

## Key Design Decisions

**Dual better-auth instances over role-based single instance.** A single instance with role checks would share cookies — a user who gains admin role mid-session would have the same cookie accepted on both portals. Separate instances with separate cookie prefixes mean a compromised user-portal session has zero leverage on the admin portal even when the DB row shows `role: 'admin'`.

**Socket.IO auth middleware over per-event guards.** Placing `io.use()` authentication before any event handler registration means unauthenticated connections never trigger any application code. Per-event guards would require every handler to repeat the session check and would not prevent unauthenticated connections from remaining connected.

**DB-first ordering in lifecycle methods.** `startBot` writes `isRunning=true` before spawning the transport; `stopBot` writes `isRunning=false` before calling stop. This means a process kill between the DB write and the transport action always leaves the DB in a state that session-loader can act on at next boot, rather than in a state inconsistent with what was actually running.

**Cache cross-invalidation via shared `SESSIONS_ALL_KEY`.** `botRepo` and `credentials.repo` are in different packages (server and engine respectively) but share the same LRU singleton. Mutating a bot session in the server layer evicts the key that the engine's session-loader uses so that a restart immediately after a dashboard write picks up the new credential state without a stale cache hit.

**Fire-and-forget transport spawn on create.** `createBot` returns the new session DTO to the client immediately after the DB write succeeds. The platform transport starts concurrently. This keeps the API response time bounded by the DB write, not by Discord gateway handshake or Telegram getMe latency.
