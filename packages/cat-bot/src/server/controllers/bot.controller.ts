import type { Request, Response } from 'express';
import { requireSession } from '@/server/validators/auth-session.validator.js';
import { botService, BusyError } from '@/server/services/bot.service.js';
import type {
  CreateBotRequestDto,
  UpdateBotRequestDto,
} from '@/server/dtos/bot.dto.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';

export class BotController {
  // Session verification happens before any business logic so the service layer
  // never receives unauthenticated requests — keeps services auth-agnostic and testable.
  async create(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;

    const dto = req.body as CreateBotRequestDto;

    // Validate the minimum required shape — full JSON Schema / Zod validation
    // belongs in a dedicated middleware if requirements grow.
    if (
      typeof dto.botNickname !== 'string' ||
      !dto.botNickname ||
      typeof dto.botPrefix !== 'string' ||
      !dto.botPrefix ||
      !Array.isArray(dto.botAdmins) ||
      // Facebook Page does not utilize botAdmins since roles are inherited from Page admin roles;
      // all other platforms require at least one bot admin ID to be securely provisioned.
      (dto.credentials?.platform !== Platforms.FacebookPage &&
        dto.botAdmins.length === 0) ||
      typeof dto.credentials?.platform !== 'string' ||
      !dto.credentials.platform
    ) {
      res.status(400).json({
        error:
          'Missing or invalid required fields: botNickname, botPrefix, botAdmins, credentials.platform',
      });
      return;
    }

    try {
      const result = await botService.createBot(userId, dto);
      res.status(201).json(result);
    } catch (error) {
      // Log the full error server-side; return a generic message so internal
      // schema details and stack traces never reach the client.
      console.error('[BotController.create]', error);
      res.status(500).json({ error: 'Failed to create bot' });
    }
  }

  // GET /api/v1/bots/:id — Retrieves a single bot's details including credentials for the editing flow.
  async get(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;

    const sessionId = String(req.params['id']);
    if (!sessionId) {
      res.status(400).json({ error: 'Missing session ID' });
      return;
    }

    try {
      const bot = await botService.getBot(userId, sessionId);
      if (!bot) {
        res.status(404).json({ error: 'Bot not found' });
        return;
      }
      res.status(200).json(bot);
    } catch (error) {
      console.error('[BotController.get]', error);
      res.status(500).json({ error: 'Failed to fetch bot details' });
    }
  }

  // PUT /api/v1/bots/:id — Replaces the identity and credentials for an existing bot.
  async update(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;

    const sessionId = String(req.params['id']);
    if (!sessionId) {
      res.status(400).json({ error: 'Missing session ID' });
      return;
    }

    const dto = req.body as UpdateBotRequestDto;

    if (
      typeof dto.botNickname !== 'string' ||
      !dto.botNickname ||
      typeof dto.botPrefix !== 'string' ||
      !dto.botPrefix ||
      !Array.isArray(dto.botAdmins) ||
      // Validation parity with creation: ensure admins are supplied for non-FB-Page platforms
      (dto.credentials?.platform !== Platforms.FacebookPage &&
        dto.botAdmins.length === 0) ||
      typeof dto.credentials?.platform !== 'string' ||
      !dto.credentials.platform
    ) {
      res.status(400).json({
        error:
          'Missing or invalid required fields: botNickname, botPrefix, botAdmins, credentials.platform',
      });
      return;
    }

    try {
      await botService.updateBot(userId, sessionId, dto);
      const bot = await botService.getBot(userId, sessionId);
      res.status(200).json(bot);
    } catch (error) {
      console.error('[BotController.update]', error);
      res.status(500).json({ error: 'Failed to update bot' });
    }
  }

  // GET /api/v1/bots — returns all bot sessions owned by the authenticated user.
  // Identical auth-guard pattern to create: controller owns auth enforcement so the
  // service layer stays pure and independently testable.
  async list(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;

    try {
      const result = await botService.listBots(userId);
      res.status(200).json(result);
    } catch (error) {
      console.error('[BotController.list]', error);
      res.status(500).json({ error: 'Failed to fetch bots' });
    }
  }

  // POST /api/v1/bots/:id/start — persists isRunning = true and boots the transport
  async start(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;

    const sessionId = String(req.params['id']);
    if (!sessionId) {
      res.status(400).json({ error: 'Missing session ID' });
      return;
    }

    try {
      await botService.startBot(userId, sessionId);
      res.status(200).json({ status: 'started' });
    } catch (error) {
      if (error instanceof BusyError) {
        res.status(423).json({ error: error.message });
        return;
      }
      console.error('[BotController.start]', error);
      res.status(500).json({ error: 'Failed to start bot' });
    }
  }

  // POST /api/v1/bots/:id/stop — persists isRunning = false and tears down the platform transport
  async stop(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;

    const sessionId = String(req.params['id']);
    if (!sessionId) {
      res.status(400).json({ error: 'Missing session ID' });
      return;
    }

    try {
      await botService.stopBot(userId, sessionId);
      res.status(200).json({ status: 'stopped' });
    } catch (error) {
      if (error instanceof BusyError) {
        res.status(423).json({ error: error.message });
        return;
      }
      console.error('[BotController.stop]', error);
      res.status(500).json({ error: 'Failed to stop bot' });
    }
  }

  // POST /api/v1/bots/:id/restart — restarts the live transport; isRunning unchanged
  async restart(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;

    const sessionId = String(req.params['id']);
    if (!sessionId) {
      res.status(400).json({ error: 'Missing session ID' });
      return;
    }

    try {
      await botService.restartBot(userId, sessionId);
      res.status(200).json({ status: 'restarted' });
    } catch (error) {
      if (error instanceof BusyError) {
        res.status(423).json({ error: error.message });
        return;
      }
      console.error('[BotController.restart]', error);
      res.status(500).json({ error: 'Failed to restart bot' });
    }
  }

  // DELETE /api/v1/bots/:id — permanently removes the bot session and all its data.
  async delete(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;

    const sessionId = String(req.params['id']);
    if (!sessionId) {
      res.status(400).json({ error: 'Missing session ID' });
      return;
    }

    try {
      await botService.deleteBot(userId, sessionId);
      res.status(200).json({ status: 'deleted' });
    } catch (error) {
      console.error('[BotController.delete]', error);
      res.status(500).json({ error: 'Failed to delete bot' });
    }
  }
}

export const botController = new BotController();
