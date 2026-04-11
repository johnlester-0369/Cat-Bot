/**
 * Validation Routes — v1
 *
 * Mounted at /api/v1/validate by routes/v1/index.ts.
 * Facebook Page validation is Socket.IO-based and does not appear here.
 */

import { Router } from 'express';
import {
  validateDiscord,
  validateTelegram,
  validateFacebookMessenger,
} from '../../controllers/validation.controller.js';

const validationRouter = Router();

// POST /api/v1/validate/discord — verify Discord bot token
validationRouter.post('/discord', (req, res) => {
  void validateDiscord(req, res);
});

// POST /api/v1/validate/telegram — verify Telegram bot token via getMe
validationRouter.post('/telegram', (req, res) => {
  void validateTelegram(req, res);
});

// POST /api/v1/validate/facebook-messenger — structural parse of appstate JSON
validationRouter.post('/facebook-messenger', (req, res) => {
  void validateFacebookMessenger(req, res);
});

export default validationRouter;
