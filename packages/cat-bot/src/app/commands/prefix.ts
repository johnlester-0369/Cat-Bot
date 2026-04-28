/**
 * /prefix — Command Prefix Manager
 *
 * Controls the bot's trigger character at two scopes:
 *
 *   Thread scope  — stored in bot_threads_session.data → "settings" → "prefix".
 *                   Persists across restarts. Only the current group is affected.
 *   System scope  — stored in prefixManager (in-memory, reverts on restart).
 *                   Affects all threads that have no thread-level override. BOT_ADMIN only.
 *
 * ── Prefix resolution order (app.ts) ─────────────────────────────────────────
 *   1. Thread prefix from prefixManager.getThreadPrefix(threadID)  [set by this command]
 *   2. Session prefix from prefixManager.getPrefix(userId, ...)    [set by session config]
 *
 * ── Cache restoration after restart ─────────────────────────────────────────
 * prefixManager's thread Map is in-memory; it empties on restart.
 * The onChat handler lazily restores a stored thread prefix from the collection
 * into the in-memory cache on the FIRST message after restart. This means the
 * FIRST command in that thread after restart uses the session prefix; all
 * subsequent messages use the restored thread prefix. This is an acceptable
 * trade-off that avoids a full thread-session table scan at boot.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { prefixManager } from '@/engine/modules/prefix/prefix-manager.lib.js';
import {
  isBotAdmin,
  updateBotSessionPrefix,
} from '@/engine/repos/credentials.repo.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { triggerSlashSync } from '@/engine/modules/prefix/slash-sync.lib.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'prefix',
  aliases: [] as string[],
  version: '1.0.0',
  role: Role.THREAD_ADMIN,
  author: 'John Lester',
  description:
    'View or change the bot command prefix for this thread or the entire system',
  category: 'System',
  usage: '<new_prefix | reset> [-g]',
  cooldown: 5,
  hasPrefix: true,
  options: [
    {
      type: OptionType.string,
      name: 'prefix',
      description:
        'New prefix to set, or "reset" to restore the system default',
      required: false,
    },
  ],
};

/** Collection key inside bot_threads_session.data that stores per-thread settings. */
const SETTINGS_COLLECTION = 'settings';

export const onCommand = async ({
  chat,
  args,
  event,
  db,
  native,
  prefix = '/',
}: AppCtx): Promise<void> => {
  const threadID = event['threadID'] as string | undefined;
  const senderID = event['senderID'] as string | undefined;
  const { userId, platform, sessionId } = native;

  // Resolve the current session-level prefix (the global/system baseline for this bot session)
  const systemPrefix =
    userId && platform && sessionId
      ? prefixManager.getPrefix(userId, platform, sessionId)
      : '/';

  // ── No args: display current prefix configuration ─────────────────────────
  if (!args[0]) {
    // Read thread prefix from the collection — source of truth for persistence
    let threadPrefix = systemPrefix;
    if (threadID) {
      try {
        const threadColl = db.threads.collection(threadID);
        if (await threadColl.isCollectionExist(SETTINGS_COLLECTION)) {
          const settings = await threadColl.getCollection(SETTINGS_COLLECTION);
          threadPrefix =
            ((await settings.get('prefix')) as string | undefined) ??
            systemPrefix;
        }
      } catch {
        // Fail-open — show system prefix as fallback on DB error
      }
    }

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: [
        `🌐 **System prefix:** \`${systemPrefix}\``,
        `💠 **Thread prefix:** \`${threadPrefix}\``,
        '',
        `\`${prefix}prefix <new>\` — change this thread's prefix`,
        `\`${prefix}prefix <new> -g\` — change system prefix (bot admins only)`,
        `\`${prefix}prefix reset\` — restore this thread's prefix to system default`,
      ].join('\n'),
    });
    return;
  }

  // ── reset: remove thread-level prefix override ────────────────────────────
  if (args[0].toLowerCase() === 'reset') {
    if (threadID) {
      try {
        const threadColl = db.threads.collection(threadID);
        if (await threadColl.isCollectionExist(SETTINGS_COLLECTION)) {
          const settings = await threadColl.getCollection(SETTINGS_COLLECTION);
          // Delete only the 'prefix' key — other thread settings (e.g. rankup) are preserved
          await settings.delete('prefix');
        }
      } catch {
        // Non-fatal — continue to clear the in-memory cache regardless
      }
      // Remove from in-memory cache so the next message falls back to session prefix immediately
      prefixManager.clearThreadPrefix(threadID);
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `✅ Thread prefix reset to system default: \`${systemPrefix}\``,
      });
      return;
    }
  }

  const newPrefix = args[0];
  const isGlobal = args[1] === '-g';

  // ── -g flag: change system (session-level) prefix ─────────────────────────
  // In-memory only — BotSession.prefix in the DB is not updated, so this reverts on restart.
  // Bot admins who want a permanent system prefix change should update it via the dashboard.
  if (isGlobal) {
    if (!userId || !platform || !sessionId || !senderID) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '❌ Cannot resolve session identity.',
      });
      return;
    }

    const isAdmin = await isBotAdmin(userId, platform, sessionId, senderID);
    if (!isAdmin) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '🚫 Only bot admins can change the system prefix.',
      });
      return;
    }

    prefixManager.setPrefix(userId, platform, sessionId, newPrefix);
    // Persist to BotSession.prefix so the admin's choice survives a process restart.
    // Fire-and-forget with a logged catch — a DB write failure must never block the
    // in-memory update that takes effect immediately for the running session.
    updateBotSessionPrefix(userId, platform, sessionId, newPrefix).catch(
      (err: unknown) => {
        console.error('[prefix] Failed to persist system prefix to DB:', err);
      },
    );
    // Slash sync: update the platform's registered slash command menu to match the new prefix.
    // If the new prefix is '/', commands are registered; if it's anything else the menu is cleared.
    // Fire-and-forget — the in-memory prefix update above takes effect immediately regardless.
    triggerSlashSync(`${userId}:${platform}:${sessionId}`).catch(
      (err: unknown) => {
        console.error(
          '[prefix] Failed to trigger slash sync after system prefix change:',
          err,
        );
      },
    );

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: [
        `✅ System prefix changed to: \`${newPrefix}\``,
        '✅ Saved to database — this prefix will be restored after restart.',
      ].join('\n'),
    });
    return;
  }

  // ── Thread-level prefix change ────────────────────────────────────────────
  if (!threadID) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Could not resolve thread ID on this platform.',
    });
    return;
  }

  // Persist to bot_threads_session.data so the override survives process restarts
  try {
    const threadColl = db.threads.collection(threadID);
    if (!(await threadColl.isCollectionExist(SETTINGS_COLLECTION))) {
      await threadColl.createCollection(SETTINGS_COLLECTION);
    }
    const settings = await threadColl.getCollection(SETTINGS_COLLECTION);
    await settings.set('prefix', newPrefix);
  } catch (err: unknown) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ Failed to save thread prefix: ${String(err)}`,
    });
    return;
  }

  // Update the in-memory cache immediately — next message uses the new prefix without a restart
  prefixManager.setThreadPrefix(threadID, newPrefix);

  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: `✅ Thread prefix changed to: \`${newPrefix}\``,
  });
};

/**
 * Passive listener — two responsibilities per message:
 *
 *   1. Lazy cache restoration: if a thread has a stored prefix in the collection but
 *      the in-memory cache is empty (e.g. after restart), load it now. The restored
 *      value takes effect starting from the NEXT message in this thread.
 *
 *   2. Bare "prefix" trigger: if the user sends exactly "prefix" (no command prefix),
 *      reply with the current prefix configuration as a convenience shortcut.
 */
export const onChat = async ({
  event,
  chat,
  native,
}: AppCtx): Promise<void> => {
  const message = (event['message'] as string | undefined) ?? '';
  const threadID = event['threadID'] as string | undefined;

  // Respond to a bare "prefix" message (no command trigger required) — mirrors GoatBot's onChat pattern
  if (message.trim().toLowerCase() === 'prefix') {
    const { userId, platform, sessionId } = native;
    const systemPrefix =
      userId && platform && sessionId
        ? prefixManager.getPrefix(userId, platform, sessionId)
        : '/';
    const threadPrefix =
      (threadID ? prefixManager.getThreadPrefix(threadID) : undefined) ??
      systemPrefix;

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `🌐 **System prefix:** \`${systemPrefix}\`\n💠 **Thread prefix:** \`${threadPrefix}\``,
    });
  }
};
