# Changelog

All notable changes to the Cat-Bot project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [1.0.4] — 2026-05-07

### cat-bot

#### Dependencies

- **Updated `fca-cat-bot` from `1.0.5` to `1.0.6`**: Bumped the Facebook Messenger E2EE transport library to its latest patch release. The `^1.0.6` range in `package.json` tracks future non-breaking patch fixes automatically.

---

## [1.0.3] — 2026-05-06

### cat-bot

#### Fixed

- **Explicit `0.0.0.0` host binding** (`src/server/server.ts`): `httpServer.listen()` now binds to `0.0.0.0` explicitly instead of Node.js's default `::` (IPv6 dual-stack). Container runtimes where `IPV6_V6ONLY=1` is the default silently dropped all IPv4 traffic under the previous binding — the explicit address guarantees reachability for both IPv4 and IPv6 clients.

#### Changed

- **`PORT` env var is now optional** (`src/engine/config/env.config.ts`): `PORT` is read via `getOptionalEnv` and defaults to `3000` when unset. Operators can omit `PORT` from their `.env` file entirely in development without a startup validation error.

## [1.0.2] — 2026-05-06

### cat-bot

#### Added

- **`thread.getMemberCount()`** on `ThreadContext` (`ctx.thread.getMemberCount`): New unified method returning the real-time member count for the current thread or group. Platform mapping: Discord → `guild.memberCount` from gateway cache (zero REST); Telegram → `getChatMemberCount` Bot API; Facebook Messenger → `participantIDs` from the raw event payload (zero API cost on the hot path) with `getFullThreadInfo` as fallback. Defaults to the triggering event's thread when called without arguments.

#### Changed

- **`join.ts` and `leave.ts` greeting banners**: Both event handlers now resolve real-time member count via `thread.getMemberCount()` and thread name for greeting image cards, displaying the accurate group size at the moment of join or leave.


#### Dependencies

- **Migrated from `fca-unofficial-e2ee` to `fca-cat-bot`**: The E2EE transport layer now uses `fca-cat-bot`, which bundles `FB-Messenger-E2EE` — a pure JavaScript E2EE implementation with no Golang runtime or `meta-messenger-js` bridge. The previous library's Golang subprocess caused unbounded RSS memory growth per session. Memory under `fca-cat-bot` is stable and scales on demand.

#### Performance

- **Facebook Messenger `getMemberCount` short-circuit**: For current-thread queries, `participantIDs` from the raw fca event payload is used directly (zero API cost) instead of triggering a `getFullThreadInfo` GraphQL round-trip. Cross-thread queries fall back to the platform API as before.

- **`participantIDs` forwarded through event router**: Raw `participantIDs` from fca events are now preserved on `message_reaction`, `message_unsend`, `event`, and `change_thread_image` payloads so join/leave handlers can derive the real-time roster length without an extra API call.

## [1.0.1] — 2026-05-02

### cat-bot

#### Added

- **`/out` command** (`src/app/commands/out.ts`): New bot self-eject command restricted to `Role.BOT_ADMIN` and above. Supports two paths: leaving the current thread (no argument) and leaving a specified thread by ID while confirming in the invoker's thread. Restricted to Discord, Telegram, and Facebook Messenger — Facebook Page is always 1:1 and has no group membership to leave. The bot sends a farewell message before leaving so delivery is attempted while it is still a member.

- **`bot.leave(threadID?)` API** on `BotContext` (`ctx.bot.leave`): New unified method that makes the bot exit a thread or group. Omitting `threadID` falls back to the triggering event's thread. Platform mapping: Discord → `guild.leave()` (channel ID resolved to server ID first); Telegram → Bot API `leaveChat(chatId)`; Facebook Messenger → `removeUserFromGroup(botId, threadID)`. Exposed via `createBotContext` in `context.model.ts` and implemented across `discord/wrapper.ts`, `telegram/wrapper.ts`, and `facebook-messenger/wrapper.ts`.

- **`/unsend` command** (`src/app/commands/unsend.ts`): New message deletion command requiring invocation as a reply to the target message. On Facebook Messenger, restricted to bot-owned messages only (platform has no delete-others API). On Discord and Telegram, supports deleting any user's message when the invoker holds sufficient authority — permission gate mirrors the `enforcePermission` hierarchy: system admin → bot admin → thread admin → deny. Prevents any authenticated user from weaponising the bot's `MANAGE_MESSAGES` / `can_delete_messages` permission.

#### Changed

- **`join.ts` event guard**: The bot joining its own group no longer triggers a self-welcome message. Added a `bot.getID()` check so the welcome fires only when the added participants do not include the bot itself.

- **`leave.ts` event guard**: The bot being removed or leaving a group no longer attempts to send a departure message into a thread it can no longer reach. Added a `bot.getID()` check so the leave message fires only when the departing participant is not the bot itself.
