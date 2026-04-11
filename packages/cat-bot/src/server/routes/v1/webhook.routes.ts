import { Router } from 'express';
import { webhookController } from '@/server/controllers/webhook.controller.js';

const webhookRouter = Router();

// GET /api/v1/webhooks/facebook — returns the generated URL and verify token
webhookRouter.get('/facebook', (req, res) => {
  void webhookController.getFacebookInfo(req, res);
});

export default webhookRouter;
