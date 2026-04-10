/**
 * Credential Validation — Socket.IO Handlers & In-Memory OTP Queue
 *
 * Owns two concerns:
 *   1. Socket.IO authentication middleware + FB Page OTP event handlers
 *   2. In-memory pending validation queue used by facebook-page.controller.ts
 *
 * FB Page validation flow:
 *   Client emits 'validate:fbpage:init' with { fbAccessToken, pageId }
 *   → Server checks DB for webhook verification status
 *   → Server generates OTP, stores pending entry keyed by `userId:pageId`
 *   → Server emits 'validate:fbpage:status' with step + OTP (+ webhookUrl if scenario 1)
 *   → User sends OTP text to their Facebook Page
 *   → Webhook POST arrives → facebook-page.controller calls checkAndResolveOtp()
 *   → If match → emit 'validate:fbpage:status' { step: 'success' } to the waiting socket
 *
 * For scenario 1 (webhook not yet registered with Meta), the handshake GET also
 * calls notifyWebhookVerified() once isVerified is persisted to DB.
 */

import type { Server as SocketIOServer } from 'socket.io';
import { auth } from '@/server/lib/better-auth.lib.js';
import { getSocketIO } from './socket.lib.js';
import { getFbPageWebhookVerification } from '@/engine/repos/webhooks.repo.js';
import { sendTextMessage } from '@/engine/adapters/platform/facebook-page/pageApi-helpers.js';
import { logger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module
import { generateVerifyToken } from '@/server/utils/hash.util.js';

// ── Pending validation queue ───────────────────────────────────────────────────

interface PendingFbPageValidation {
  userId: string;
  pageId: string;
  fbAccessToken: string;
  otp: string;
  socketId: string;
  /** Unix ms timestamp after which this entry should be considered expired. */
  expiresAt: number;
}

/** Keyed by `userId:pageId` — at most one pending validation per page at a time. */
const pendingQueue = new Map<string, PendingFbPageValidation>();

/** Keyed by userId — tracks socketIds waiting for the Facebook webhook handshake. */
const pendingWebhookVerifications = new Map<string, Set<string>>();

const OTP_TTL_MS = 10 * 60 * 1000; // 10-minute window for OTP entry

function generateOtp(): string {
  // 6-digit numeric OTP — easy to type into a Facebook message without confusion
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/** Removes expired entries lazily — called before adding a new validation. */
function pruneExpiredEntries(): void {
  const now = Date.now();
  for (const [key, entry] of pendingQueue) {
    if (now > entry.expiresAt) pendingQueue.delete(key);
  }
}

// ── Public API consumed by facebook-page.controller.ts ────────────────────────

/**
 * Returns true when there is an active pending FB Page validation for the user.
 * Used to bypass the "no registered session" guard in the webhook controller so
 * Facebook can deliver the OTP message even before a bot session is running.
 */
export function isPendingFbPageValidation(userId: string): boolean {
  // Check both OTP queue and webhook handshake waiters
  for (const [key] of pendingQueue) {
    if (key.startsWith(`${userId}:`)) return true;
  }
  return pendingWebhookVerifications.has(userId);
}

/**
 * Checks whether the incoming message text matches a pending OTP for the given
 * userId+pageId pair. If matched, resolves the validation by emitting 'success'
 * to the client's socket and removing the pending entry.
 *
 * Called synchronously inside handleWebhookEvent — socket.io emit is synchronous.
 */
export function checkAndResolveOtp(
  userId: string,
  pageId: string,
  messageText: string,
  senderPsid?: string,
): boolean {
  const key = `${userId}:${pageId}`;
  const pending = pendingQueue.get(key);
  if (!pending) return false;

  if (Date.now() > pending.expiresAt) {
    pendingQueue.delete(key);
    const io = getSocketIO();
    if (io) {
      io.to(pending.socketId).emit('validate:fbpage:status', {
        step: 'error',
        error: 'Verification timed out. Please click Verify again.',
      });
    }
    return false;
  }

  if (messageText.trim() !== pending.otp) return false;

  // OTP matched — remove from queue and kick off access-token verification.
  // verifyTokenViaPageMessage fires fire-and-forget so checkAndResolveOtp stays
  // synchronous — the controller `continue` statement must not require await.
  pendingQueue.delete(key);
  logger.info(`[validation.socket] OTP verified for userId=${userId} pageId=${pageId}`);
  void verifyTokenViaPageMessage(pending, senderPsid);
  return true;
}

/**
 * Second verification layer: sends 'Successfully credential verified' to the OTP
 * sender's PSID. A successful Graph API send proves the fbAccessToken is scoped to
 * this pageId — a token from a different Page would return a permission error.
 * Fires after OTP match; kept async and separate so checkAndResolveOtp is sync.
 */
async function verifyTokenViaPageMessage(
  pending: PendingFbPageValidation,
  senderPsid: string | undefined,
): Promise<void> {
  const io = getSocketIO();

  if (senderPsid) {
    try {
      // Sending to the OTP sender's PSID proves the token can POST to this Page.
      // A token belonging to a different page returns Graph API error code 100.
      await sendTextMessage(pending.fbAccessToken, senderPsid, {
        text: 'Successfully credential verified',
      });
      logger.info(
        `[validation.socket] Access token confirmed for pageId=${pending.pageId}`,
      );
    } catch (err) {
      // Token received the OTP message (session is valid) but cannot send as this Page —
      // most likely fbAccessToken was generated for a different Facebook Page ID.
      logger.warn(
        `[validation.socket] Access token mismatch for pageId=${pending.pageId}`,
        { error: err },
      );
      if (io) {
        io.to(pending.socketId).emit('validate:fbpage:status', {
          step: 'error',
          error:
            'OTP verified but the access token cannot send messages as this Page. ' +
            'Ensure the token matches the Page ID.',
        });
      }
      return;
    }
  }

  if (io) {
    io.to(pending.socketId).emit('validate:fbpage:status', { step: 'success' });
  }
}

/**
 * Emits 'webhook-verified' to all sockets waiting for the Facebook handshake
 * for this userId. Called by handleVerification() after upsertFbPageWebhookVerification().
 */
export function notifyWebhookVerified(userId: string): void {
  const io = getSocketIO();
  if (!io) return;

  const socketIds = pendingWebhookVerifications.get(userId);
  if (!socketIds) return;

  for (const socketId of socketIds) {
    io.to(socketId).emit('validate:fbpage:status', { step: 'webhook-verified' });
  }
  pendingWebhookVerifications.delete(userId);
  logger.info(`[validation.socket] Notified ${socketIds.size} socket(s) — webhook verified for userId=${userId}`);
}

// ── Socket.IO handler registration ────────────────────────────────────────────

/**
 * Registers the authentication middleware and 'validate:fbpage:init' handler
 * on the provided Socket.IO server. Called once from server.ts after initSocketIO().
 *
 * Auth strategy: extract better-auth session cookie from the socket handshake
 * headers — browsers include cookies automatically when withCredentials: true.
 */
export function registerValidationHandlers(io: SocketIOServer): void {
  // Authenticate every socket connection via the better-auth session cookie.
  // Unauthenticated sockets are rejected before any event handler runs.
  io.use(async (socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers['cookie'] ?? '';
      const headers = new Headers({ cookie: cookieHeader });
      const session = await auth.api.getSession({ headers });
      if (!session) {
        next(new Error('Authentication required: no valid session cookie'));
        return;
      }
      // Store userId on socket.data so event handlers don't repeat the auth call
      socket.data['userId'] = session.user.id as string;
      next();
    } catch {
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data['userId'] as string;
    logger.info(`[socket] Connected: ${socket.id} (user=${userId})`);

    /**
     * Client sends this when the user clicks "Verify" on the Facebook Page platform step.
     * Generates an OTP and responds with the appropriate step based on webhook status.
     */
    socket.on('validate:fbpage:init', async (data: unknown) => {
      try {
        // Guard against malformed payloads from untrusted clients
        if (!data || typeof data !== 'object') {
          socket.emit('validate:fbpage:status', { step: 'error', error: 'Invalid payload' });
          return;
        }
        const { fbAccessToken, pageId } = data as { fbAccessToken?: string; pageId?: string };
        if (!fbAccessToken || !pageId) {
          socket.emit('validate:fbpage:status', { step: 'error', error: 'Missing fbAccessToken or pageId' });
          return;
        }

        pruneExpiredEntries();

        // Check whether this user has already completed the FB Page webhook handshake
        const webhookRecord = await getFbPageWebhookVerification(userId);
        const isWebhookVerified = webhookRecord?.isVerified ?? false;

        const otp = generateOtp();
        const key = `${userId}:${pageId}`;
        pendingQueue.set(key, {
          userId,
          pageId,
          fbAccessToken,
          otp,
          socketId: socket.id,
          expiresAt: Date.now() + OTP_TTL_MS,
        });

        const baseUrl = process.env['BETTER_AUTH_URL'] ?? 'http://localhost:3000';

        if (!isWebhookVerified) {
          // Scenario 1 — user has not yet registered our webhook with Meta.
          // Surface webhook URL + verify token so they can do the handshake,
          // then keep the OTP ready for after the webhook is confirmed.
          if (!pendingWebhookVerifications.has(userId)) {
            pendingWebhookVerifications.set(userId, new Set());
          }
          pendingWebhookVerifications.get(userId)!.add(socket.id);

          socket.emit('validate:fbpage:status', {
            step: 'webhook-pending',
            otp,
            webhookUrl: `${baseUrl}/api/v1/facebook-page/${userId}`,
            verifyToken: generateVerifyToken(userId),
          });
        } else {
          // Scenario 2 — webhook already verified.  Skip to OTP challenge.
          socket.emit('validate:fbpage:status', { step: 'otp-pending', otp });
        }
      } catch (err) {
        logger.error('[validation.socket] validate:fbpage:init error', { error: err });
        socket.emit('validate:fbpage:status', { step: 'error', error: 'Internal server error' });
      }
    });

    socket.on('disconnect', () => {
      logger.info(`[socket] Disconnected: ${socket.id}`);
      // Clean up pending OTP entries for this socket to avoid zombie queue entries
      for (const [key, pending] of pendingQueue) {
        if (pending.socketId === socket.id) pendingQueue.delete(key);
      }
      // Clean up pending webhook verification waiters
      for (const [uid, socketIds] of pendingWebhookVerifications) {
        socketIds.delete(socket.id);
        if (socketIds.size === 0) pendingWebhookVerifications.delete(uid);
      }
    });
  });
}
