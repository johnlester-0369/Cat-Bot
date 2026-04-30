/**
 * Facebook Page Routes — v1
 *
 * Mounted at /api/v1/facebook-page by app.ts.
 * :user_id maps to the raw userId — one URL prefix covers all
 * Page sessions belonging to a single user account.
 *
 * Adding a v2 route surface never requires touching this file or the controller:
 * create routes/v2/facebook-page.routes.ts and mount it in app.ts.
 */

import { Router } from 'express';
import {
  handleVerification,
  handleWebhookEvent,
} from '@/server/controllers/v1/facebook-page.controller.js';

const router = Router();

// GET — Facebook webhook ownership verification (subscribe handshake)
router.get('/:user_id', handleVerification);

// POST — Incoming messaging events from Facebook's delivery pipeline
router.post('/:user_id', handleWebhookEvent);

export default router;
