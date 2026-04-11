/**
 * Facebook Page Webhook Controller
 *
 * Pure request/response handlers — no Express app or server bootstrap here.
 * Each function is independently unit-testable by passing mock req/res objects.
 * Session state is read through the lib accessors; this module owns no state of its own.
 */

import type { Request, Response } from 'express';
import { upsertFbPageWebhookVerification } from '@/engine/repos/webhooks.repo.js';
import { logger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module
import {
  getSession,
  findAnySessionForUserId,
} from '../../engine/modules/session/facebook-page-session.lib.js';
import type { FacebookWebhookBody } from '../models/page-session.model.js';
import { generateVerifyToken } from '../utils/hash.util.js';
import {
  checkAndResolveOtp,
  isPendingFbPageValidation,
  notifyWebhookVerified,
} from '../socket/validation.socket.js';

/**
 * GET /api/v1/facebook-page/:user_id
 * Facebook ownership-verification handshake — sent when a new webhook subscription
 * is created in Meta App Dashboard. Responds with hub.challenge on success.
 */
export async function handleVerification(
  req: Request,
  res: Response,
): Promise<void> {
  // Express 5 types req.params values as string | string[] — coerce to string
  const rawUserId = req.params['user_id'];
  const userId = Array.isArray(rawUserId)
    ? (rawUserId[0] ?? '')
    : (rawUserId ?? '');
  const mode = req.query['hub.mode'];
  const challenge = req.query['hub.challenge'];
  const verifyToken = req.query['hub.verify_token'];

  // Allow verification when a registered session exists OR credential validation is pending.
  // During Scenario 1 (bot not yet created), no session exists but validation needs the handshake.
  if (!findAnySessionForUserId(userId) && !isPendingFbPageValidation(userId)) {
    logger.warn(
      `GET /api/v1/facebook-page/${userId} — no registered session found for this webhook`,
    );
    res.sendStatus(403);
    return;
  }

  const expectedToken = generateVerifyToken(userId);

  if (verifyToken !== expectedToken) {
    logger.warn(
      `[user ${userId}] Webhook verification failed — token mismatch`,
    );
    res.sendStatus(403);
    return;
  }

  if (mode === 'subscribe') {
    try {
      // Persist verification so the Web UI updates to Verified status automatically
      await upsertFbPageWebhookVerification(userId);
      // Notify any socket client waiting for webhook confirmation (Scenario 1 validation flow)
      notifyWebhookVerified(userId);
      logger.info(`[user ${userId}] Webhook verified by Facebook`);
      res.status(200).send(challenge);
    } catch (err) {
      logger.error(`[user ${userId}] Failed to update webhook status`, {
        error: err,
      });
      res.sendStatus(500);
    }
  } else {
    logger.warn(
      `[user ${userId}] Verification failed — unexpected mode: ${String(mode)}`,
    );
    res.sendStatus(403);
  }
}

/**
 * POST /api/v1/facebook-page/:user_id
 * Incoming messaging events from Facebook. Acknowledges with 200 immediately
 * (Facebook requires a response within 20 s) then dispatches to onMessage
 * asynchronously so slow handlers never trigger Facebook's retry backoff.
 */
export function handleWebhookEvent(req: Request, res: Response): void {
  // Express 5 types req.params values as string | string[] — coerce to string
  const rawUserId = req.params['user_id'];
  const userId = Array.isArray(rawUserId)
    ? (rawUserId[0] ?? '')
    : (rawUserId ?? '');

  // Ack before any async work — Facebook will retry delivery if it does not
  // receive 200 within 20 s, causing duplicate event processing.
  res.sendStatus(200);

  const body = req.body as FacebookWebhookBody;
  // Allow delivery when there is an active session OR a pending credential validation
  if (!findAnySessionForUserId(userId) && !isPendingFbPageValidation(userId)) {
    logger.warn(
      `POST /api/v1/facebook-page/${userId} — no registered session found`,
    );
    return;
  }

  for (const entry of body.entry ?? []) {
    // entry.id IS the Page ID — resolve the session registered as userId:pageId.
    const pageId = entry.id ?? '';
    const session = getSession(String(userId), String(pageId));

    for (const messaging of entry.messaging ?? []) {
      // Check OTP validation queue BEFORE routing to the bot session.
      // This intercepts OTP messages during credential validation (before the bot is saved/started).
      const msg = messaging['message'] as Record<string, unknown> | undefined;
      const messageText = msg?.['text'] as string | undefined;
      // Extract sender PSID so verifyTokenViaPageMessage can reply to the same user,
      // proving the access token is actually scoped to this Page (second auth layer).
      const senderObj = messaging['sender'] as { id?: string } | undefined;
      const senderPsid = senderObj?.id;
      if (
        messageText &&
        checkAndResolveOtp(
          String(userId),
          String(pageId),
          messageText,
          senderPsid,
        )
      ) {
        continue; // OTP consumed — skip session routing for this message
      }

      if (!session) {
        logger.warn(
          `POST /api/v1/facebook-page/${userId} — no session for pageId ${pageId}; messaging skipped`,
        );
        continue;
      }

      // Fire-and-forget with catch — a single failing message must not
      // prevent the rest of the batch from being processed.
      session.onMessage(messaging).catch((err: unknown) => {
        logger.error(
          `[user ${userId}][page ${pageId}] Unhandled error in onMessage`,
          { error: err },
        );
      });
    }
  }
}
