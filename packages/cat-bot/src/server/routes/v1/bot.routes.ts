import { Router } from 'express';
import { botController } from '@/server/controllers/bot.controller.js';
// Commands/events toggle endpoints share the /:id base path with the bot routes
import { botSessionConfigController } from '@/server/controllers/bot-session-config.controller.js';

const botRouter = Router();

// POST /api/v1/bots — creates a new bot session (identity + admins + platform credential).
// Express v5 natively handles async handlers; errors caught inside the controller.
botRouter.post('/', (req, res) => {
  void botController.create(req, res);
});

// GET /api/v1/bots — lists all bot sessions for the authenticated user.
botRouter.get('/', (req, res) => {
  void botController.list(req, res);
});

// GET /api/v1/bots/:id — retrieves full details of a specific bot session.
botRouter.get('/:id', (req, res) => {
  void botController.get(req, res);
});

// PUT /api/v1/bots/:id — updates an existing bot session configuration.
botRouter.put('/:id', (req, res) => {
  void botController.update(req, res);
});

// POST /api/v1/bots/:id/start — set isRunning = true and boot the platform transport
botRouter.post('/:id/start', (req, res) => {
  void botController.start(req, res);
});

// POST /api/v1/bots/:id/stop — set isRunning = false and tear down the platform transport
botRouter.post('/:id/stop', (req, res) => {
  void botController.stop(req, res);
});

// POST /api/v1/bots/:id/restart — restart the live transport without changing isRunning
botRouter.post('/:id/restart', (req, res) => {
  void botController.restart(req, res);
});

// DELETE /api/v1/bots/:id — permanently delete the bot session and all associated data
botRouter.delete('/:id', (req, res) => {
  void botController.delete(req, res);
});

// GET /api/v1/bots/:id/logs — returns in-memory ANSI log history for this session.
// Must be registered before /:id/commands to prevent Express matching 'logs' as :name.
botRouter.get('/:id/logs', (req, res) => {
  void botController.getLogs(req, res);
});

// GET /api/v1/bots/:id/commands — lists all registered commands with their enabled status.
// Returns whatever bot_session_commands contains; synced at bot startup.
botRouter.get('/:id/commands', (req, res) => {
  void botSessionConfigController.getCommands(req, res);
});

// PUT /api/v1/bots/:id/commands/:name — toggles a single command on/off.
botRouter.put('/:id/commands/:name', (req, res) => {
  void botSessionConfigController.toggleCommand(req, res);
});

// GET /api/v1/bots/:id/events — lists all registered event modules with their enabled status.
botRouter.get('/:id/events', (req, res) => {
  void botSessionConfigController.getEvents(req, res);
});

// PUT /api/v1/bots/:id/events/:name — toggles a single event module on/off.
botRouter.put('/:id/events/:name', (req, res) => {
  void botSessionConfigController.toggleEvent(req, res);
});

export default botRouter;
