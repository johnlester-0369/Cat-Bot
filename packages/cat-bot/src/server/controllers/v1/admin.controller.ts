import type { Request, Response } from 'express';
import { requireAdmin } from '@/server/validators/auth-session.validator.js';
import { adminAuth } from '@/server/lib/better-auth.lib.js';
import { botRepo } from '@/server/repos/bot.repo.js';
import { botService } from '@/server/services/bot.service.js';
import {
  listSystemAdmins,
  addSystemAdmin,
  removeSystemAdmin,
  listAllUsers,
} from 'database';
import type { AddSystemAdminRequestDto } from '@/server/dtos/admin.dto.js';
export class AdminController {
  // GET /api/v1/admin/users — fetches all users, delegating pagination and search directly to the database.
  async listUsers(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      const page = parseInt(req.query['page'] as string, 10) || 1;
      // Enforce a hard maximum to avoid massive performance drops from querying unlimited pages
      const limit = Math.min(
        parseInt(req.query['limit'] as string, 10) || 10,
        100,
      );
      const search = ((req.query['search'] as string | undefined) || '').trim();

      // WHY: Search and pagination MUST happen in the packages/database layer natively (using SQL LIMIT/OFFSET,
      // MongoDB $facet, or Prisma skip/take) rather than dynamically slicing arrays in the server layer.
      // This ensures O(1) memory complexity and O(limit) time complexity even with 100k+ users.
      const result = await listAllUsers(search, page, limit);

      res.status(200).json(result);
    } catch (error) {
      console.error('[AdminController.listUsers]', error);
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  }

  // GET /api/v1/admin/bots — all bot sessions across all owners
  async listBots(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      const page = parseInt(req.query['page'] as string, 10) || 1;
      const limit = Math.min(
        parseInt(req.query['limit'] as string, 10) || 10,
        100,
      );
      const search = ((req.query['search'] as string | undefined) || '').trim();

      // WHY: Delegated to the database adapter. Never load the full bot_session table into memory
      // to perform dynamic Array.prototype.slice pagination here.
      const result = await botRepo.listAll(search, page, limit);

      res.status(200).json(result);
    } catch (error) {
      console.error('[AdminController.listBots]', error);
      res.status(500).json({ error: 'Failed to fetch all bot sessions' });
    }
  }

  // GET /api/v1/admin/system-admins
  async getSystemAdmins(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      const admins = await listSystemAdmins();
      res.status(200).json({ admins });
    } catch (error) {
      console.error('[AdminController.getSystemAdmins]', error);
      res.status(500).json({ error: 'Failed to fetch system admins' });
    }
  }

  // POST /api/v1/admin/system-admins
  async addSystemAdmin(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    const { adminId } = req.body as AddSystemAdminRequestDto;
    if (typeof adminId !== 'string' || !adminId.trim()) {
      res.status(400).json({ error: 'Missing required field: adminId' });
      return;
    }
    try {
      const admin = await addSystemAdmin(adminId.trim());
      res.status(201).json(admin);
    } catch (error) {
      console.error('[AdminController.addSystemAdmin]', error);
      res.status(500).json({ error: 'Failed to add system admin' });
    }
  }

  // DELETE /api/v1/admin/system-admins/:adminId
  async removeSystemAdmin(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    const adminId = String(req.params['adminId'] ?? '');
    if (!adminId) {
      res.status(400).json({ error: 'Missing adminId param' });
      return;
    }
    try {
      await removeSystemAdmin(adminId);
      res.status(200).json({ status: 'removed' });
    } catch (error) {
      console.error('[AdminController.removeSystemAdmin]', error);
      res.status(500).json({ error: 'Failed to remove system admin' });
    }
  }

  /**
   * POST /api/v1/admin/users/:userId/ban-sessions
   * Stops all live bot transports for the given user and sets isRunning=false in the DB.
   * Called alongside better-auth's banUser so the session teardown is synchronised with
   * the auth-level ban — the client fires both requests after a successful better-auth response.
   */
  async stopUserSessions(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    const userId = String(req.params['userId'] ?? '');
    if (!userId) {
      res.status(400).json({ error: 'Missing userId param' });
      return;
    }
    try {
      await botService.stopAllUserSessions(userId);
      res.status(200).json({ status: 'sessions stopped' });
    } catch (error) {
      console.error('[AdminController.stopUserSessions]', error);
      res.status(500).json({ error: 'Failed to stop user sessions' });
    }
  }

  /** POST /api/v1/admin/users/:userId/unban-sessions — restarts all sessions for an unbanned user. */
  async startUserSessions(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    const userId = String(req.params['userId'] ?? '');
    if (!userId) {
      res.status(400).json({ error: 'Missing userId param' });
      return;
    }
    try {
      await botService.startAllUserSessions(userId);
      res.status(200).json({ status: 'sessions started' });
    } catch (error) {
      console.error('[AdminController.startUserSessions]', error);
      res.status(500).json({ error: 'Failed to start user sessions' });
    }
  }

  // PUT /api/v1/admin/users/:userId
  // Updates the user's name, email, and role.
  async updateUser(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    const userId = String(req.params['userId'] ?? '');
    const { name, email, role } = req.body as {
      name?: string;
      email?: string;
      role?: string;
    };

    if (!userId) {
      res.status(400).json({ error: 'Missing userId param' });
      return;
    }

    try {
      const ctx = await adminAuth.$context;

      // Validation: Prevent email collisions. If the email attempt already exists in user table database, reject it.
      if (email) {
        const lowerEmail = email.toLowerCase();
        const existing = await ctx.adapter.findOne<Record<string, unknown>>({
          model: 'user',
          where: [{ field: 'email', value: lowerEmail }],
        });

        if (existing && existing['id'] !== userId) {
          res
            .status(400)
            .json({ error: 'Email already exists in user table database' });
          return;
        }
      }

      const updateData: Record<string, unknown> = {};
      if (name) updateData['name'] = name;
      if (email) updateData['email'] = email.toLowerCase();
      if (role) updateData['role'] = role;

      // Using the raw adapter directly as it seamlessly updates the core user schema fields
      await ctx.adapter.update({
        model: 'user',
        where: [{ field: 'id', value: userId }],
        update: updateData,
      });

      res.status(200).json({ status: 'updated' });
    } catch (error) {
      console.error('[AdminController.updateUser]', error);
      res.status(500).json({ error: 'Failed to update user' });
    }
  }

  // POST /api/v1/admin/users/:userId/verify
  async verifyUser(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    const userId = String(req.params['userId'] ?? '');
    if (!userId) {
      res.status(400).json({ error: 'Missing userId param' });
      return;
    }
    try {
      const ctx = await adminAuth.$context;
      await ctx.adapter.update({
        model: 'user',
        where: [{ field: 'id', value: userId }],
        update: { emailVerified: true },
      });
      res.status(200).json({ status: 'verified' });
    } catch (error) {
      console.error('[AdminController.verifyUser]', error);
      res.status(500).json({ error: 'Failed to verify user' });
    }
  }

  // DELETE /api/v1/admin/bots/:userId/:sessionId
  // Admin-privileged hard delete — works on any user's session without a user auth cookie.
  // Delegates to botService.deleteBot which stops the live transport first, then unregisters
  // the session closure, and finally wipes all DB rows in dependency order (commands, events,
  // credentials, then the session row itself). Same teardown path as the user-facing delete.
  async deleteBot(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    const userId = String(req.params['userId'] ?? '');
    const sessionId = String(req.params['sessionId'] ?? '');
    if (!userId || !sessionId) {
      res.status(400).json({ error: 'Missing userId or sessionId param' });
      return;
    }
    try {
      await botService.deleteBot(userId, sessionId);
      res.status(200).json({ status: 'deleted' });
    } catch (error) {
      console.error('[AdminController.deleteBot]', error);
      res.status(500).json({ error: 'Failed to delete bot session' });
    }
  }
}

export const adminController = new AdminController();
