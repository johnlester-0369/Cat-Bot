/**
 * Admin Routes — v1
 *
 * Mounted at /api/v1/admin by routes/v1/index.ts.
 * Every handler in adminController verifies adminAuth session + role === 'admin'
 * before executing — no additional middleware guard is needed here.
 */

import { Router } from 'express';
import { adminController } from '@/server/controllers/v1/admin.controller.js';

const adminRouter = Router();

// GET /api/v1/admin/bots — all bot sessions across all users (admin overview)
adminRouter.get('/bots', (req, res) => {
  void adminController.listBots(req, res);
});

// DELETE /api/v1/admin/bots/:userId/:sessionId — admin force-deletes any bot session
// userId + sessionId form the composite PK used by botService.deleteBot internally.
adminRouter.delete('/bots/:userId/:sessionId', (req, res) => {
  void adminController.deleteBot(req, res);
});

// GET /api/v1/admin/users — all registered users (paginated + search)
adminRouter.get('/users', (req, res) => {
  void adminController.listUsers(req, res);
});

// GET /api/v1/admin/system-admins — list all global system admin IDs
adminRouter.get('/system-admins', (req, res) => {
  void adminController.getSystemAdmins(req, res);
});

// POST /api/v1/admin/system-admins — register a new global system admin ID
adminRouter.post('/system-admins', (req, res) => {
  void adminController.addSystemAdmin(req, res);
});

// DELETE /api/v1/admin/system-admins/:adminId — revoke global system admin privileges
adminRouter.delete('/system-admins/:adminId', (req, res) => {
  void adminController.removeSystemAdmin(req, res);
});

// POST /api/v1/admin/users/:userId/ban-sessions — halt all bot transports for a banned user
adminRouter.post('/users/:userId/ban-sessions', (req, res) => {
  void adminController.stopUserSessions(req, res);
});

// POST /api/v1/admin/users/:userId/unban-sessions — restart all bot sessions for an unbanned user
adminRouter.post('/users/:userId/unban-sessions', (req, res) => {
  void adminController.startUserSessions(req, res);
});

// PUT /api/v1/admin/users/:userId — edit user name, email, and role
adminRouter.put('/users/:userId', (req, res) => {
  void adminController.updateUser(req, res);
});

// POST /api/v1/admin/users/:userId/verify — manually verify a user account's email
adminRouter.post('/users/:userId/verify', (req, res) => {
  void adminController.verifyUser(req, res);
});

export default adminRouter;
