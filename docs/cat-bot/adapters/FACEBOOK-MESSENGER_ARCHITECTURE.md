# Facebook Messenger Platform Adapter — Architecture

## Overview

The Facebook Messenger platform adapter is the transport layer that bridges fca-unofficial (an unofficial Facebook Messenger MQTT client) to the Cat-Bot unified event contract. It sits entirely below `src/engine/app.ts` and above `fca-unofficial` — command modules and event handlers above it never import fca types directly; the platform below it never knows about Cat-Bot's business logic.

The adapter is structured as a four-layer stack: **orchestration → authentication → event routing → API delegation**. Each layer has a single owner file with narrowly scoped helpers extracted into `lib/` and `utils/` subdirectories. The external contract exposed upward is a single `EventEmitter` instance augmented with `.start()` and `.stop(signal?)` whose emitted payload shapes are identical to every other platform adapter.

Unlike the Discord and Telegram adapters, Facebook Messenger has no official bot API. fca-unofficial authenticates via a session cookie blob (appstate) and communicates over a persistent MQTT connection. This design has two major architectural consequences: authentication errors are unrecoverable without a new appstate, and the MQTT connection requires active reconnect logic that the adapter owns internally.

---

## Module File Tree

```
src/engine/adapters/platform/facebook-messenger/
│
├── index.ts                          — Orchestrator: creates the FacebookMessengerEmitter augmented
│                                       with start() and stop(); owns the MQTT listener lifecycle
│                                       including the reconnect loop and auth-error detection;
│                                       dynamically imports wrapper.ts at start() time to isolate
│                                       module-load failures from the import chain; delegates login to
│                                       login.ts and event routing to event-router.ts; re-exports
│                                       startBot() so integration tests can construct a FacebookApi
│                                       directly without going through the listener
│
├── types.ts                          — Shared type definitions only: FcaApi (full interface for the
│                                       fca-unofficial api object covering every method consumed across
│                                       all lib/ files), MqttState (MQTT lifecycle state delivered as
│                                       the third argument of listenMqtt callbacks), StartBotConfig,
│                                       StartBotResult, and FacebookMessengerEmitter (EventEmitter +
│                                       start/stop lifecycle methods); separated so other files can
│                                       import types without pulling in fca-unofficial's module-level
│                                       side effects
│
├── login.ts                          — Authentication: handles the fca-unofficial login flow using the
│                                       appstate JSON loaded from the database; calls fcaInstances()
│                                       with emitLogger:true to route all fca internal log output
│                                       through the session-scoped logger instead of raw stderr;
│                                       performs an explicit refreshFb_dtsg() call post-login as a
│                                       secondary validation step to detect stale appstates that pass
│                                       the initial login check but are no longer functional; does NOT
│                                       start MQTT listening — that is exclusively owned by index.ts
│                                       to guarantee exactly one MQTT listener per connection
│
├── event-router.ts                   — Event routing: pure function routeRawEvent() that maps fca-
│                                       unofficial raw event type strings to unified emitter event
│                                       names; the routing table is separated from the listener
│                                       lifecycle so it can be inspected and tested independently;
│                                       message and message_reply events go through normalizeMessageEvent()
│                                       for field normalization; all other event types go through
│                                       formatEvent() from event.model for null-safety; the
│                                       change_thread_image fca type is folded into EventType.EVENT
│                                       with logMessageType 'log:thread-image' here so all thread
│                                       administrative events share one dispatch path
│
├── wrapper.ts                        — UnifiedApi implementation: FacebookApi extends UnifiedApi
│                                       and delegates every method to a single-responsibility lib/
│                                       function via the private #api field (fca-unofficial api
│                                       instance); no business logic lives here — only wiring between
│                                       the fca api handle and lib/; getUserName() and getThreadName()
│                                       delegate to the database repos layer because fca-unofficial
│                                       has no zero-cost name lookup endpoint; getAvatarUrl() resolves
│                                       via the public Facebook Graph API photo endpoint using a
│                                       well-known app-level access token; re-exports
│                                       normalizeMessageEvent so existing consumers (index.ts dynamic
│                                       import) continue to resolve it through wrapper.js
│
├── unsupported.ts                    — Unsupported operation stubs: removeGroupImage() always rejects
│                                       with a descriptive message because fca-unofficial exposes
│                                       api.changeGroupImage() to set a new image but has no endpoint
│                                       to remove or reset it; grouped in one file so wrapper.ts
│                                       imports one module rather than handling no-ops inline
│
├── lib/                              — Pure operation functions: each file implements exactly one
│   │                                   UnifiedApi operation; functions accept only the minimal fca
│   │                                   api surface they strictly need (declared as local interfaces,
│   │                                   not importing FcaApi from types.ts) so they are independently
│   │                                   testable and replaceable without touching the class shell
│   │
│   ├── sendMessage.ts                — Sends a text or attachment message via fca sendMessage;
│   │                                   detects unified SendPayload format (presence of 'message' key,
│   │                                   'attachment_url', or array attachment) vs. raw fca-native
│   │                                   format (string or { body, attachment: Readable }); unified
│   │                                   path processes NamedStreamAttachment[] via bufferToStream and
│   │                                   NamedUrlAttachment[] via urlToStream before passing allStreams
│   │                                   to fca; maps unified {tag, user_id} mention entries to fca's
│   │                                   {tag, id} shape; falls back to raw pass-through for legacy
│   │                                   fca-native callers
│   │
│   ├── replyMessage.ts               — Sends a message with optional reply threading, attachment
│   │                                   arrays, and mention entries; accepts ReplyMessageOptions;
│   │                                   downloads NamedUrlAttachment[] via urlToStream and normalizes
│   │                                   NamedStreamAttachment[] (wrapping Buffer inputs with
│   │                                   bufferToStream so fca derives the correct MIME type from the
│   │                                   .path extension); applies mdToText() when style='markdown'
│   │                                   since fca-unofficial MQTT has no native markdown rendering;
│   │                                   maps unified {tag, user_id} mentions to fca {tag, id}; passes
│   │                                   reply_to_message_id as the fourth argument of fca sendMessage
│   │                                   for reply threading
│   │
│   ├── editMessage.ts                — Edits a sent message body via fca editMessage (body, messageID
│   │                                   arg order — inverted from the unified API signature); accepts
│   │                                   string or EditMessageOptions; applies mdToText() when
│   │                                   style='markdown' to simulate formatted text via styled Unicode
│   │                                   characters since fca has no parse_mode equivalent
│   │
│   ├── unsendMessage.ts              — Retracts a sent message via fca unsendMessage; fca resolves
│   │                                   without returning meaningful data on success; the callback
│   │                                   receives no error argument for this operation
│   │
│   ├── reactToMessage.ts             — Adds an emoji reaction via fca setMessageReaction; passes
│   │                                   both messageID and threadID in the descriptor format so fca
│   │                                   routes via MQTT rather than falling back to a slower REST
│   │                                   call; force=true bypasses fca's internal rate-limiting guard
│   │
│   ├── getUserInfo.ts                — Resolves display names for a list of user IDs via fca
│   │                                   getUserInfo; normalizes the response so every requested ID
│   │                                   always has a 'name' string — fca may omit entries or return
│   │                                   without a 'name' key when a thread ID is accidentally passed
│   │                                   instead of a real user ID; falls back to "User {uid}"
│   │
│   ├── getBotID.ts                   — Returns the logged-in Facebook user ID via fca
│   │                                   getCurrentUserID(); always synchronous on fca's side;
│   │                                   wrapped in Promise.resolve() to satisfy the async UnifiedApi
│   │                                   contract
│   │
│   ├── getFullThreadInfo.ts          — Returns a UnifiedThreadInfo by calling fca getThreadInfo();
│   │                                   normalizes adminIDs to string[] since fca returns either
│   │                                   string or { id: string }; memberCount is derived from
│   │                                   participantIDs.length since fca does not return it separately;
│   │                                   uses createUnifiedThreadInfo() factory to guarantee all fields
│   │                                   have safe defaults
│   │
│   ├── getFullUserInfo.ts            — Returns a UnifiedUserInfo by calling fca getUserInfo() for a
│   │                                   single user ID; maps name/firstName/vanity/thumbSrc from the
│   │                                   raw fca shape; vanity is the Facebook URL slug exposed as
│   │                                   username; uses createUnifiedUserInfo() factory
│   │
│   ├── setGroupName.ts               — Renames a group thread via fca setTitle; guards against fca
│   │                                   versions that omit setTitle (the method is optional in the
│   │                                   interface) to surface the failure immediately rather than
│   │                                   hanging silently on an undefined call
│   │
│   ├── setGroupImage.ts              — Sets the group photo via fca changeGroupImage; requires a
│   │                                   Readable stream with a .path property for MIME detection;
│   │                                   Buffer inputs use bufferToStream and URL inputs use
│   │                                   urlToStream to satisfy this contract; Readable inputs are
│   │                                   passed directly with the caller responsible for setting .path
│   │
│   ├── setGroupReaction.ts           — Sets the group's quick-reaction (default "like") emoji via
│   │                                   fca changeThreadEmoji
│   │
│   ├── addUserToGroup.ts             — Adds a user to a group thread via fca addUserToGroup; note
│   │                                   the fca argument order is (userID, threadID, cb) — inverted
│   │                                   from the unified convention of (threadID, userID)
│   │
│   ├── removeUserFromGroup.ts        — Removes a user from a group thread via fca
│   │                                   removeUserFromGroup; same argument inversion as addUserToGroup
│   │
│   └── setNickname.ts                — Sets a participant's display nickname via fca changeNickname;
│                                       fca argument order is (nickname, threadID, participantID, cb);
│                                       an empty string clears the nickname and restores the
│                                       account's default display name
│
└── utils/
    ├── index.ts                      — Barrel: re-exports normalizeMessageEvent from normalize-event.js
    │                                   and bufferToStream/urlToStream from streams.js so lib/ files
    │                                   import from a single local path without reaching up the tree
    │
    ├── normalize-event.ts            — Message event normalization: normalizeMessageEvent() converts
    │                                   raw fca-unofficial message events into the unified event
    │                                   shape; handles both 'message' and 'message_reply' fca types;
    │                                   normalizes the body field to 'message', generates an 'args'
    │                                   array from body.trim().split(/\s+/), enforces string fallbacks
    │                                   so unified models never receive undefined, and reconstructs
    │                                   the full messageReply inner object for reply events;
    │                                   separated from stream utilities because event normalization
    │                                   is a domain-specific concern, not a general-purpose helper
    │
    └── streams.ts                    — Stream utility re-exports: single local import point for
                                        bufferToStream and urlToStream so lib/ files never need to
                                        reach two levels up to the shared engine utility; delegates
                                        entirely to @/engine/utils/streams.util.js — one source of
                                        truth for buffer/stream operations
```

---

## Architectural Layers

### Layer 1 — Orchestration (`index.ts`)

`createFacebookMessengerListener()` returns a `FacebookMessengerEmitter` — a Node.js `EventEmitter` augmented with `.start()` and `.stop(signal?)`. It does not contain fca-unofficial code directly; its responsibilities are sequencing the boot phases, owning the MQTT listener lifecycle, and implementing the reconnect loop.

A critical design choice in this layer is the **dynamic import of `wrapper.ts`** inside `.start()`. All `lib/` files are pulled in when `wrapper.ts` is evaluated. Deferring this import until `start()` is called ensures that module-level evaluation failures in `wrapper.ts` or any `lib/` file are isolated to the session's start phase rather than crashing the entire process at import time.

The `reconnecting` flag is a concurrency guard. fca-unofficial's MQTT connection may emit multiple consecutive errors in rapid succession when connectivity drops. Without this flag, each error event would independently spawn a `withRetry` loop, resulting in multiple competing re-authentication attempts against the same Facebook account — a condition that would accelerate appstate expiry. Only the first error triggers the reconnect; subsequent errors are silently discarded until the reconnect resolves.

### Layer 2 — Authentication (`login.ts`)

`startBot()` is the single place that interacts with `fca-unofficial`'s login surface. It is deliberately separated from the listener lifecycle so it can be reused independently (integration tests call it directly to obtain a raw fca api handle) and so the login flow can be tested without constructing a full MQTT listener.

The `emitLogger: true` option passed to `fcaInstances()` reroutes all fca internal console output through the session-scoped logger. Without this, fca's login sequence and MQTT lifecycle messages would write directly to stderr, bypassing the structured logging pipeline and the web dashboard's console relay.

The secondary `refreshFb_dtsg()` validation call is a defensive check. Some appstates pass fca's initial login handshake but lack a valid `fb_dtsg` CSRF token — these sessions would fail silently on the first message send. The explicit check surfaces the failure at startup before the MQTT listener is activated, so the session never enters a state where it appears online but cannot send messages.

### Layer 3 — Event Routing (`event-router.ts`)

`routeRawEvent()` is a pure function that accepts a single raw fca event and dispatches it to the correct emitter event name. Extracting this routing table from `index.ts` allows the mapping logic to be audited and tested independently of the MQTT listener lifecycle.

The routing strategy differs by event type:

- `message` and `message_reply` pass through `normalizeMessageEvent()` which rebuilds the event into the unified shape (renaming `body` → `message`, generating `args`, enforcing string fallbacks). The fca event type string is preserved as the emitter event name so `app.ts` can subscribe to `'message_reply'` independently.
- `message_reaction` and `message_unsend` pass through `formatEvent()` from `event.model` for null-safety. The `platform` tag is spread in after `formatEvent()` because fca events do not carry it natively.
- `event` and `change_thread_image` both pass through `formatEvent()` and emit on `'event'`. The `change_thread_image` fold is the key normalization: fca emits this as a standalone top-level type, but `formatEvent()` converts it to `EventType.EVENT` with `logMessageType: 'log:thread-image'`. This means all thread administrative events — regardless of which platform sourced them — share a single dispatch path in the handler layer above.

### Layer 4 — API Delegation (`wrapper.ts` + `lib/`)

`wrapper.ts` contains a single private class `FacebookApi extends UnifiedApi` and a public factory `createFacebookApi(fcaApi: FcaApi): UnifiedApi`. The class captures the fca api instance in a private `#api` field — no external code should call fca directly. Every `override` method is a one-liner that delegates to the corresponding `lib/` function, keeping wrapper.ts as pure wiring with no fca API logic of its own.

Each `lib/` file declares its own minimal local interface for the fca api surface it consumes rather than importing `FcaApi` from `types.ts`. This structural isolation means each function can be unit-tested by providing a minimal mock without constructing the full fca api surface.

---

## Boot Sequence

When `app.ts` calls `platform.start(commands)`, the unified platform aggregator (`adapters/platform/index.ts`) calls `startSessionWithRetry()` for each configured Facebook Messenger session. Inside the retry wrapper, the Facebook Messenger listener's `.start()` executes these sequential phases:

1. `wrapper.ts` is dynamically imported — all `lib/` modules are evaluated at this point; any evaluation failure surfaces here rather than at import time
2. `startBot()` is called with the appstate string from the database — fca-unofficial is instantiated and the login flow runs including `refreshFb_dtsg()` secondary validation
3. `listen(api)` is called — `api.listenMqtt()` establishes the persistent MQTT connection and begins delivering events to the callback
4. For each MQTT callback invocation, `createFacebookApi(fcaApi)` constructs the `UnifiedApi` wrapper and `routeRawEvent()` dispatches to the emitter
5. The session is marked active via `sessionManager.markActive()` after the listener is established

`startBot()` is deliberately not called inside `listen()`. There is exactly one `listenMqtt()` call per session at all times — `listen()` can be called again during reconnect with a fresh api handle obtained from a new `startBot()` invocation.

---

## Event Routing

The Facebook Messenger adapter emits five distinct event types on the `FacebookMessengerEmitter`. Each payload carries three fields: `api` (the `UnifiedApi` adapter), `event` (the normalized event object), and `native` (platform context including `userId`, `sessionId`, the raw fca api handle, and the raw event for consumers that need it).

```
event-router.ts (routeRawEvent) emits:

├── 'message'           — fca type 'message' (standard text/attachment messages)
│                         normalizeMessageEvent() applied; body renamed to message,
│                         args generated, isGroup and mentions enforced
│
├── 'message_reply'     — fca type 'message_reply' (reply to a specific earlier message)
│                         normalizeMessageEvent() applied; messageReply inner object
│                         reconstructed with full field normalization; emitted under
│                         'message_reply' to allow independent subscription in app.ts
│
├── 'message_reaction'  — fca type 'message_reaction' (emoji reaction on a message)
│                         formatEvent() applied for null-safety; platform tag spread
│                         in after formatEvent since fca events lack it natively
│
├── 'message_unsend'    — fca type 'message_unsend' (sender retracts a message)
│                         formatEvent() applied; timestamp sentinel preserved as
│                         undefined (not null) to distinguish "no timestamp" from
│                         timestamp=0 per fca-unofficial's own contract
│
└── 'event'             — fca type 'event' (thread administrative events)
                          fca type 'change_thread_image' (folded here by formatEvent)
                          Both normalize to EventType.EVENT; change_thread_image becomes
                          logMessageType 'log:thread-image' so handlers subscribe once
                          for that key regardless of which platform sourced the event
```

Note: `message_reaction` and `message_unsend` are only available on Facebook Messenger via MQTT. The Discord adapter surfaces both; the Telegram and Facebook Page adapters do not emit them. The unified platform aggregator in `adapters/platform/index.ts` forwards all five types verbatim — transports that never emit a given type are transparent no-ops in `app.ts`.

---

## MQTT Reconnect Strategy

The fca-unofficial MQTT connection can drop for transient reasons (network blip, Facebook gateway reset) or permanent reasons (appstate expired, account blocked). The adapter distinguishes these two cases and handles them differently.

The reconnect path inside `index.ts` executes when the MQTT listener callback receives a non-null error:

1. `isAuthError(err)` classifies the error — auth errors are permanent and cannot be recovered by reconnecting with the same appstate. The session is immediately marked inactive via `sessionManager.markInactive()` and the reconnect loop is skipped.
2. For non-auth errors, `reconnecting` is set to `true` to suppress duplicate reconnect attempts from subsequent burst errors. The dead listener is stopped via `stopListeningAsync()` before a new login attempt begins.
3. `withRetry()` drives the re-login cycle: up to 10 attempts with exponential backoff from 5s initial delay, capped at 120s. Each attempt calls `startBot()` for a full re-authentication in case the session cookie was refreshed by Facebook mid-connection.
4. If all 10 attempts are exhausted, the session is marked inactive and the reconnect loop terminates. Other sessions on other platforms continue running unaffected.
5. `reconnecting` is reset to `false` after the retry cycle completes (success or exhaustion) so the guard is released for any future disconnection event on a successfully reconnected session.

---

## Database Name Delegation

Facebook Messenger has no zero-cost name lookup endpoint. Every name resolution requires a full `getUserInfo()` or `getThreadInfo()` fca API call over MQTT, which is expensive in both time and fca session health. The `FacebookApi` class delegates `getUserName()` and `getThreadName()` to the database repos layer instead:

- `getUserName(userID)` → `dbGetUserName()` from `@/engine/repos/users.repo.js`
- `getThreadName(threadID)` → `dbGetThreadName()` from `@/engine/repos/threads.repo.js`

The database is populated with display names as messages arrive — the handler layer upserts user and thread records on every incoming event. This means names resolved through `getUserName()` and `getThreadName()` reflect the most recently observed display name for that entity without any API round-trip.

`getFullUserInfo()` and `getFullThreadInfo()` retain their full fca API calls for use cases where fresh rich data is required (the `user` command, the `tid` command, etc.). The database delegation applies only to the lightweight name-only paths used by most commands when displaying sender context.

`getAvatarUrl()` resolves via the public Facebook Graph API photo endpoint (`graph.facebook.com/{userID}/picture`) using a well-known public app-level access token. This endpoint works for any Facebook PSID without additional OAuth scopes and does not consume fca MQTT bandwidth.

---

## Key Design Decisions

**Dynamic import of `wrapper.ts` inside `start()`.** All `lib/` modules are transitively evaluated when `wrapper.ts` is imported. A module-level error in any lib file — for example a missing native dependency — would crash the entire process at application startup if imported statically. Deferring to `start()` isolates the failure to the session's boot phase, where `startSessionWithRetry` can classify it and leave other platform sessions unaffected.

**`reconnecting` flag for burst-error deduplication.** MQTT connections under network stress may emit multiple error events in a tight window before the connection is fully closed. Without the `reconnecting` guard, each error would independently spawn a `withRetry` loop competing to re-authenticate the same Facebook account — a race that accelerates appstate invalidation. The boolean flag ensures exactly one reconnect loop is active at any time.

**`startBot()` separated from `listen()`.** The MQTT listener and the authentication flow are decoupled by design. `listen()` only accepts an already-authenticated fca api handle; `startBot()` only produces one. This separation means the reconnect path in `index.ts` can re-run authentication independently of listener lifecycle management, and integration tests can obtain a raw api handle without touching the MQTT listener at all.

**Modular `lib/` extraction with local interface declarations.** Each `lib/` function declares its own minimal `interface FcaApi` covering only the methods it uses. This prevents any single lib file from depending on the full `FcaApi` type from `types.ts`, keeping each function independently testable with a minimal mock. `wrapper.ts` is the only file that assembles all lib functions together behind the `FacebookApi` class.

**`change_thread_image` folded into `EventType.EVENT` at the routing layer.** fca-unofficial emits `change_thread_image` as a standalone top-level type not listed in `EventType`. Folding it to `EventType.EVENT + logMessageType 'log:thread-image'` in `routeRawEvent()` (via `formatEvent()`) means all thread administrative events share one dispatch path in the handler layer. Event modules subscribe to `'log:thread-image'` once and receive it regardless of platform — no fca-specific special-casing in command or event modules.

**Database delegation for `getUserName()` and `getThreadName()`.** fca-unofficial has no equivalent of Discord's guild member cache or Telegram's `ctx.from` for zero-cost name resolution. Delegating to the database repos avoids a full `getUserInfo()` MQTT call on every message that needs to display a sender name. The database is kept current by the handler layer's upsert calls, so names are always at most one interaction stale — acceptable for display purposes.

**Buffer inputs wrapped with `bufferToStream()` in send paths.** fca-unofficial's `sendMessage` and `changeGroupImage` derive the MIME type for uploaded files from the `.path` property of the stream object. Callers that provide `Buffer` inputs do not set `.path` — `bufferToStream()` wraps the buffer in a named `PassThrough` stream with `.path` set to the caller-supplied filename. Without this step, fca would upload files with an incorrect or missing MIME type, causing Facebook's CDN to reject or mis-serve the attachment.