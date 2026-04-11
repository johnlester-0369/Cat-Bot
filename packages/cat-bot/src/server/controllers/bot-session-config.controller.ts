/**
 * Bot Session Config Controller — Commands & Events Toggle REST Handlers
 *
 * Owns the four endpoints that let the web dashboard read and toggle the
 * enable/disable state of command modules and event modules per bot session:
 *
 *   GET  /api/v1/bots/:id/commands        → list all commands + isEnable
 *   PUT  /api/v1/bots/:id/commands/:name  → toggle a command on/off
 *   GET  /api/v1/bots/:id/events          → list all events + isEnable
 *   PUT  /api/v1/bots/:id/events/:name    → toggle an event on/off
 *
 * Auth model: identical to BotController — session cookie via better-auth.
 * Ownership is verified by querying BotSession for (userId, sessionId); a
 * 404 is returned if the session doesn't belong to the authenticated user.
 */

import type { Request, Response } from 'express';
import { auth } from '@/server/lib/better-auth.lib.js';
import { botRepo } from '@/server/repos/bot.repo.js';
import { ID_TO_PLATFORM } from '@/engine/modules/platform/platform.constants.js';
import {
  findSessionCommands,
  setCommandEnabled,
} from '@/engine/modules/session/bot-session-commands.repo.js';
import {
  findSessionEvents,
  setEventEnabled,
} from '@/engine/modules/session/bot-session-events.repo.js';
import {
  commandRegistry,
  eventRegistry,
} from '@/engine/lib/module-registry.lib.js';
import type { ToggleEnabledRequestDto } from '@/server/dtos/bot-session-config.dto.js';
// Triggers slash command re-registration on live Discord/Telegram sessions when a command is toggled.
// Resolves as a no-op for platforms without a registered sync (FB Messenger, FB Page) or stopped sessions.
import { triggerSlashSync } from '@/engine/modules/prefix/slash-sync.lib.js';
import { isPlatformAllowed } from '@/engine/modules/platform/platform-filter.util.js';

// ── Shared Auth Helper ────────────────────────────────────────────────────────

async function requireSession(
  req: Request,
  res: Response,
): Promise<string | null> {
  const headers = new Headers();
  for (const [key, val] of Object.entries(req.headers)) {
    if (val === undefined) continue;
    headers.set(key, Array.isArray(val) ? val.join(', ') : val);
  }
  const sessionData = await auth.api.getSession({ headers });
  if (!sessionData) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return sessionData.user.id;
}

// ── Shared Ownership Resolver ─────────────────────────────────────────────────

/**
 * Returns the platform string for the given (userId, sessionId) pair after
 * verifying the session belongs to the authenticated user. Returns null and
 * writes a 404 response when the session row does not exist.
 */
async function resolvePlatform(
  userId: string,
  sessionId: string,
  res: Response,
): Promise<string | null> {
  const platformId = await botRepo.getPlatformId(userId, sessionId);
  if (platformId === null) {
    res.status(404).json({ error: 'Bot not found' });
    return null;
  }
  const platform = (ID_TO_PLATFORM as Record<number, string>)[platformId];
  if (!platform) {
    res.status(500).json({ error: 'Unknown platform in stored session' });
    return null;
  }
  return platform;
}

// ── Controller Class ──────────────────────────────────────────────────────────

export class BotSessionConfigController {
  // GET /api/v1/bots/:id/commands
  async getCommands(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;

    const sessionId = String(req.params['id']);
    if (!sessionId) {
      res.status(400).json({ error: 'Missing session ID' });
      return;
    }

    const platform = await resolvePlatform(userId, sessionId, res);
    if (!platform) return;

    try {
      const rawCommands = await findSessionCommands(
        userId,
        platform,
        sessionId,
      );
      // Enrich with metadata from the in-memory registry so the web UI can render details
      const commands = rawCommands
        // Filter out commands that are structurally disallowed on this session's platform
        .filter((cmd: { commandName: string; isEnable: boolean }) => {
          const mod = commandRegistry.get(cmd.commandName.toLowerCase());
          return mod && isPlatformAllowed(mod, platform);
        })
        .map((cmd: { commandName: string; isEnable: boolean }) => {
          const mod = commandRegistry.get(cmd.commandName.toLowerCase());
          const cfg = mod?.['config'] as Record<string, unknown> | undefined;
          return {
            ...cmd,
            version: cfg?.['version'] as string | undefined,
            description: cfg?.['description'] as string | undefined,
            usage: cfg?.['usage'] as string | undefined,
            role: cfg?.['role'] as number | undefined,
            aliases: cfg?.['aliases'] as string[] | undefined,
            cooldown: cfg?.['cooldown'] as number | undefined,
            author: cfg?.['author'] as string | undefined,
          };
        });
      res.status(200).json({ commands });
    } catch (error) {
      console.error('[BotSessionConfigController.getCommands]', error);
      res.status(500).json({ error: 'Failed to fetch commands' });
    }
  }

  // PUT /api/v1/bots/:id/commands/:name
  async toggleCommand(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;

    const sessionId = String(req.params['id']);
    const commandName = String(req.params['name']);
    if (!sessionId || !commandName) {
      res.status(400).json({ error: 'Missing session ID or command name' });
      return;
    }

    const platform = await resolvePlatform(userId, sessionId, res);
    if (!platform) return;

    const { isEnable } = req.body as ToggleEnabledRequestDto;
    if (typeof isEnable !== 'boolean') {
      res.status(400).json({ error: 'isEnable must be a boolean' });
      return;
    }

    // Guard against modifying state for a command that does not run on this platform
    const mod = commandRegistry.get(commandName.toLowerCase());
    if (!mod || !isPlatformAllowed(mod, platform)) {
      res
        .status(400)
        .json({ error: 'Command not available for this platform' });
      return;
    }

    try {
      await setCommandEnabled(
        userId,
        platform,
        sessionId,
        commandName,
        isEnable,
      );
      // Fire-and-forget slash re-registration — the HTTP response must not block on a Discord REST
      // or Telegram Bot API round-trip. The callback checks the prefix internally and short-circuits
      // when prefix !== '/', so this is safe to call for every platform without branching here.
      void triggerSlashSync(`${userId}:${platform}:${sessionId}`).catch(
        (err) => {
          console.error(
            '[BotSessionConfigController.toggleCommand] Slash sync failed (non-fatal)',
            err,
          );
        },
      );
      res.status(200).json({ commandName, isEnable });
    } catch (error) {
      console.error('[BotSessionConfigController.toggleCommand]', error);
      res.status(500).json({ error: 'Failed to toggle command' });
    }
  }

  // GET /api/v1/bots/:id/events
  async getEvents(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;

    const sessionId = String(req.params['id']);
    if (!sessionId) {
      res.status(400).json({ error: 'Missing session ID' });
      return;
    }

    const platform = await resolvePlatform(userId, sessionId, res);
    if (!platform) return;

    try {
      const rawEvents = await findSessionEvents(userId, platform, sessionId);
      const events = rawEvents
        // Filter out events that are structurally disallowed on this session's platform
        .filter((evt: { eventName: string; isEnable: boolean }) => {
          const mod = eventRegistry.get(evt.eventName.toLowerCase());
          return mod && isPlatformAllowed(mod, platform);
        })
        .map((evt: { eventName: string; isEnable: boolean }) => {
          const mod = eventRegistry.get(evt.eventName.toLowerCase());
          const cfg = mod?.['config'] as Record<string, unknown> | undefined;
          return {
            ...evt,
            version: cfg?.['version'] as string | undefined,
            description: cfg?.['description'] as string | undefined,
            author: cfg?.['author'] as string | undefined,
          };
        });
      res.status(200).json({ events });
    } catch (error) {
      console.error('[BotSessionConfigController.getEvents]', error);
      res.status(500).json({ error: 'Failed to fetch events' });
    }
  }

  // PUT /api/v1/bots/:id/events/:name
  async toggleEvent(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;

    const sessionId = String(req.params['id']);
    const eventName = String(req.params['name']);
    if (!sessionId || !eventName) {
      res.status(400).json({ error: 'Missing session ID or event name' });
      return;
    }

    const platform = await resolvePlatform(userId, sessionId, res);
    if (!platform) return;

    const { isEnable } = req.body as ToggleEnabledRequestDto;
    if (typeof isEnable !== 'boolean') {
      res.status(400).json({ error: 'isEnable must be a boolean' });
      return;
    }

    // Guard against modifying state for an event that does not run on this platform
    const mod = eventRegistry.get(eventName.toLowerCase());
    if (!mod || !isPlatformAllowed(mod, platform)) {
      res.status(400).json({ error: 'Event not available for this platform' });
      return;
    }

    try {
      await setEventEnabled(userId, platform, sessionId, eventName, isEnable);
      res.status(200).json({ eventName, isEnable });
    } catch (error) {
      console.error('[BotSessionConfigController.toggleEvent]', error);
      res.status(500).json({ error: 'Failed to toggle event' });
    }
  }
}

export const botSessionConfigController = new BotSessionConfigController();
