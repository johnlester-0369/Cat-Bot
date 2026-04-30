import type { Request, Response } from 'express';
import { requireSession } from '@/server/validators/auth-session.validator.js';
import { getFbPageWebhookVerification } from '@/engine/repos/webhooks.repo.js';
import { generateVerifyToken } from '@/server/utils/hash.util.js';

export class WebhookController {
  async getFacebookInfo(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;

    const verifyToken = generateVerifyToken(userId);

    // Dynamically generate the external webhook address using Express request context
    const botUrlBase = `${req.protocol}://${req.get('host')}`;
    const webhookUrl = `${botUrlBase}/api/v1/facebook-page/${userId}`;

    // Look up the verification handshake status managed by the Bot process
    const webhook = await getFbPageWebhookVerification(userId);

    res.status(200).json({
      webhookUrl,
      verifyToken,
      isVerified: webhook?.isVerified ?? false,
    });
  }
}

export const webhookController = new WebhookController();
