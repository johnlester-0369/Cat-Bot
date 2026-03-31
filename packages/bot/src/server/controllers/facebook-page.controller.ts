/**
 * Facebook Page Webhook Controller
 *
 * Pure request/response handlers — no Express app or server bootstrap here.
 * Each function is independently unit-testable by passing mock req/res objects.
 * Session state is read through the lib accessors; this module owns no state of its own.
 */

import type { Request, Response } from 'express';
import { logger } from '@/lib/logger.lib.js';
import {
  getSession,
  findSessionByUserId,
} from '../lib/facebook-page-session.lib.js';
import type { FacebookWebhookBody } from '../models/page-session.model.js';

/**
 * GET /v1/facebook-page/:user_id
 * Facebook ownership-verification handshake — sent when a new webhook subscription
 * is created in Meta App Dashboard. Responds with hub.challenge on success.
 */
export function handleVerification(req: Request, res: Response): void {
  // Express 5 types req.params values as string | string[] — coerce to string
  const rawUserId = req.params['user_id'];
  const userId = Array.isArray(rawUserId)
    ? (rawUserId[0] ?? '')
    : (rawUserId ?? '');
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // Facebook only sends verifyToken (not pageId) during the handshake —
  // scan this user's sessions for a matching token instead of a direct Map lookup.
  const matched = findSessionByUserId(userId, String(token ?? ''));

  if (!matched) {
    logger.warn(
      `GET /v1/facebook-page/${userId} — no session matched the verify_token`,
    );
    res.sendStatus(403);
    return;
  }

  if (mode === 'subscribe') {
    logger.info(`[user ${userId}] Webhook verified by Facebook`);
    res.status(200).send(challenge);
  } else {
    logger.warn(
      `[user ${userId}] Verification failed — unexpected mode: ${String(mode)}`,
    );
    res.sendStatus(403);
  }
}

/**
 * POST /v1/facebook-page/:user_id
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

  // Non-page objects (e.g. 'user' for Messenger) are silently ignored —
  // this server only handles Page-scoped webhook subscriptions.
  if (body.object !== 'page') return;

  for (const entry of body.entry ?? []) {
    // entry.id IS the Page ID — resolve the session registered as userId:pageId.
    const pageId = entry.id ?? '';
    const session = getSession(String(userId), String(pageId));

    if (!session) {
      logger.warn(
        `POST /v1/facebook-page/${userId} — no session for pageId ${pageId}; entry skipped`,
      );
      continue;
    }

    for (const messaging of entry.messaging ?? []) {
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
