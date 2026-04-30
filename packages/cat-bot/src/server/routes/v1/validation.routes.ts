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
  validateEmailForPasswordReset,
  requestPasswordResetCustom,
  verifyResetTokenCustom,
  confirmPasswordResetCustom,
  checkEmailStatus,
} from '@/server/controllers/v1/validation.controller.js';

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

// POST /api/v1/validate/email-reset — check email existence + optional admin-role filter
validationRouter.post('/email-reset', (req, res) => {
  void validateEmailForPasswordReset(req, res);
});

// POST /api/v1/validate/email-status — check email existence and verification status
validationRouter.post('/email-status', (req, res) => {
  void checkEmailStatus(req, res);
});

// POST /api/v1/validate/reset-password/request — generate in-memory reset token
validationRouter.post('/reset-password/request', (req, res) => {
  void requestPasswordResetCustom(req, res);
});

// POST /api/v1/validate/reset-password/verify-token — check in-memory reset token
validationRouter.post('/reset-password/verify-token', (req, res) => {
  void verifyResetTokenCustom(req, res);
});

// POST /api/v1/validate/reset-password/confirm — consume token and reset password
validationRouter.post('/reset-password/confirm', (req, res) => {
  void confirmPasswordResetCustom(req, res);
});

export default validationRouter;
