# Facebook Page Platform Adapter — Architecture

## Overview

The Facebook Page platform adapter is the transport layer that bridges the Facebook Graph API webhook pipeline to the Cat-Bot unified event contract. It sits entirely below `src/engine/app.ts` and above the raw Graph API — command modules and event handlers above it never import Graph API types directly; the platform below it never knows about Cat-Bot's business logic.

Unlike the Facebook Messenger adapter (which uses a persistent fca-unofficial MQTT connection) or the Discord and Telegram adapters (which use long-polling or webhook libraries with stateful client objects), the Facebook Page adapter is **fully stateless and webhook-driven**. The Graph API delivers events as HTTP POST payloads to the Express webhook server in `src/server/`. The adapter's job is to transform these raw payloads into typed unified events and emit them on a shared `EventEmitter` — it holds no persistent network connection and no in-memory session state beyond the page ID cache inside `pageApi.ts`.

A second fundamental constraint shapes every architectural decision in this adapter: **Facebook Page Messenger conversations are always 1:1**. There are no group threads, no participant lists, no group metadata, and no group administrative events. The sender's PSID (Page-Scoped User ID) serves as both the `senderID` and the `threadID` for every event. All group management operations (`setGroupName`, `setGroupImage`, `addUserToGroup`, etc.) are permanently unsupported and are grouped in `unsupported.ts` as throw-only stubs.

The adapter is structured as a four-layer stack: **session facade → webhook routing → API delegation → Graph API transport**. Each layer has a single owner file with narrowly scoped helpers extracted into `lib/` and `utils/` subdirectories.

---

## Module File Tree

```
src/engine/adapters/platform/facebook-page/
│
├── index.ts                          — Session facade: creates the PlatformEmitter augmented with
│                                       start() and stop(); owns the session lifecycle — constructs
│                                       the PageApi via createPageApi(), builds the event router via
│                                       createEventRouter(), and registers the session config with
│                                       registerPageSession() so the singleton webhook server in
│                                       src/server/ can route incoming POST payloads to the correct
│                                       session handler; no Graph API logic lives here — only
│                                       sequencing and session registration
│
├── types.ts                          — Listener-level type definitions only: FacebookPageConfig
│                                       (session credentials including pageAccessToken, pageId,
│                                       userId, sessionId, and prefix), and PlatformEmitter
│                                       (EventEmitter augmented with start/stop lifecycle methods);
│                                       separated from index.ts so adapters/platform/index.ts and
│                                       event-router.ts can import types without pulling in the
│                                       Express server and session registry side effects
│
├── event-router.ts                   — Webhook event router: createEventRouter() returns an async
│                                       callback consumed by the webhook server for every incoming
│                                       messaging entry; routing is ordered to handle reaction and
│                                       postback fields BEFORE the standard message guard because
│                                       those entries carry 'reaction' or 'postback' instead of
│                                       'message' and would be silently dropped by a naive !message
│                                       check; reaction events pre-fetch the reacted-to message
│                                       author from the Graph API (getMessage) so handlers know
│                                       whose message was reacted to; postback events are mapped
│                                       directly to EventType.BUTTON_ACTION; standard messages
│                                       pre-fetch the replied-to message when reply_to.mid is set
│                                       so normalizeFbPageEvent() stays a pure synchronous transform;
│                                       echo messages (bot's own sends) are silently discarded
│
├── wrapper.ts                        — UnifiedApi class shell and factory: FbPageApi extends
│                                       UnifiedApi and binds every method to the PageApi instance
│                                       captured at construction time; all business logic is
│                                       delegated to the corresponding lib/ function — this file is
│                                       pure wiring with no Graph API logic of its own; getUserName()
│                                       and getThreadName() delegate to the database repos layer
│                                       because the Graph API has no zero-cost name lookup for
│                                       Page-Scoped IDs; getAvatarUrl() is permanently unsupported
│                                       (the Page Send API has no profile photo endpoint accessible
│                                       without user OAuth); createFbPageApi(pageApi) is the public
│                                       factory that returns a UnifiedApi so callers depend only on
│                                       the abstract contract
│
├── unsupported.ts                    — Throw-only stubs for operations that are permanently
│                                       unavailable on Facebook Page Messenger: all group management
│                                       methods (setGroupName, setGroupImage, removeGroupImage,
│                                       addUserToGroup, removeUserFromGroup, setGroupReaction,
│                                       setNickname) throw because Page conversations are always 1:1;
│                                       reactToMessage throws because the Page Send API exposes no
│                                       message reaction endpoint; getAvatarUrl throws because the
│                                       Page Send API has no page-scoped profile photo endpoint;
│                                       grouping all stubs here keeps wrapper.ts free of inline
│                                       error-only branches and makes the unsupported surface explicit
│
├── pageApi-types.ts                  — Graph API interface definitions only: PageApi (the full
│                                       interface covering getPageId, sendMessage, unsendMessage,
│                                       getUserInfo, getMessage, and sendUrlAttachment) and
│                                       GetMessageResult (the shape returned by getMessage for
│                                       replied-to message lookups); separated from pageApi.ts so
│                                       lib/* modules can import the PageApi contract without pulling
│                                       in axios, FormData, or the HTTP implementation details;
│                                       pageApi.ts re-exports both interfaces for backward compat
│
├── pageApi-helpers.ts                — Graph API HTTP transport functions: low-level functions that
│                                       translate application-level requests into Graph API HTTP calls
│                                       via axios; sendTextMessage posts plain text; sendTemplateMessage
│                                       posts the Button Template payload that pairs text with postback
│                                       buttons (the only FB Page construct for interactive UI);
│                                       sendUrlAttachment lets the Graph API fetch assets server-side
│                                       from a URL (eliminates the download-then-reupload round-trip);
│                                       sendAttachmentMessage uploads binary stream content via
│                                       multipart form-data; getAttachmentTypeFromExt() and
│                                       getAttachmentType() derive the Graph API type field from the
│                                       filename extension so image/video/audio/file are declared
│                                       correctly; FB_API_BASE constant centralizes the Graph API
│                                       version string; internal to the facebook-page module — only
│                                       pageApi.ts imports from here
│
├── pageApi.ts                        — Graph API factory: createPageApi() returns a PageApi object
│                                       that wraps all Graph API HTTP calls in a callback-style
│                                       interface matching fca-unofficial's api shape so lib/* can
│                                       treat both adapters uniformly; the page ID is provided at
│                                       construction time from credential.json (FB_PAGE_ID),
│                                       eliminating the GET /me call that would require the
│                                       pages_read_engagement permission; sendMessage dispatches
│                                       to sendTextMessage, sendTemplateMessage, or
│                                       sendAttachmentMessage depending on the payload shape;
│                                       unsendMessage is a no-op (Page API requires special DELETE
│                                       permissions unavailable to standard page tokens);
│                                       getUserInfo fetches sequentially (not in parallel) to avoid
│                                       Graph API rate limits; getMessage pre-fetches replied-to
│                                       message content for reply_to.mid lookups; isAuthError
│                                       classifies permanent token-revocation errors and triggers
│                                       the onAuthError callback which marks the session inactive
│
├── lib/                              — Pure operation functions: each file implements exactly one
│   │                                   UnifiedApi method; functions accept only the PageApi instance
│   │                                   and operation-specific parameters — no UnifiedApi, no Cat-Bot
│   │                                   types — so they are independently testable and replaceable
│   │                                   without touching the class shell
│   │
│   ├── sendMessage.ts                — Wraps the pageApi.sendMessage callback interface into a
│   │                                   Promise; accepts both plain string and SendPayload shapes;
│   │                                   returns the Graph API message_id ("m_...") on success
│   │
│   ├── replyMessage.ts               — Sends messages with optional attachments and interactive
│   │                                   buttons; the Graph API has no reply-threading concept and no
│   │                                   batch send endpoint — text captions are sent first so the
│   │                                   recipient reads context before attachments; URL-based
│   │                                   attachments are sent via Graph API server-side fetch (no
│   │                                   local download); stream/buffer attachments use multipart
│   │                                   form-data upload; when buttons are present, uses the Button
│   │                                   Template (type: 'template') — the only FB Page construct
│   │                                   for interactive UI; button titles are truncated to 20
│   │                                   characters (Graph API hard limit); attachments are sent
│   │                                   before the template so images appear above the button row
│   │                                   in chat; applies mdToText() when style='markdown' since
│   │                                   the Page API has no parse_mode equivalent
│   │
│   ├── editMessage.ts                — The Graph API provides no message editing endpoint; this
│   │                                   function falls back to sending the edited payload as a new
│   │                                   message; delegates to replyMessage when buttons are present
│   │                                   (to use Button Template), otherwise delegates to sendMessage;
│   │                                   requires threadID to be injected in options by the chat
│   │                                   context layer — throws if threadID is absent
│   │
│   ├── unsendMessage.ts              — Wraps pageApi.unsendMessage in a Promise; the Page API
│   │                                   requires special DELETE permissions not available to standard
│   │                                   page tokens so the underlying pageApi implementation is a
│   │                                   no-op; the wrapper exists to keep the interface contract
│   │                                   consistent with other platforms
│   │
│   ├── getBotID.ts                   — Returns the Facebook Page ID by delegating to
│   │                                   pageApi.getPageId(); the ID is provided at construction
│   │                                   time from credential.json (no Graph API call required)
│   │
│   ├── getUserInfo.ts                — Resolves display names for an array of user IDs by wrapping
│   │                                   the pageApi.getUserInfo callback interface into a Promise;
│   │                                   returns a map of userID → { name: string }
│   │
│   ├── getFullThreadInfo.ts          — Returns a UnifiedThreadInfo for a Page Messenger thread;
│   │                                   because Page conversations are always 1:1, the threadID IS
│   │                                   the sender's PSID; calls getUserInfo(threadID) to derive the
│   │                                   thread name; all group-related fields are zeroed (isGroup:
│   │                                   false, memberCount: 2, adminIDs: [], avatarUrl: null);
│   │                                   getUserInfo failure is swallowed so a failed profile lookup
│   │                                   never crashes command handling
│   │
│   └── getFullUserInfo.ts            — Returns a UnifiedUserInfo for a single PSID via Graph API
│                                       GET /{userID}?fields=name; only name is available through
│                                       this endpoint — avatar, locale, and gender are absent;
│                                       falls back to "User {userID}" on profile fetch failure
│
└── utils/
    └── helper.util.ts                — Attachment mappers and event normalizers: pure
                                        transformation functions separated from wrapper.ts so they
                                        can be unit-tested without constructing a FbPageApi instance;
                                        mapAttachment() maps a single webhook push attachment (image,
                                        audio, video, file, sticker, location) to the fca-unofficial
                                        event shape — only payload.url is available from the webhook,
                                        sub-fields like thumbnailUrl are Messenger-internal and absent;
                                        mapGetApiAttachment() maps a GET /{message-id} attachment
                                        (completely different shape: type is derived from mime_type,
                                        image data lives in image_data.url, non-image files use
                                        file_url) used for reply_to message pre-fetches;
                                        normalizeFbPageEvent() transforms a raw webhook messaging
                                        object into the unified message or message_reply shape — the
                                        messageReply field is pre-built from Graph API data fetched
                                        before this call so the function remains a pure synchronous
                                        transform; normalizeFbPageReactionEvent() normalizes the
                                        message_reactions webhook field into the unified
                                        message_reaction shape
```

---

## Architectural Layers

### Layer 1 — Session Facade (`index.ts`)

`createFacebookPageListener()` returns a `PlatformEmitter` — a Node.js `EventEmitter` augmented with `.start()` and `.stop()`. Its only responsibility is sequencing the session setup phases:

1. Constructing the `PageApi` adapter via `createPageApi()` with the access token and page ID from credentials
2. Building the event router callback via `createEventRouter()` — the callback processes one webhook messaging entry at a time
3. Registering a `PageSessionConfig` with `registerPageSession()` so the singleton Express webhook server in `src/server/` can route incoming POST payloads to this session's callback

The adapter holds no MQTT connection and performs no long-polling. Start and stop are lightweight operations: start registers the session; stop calls `unregisterPageSession()`. There is no transport to connect or disconnect.

### Layer 2 — Webhook Event Routing (`event-router.ts`)

`createEventRouter()` returns an `async (messaging) => void` callback that the webhook server invokes for every `messaging[]` entry in a Graph API webhook payload. The routing function handles three distinct entry types, and the check order is critical:

- **Reaction entries** — carry a `'reaction'` field instead of `'message'`; must be checked first
- **Postback entries** — carry a `'postback'` field instead of `'message'`; must be checked before the `!message` guard
- **Standard message entries** — carry the `'message'` field; echo messages (`is_echo: true`) are discarded

For reaction events, the router performs an async Graph API fetch (`pageApi.getMessage`) to resolve the original message's author before emitting — so handlers know whose message received the reaction. For standard messages with a `reply_to.mid` reference, the router pre-fetches the replied-to message so `normalizeFbPageEvent()` remains a pure synchronous transformation.

### Layer 3 — API Delegation (`wrapper.ts` + `lib/`)

`wrapper.ts` contains a single private class `FbPageApi extends UnifiedApi` and a public factory `createFbPageApi(pageApi: PageApi): UnifiedApi`. The class captures the `PageApi` instance in a `#pageApi` private field. Every `override` method is a one-liner that delegates to the corresponding `lib/` function — no Graph API logic lives in `wrapper.ts` itself.

Two methods implement specialized resolution rather than delegating to `lib/`:

- **`getUserName()`** — delegates to `users.repo.ts` in the database layer; the Graph API would require a paid `/me/conversations` endpoint for names; the database is populated on every incoming message so names reflect the most recently seen display name
- **`getThreadName()`** — delegates to `threads.repo.ts` in the database layer; Page Messenger threads are always 1:1 and the thread "name" is the sender's display name stored by prior interactions

All group management methods delegate to `unsupported.ts` stubs that throw immediately with descriptive messages.

### Layer 4 — Graph API Transport (`pageApi.ts` + `pageApi-helpers.ts`)

`pageApi-helpers.ts` owns the raw HTTP layer. All Graph API calls use `axios` and target `https://graph.facebook.com/v22.0`. The transport layer exposes five distinct send strategies:

- `sendTextMessage` — plain text via POST `/me/messages`
- `sendTemplateMessage` — Button Template payload (interactive UI)
- `sendUrlAttachment` — URL-referenced asset fetched server-side by the Graph API
- `sendAttachmentMessage` — binary stream uploaded via multipart `FormData`

`pageApi.ts` wraps these helpers in a callback-style factory that matches the fca-unofficial `api` shape, allowing `lib/*` functions to use the same calling convention regardless of which platform they were originally designed for.

---

## Boot Sequence

When `app.ts` calls `platform.start(commands)`, the unified platform aggregator (`adapters/platform/index.ts`) calls `startSessionWithRetry()` for each configured Facebook Page session. Inside the retry wrapper, the Facebook Page listener's `.start()` executes these sequential phases:

1. `createPageApi()` — constructs the Graph API adapter with the access token and page ID; no network call is made at this step since the page ID is provided from credentials directly
2. `createEventRouter()` — builds the async callback that will process incoming webhook messaging entries; no network activity yet
3. `registerPageSession()` — registers the session config with the singleton webhook server via `facebook-page-session.lib.ts`; the Express server is already running (started by `startServer()` in `app.ts`); incoming POST payloads are now routed to the session callback
4. `sessionManager.markActive()` — dashboard status updates to reflect the session is online

There is no login handshake, no token validation step at boot, and no connection to establish. Auth errors (revoked page access tokens) surface lazily on the first send attempt via `isAuthError()` in `pageApi.ts`, which calls `onAuthError()` to mark the session inactive and alert the session manager.

---

## Event Routing

The Facebook Page adapter emits four distinct event types on the unified `EventEmitter`. Each payload carries three fields: `api` (the `UnifiedApi` adapter), `event` (the normalized event object), and `native` (platform context including `userId`, `sessionId`, and the raw webhook `messaging` entry).

```
event-router.ts (createEventRouter) emits:

├── 'message_reaction'  — webhook entry with 'reaction' field present
│                         normalizeFbPageReactionEvent() applied; requires a Graph API
│                         getMessage() call to resolve the original message author;
│                         threadID == senderID (always 1:1); subscribe to
│                         message_reactions in Meta App Dashboard to receive these
│
├── 'button_action'     — webhook entry with 'postback' field present (user tapped a
│                         Button Template button); buttonId = postback.payload which
│                         contains the fully-qualified "commandName:buttonId" string;
│                         threadID and senderID are both the sender's PSID
│
├── 'message'           — standard webhook 'message' entry with no reply_to reference;
│                         normalizeFbPageEvent() applied; echo messages discarded;
│                         attachments mapped via mapAttachment() from webhook push shape
│
└── 'message_reply'     — webhook 'message' entry where message.reply_to.mid is set;
                          Graph API getMessage() is called before normalizeFbPageEvent()
                          so the replied-to message body and attachments are pre-built;
                          replied-to attachments use mapGetApiAttachment() (GET API shape,
                          not webhook push shape — different field layout)
```

---

## Attachment Handling

Two entirely different attachment shapes exist in the Facebook Page adapter, each requiring its own mapper:

**Webhook push shape** (`mapAttachment` in `utils/helper.util.ts`) — used for attachments on the incoming message itself. The Graph API webhook exposes only `payload.url` for binary assets. Sub-fields like `thumbnailUrl`, `spriteUrl`, or dimension data that fca-unofficial provides for Messenger are absent. The mapper produces the fca-unified shape so command modules that check `attachment.type` and `attachment.url` work without modification.

**GET API shape** (`mapGetApiAttachment` in `utils/helper.util.ts`) — used for attachments on the _replied-to_ message fetched via `GET /{message-id}?fields=attachments`. This shape has no `type` enum field — the type is derived from `mime_type`. Images use `image_data.url`; non-image files use `file_url`. The mapper normalizes both into the same unified attachment shape.

**Outbound attachments** in `lib/replyMessage.ts` follow the Graph API's two-path strategy:

- **URL attachments** — sent via `sendUrlAttachment()` which instructs the Graph API to fetch the asset server-side. No local download. Eliminates the download-then-reupload round-trip that causes image delivery failures on ephemeral CDN URLs.
- **Stream/buffer attachments** — uploaded via `sendAttachmentMessage()` using multipart `FormData`. The attachment type (`audio`/`image`) is derived from the filename extension on the stream's `.path` property.

---

## Button Template Strategy

Facebook Page Messenger has no generic interactive button component analogous to Discord's `ActionRowBuilder` or Telegram's `InlineKeyboardMarkup`. The only supported interactive construct is the **Button Template** — a Graph API message type that pairs a required non-empty text string (1–640 characters) with up to three postback buttons.

When `replyMessage()` receives a non-empty `button` array:

1. URL attachments and stream attachments are sent first so images appear visually above the caption and button row in the chat thread
2. The Button Template is sent last via `sendTemplateMessage()` — each button's `type` is `'postback'` and its `payload` is the fully-qualified `commandName:buttonId` string
3. Button titles are truncated to 20 characters to satisfy the Graph API's hard limit
4. The postback payload routes back to `event-router.ts` as a `'button_action'` event when the user taps

The `editMessage()` path has no native editing endpoint — it sends the edited payload as a new message, delegating to `replyMessage()` when buttons are present so the Button Template is used correctly.

---

## Name Resolution Strategy

Facebook Page Messenger has no zero-cost name lookup for Page-Scoped User IDs. The available options are either a sequential Graph API `GET /{userID}?fields=name` call (rate-limited, requires `pages_messaging` or `pages_read_engagement` scope) or the database layer populated by prior interactions.

`FbPageApi` uses two distinct strategies depending on the method:

- **`getUserName()`** — delegates to `dbGetUserName()` from `users.repo.ts`. The handler layer upserts user display names into the database on every incoming message event, so the returned name reflects the most recently observed display name at zero API cost.
- **`getThreadName()`** — delegates to `dbGetThreadName()` from `threads.repo.ts`. Since Page Messenger threads are always 1:1, the thread "name" is the sender's display name.
- **`getFullUserInfo()`** — makes a full `GET /{userID}?fields=name` Graph API call via `lib/getFullUserInfo.ts`. Only `name` is returned by this endpoint; all other `UnifiedUserInfo` fields are `null`.
- **`getFullThreadInfo()`** — calls `getUserInfo(threadID)` via `lib/getFullThreadInfo.ts` (because the threadID is the sender's PSID) to derive the thread name; all group fields are defaulted.
- **`getAvatarUrl()`** — permanently unsupported; throws via `unsupported.ts`. The Page Send API has no page-scoped profile photo endpoint.

---

## Key Design Decisions

**Webhook-driven, stateless adapter.** Unlike the Facebook Messenger adapter (persistent MQTT) or the Discord/Telegram adapters (long-polling or webhook with library-managed connection state), the Page adapter holds no network connection and no stateful client object. Start/stop are lightweight operations limited to session registration and deregistration. Connection failures are not a concern — each webhook POST is an independent HTTP request.

**Page ID from credentials, not GET `/me`.** Fetching the page ID via `GET /me` requires the `pages_read_engagement` permission which may be unavailable during app review or for unverified pages. Providing the page ID directly in credentials at credential setup time eliminates this permission dependency and removes a network round-trip from the boot sequence.

**Routing order in `event-router.ts`.** Facebook's webhook can deliver reaction, postback, and standard message entries in the same `messaging[]` array. Routing checks for `'reaction'` and `'postback'` fields must precede the `!message` guard because those entries have no `'message'` field — a naive guard would silently drop them. The current check order (`reaction → postback → message`) is not stylistic — it is structurally required.

**`normalizeFbPageEvent()` as a pure synchronous transform.** Fetching the replied-to message body and the reaction target's author requires async Graph API calls. By performing these fetches in `event-router.ts` _before_ calling the normalizer, `normalizeFbPageEvent()` and `normalizeFbPageReactionEvent()` remain pure functions that accept only synchronous data. This separation makes them unit-testable without mocking the Graph API.

**Two attachment shape mappers.** Webhook push attachments and GET API attachment responses have completely different field layouts. Sharing one mapper would require runtime branching on field presence which is fragile. Two dedicated mappers (`mapAttachment` for push, `mapGetApiAttachment` for GET) each express their specific input contract clearly and fail loudly on unexpected shapes rather than silently producing `undefined` fields.

**`sendUrlAttachment` for all URL-based outbound media.** The Graph API's server-side URL fetch eliminates the proxy download round-trip. More importantly, it avoids the broken stream path that previously discarded images silently — the attachment would be constructed and sent but the binary content was never delivered. URL-based assets now bypass the local stream entirely.

**`editMessage()` falls back to a new message send.** The Graph API provides no endpoint to edit a previously sent message body. Rather than throwing an unimplemented error, `editMessage()` delivers the updated content as a new message — when buttons are present it uses Button Template via `replyMessage()` so the interactive UI is preserved; otherwise it uses `sendMessage()`. Command modules that call `ctx.chat.editMessage()` continue to work on Page without modification.

**Group operations in a single `unsupported.ts` module.** Page Messenger is permanently 1:1. There is no future API version that will add group threads to the Page platform. Grouping all throw-only stubs in one file makes the unsupported surface explicit and keeps `wrapper.ts` free of inline error-only branches. Command modules that conditionally use group operations should check `ctx.event.isGroup` or handle the thrown error and surface a user-friendly message.

**Database delegation for `getUserName()` and `getThreadName()`.** Sequential Graph API calls for name resolution on high-traffic pages would consume rate-limit budget and introduce latency on every message that needs to display a sender name. Delegating to the database repos — populated on every incoming event by the handler layer — provides zero-cost name lookup for the most recently seen display name, which is sufficient for all display contexts.