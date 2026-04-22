# Telegram Platform Adapter — Architecture

## Overview

The Telegram platform adapter is the transport layer that bridges Telegraf (the Node.js Telegram Bot API wrapper) to the Cat-Bot unified event contract. It sits entirely below `src/engine/app.ts` and above `telegraf` — command modules and event handlers above it never import Telegram types directly; the platform below it never knows about Cat-Bot's business logic.

The adapter is structured as a five-layer stack: **public facade → session orchestration → handler registration → API delegation → pure utilities**. Each layer has a single owner file with narrowly scoped helpers extracted into `lib/` and `utils/` subdirectories. The external contract exposed upward is a single `EventEmitter` instance augmented with `.start(commands)` and `.stop(signal?)` whose emitted payload shapes are identical to every other platform adapter.

---

## Module File Tree

```
src/engine/adapters/platform/telegram/
│
├── index.ts                          — Public API facade: re-exports createTelegramListener()
│                                       and TelegramConfig so external consumers (adapters/platform/
│                                       index.ts) import only from this single surface; internal
│                                       implementation detail files are not re-exported, keeping
│                                       the public contract narrow and stable
│
├── types.ts                          — Type definitions only: TelegramConfig (session credentials
│                                       and prefix config), TelegramEmitter (EventEmitter augmented
│                                       with start/stop lifecycle methods); separated so adapters/
│                                       platform/index.ts can import types without pulling in
│                                       Telegraf's module-level side effects
│
├── listener.ts                       — Session lifecycle orchestrator: creates the Telegraf instance;
│                                       validates the bot token via getMe() before registering any
│                                       handlers (surfaces auth errors to withRetry's shouldRetry gate
│                                       before launch() fires); sequences slash-menu registration,
│                                       handler attachment, and bot launch in the correct boot order;
│                                       supports both long-polling and webhook modes (controlled by
│                                       TELEGRAM_WEBHOOK_DOMAIN env var); registers the slash-sync
│                                       callback post-launch so dashboard toggles can live-update the
│                                       Telegram "/" command menu without a bot restart; owns stop()
│                                       which unregisters the slash-sync entry and the webhook handler
│                                       before calling bot.stop()
│
├── handlers.ts                       — Telegraf update handler registration: attaches all bot.on()
│                                       listeners to the Telegraf instance; each handler normalizes
│                                       its raw context object via utils/helper.util.ts and emits a
│                                       typed event on the shared EventEmitter; service message
│                                       handlers (new_chat_members, left_chat_member) are registered
│                                       BEFORE the general 'message' handler to ensure Telegraf's
│                                       middleware chain does not swallow them; callback_query handler
│                                       intentionally defers answerCbQuery() to button.dispatcher so
│                                       it can pass a show_alert popup for unauthorized button clicks
│
├── slash-commands.ts                 — Telegram Bot API command menu management: manages the command
│                                       menu across all four broadcast scopes (default,
│                                       all_private_chats, all_group_chats, all_chat_administrators)
│                                       to prevent stale entries from persisting as scope fallbacks;
│                                       guards Bot API calls with a command-hash idempotency check
│                                       stored in bot_credential_telegram so restarts skip the API
│                                       call when nothing has changed; enforces Telegram's hard cap
│                                       of 100 commands (BOT_COMMANDS_TOO_MUCH); sanitizes command
│                                       names (hyphens → underscores) and descriptions (emoji stripped)
│                                       automatically to satisfy Bot API constraints while warning
│                                       module authors; supports a forceRegister flag that bypasses
│                                       the hash check for dashboard-triggered toggle syncs
│
├── wrapper.ts                        — UnifiedApi class shell and factory: TelegramApi extends
│                                       UnifiedApi and binds every method to the current Telegraf
│                                       Context object captured at construction time; all business
│                                       logic is delegated to the corresponding lib/ function — this
│                                       file is pure wiring with no Telegram API logic of its own;
│                                       getUserName() and getThreadName() implement an event-first
│                                       resolution strategy (read from ctx.from / ctx.chat at zero
│                                       API cost) then fall back to the database layer for non-sender
│                                       lookups; createTelegramApi(ctx) is the public factory that
│                                       returns UnifiedApi so callers depend only on the abstract contract
│
├── unsupported.ts                    — Bot API limitation stubs: addUserToGroup throws with a
│                                       descriptive message directing callers to createChatInviteLink()
│                                       instead; setGroupReaction throws because Telegram exposes no
│                                       group-level default reaction emoji via the Bot API; grouping
│                                       both in one file keeps wrapper.ts free of inline error-only
│                                       branches
│
├── lib/                              — Pure operation functions: each file implements exactly one
│   │                                   UnifiedApi method; functions accept only the Telegraf Context
│   │                                   and operation-specific parameters — no UnifiedApi, no Cat-Bot
│   │                                   types — so they are independently testable and replaceable
│   │                                   without touching the class shell
│   │
│   ├── sendMessage.ts                — Sends a plain text message to the explicit threadID when
│   │                                   provided (cross-chat delivery path), falling back to
│   │                                   ctx.chat?.id for the standard same-chat reply; accepts both
│   │                                   plain string and SendPayload shapes; returns the sent
│   │                                   message_id as a string
│   │
│   ├── replyMessage.ts               — Sends a message with optional reply-threading, attachment
│   │                                   arrays (stream and URL), button inline keyboards, and
│   │                                   @mention entities; routes attachments to the correct Bot API
│   │                                   method by file extension (sendMediaGroup for photos, sendVideo,
│   │                                   sendAnimation for GIFs, sendAudio, sendDocument); single-
│   │                                   attachment+button payloads bypass sendMediaGroup (which
│   │                                   ignores reply_markup) in favour of type-specific send methods
│   │                                   that natively support keyboards; URL attachments are downloaded
│   │                                   locally before upload to prevent Telegram's server-side fetcher
│   │                                   from misidentifying media types; MarkdownV2 sanitization is
│   │                                   applied before entity offset computation so byte-offsets align
│   │                                   with what the Bot API actually receives
│   │
│   ├── editMessage.ts                — Edits a previously sent message via editMessageText for text-
│   │                                   only edits or editMessageMedia when attachments are provided;
│   │                                   passes inline_message_id as undefined (not null) to satisfy
│   │                                   Telegraf's strict type signature for non-inline messages;
│   │                                   URL-based attachments are downloaded locally first (mirrors
│   │                                   replyMessage.ts behavior for consistent media type handling)
│   │
│   ├── unsendMessage.ts              — Deletes a message by numeric ID; silently swallows errors
│   │                                   because the message may already be deleted, outside the 48-
│   │                                   hour Bot API window, or the bot may lack admin rights
│   │
│   ├── reactToMessage.ts             — Sets a message reaction via Bot API 7.0+ setMessageReaction;
│   │                                   uses type 'emoji' for standard non-paid reactions; the emoji
│   │                                   string is passed through with @ts-expect-error because
│   │                                   Telegraf's strong-typed enum does not cover dynamic strings
│   │
│   ├── getBotID.ts                   — Returns the bot's Telegram user ID; prefers ctx.botInfo.id
│   │                                   (populated by Telegraf on every update, zero network cost)
│   │                                   and falls back to getMe() for the test-mock path
│   │
│   ├── getUserInfo.ts                — Resolves display names for a batch of user IDs; resolves the
│   │                                   sender ID from ctx.from at zero API cost; all other IDs fall
│   │                                   back to "User {id}" because getChatMember is expensive and
│   │                                   requires the user to be in the current chat
│   │
│   ├── getFullUserInfo.ts            — Returns a UnifiedUserInfo for a single user ID; resolution
│   │                                   order: getChatMember for the current chat → ctx.from when IDs
│   │                                   match → stub with "User {userID}" fallback; avatarUrl is null
│   │                                   to avoid the extra getFile round-trip on every info query
│   │
│   ├── getFullThreadInfo.ts          — Returns a UnifiedThreadInfo for a chat ID; fetches via
│   │                                   getChat then populates adminIDs via getChatAdministrators and
│   │                                   memberCount via getChatMembersCount for group/supergroup types;
│   │                                   participantIDs is always empty because the Bot API does not
│   │                                   expose full member lists; falls back to ctx.chat when getChat
│   │                                   fails (bot not a member of the target chat)
│   │
│   ├── getAvatarUrl.ts               — Resolves the most recent profile photo URL via two Bot API
│   │                                   steps: getUserProfilePhotos(userId, 0, 1) then getFileLink
│   │                                   on the largest size variant; CDN URLs have approximately a
│   │                                   1-hour TTL per Bot API specification; non-fatal — returns
│   │                                   null on privacy-blocked profiles or API errors
│   │
│   ├── setGroupName.ts               — Renames the chat via ctx.setChatTitle() (Telegraf v4 context
│   │                                   shortcut that reads chat.id internally)
│   │
│   ├── setGroupImage.ts              — Sets the chat photo; setChatPhoto requires multipart upload
│   │                                   and does not accept remote URL strings — URL inputs are
│   │                                   downloaded via axios first, then uploaded as Buffer via
│   │                                   Input.fromBuffer; Readable stream inputs use
│   │                                   Input.fromReadableStream
│   │
│   ├── removeGroupImage.ts           — Removes the chat photo via ctx.deleteChatPhoto() (Telegraf v4
│   │                                   context shortcut)
│   │
│   ├── removeUserFromGroup.ts        — Kicks a user via ban then immediate unban with only_if_banned;
│   │                                   the immediate unban preserves the user's ability to rejoin via
│   │                                   an invite link — a permanent ban would be too destructive for
│   │                                   a general-purpose kick command
│   │
│   └── setNickname.ts                — Sets a custom administrator title via
│                                       setChatAdministratorCustomTitle; only works for admins —
│                                       regular-member nickname setting is not exposed by the Bot API;
│                                       command modules are expected to handle the resulting API error
│                                       and inform the user that the target must be an admin
│
└── utils/
    ├── helper.util.ts                — Event normalization utilities: pure transformation functions
    │                                   that map raw Telegraf context objects into the unified event
    │                                   contract; separated from wrapper.ts so normalizers can be
    │                                   unit-tested without constructing a TelegramApi instance;
    │                                   normalizeTelegramEvent() maps text/media messages including
    │                                   inline reply_to_message; normalizeNewChatMembersEvent() maps
    │                                   new_chat_members to log:subscribe shape filtering bots out;
    │                                   normalizeLeftChatMemberEvent() maps left_chat_member to
    │                                   log:unsubscribe shape; normalizeTelegramReactionEvent() maps
    │                                   Bot API 7.0+ message_reaction updates extracting the primary
    │                                   emoji from new_reaction falling back to old_reaction;
    │                                   resolveAttachmentUrls() fires parallel getFileLink calls to
    │                                   convert file_id values to CDN URLs; buildTelegramMentionEntities()
    │                                   converts the unified MentionEntry array to Bot API text_mention
    │                                   entity format (tags users by numeric ID without requiring a
    │                                   public @username)
    │
    └── markdownv2.util.ts            — MarkdownV2 text processing utilities: escapeMarkdownV2() escapes
                                        all 18 reserved characters plus backslash for literal plain text;
                                        sanitizeMarkdownV2() is a char-by-char state machine that converts
                                        command-module Markdown (including CommonMark **bold** syntax) to
                                        valid Telegram MarkdownV2 — formatting markers are preserved while
                                        reserved characters inside span content are escaped; the function
                                        is idempotent (re-running on already-sanitized text returns the
                                        same string); validateMarkdownV2() is a quick-exit check that
                                        returns true when sanitizeMarkdownV2 would be a no-op
```

---

## Architectural Layers

### Layer 1 — Public Facade (`index.ts`)

`index.ts` is a pure re-export barrel. It exposes exactly two symbols: `createTelegramListener` and `TelegramConfig`. All other implementation files — `wrapper.ts`, `handlers.ts`, `slash-commands.ts`, and every `lib/` module — are private to the platform directory. This single-entry-point pattern means `adapters/platform/index.ts` never needs to change when internal Telegram implementation details are refactored.

### Layer 2 — Session Orchestration (`listener.ts`)

`createTelegramListener()` returns a `TelegramEmitter` — a Node.js `EventEmitter` augmented with `.start(commands)` and `.stop(signal?)`. It is responsible for sequencing the entire Telegraf lifecycle:

1. Constructing the Telegraf instance
2. Validating the bot token via an explicit `getMe()` call before any handlers are registered
3. Delegating slash-menu registration to `slash-commands.ts`
4. Delegating handler attachment to `handlers.ts`
5. Launching the bot in either long-polling mode (default) or webhook mode
6. Registering the slash-sync callback post-launch so dashboard command toggles can update the live menu

The pre-launch `getMe()` call is critical: `bot.launch()` calls `getMe()` internally as a fire-and-forget Promise. If the token is revoked, the rejection would escape to the process-level `unhandledRejection` handler and crash every session. By calling `getMe()` explicitly before launch, auth errors surface inside `start()` where `withRetry`'s `shouldRetry` gate can classify them as permanent and stop retrying immediately.

### Layer 3 — Handler Registration (`handlers.ts`)

`attachHandlers()` registers all `bot.on()` and `bot.on('message')` listeners on the Telegraf instance. Service message handlers (`new_chat_members`, `left_chat_member`) are registered before the general `'message'` handler because Telegraf uses a Koa-style middleware chain — the first handler that does not call `next()` terminates the chain. If the general `'message'` handler were registered first, service messages would never reach their specific handlers.

Each handler calls a normalizer from `utils/helper.util.ts`, wraps the result with a `TelegramApi` instance from `wrapper.ts`, and emits a typed event on the `TelegramEmitter`. The `callback_query` handler is the one exception to this pattern: it does not call `ctx.answerCbQuery()` — that responsibility is delegated to `button.dispatcher` so the dispatcher can pass a `show_alert: true` popup for unauthorized button clicks before acknowledging the query.

### Layer 4 — Slash Command Menu (`slash-commands.ts`)

`registerSlashMenu()` manages the Telegram Bot API command menu across all four broadcast scopes: `default`, `all_private_chats`, `all_group_chats`, and `all_chat_administrators`. All four must be managed in lockstep to prevent stale entries from persisting as lower-priority scope fallbacks.

The registration logic evaluates a command-hash idempotency gate before every Bot API call:

- **REGISTER** when `prefix === "/"` and either `isCommandRegister` is false or the stored hash does not match the current command set fingerprint
- **CLEAR** when `prefix !== "/"` and the stored state shows commands are still registered
- **SKIP** otherwise — the menu is already in the desired state

When the web dashboard toggles a command on or off, it invokes the slash-sync callback registered in `listener.ts`, which calls `registerSlashMenu` with `forceRegister: true` to bypass the hash check and re-register with the current enabled-set from the database.

### Layer 5 — API Delegation (`wrapper.ts` + `lib/`)

`wrapper.ts` contains a single private class `TelegramApi extends UnifiedApi` and a public factory `createTelegramApi(ctx: Context): UnifiedApi`. The class captures the Telegraf `Context` object at construction time via a private `#ctx` field. Every `override` method is a one-liner that delegates to the corresponding `lib/` function — no Telegram API logic lives in `wrapper.ts` itself.

Two methods implement their own resolution strategy rather than delegating to `lib/`:

- `getUserName()` reads from `ctx.from` at zero API cost for the current sender, then falls back to the database layer for other user IDs
- `getThreadName()` reads from `ctx.chat` at zero API cost, then falls back to the database layer for unresolvable chat types

---

## Boot Sequence

When `app.ts` calls `platform.start(commands)`, the unified platform aggregator (`adapters/platform/index.ts`) calls `startSessionWithRetry()` for each configured Telegram session. Inside the retry wrapper, the Telegram listener's `.start(commands)` executes these sequential phases:

1. A new `Telegraf` instance is constructed with the session's `botToken`
2. `activeBot.telegram.getMe()` is called explicitly — auth errors are thrown here and classified by `shouldRetry` before proceeding
3. `registerSlashMenu()` runs the command-hash gate and either registers, clears, or skips the Bot API call
4. `attachHandlers()` attaches all `bot.on()` listeners — the emitter begins forwarding events to `app.ts` after this step
5. `bot.catch()` absorbs handler-level rejections so one failing command never crashes other sessions
6. The bot is launched in long-polling mode (`bot.launch()`) or webhook mode (`bot.createWebhook()`) based on the `TELEGRAM_WEBHOOK_DOMAIN` environment variable
7. The slash-sync callback is registered with `prefix-manager.lib.ts` so dashboard toggles work without a restart

---

## Event Routing

The Telegram adapter emits five distinct event types on the `TelegramEmitter`. Each payload carries `api` (the `UnifiedApi` instance), `event` (the normalized event object), and `native` (platform context including `userId`, `sessionId`, and the raw Telegraf `ctx`).

```
handlers.ts emits:

├── 'message'           — bot.on('message') for text and all attachment types
│                         (photo, video, audio, document, sticker, voice, animation,
│                         video_note) when the message has no reply_to_message reference
│
├── 'message_reply'     — bot.on('message') when ctx.message.reply_to_message is set
│                         (user tapped "Reply" on an existing message)
│                         The normalizer includes the messageReply inner object so
│                         onReply state flows have access to the replied-to message body
│
├── 'event'             — bot.on(message('new_chat_members')) → logMessageType: 'log:subscribe'
│                         bot.on(message('left_chat_member')) → logMessageType: 'log:unsubscribe'
│
├── 'message_reaction'  — bot.on('message_reaction'); requires the bot to be a GROUP ADMINISTRATOR
│                         and 'message_reaction' listed in allowedUpdates (both polling and
│                         webhook modes include this explicitly); Bot API 7.0+ only
│
└── 'button_action'     — bot.on('callback_query'); emitted with buttonId from cbq.data;
                          answerCbQuery() is intentionally not called here — deferred to
                          button.dispatcher so it can show show_alert popups for unauthorized clicks
```

---

## Slash Command Idempotency

Bot restarts are common during development and after deployments. Issuing `setMyCommands` on every restart would burn Bot API rate-limit budget and produce unnecessary latency. `slash-commands.ts` avoids this using a SHA fingerprint of the serialized command definitions stored in the `bot_credential_telegram` table.

The registration gate evaluates three conditions before every potential Bot API call:

- **Hash match + already registered + prefix "/"** → skip; menu is already in the desired state
- **Hash mismatch or not registered + prefix "/"** → register all eligible commands across all four broadcast scopes; persist new hash and `isCommandRegister: true`
- **prefix != "/" + isCommandRegister is true or hash differs** → clear all four scopes; persist `isCommandRegister: false` with current hash

The `forceRegister` parameter bypasses the hash gate entirely. It is used exclusively by the slash-sync callback triggered from the web dashboard when a command is toggled on or off — the enabled-set changes without altering the command definition hash, so the gate would incorrectly skip the re-registration without this override.

---

## MarkdownV2 Pipeline

Telegram MarkdownV2 requires all 18 reserved characters (`_ * [ ] ( ) ~ ` > # + - = | { } . !`) to be escaped with a backslash — even inside formatting spans. Command modules in this codebase use CommonMark syntax (`**bold**`, `_italic_`) because it is more widely recognized.

`sanitizeMarkdownV2()` in `utils/markdownv2.util.ts` bridges this gap through a char-by-char state machine:

1. `**bold**` is converted to `*bold*` (CommonMark → Telegram single-asterisk bold) before the main pass
2. Recognized formatting spans (`*`, `_`, `__`, `~`, `||`, `` ` ``, ```` ``` ````) are identified by scanning for their closing markers
3. Span content is processed by `escapeInner()` which escapes all reserved characters except the span's own marker character
4. Plain-text characters outside any span escape all 18 reserved characters plus bare backslashes
5. Existing `\X` escape sequences are preserved verbatim in all contexts — the function is idempotent

`sanitizeMarkdownV2` is applied in `replyMessage.ts` and `editMessage.ts` before any entity offset computation. Because mention entity byte-offsets must align with the final string the Bot API receives, sanitization must happen first — inserting backslashes shifts positions and would misplace `text_mention` highlights if applied afterward.

---

## Name Resolution Strategy

Both `getUserName()` and `getThreadName()` in `wrapper.ts` implement an event-first resolution strategy to avoid unnecessary Bot API round-trips on high-frequency message traffic:

- **`getUserName()`**: Reads `ctx.from.first_name + last_name` for the current sender at zero API cost. For any other user ID, falls back to the database layer (`users.repo.ts`) which is populated with display names as messages arrive.
- **`getThreadName()`**: Reads `ctx.chat.title` for groups/supergroups/channels, or `ctx.chat.first_name` for private DMs at zero API cost. Falls back to the database layer (`threads.repo.ts`) for anonymous chats or unresolvable types.
- **`getAvatarUrl()`**: Always makes two Bot API calls (`getUserProfilePhotos` → `getFileLink`) because there is no cache equivalent for CDN URLs. Returns `null` on privacy-blocked profiles rather than throwing. CDN URLs have a ~1 hour TTL.
- **`getFullUserInfo()`** and **`getFullThreadInfo()`**: Make full Bot API calls (`getChatMember`, `getChat`, `getChatAdministrators`) and produce rich `UnifiedUserInfo` / `UnifiedThreadInfo` shapes. `avatarUrl` is `null` in both to avoid the additional `getFile` round-trip during info queries.

The database fallback layer ensures that cross-platform name resolution works correctly — the same `users.repo.ts` and `threads.repo.ts` functions are used by all platform adapters, so a display name stored by a Facebook Messenger message is accessible to Telegram commands that reference the same user ID.

---

## Key Design Decisions

**Pre-launch `getMe()` validation.** `bot.launch()` in Telegraf calls `getMe()` internally as an unhandled Promise. A revoked token causes an unhandled rejection that crashes every session via `process.once('unhandledRejection')`. Calling `getMe()` explicitly before launch surfaces the error inside `start()` where `withRetry`'s `shouldRetry` classifies it as permanent auth failure and stops retrying immediately — only the affected session goes offline.

**Service handlers before general `'message'` handler.** Telegraf's middleware chain is Koa-style: first matching handler wins. Registering `new_chat_members` and `left_chat_member` handlers before the general `'message'` handler ensures service messages always reach their specific normalizers. The general handler retains a guard checking for `msg.new_chat_members` and `msg.left_chat_member` as a safety net for unexpected delivery paths.

**Deferred `answerCbQuery()` in button handler.** Discord's equivalent `deferUpdate()` is called inside `event-handlers.ts` for the same reason: the acknowledgment must fire quickly. Telegram's `callback_query` acknowledgment window is approximately 10 seconds, which is less urgent, but the deferral to `button.dispatcher` serves a different purpose — it allows the dispatcher to pass an alert text via `show_alert: true` for unauthorized button clicks before acknowledging, producing a native modal popup visible only to the user who pressed the button.

**Modular `lib/` extraction.** Each `lib/` function accepts only the Telegraf `Context` and its specific operation parameters — no `UnifiedApi`, no Cat-Bot types. This makes them independently testable without constructing a full session context. `wrapper.ts` is a thin composition layer that supplies the `#ctx` reference; it never contains Telegram API logic itself.

**Four-scope broadcast management for slash commands.** Telegram's command menu uses a 7-scope priority chain. Managing only the `default` scope would leave stale entries in the three specific broadcast scopes persisting as fallbacks when the bot switches to a non-slash prefix. Clearing all four scopes ensures the menu is completely removed when `prefix != "/"`.

**MarkdownV2 sanitization before entity computation.** Command modules use CommonMark syntax. `sanitizeMarkdownV2()` inserts backslash escape characters into the text. Because `text_mention` entity byte-offsets must align with the exact bytes the Bot API receives, sanitization is applied first in `replyMessage.ts` — any offsets computed against the pre-sanitized string would be incorrect after backslashes are inserted.