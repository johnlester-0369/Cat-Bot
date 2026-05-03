# Changelog

All notable changes to the Cat-Bot project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [1.0.1] — 2026-05-02

### cat-bot

#### Added

- **`/out` command** (`src/app/commands/out.ts`): New bot self-eject command restricted to `Role.BOT_ADMIN` and above. Supports two paths: leaving the current thread (no argument) and leaving a specified thread by ID while confirming in the invoker's thread. Restricted to Discord, Telegram, and Facebook Messenger — Facebook Page is always 1:1 and has no group membership to leave. The bot sends a farewell message before leaving so delivery is attempted while it is still a member.

- **`bot.leave(threadID?)` API** on `BotContext` (`ctx.bot.leave`): New unified method that makes the bot exit a thread or group. Omitting `threadID` falls back to the triggering event's thread. Platform mapping: Discord → `guild.leave()` (channel ID resolved to server ID first); Telegram → Bot API `leaveChat(chatId)`; Facebook Messenger → `removeUserFromGroup(botId, threadID)`. Exposed via `createBotContext` in `context.model.ts` and implemented across `discord/wrapper.ts`, `telegram/wrapper.ts`, and `facebook-messenger/wrapper.ts`.

- **`/unsend` command** (`src/app/commands/unsend.ts`): New message deletion command requiring invocation as a reply to the target message. On Facebook Messenger, restricted to bot-owned messages only (platform has no delete-others API). On Discord and Telegram, supports deleting any user's message when the invoker holds sufficient authority — permission gate mirrors the `enforcePermission` hierarchy: system admin → bot admin → thread admin → deny. Prevents any authenticated user from weaponising the bot's `MANAGE_MESSAGES` / `can_delete_messages` permission.

#### Changed

- **`join.ts` event guard**: The bot joining its own group no longer triggers a self-welcome message. Added a `bot.getID()` check so the welcome fires only when the added participants do not include the bot itself.

- **`leave.ts` event guard**: The bot being removed or leaving a group no longer attempts to send a departure message into a thread it can no longer reach. Added a `bot.getID()` check so the leave message fires only when the departing participant is not the bot itself.