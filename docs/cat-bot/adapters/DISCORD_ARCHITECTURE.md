# Discord Platform Adapter — Architecture

## Overview

The Discord platform adapter is the transport layer that bridges Discord.js gateway events to the Cat-Bot unified event contract. It sits entirely below `src/engine/app.ts` and above `discord.js` — command modules and event handlers above it never import Discord types directly; the platform below it never knows about Cat-Bot's business logic.

The adapter is structured as a four-layer stack: **orchestration → client lifecycle → event normalization → API delegation**. Each layer has a single owner file with narrowly scoped helpers extracted into `lib/` and `utils/` subdirectories. The external contract exposed upward is a single `EventEmitter` instance whose emitted payload shapes are identical to every other platform adapter.

---

## Module File Tree

```
src/engine/adapters/platform/discord/
│
├── index.ts                          — Orchestrator: composes client, slash-commands, and event-handlers
│                                       in the correct boot order; owns the EventEmitter returned to
│                                       adapters/platform/index.ts; registers the slash-sync callback
│                                       so dashboard toggles can live-update the Discord "/" menu
│
├── client.ts                         — Client lifecycle: creates the discord.js Client with all required
│                                       intents and partials; performs login and waits for ClientReady;
│                                       registers the "error" handler that absorbs gateway failures
│                                       without killing the process; exposes onFatalError for auth-drop
│                                       notification back to the session manager
│
├── slash-commands.ts                 — Slash command registration: builds SlashCommandBuilder payloads
│                                       from the loaded commands Map; guards with a SHA-based command
│                                       hash stored in the DB to skip REST when the menu is unchanged;
│                                       enforces Discord's 100-command global limit; handles both
│                                       register (prefix="/") and clear (prefix≠"/") paths;
│                                       clearGuildCommands() is called on guildCreate to prevent
│                                       visible duplicates between guild-scoped and global menus
│
├── event-handlers.ts                 — Event listener attachment: attaches all discord.js .on() listeners
│                                       to the Client instance; normalizes every native Discord event
│                                       into the unified Cat-Bot shape and emits it on the shared
│                                       EventEmitter; slash interactions are processed internally
│                                       (not emitted to app.ts) because deferReply() must fire
│                                       within Discord's 3-second acknowledgment window
│
├── wrapper.ts                        — UnifiedApi factories: two factory functions create UnifiedApi
│                                       adapters keyed to either an interaction context (slash commands,
│                                       button presses) or a channel context (message events, guild
│                                       member events); each method delegates to the corresponding
│                                       lib/ function with the appropriate discord.js reference;
│                                       cross-channel resolution lets commands send to DMs or relay
│                                       channels by accepting a user ID or channel ID as threadID
│
├── unsupported.ts                    — Unsupported stubs: operations impossible under a standard bot
│                                       token (addUserToGroup requires OAuth guilds.join scope;
│                                       setGroupReaction has no Discord concept equivalent);
│                                       grouped in one file so wrapper.ts imports one module
│                                       rather than handling no-ops inline
│
├── lib/                              — Pure operation functions: each file is one operation; every
│   │                                   function accepts only the discord.js objects it strictly
│   │                                   needs (no UnifiedApi, no Cat-Bot types) so they are
│   │                                   independently testable and replaceable
│   │
│   ├── sendMessage.ts                — Sends a text/attachment message via an abstract sendFn closure;
│   │                                   handles both direct-string and SendPayload shapes; processes
│   │                                   NamedStreamAttachment[] and NamedUrlAttachment[] arrays
│   │
│   ├── replyMessage.ts               — Sends a message with optional reply-threading, attachment arrays,
│   │                                   and button component rows; maps unified ButtonStyle strings to
│   │                                   discord.js ButtonStyle enum values; uses the abstract sendFn
│   │                                   pattern so both interaction and channel paths share logic
│   │
│   ├── editMessage.ts                — Edits a previously sent bot message; fetches the Message object
│   │                                   from the channel before editing; builds ActionRow components
│   │                                   from ButtonItem[][] rows; an explicit undefined check on the
│   │                                   button field allows passing an empty array to clear all buttons
│   │
│   ├── unsendMessage.ts              — Deletes a message by ID; channel=null is a no-op (slash command
│   │                                   interaction replies cannot be deleted via the interaction API)
│   │
│   ├── reactToMessage.ts             — Adds an emoji reaction; reuses a rawMessage reference when the
│   │                                   message ID matches to avoid a REST fetch round-trip
│   │
│   ├── getUserInfo.ts                — Resolves display names for a list of user IDs via a caller-supplied
│   │                                   resolveUser closure; the closure abstraction keeps this function
│   │                                   agnostic between the interaction path and the channel path
│   │
│   ├── getBotID.ts                   — Returns the bot's own Discord user ID; prefers client.user.id
│   │                                   (interaction path) and falls back to guild.members.me.user.id
│   │                                   (channel path) before throwing
│   │
│   ├── getFullThreadInfo.ts          — Returns a UnifiedThreadInfo for a Discord guild; fetches the
│   │                                   guild via channels.fetch(threadID) then guild.fetch() to hydrate
│   │                                   fields like approximateMemberCount; produces a DM-safe fallback
│   │                                   when no guild context is available
│   │
│   ├── getFullUserInfo.ts            — Returns a UnifiedUserInfo for a Discord user ID; resolution order:
│   │                                   client.users.fetch() → selfUser shortcut → guild.members.fetch()
│   │                                   → stub with id only
│   │
│   ├── getAvatarUrl.ts               — Resolves a user's avatar URL; resolution order:
│   │                                   guild member cache (captures server-specific overrides) →
│   │                                   guild.members.fetch() → client.users.cache → client.users.fetch()
│   │
│   ├── setGroupName.ts               — Renames the guild; verifies ManageGuild permission before calling
│   │                                   guild.setName()
│   │
│   ├── setGroupImage.ts              — Sets the guild icon; converts Readable streams to Buffer because
│   │                                   guild.setIcon() does not accept Node.js streams
│   │
│   ├── removeGroupImage.ts           — Removes the guild icon by passing null to guild.setIcon()
│   │
│   ├── removeUserFromGroup.ts        — Kicks a guild member; requires the bot's role to be higher in
│   │                                   the hierarchy than the target member
│   │
│   └── setNickname.ts                — Sets a guild member's display nickname; pass null or empty string
│                                       to clear back to the account username
│
└── utils/
    ├── helper.util.ts                — Stream and mention utilities: streamToBuffer() collects stream
    │                                   chunks via async iteration (preferred over EventEmitter for
    │                                   discord.js async-iterables); buildDiscordMentionMsg() replaces
    │                                   @tag placeholders with Discord's <@userId> format using
    │                                   split+join to avoid RegExp escaping edge cases; re-exports
    │                                   urlToStream from the shared engine streams utility
    │
    └── normalizers.util.ts           — Event normalizers: six functions transform native discord.js
                                        event objects into the unified Cat-Bot event shapes; extraction
                                        from helper.util.ts keeps stream utilities and event normalization
                                        as separate concerns; event-handlers.ts imports only these
                                        functions from here, never from wrapper.ts
```

---

## Architectural Layers

### Layer 1 — Orchestration (`index.ts`)

`createDiscordListener()` returns an `EventEmitter` augmented with `.start(commands)` and `.stop(signal?)`. It does not contain any discord.js code directly — its only responsibility is sequencing the three phases and registering the slash-sync callback with the prefix manager. The slash-sync callback is captured by closure reference to `activeClient` and `activeCommands` so subsequent `stop → start` cycles automatically bind to the new Client instance without re-registering.

### Layer 2 — Client Lifecycle (`client.ts`)

`createDiscordClient()` is the single place that touches `GatewayIntentBits`, `Partials`, and the login flow. It wraps the login in a `Promise<void>` that resolves on `Events.ClientReady` and rejects on login failure — the rejection propagates to `startSessionWithRetry` in `adapters/platform/index.ts`, which classifies auth errors as permanent and stops retrying immediately. The `client.on('error')` handler added after successful login absorbs WebSocket failures that would otherwise terminate the Node.js process.

### Layer 3 — Event Normalization (`event-handlers.ts` + `utils/normalizers.util.ts`)

`attachEventHandlers()` registers all `client.on()` listeners in one place. Each handler calls the corresponding normalizer from `normalizers.util.ts` to produce a `Record<string, unknown>` matching the Cat-Bot unified event contract, then wraps the result with an appropriate `UnifiedApi` instance from `wrapper.ts` and emits on the shared `EventEmitter`.

Slash command `interactionCreate` events are the one exception: they are dispatched to `handleMessage` internally rather than emitted to `app.ts`, because Discord requires `interaction.deferReply()` to be called within three seconds. Delegating through the emitter would risk missing that window. Button `interactionCreate` events call `interaction.deferUpdate()` immediately for the same reason, then emit `'button_action'` with a purpose-built event payload.

### Layer 4 — API Delegation (`wrapper.ts` + `lib/`)

`wrapper.ts` exposes two factory functions producing `UnifiedApi`-compatible objects:

**`createDiscordApi(interaction)`** — for slash commands and button interactions. Implemented as a private class `DiscordApi extends UnifiedApi` with a `#firstSend` tracker. The first call to `#send()` uses `editReply()` (deferred) or `reply()` (not deferred); subsequent calls use `followUp()`. When constructed with `isButtonInteraction=true`, all sends go to `followUp()` directly because `deferUpdate()` has already been called and `editReply()` would overwrite the original button message.

**`createDiscordChannelApi(channel, guild, rawMessage?, client?)`** — for non-interaction events such as `messageCreate`, `guildMemberAdd`, and `guildMemberRemove`. Returns a plain `UnifiedApi` instance with all methods replaced via direct assignment. The `resolveChannel()` helper inside this factory allows commands to send to a different channel or DM by passing a user ID or channel ID as `threadID`.

Both factories share the same `lib/` functions. The abstraction point is a `sendFn` closure passed into `lib/sendMessage.ts` and `lib/replyMessage.ts`, letting each factory supply its own send strategy without duplicating attachment-handling logic.

---

## Boot Sequence

When `app.ts` calls `platform.start(commands)`, the unified platform aggregator (`adapters/platform/index.ts`) calls `startSessionWithRetry()` for each configured Discord session. Inside the retry wrapper, the Discord listener's `.start(commands)` executes three sequential phases:

1. `createDiscordClient()` — authenticates with the Discord gateway and waits for `ClientReady`
2. `registerSlashCommands()` — computes a SHA hash of the current command set and skips the REST call if the DB shows the menu is already current; clears guild-scoped duplicates before publishing global commands
3. `attachEventHandlers()` — attaches all `client.on()` listeners; the emitter begins forwarding events to `app.ts` only after this phase completes

After all three phases succeed, the slash-sync callback is registered with `prefix-manager.lib.ts` so the web dashboard can trigger live command-menu updates without restarting the bot.

---

## Event Routing

The Discord adapter emits five distinct event types on the unified `EventEmitter`. Each payload carries three fields: `api` (the `UnifiedApi` adapter), `event` (the normalized event object), and `native` (platform context including `userId`, `sessionId`, and the raw discord.js object for consumers that need it).

```
discord/event-handlers.ts emits:

├── 'message'           — messageCreate (non-bot, no reply reference)
│                         interactionCreate/ChatInputCommand (slash commands routed as messages)
│
├── 'message_reply'     — messageCreate with message.reference set (user hit "Reply")
│
├── 'event'             — guildMemberAdd  → logMessageType: 'log:subscribe'
│                         guildMemberRemove → logMessageType: 'log:unsubscribe'
│
├── 'message_reaction'  — messageReactionAdd (after partial fetch if needed)
│
├── 'message_unsend'    — messageDelete
│
└── 'button_action'     — interactionCreate/isButton (after deferUpdate())
```

The `'message_reply'` distinction allows `app.ts` to subscribe granularly — commands using `onReply` state flows need the reply-thread reference while plain `onCommand` handlers treat both as the same surface.

---

## Slash Command Idempotency

`slash-commands.ts` avoids redundant REST round-trips on every bot restart using a SHA-256 hash of the serialized command definitions stored in the `bot_credential_discord` table. The registration gate evaluates three conditions:

- **REGISTER** when `prefix === "/"` and either `isCommandRegister` is false or the stored hash does not match the current hash
- **CLEAR** when `prefix !== "/"` and the stored state shows commands are still registered
- **SKIP** in all other cases — the menu is already in the desired state

When the web dashboard toggles a command on or off, it calls the slash-sync callback registered on `prefix-manager.lib.ts`, which bypasses the hash check (`forceRegister: true`) and re-registers with the current enabled-set from the database. This ensures the Discord "/" menu always reflects the admin's current configuration without requiring a bot restart.

The 100-command global limit is enforced before any REST call — exceeding it clears the menu entirely and logs a loud warning rather than submitting a payload Discord would reject with HTTP 400.

---

## Dual-Path API Design

The same `lib/` functions serve both the interaction path and the channel path through the `sendFn` closure pattern. `lib/replyMessage.ts` accepts a `SendFn` type that is either:

- **Interaction path**: `(content, files, replyId?, components?) => this.#send(content, files, components)`
- **Channel path**: `(content, files, replyId?, components?) => channel.send({ content, ... })`

This means attachment serialization, URL-to-stream conversion, mention replacement, and button component building happen once in `lib/replyMessage.ts` regardless of which transport path initiated the send. The only difference between the two paths is where the final message object is dispatched.

---

## Cross-Channel Resolution

Both `DiscordApi` (interaction path) and `createDiscordChannelApi` (channel path) implement a `resolveChannel()` helper that supports sending to a channel or user other than the one associated with the triggering event. The resolution order is:

1. Return the bound channel if `threadID` matches (no resolution needed)
2. `client.channels.fetch(threadID)` — resolves guild text channel IDs
3. `client.users.fetch(threadID)` then `user.createDM()` — resolves user IDs to DM channels

This is primarily used by the `callad` command which relays messages between user threads and admin DMs.

---

## Name Resolution Strategy

Both API factories implement a cache-first strategy for `getUserName()` and `getThreadName()` to avoid REST budget consumption on high-traffic bots:

- **`getUserName()`**: `GuildMemberManager.cache` (populated by `GatewayIntentBits.GuildMembers`) → `client.users.cache` → database fallback via `users.repo.ts`
- **`getThreadName()`**: `guild.name` from guild cache → channel name → database fallback via `threads.repo.ts`
- **`getAvatarUrl()`**: guild member cache (captures server-specific overrides) → `guild.members.fetch()` → `client.users.cache` → `client.users.fetch()`

The database fallback ensures that Facebook Messenger or Telegram users whose IDs land in a cross-platform command still resolve correctly — the DB is populated with display names as messages arrive.

---

## Key Design Decisions

**Modular `lib/` extraction over a monolithic wrapper class.** Each lib function accepts only the discord.js objects it strictly needs, making them independently testable. `wrapper.ts` is a thin composition layer that supplies closures; it never contains Discord API logic itself.

**Two factories instead of one.** `DiscordApi` (class) tracks `#firstSend` state because slash command interactions have a strict reply sequence: `deferReply` → `editReply` → `followUp`. A stateless object literal cannot model this. The channel-path factory (`createDiscordChannelApi`) has no such state and can be a plain object, which is simpler and incurs no class overhead.

**Normalizers extracted from helper utilities.** `utils/normalizers.util.ts` and `utils/helper.util.ts` are separate files. Stream utilities and event normalization are orthogonal concerns — mixing them would force every consumer to import the entire module when it only needs one of the two capabilities.

**Slash command acknowledgment inside `event-handlers.ts`.** Discord's three-second interaction acknowledgment window cannot be safely crossed by an async EventEmitter emit. Processing slash interactions synchronously inside `event-handlers.ts` — calling `deferReply()` before any other async work — guarantees the window is never missed regardless of how busy the event loop is.

**Command-hash idempotency gate.** Bot restarts are common during development. Issuing a global PUT to Discord's REST API on every restart would burn rate-limit budget and cause noticeable latency. The SHA hash stored in the database eliminates this cost for the common case where commands have not changed.