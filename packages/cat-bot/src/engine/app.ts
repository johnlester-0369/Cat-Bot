/**
 * Cat-Bot — Central Entry Point & Orchestration Layer
 *
 * This file owns everything above the platform transport layer:
 *   1. Module loading  — reads src/app/commands/ and src/app/events/
 *   2. Platform setup  — creates EventEmitter-based platform listeners
 *   3. Event wiring    — subscribes to typed platform events and delegates
 *                        to the unified handler (src/controllers/index.ts)
 *
 * ── Platform Listener Pattern ────────────────────────────────────────────────
 * Each platform (discord/, telegram/, facebook-messenger/, facebook-page/)
 * exposes a createXxxListener() factory that returns a Node.js EventEmitter.
 * The listener emits events keyed by EventType (e.g. 'message', 'message_reply',
 * 'message_reaction', 'message_unsend', 'event') carrying the payload:
 *
 *   { api: UnifiedApi, event: UnifiedEvent, native: PlatformNative }
 *
 * app.ts registers .on() handlers for each event type BEFORE calling
 * listener.start() to boot the transport. This separation means:
 *
 *   - Platforms know HOW to receive and normalise events (transport concern)
 *   - app.ts knows WHERE to route events (orchestration concern)
 *   - Adding a new platform = import listener + register .on() handlers
 *   - Platform event types follow models/event.model.ts EventType values
 *
 * ── Event routing ─────────────────────────────────────────────────────────────
 *   'message'          → handleMessage (all platforms)
 *   'message_reply'    → handleMessage (Discord, Telegram, Facebook Messenger)
 *   'event'            → handleEvent   (all platforms)
 *   'message_reaction' → handleEvent   (Facebook Messenger only via MQTT)
 *   'message_unsend'   → handleEvent   (Facebook Messenger only via MQTT)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

// ── Core config and logging ───────────────────────────────────────────────────
import { env } from '@/engine/config/env.config.js';
import { logger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module
import { loadSessionConfigs } from '@/engine/utils/session-loader.util.js';
import { prefixManager } from '@/engine/modules/prefix/prefix-manager.lib.js';

// ── Handler — imported via @/ alias for consistency with the rest of the codebase ──
import {
  handleMessage,
  handleEvent,
  handleButtonAction,
} from '@/engine/controllers/index.js';
import type { UnifiedApi } from '@/engine/adapters/models/api.model.js';

// ── Platform listeners ────────────────────────────────────────────────────────
import { createUnifiedPlatformListener } from '@/engine/adapters/platform/index.js';
// Side-effect import — registers the default middleware pipeline (validateCommandOptions,
// chatPassthrough, etc.) so the registry is fully populated before platform.start() fires.
import '@/engine/middleware/index.js';
import { sessionManager } from '@/engine/modules/session/session-manager.lib.js';
// Command/event registry sync — needed to populate bot_session_commands/events at boot
import { Platforms } from '@/engine/constants/platform.constants.js';
import { upsertSessionCommands } from '@/engine/modules/session/bot-session-commands.repo.js';
import { commandRegistry, eventRegistry } from '@/engine/lib/module-registry.lib.js';
import { upsertSessionEvents } from '@/engine/modules/session/bot-session-events.repo.js';
import type { SessionConfigs } from '@/engine/utils/session-loader.util.js';
import { isPlatformAllowed } from '@/engine/utils/platform-filter.util.js';
import { startServer } from '@/server/server.js';

// ============================================================================
// __dirname equivalent — needed for dynamic module path resolution in ESM
// ============================================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// MODULE LOADER — single source of truth for commands and events
// ============================================================================

/**
 * Dynamically imports every .js file in src/app/commands/ and returns a
 * Map keyed by lowercased command name. Invalid modules are skipped with a
 * warning so a single broken file never prevents the bot from starting.
 */
async function loadCommands(): Promise<Map<string, Record<string, unknown>>> {
  const commands = new Map<string, Record<string, unknown>>();
  const dir = path.join(__dirname, '..', 'app', 'commands');

  if (!fs.existsSync(dir)) {
    logger.warn(`⚠️  Commands directory not found: ${dir}`);
    return commands;
  }

  // Allow loading .ts files during local dev via tsx, whilst ignoring compiled type definitions
  const files = (await fs.promises.readdir(dir)).filter(
    (f) => (f.endsWith('.js') || f.endsWith('.ts')) && !f.endsWith('.d.ts'),
  );

  for (const file of files) {
    try {
      const mod = (await import(
        pathToFileURL(path.join(dir, file)).href
      )) as Record<string, unknown>;
      const cfg = mod['config'] as { name?: string; aliases?: string[] } | undefined;

      if (!cfg?.name) {
        logger.warn(`⚠️  Skipping ${file}: missing config.name`);
        continue;
      }
      if (
        typeof mod['onCommand'] !== 'function' &&
        typeof mod['onChat'] !== 'function'
      ) {
        logger.warn(`⚠️  Skipping ${file}: missing onStart/onChat`);
        continue;
      }

      commands.set(cfg.name.toLowerCase(), mod);
      commandRegistry.set(cfg.name.toLowerCase(), mod);
      logger.info(`Loaded command: ${cfg.name}`);
      // Register each alias so e.g. '/bal' dispatches the same onCommand as '/balance'.
      // Aliases point to the same module reference — no duplication of handler logic.
      if (Array.isArray(cfg.aliases)) {
        for (const alias of cfg.aliases) {
          commands.set(String(alias).toLowerCase(), mod);
          logger.info(`  ↳ Alias: ${String(alias).toLowerCase()}`);
        }
      }
    } catch (err) {
      logger.error(`❌ Failed to load command ${file}`, { error: err });
    }
  }

  logger.info(`Loaded ${commands.size} command(s)`);
  return commands;
}

/**
 * Dynamically imports every .js file in src/app/events/ and returns a
 * Map keyed by unified event type (e.g. 'member_join', 'member_leave').
 * One event file can register for multiple types via config.eventType[].
 */
async function loadEventModules(): Promise<
  Map<string, Array<Record<string, unknown>>>
> {
  const events = new Map<string, Array<Record<string, unknown>>>();
  const dir = path.join(__dirname, '..', 'app', 'events');

  if (!fs.existsSync(dir)) {
    logger.warn(`⚠️  Events directory not found: ${dir}`);
    return events;
  }

  // Allow loading .ts files during local dev via tsx, whilst ignoring compiled type definitions
  const files = (await fs.promises.readdir(dir)).filter(
    (f) => (f.endsWith('.js') || f.endsWith('.ts')) && !f.endsWith('.d.ts'),
  );

  for (const file of files) {
    try {
      const mod = (await import(
        pathToFileURL(path.join(dir, file)).href
      )) as Record<string, unknown>;
      const cfg = mod['config'] as
        | {
            name?: string;
            eventType?: string[];
            onEvent?: (...args: unknown[]) => unknown;
          }
        | undefined;

      if (!cfg?.name || !Array.isArray(cfg.eventType)) continue;

      // Validate that event module exports onEvent handler
      if (typeof mod['onEvent'] !== 'function') {
        logger.warn(`⚠️  Skipping ${file}: missing onEvent handler`);
        continue;
      }

      for (const type of cfg.eventType) {
        if (!events.has(type)) events.set(type, []);
        events.get(type)!.push(mod);
      }
      eventRegistry.set(cfg.name.toLowerCase(), mod);

      logger.info(`Loaded event handler: ${cfg.name}`);
    } catch (err) {
      logger.error(`Failed to load event ${file}`, { error: err });
    }
  }

  return events;
}

// ============================================================================
// COMMAND & EVENT REGISTRY SYNC
// ============================================================================

/**
 * Upserts all loaded command and event module names into the DB for every active
 * session so the web dashboard can list and toggle them without knowing which
 * modules are installed. Existing isEnable = false rows set by the bot admin
 * survive bot restarts unchanged since only missing rows are created.
 *
 * Called once per boot after sessions are resolved — the commands/events Maps are
 * finalised at this point and will not change until the next restart.
 */
async function syncCommandsAndEvents(
  commands: Map<string, Record<string, unknown>>,
  eventModules: Map<string, Array<Record<string, unknown>>>,
  sessionConfigs: SessionConfigs,
): Promise<void> {
  const allSessions = [
    ...sessionConfigs.discord.map((s) => ({ userId: s.userId, sessionId: s.sessionId, platform: Platforms.Discord })),
    ...sessionConfigs.telegram.map((s) => ({ userId: s.userId, sessionId: s.sessionId, platform: Platforms.Telegram })),
    ...sessionConfigs.fbPage.map((s) => ({ userId: s.userId, sessionId: s.sessionId, platform: Platforms.FacebookPage })),
    ...sessionConfigs.fbMessenger.map((s) => ({ userId: s.userId, sessionId: s.sessionId, platform: Platforms.FacebookMessenger })),
  ];

  for (const sess of allSessions) {
    // Only sync commands that are structurally allowed to run on this specific platform session
    const cmdList = new Set<string>();
    for (const mod of commands.values()) {
      if (isPlatformAllowed(mod, sess.platform)) {
        const cfg = mod['config'] as { name?: string } | undefined;
        if (cfg?.name) cmdList.add(cfg.name.toLowerCase());
      }
    }

    // Only sync events that are structurally allowed to run on this specific platform session
    const evtList = new Set<string>();
    for (const handlers of eventModules.values()) {
      for (const mod of handlers) {
        if (isPlatformAllowed(mod, sess.platform)) {
          const cfg = mod['config'] as { name?: string } | undefined;
          if (cfg?.name) evtList.add(cfg.name.toLowerCase());
        }
      }
    }

    const cmdArr = [...cmdList];
    const evtArr = [...evtList];

    if (cmdArr.length > 0) await upsertSessionCommands(sess.userId, sess.platform, sess.sessionId, cmdArr);
    if (evtArr.length > 0) await upsertSessionEvents(sess.userId, sess.platform, sess.sessionId, evtArr);
  }

  logger.info(
    `[app] Synced commands and events for ${allSessions.length} session(s)`,
  );
}

// ============================================================================
// BOOT
// ============================================================================

async function main(): Promise<void> {
  logger.info('Cat-Bot - loading modules...');
  logger.info(`Environment: ${env.NODE_ENV}`);

  // Load once — all platform listeners share the same Maps
  const [commands, eventModules] = await Promise.all([
    loadCommands(),
    loadEventModules(),
  ]);

  logger.info('Cat-Bot - creating platform listeners...');

  // ── Create unified platform listener ──────────────────────────────────────
  // Platform-specific quirks (which events each transport supports) are handled
  // inside platforms/index.js — app.ts sees a single uniform event surface.
  // All credentials are resolved from the DB before any transport is initialised —
  // credentials must be present before platform listeners start emitting events.
  const sessionConfigs = await loadSessionConfigs();
  // Sync loaded module names into DB so the dashboard can list/toggle them per session
  await syncCommandsAndEvents(commands, eventModules, sessionConfigs);

  // Warn at startup about command configs that are incompatible with Telegram's slash menu.
  // Telegram's /setcommands API rejects names containing hyphens and descriptions containing
  // emoji — slash-commands.ts sanitizes both automatically, but logging here surfaces the
  // issue once, globally, before any transport boots so developers can fix the source modules.
  // Skipped entirely when no Telegram session uses the '/' prefix.
  const hasTelegramSlashSession = sessionConfigs.telegram.some((c) => c.prefix === '/');
  if (hasTelegramSlashSession) {
    for (const [, mod] of commands) {
      const cfg = mod['config'] as { name?: string; description?: string } | undefined;
      if (!cfg?.name) continue;
      if (cfg.name.includes('-')) {
        logger.warn(
          `[app] Telegram command name "${cfg.name}" contains hyphens — not supported, will be registered as "${cfg.name.replace(/-/g, '_')}"`,
        );
      }
      if (cfg.description && /\p{Extended_Pictographic}/u.test(cfg.description)) {
        logger.warn(
          `[app] Telegram command "${cfg.name}" description contains emoji — not supported, emoji will be stripped`,
        );
      }
    }
  }

  const botConfig = {
    discord: sessionConfigs.discord,
    telegram: sessionConfigs.telegram,
    fbPage: sessionConfigs.fbPage,
    fbMessenger: sessionConfigs.fbMessenger,
  };
  const platform = createUnifiedPlatformListener(botConfig);

  // ── Wire event handlers once for all platforms ─────────────────────────────
  // Transports that do not support a given event type simply never emit it;
  // no platform branching or special-casing needed here.
  platform.on('message', async (payload: Record<string, unknown>) => {
    const native = payload.native as import('@/engine/types/controller.types.js').NativeContext;
    const livePrefix = prefixManager.getPrefix(native.userId ?? '', native.platform, native.sessionId ?? '');
    await handleMessage(
      payload.api as UnifiedApi,
      payload.event as Record<string, unknown>,
      commands,
      eventModules,
      livePrefix,
      native,
    );
  });

  platform.on('message_reply', async (payload: Record<string, unknown>) => {
    const native = payload.native as import('@/engine/types/controller.types.js').NativeContext;
    const livePrefix = prefixManager.getPrefix(native.userId ?? '', native.platform, native.sessionId ?? '');
    // message_reply shares handleMessage — command modules read event.messageReply for the quoted message.
    await handleMessage(
      payload.api as UnifiedApi,
      payload.event as Record<string, unknown>,
      commands,
      eventModules,
      livePrefix,
      native,
    );
  });

  platform.on('event', async (payload: Record<string, unknown>) => {
    await handleEvent(
      payload.api as UnifiedApi,
      payload.event as Record<string, unknown>,
      eventModules,
      payload.native as import('@/engine/types/controller.types.js').NativeContext,
    );
  });

  platform.on('message_reaction', async (payload: Record<string, unknown>) => {
    // commands passed so dispatchOnReact can match pending onReact state before generic event dispatch.
    await handleEvent(
      payload.api as UnifiedApi,
      payload.event as Record<string, unknown>,
      eventModules,
      payload.native as import('@/engine/types/controller.types.js').NativeContext,
      commands,
    );
  });

  platform.on('message_unsend', async (payload: Record<string, unknown>) => {
    await handleEvent(
      payload.api as UnifiedApi,
      payload.event as Record<string, unknown>,
      eventModules,
      payload.native as import('@/engine/types/controller.types.js').NativeContext,
    );
  });

  platform.on('button_action', async (payload: Record<string, unknown>) => {
    await handleButtonAction(
      payload.api as UnifiedApi,
      payload.event as Record<string, unknown>,
      commands,
      payload.native as import('@/engine/types/controller.types.js').NativeContext,
    );
  });

  logger.info('Cat-Bot - starting all platforms...');

  // ── Start all platforms via unified listener ───────────────────────────────
  // Each transport boots independently inside platform.start(); one failure does not block the others.
  platform.start(commands);

  logger.info('Cat-Bot — all platform listeners wired');

  // ── Start API & Webhook Server ──────────────────────────────────────────────
  // Hosts the bot management dashboard API and Facebook Page webhook listener.
  startServer();
}

// ============================================================================
// CENTRALIZED SIGNAL HANDLERS
// Registered once here so spawning N platform sessions never stacks duplicate
// process.once listeners. Each platform calls shutdownRegistry.register(stopFn)
// inside start() instead — app.ts iterates the full registry on every signal.
// ============================================================================

async function handleShutdown(signal: string, exitCode: number): Promise<void> {
  logger.info(
    `🛑 [app] Received ${signal} — stopping all platform sessions...`,
  );
  await sessionManager.stopAll(signal);
  process.exit(exitCode);
}

process.once('SIGINT', () => {
  void handleShutdown('SIGINT', 0);
});
process.once('SIGTERM', () => {
  void handleShutdown('SIGTERM', 0);
});
process.once('uncaughtException', (err: Error) => {
  logger.error('💀 [app] Uncaught exception', { error: err });
});
process.once('unhandledRejection', (reason: unknown) => {
  logger.error('💀 [app] Unhandled rejection', { error: reason });
});

main().catch((err: unknown) => {
  logger.error('💀 Fatal: could not start Cat-Bot', { error: err });
  process.exit(1);
});
