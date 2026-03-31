/**
 * Cat-Bot — Central Entry Point & Orchestration Layer
 *
 * This file owns everything above the platform transport layer:
 *   1. Module loading  — reads src/modules/commands/ and src/modules/events/
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
import { env } from '@/config/env.config.js';
import { logger } from '@/lib/logger.lib.js';
import { loadSessionConfigs } from '@/utils/session-loader.util.js';

// ── Handler — imported via @/ alias for consistency with the rest of the codebase ──
import {
  handleMessage,
  handleEvent,
  handleButtonAction,
} from '@/controllers/index.js';
import type { UnifiedApi } from '@/adapters/models/api.model.js';

// ── Platform listeners ────────────────────────────────────────────────────────
import { createUnifiedPlatformListener } from '@/adapters/platform/index.js';
// Side-effect import — registers the default middleware pipeline (validateCommandOptions,
// chatPassthrough, etc.) so the registry is fully populated before platform.start() fires.
import '@/middleware/index.js';
import { shutdownRegistry } from '@/lib/shutdown.lib.js';

// ============================================================================
// SESSION CREDENTIAL CONFIGURATION
// Reads credentials from session/{platform}/{id}/credential.json and prefix
// from session/{platform}/{id}/config.json — .env is no longer required.
// Validation (missing field detection) runs inside loadSessionConfigs() and
// exits the process before any platform listener is created.
// ============================================================================

const sessionConfigs = loadSessionConfigs();

// Each platform now supports multiple sessions — one entry per discovered session directory.
// Platforms with no session directories are silently skipped at the transport layer.
// All credential resolution and port derivation already occurred inside loadSessionConfigs().
const botConfig = {
  discord: sessionConfigs.discord,
  telegram: sessionConfigs.telegram,
  fbPage: sessionConfigs.fbPage,
  fbMessenger: sessionConfigs.fbMessenger,
};

// ============================================================================
// __dirname equivalent — needed for dynamic module path resolution in ESM
// ============================================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// MODULE LOADER — single source of truth for commands and events
// ============================================================================

/**
 * Dynamically imports every .js file in src/modules/commands/ and returns a
 * Map keyed by lowercased command name. Invalid modules are skipped with a
 * warning so a single broken file never prevents the bot from starting.
 */
async function loadCommands(): Promise<Map<string, Record<string, unknown>>> {
  const commands = new Map<string, Record<string, unknown>>();
  const dir = path.join(__dirname, 'modules', 'commands');

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
      const cfg = mod['config'] as { name?: string } | undefined;

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
      logger.info(`Loaded command: ${cfg.name}`);
    } catch (err) {
      logger.error(`❌ Failed to load command ${file}`, { error: err });
    }
  }

  logger.info(`Loaded ${commands.size} command(s)`);
  return commands;
}

/**
 * Dynamically imports every .js file in src/modules/events/ and returns a
 * Map keyed by unified event type (e.g. 'member_join', 'member_leave').
 * One event file can register for multiple types via config.eventType[].
 */
async function loadEventModules(): Promise<
  Map<string, Array<Record<string, unknown>>>
> {
  const events = new Map<string, Array<Record<string, unknown>>>();
  const dir = path.join(__dirname, 'modules', 'events');

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

      logger.info(`Loaded event handler: ${cfg.name}`);
    } catch (err) {
      logger.error(`Failed to load event ${file}`, { error: err });
    }
  }

  return events;
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
  const platform = createUnifiedPlatformListener(botConfig);

  // ── Wire event handlers once for all platforms ─────────────────────────────
  // Transports that do not support a given event type simply never emit it;
  // no platform branching or special-casing needed here.
  platform.on('message', async (payload: Record<string, unknown>) => {
    await handleMessage(
      payload.api as UnifiedApi,
      payload.event as Record<string, unknown>,
      commands,
      eventModules,
      payload.prefix as string,
      payload.native as import('@/types/controller.types.js').NativeContext,
    );
  });

  platform.on('message_reply', async (payload: Record<string, unknown>) => {
    // message_reply shares handleMessage — command modules read event.messageReply for the quoted message.
    await handleMessage(
      payload.api as UnifiedApi,
      payload.event as Record<string, unknown>,
      commands,
      eventModules,
      payload.prefix as string,
      payload.native as import('@/types/controller.types.js').NativeContext,
    );
  });

  platform.on('event', async (payload: Record<string, unknown>) => {
    await handleEvent(
      payload.api as UnifiedApi,
      payload.event as Record<string, unknown>,
      eventModules,
      payload.native as import('@/types/controller.types.js').NativeContext,
    );
  });

  platform.on('message_reaction', async (payload: Record<string, unknown>) => {
    // commands passed so dispatchOnReact can match pending onReact state before generic event dispatch.
    await handleEvent(
      payload.api as UnifiedApi,
      payload.event as Record<string, unknown>,
      eventModules,
      payload.native as import('@/types/controller.types.js').NativeContext,
      commands,
    );
  });

  platform.on('message_unsend', async (payload: Record<string, unknown>) => {
    await handleEvent(
      payload.api as UnifiedApi,
      payload.event as Record<string, unknown>,
      eventModules,
      payload.native as import('@/types/controller.types.js').NativeContext,
    );
  });

  platform.on('button_action', async (payload: Record<string, unknown>) => {
    await handleButtonAction(
      payload.api as UnifiedApi,
      payload.event as Record<string, unknown>,
      commands,
      payload.native as import('@/types/controller.types.js').NativeContext,
    );
  });

  logger.info('Cat-Bot - starting all platforms...');

  // ── Start all platforms via unified listener ───────────────────────────────
  // Each transport boots independently inside platform.start(); one failure does not block the others.
  platform.start(commands);

  logger.info('Cat-Bot — all platform listeners wired');
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
  await shutdownRegistry.runAll(signal);
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
  void handleShutdown('uncaughtException', 1);
});
process.once('unhandledRejection', (reason: unknown) => {
  logger.error('💀 [app] Unhandled rejection', { error: reason });
  void handleShutdown('unhandledRejection', 1);
});

main().catch((err: unknown) => {
  logger.error('💀 Fatal: could not start Cat-Bot', { error: err });
  process.exit(1);
});
