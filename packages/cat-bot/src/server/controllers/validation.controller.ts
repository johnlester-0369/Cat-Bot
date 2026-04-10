/**
 * Credential Validation Controller — REST Endpoints
 *
 * POST /api/v1/validate/discord          — verify Discord bot token via REST API
 * POST /api/v1/validate/telegram         — verify Telegram token via getMe
 * POST /api/v1/validate/facebook-messenger — structural parse of appstate JSON
 *
 * Facebook Page validation is handled entirely through the Socket.IO flow in
 * validation.socket.ts (OTP delivery via webhook), not here.
 *
 * Response contract for all three endpoints:
 *   { valid: true, botName?: string }   — credentials accepted
 *   { valid: false, error: string }     — credentials rejected (still HTTP 200)
 *   HTTP 4xx/5xx                        — infrastructure errors
 *
 * WHY HTTP 200 for invalid credentials: this lets the React hook distinguish
 * between a network failure (throws) and a validation rejection (valid: false)
 * without try/catch branching at the call site.
 */

import type { Request, Response } from 'express';
import { auth } from '@/server/lib/better-auth.lib.js';
import { logger, createLogger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module
import axios from 'axios';
import { startBot } from '@/engine/adapters/platform/facebook-messenger/index.js';
import { isAuthError, withRetry, isNetworkError } from '@/engine/lib/retry.lib.js';

// ── Auth helper ───────────────────────────────────────────────────────────────

async function requireAuth(req: Request, res: Response): Promise<string | null> {
  const headers = new Headers();
  for (const [key, val] of Object.entries(req.headers)) {
    if (val === undefined) continue;
    headers.set(key, Array.isArray(val) ? val.join(', ') : val);
  }
  const session = await auth.api.getSession({ headers });
  if (!session) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return session.user.id;
}

// ── Discord ───────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/validate/discord
 * Body: { discordToken: string }
 *
 * Calls GET /v10/users/@me with Bot token authentication.
 * A 200 response proves the token is a valid bot token — no guild membership required.
 */
export async function validateDiscord(req: Request, res: Response): Promise<void> {
  const userId = await requireAuth(req, res);
  if (!userId) return;

  const { discordToken } = req.body as { discordToken?: string };
  if (!discordToken) {
    res.status(400).json({ error: 'Missing discordToken' });
    return;
  }

  try {
    const response = await withRetry(
      () => axios.get<{ username: string; id: string }>(
        'https://discord.com/api/v10/users/@me',
        { headers: { Authorization: `Bot ${discordToken}` } },
      ),
      {
        maxAttempts: 3,
        initialDelayMs: 1000,
        // 401 means an invalid token — retrying is futile; only retry transient network faults
        shouldRetry: (err) => !isAuthError(err) && isNetworkError(err),
      },
    );
    res.status(200).json({ valid: true, botName: response.data.username, botId: response.data.id });
  } catch (err) {
    const e = err as { response?: { status: number } };
    if (e.response?.status === 401) {
      res.status(200).json({ valid: false, error: 'Invalid Discord bot token' });
      return;
    }
    logger.error('[validate] Discord validation request failed', { error: err });
    res.status(500).json({ error: 'Failed to validate Discord token' });
  }
}

// ── Telegram ──────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/validate/telegram
 * Body: { telegramToken: string }
 *
 * getMe is the canonical token check — responds immediately without requiring
 * any group membership or channel access.
 */
export async function validateTelegram(req: Request, res: Response): Promise<void> {
  const userId = await requireAuth(req, res);
  if (!userId) return;

  const { telegramToken } = req.body as { telegramToken?: string };
  if (!telegramToken) {
    res.status(400).json({ error: 'Missing telegramToken' });
    return;
  }

  try {
    const response = await withRetry(
      () => axios.get<{
        ok: boolean;
        result?: { first_name?: string; username?: string };
      }>(`https://api.telegram.org/bot${telegramToken}/getMe`),
      {
        maxAttempts: 3,
        initialDelayMs: 1000,
        // 401 from Telegram's Bot API means an invalid token — retrying is futile
        shouldRetry: (err) => !isAuthError(err) && isNetworkError(err),
      },
    );

    if (response.data.ok) {
      const r = response.data.result;
      res.status(200).json({ valid: true, botName: r?.first_name ?? r?.username });
    } else {
      res.status(200).json({ valid: false, error: 'Invalid Telegram bot token' });
    }
  } catch (err) {
    const e = err as { response?: { status: number } };
    if (e.response?.status === 401) {
      res.status(200).json({ valid: false, error: 'Invalid Telegram bot token' });
      return;
    }
    logger.error('[validate] Telegram validation request failed', { error: err });
    res.status(500).json({ error: 'Failed to validate Telegram token' });
  }
}

// ── Facebook Messenger ────────────────────────────────────────────────────────

/**
 * POST /api/v1/validate/facebook-messenger
 * Body: { appstate: string }
 *
 * Validates appstate structurally without performing a live login.
 * A live fca-unofficial login would consume a real session and is too expensive
 * and stateful for a pre-save validation step. We verify:
 *   - Valid JSON
 *   - Non-empty array
 *   - Each entry has `key` and `value` fields (fca-unofficial cookie shape)
 *   - Critical session cookies `c_user` and `xs` are present (proves real appstate)
 */
export async function validateFacebookMessenger(req: Request, res: Response): Promise<void> {
  const userId = await requireAuth(req, res);
  if (!userId) return;

  const { appstate } = req.body as { appstate?: string };
  if (!appstate) {
    res.status(400).json({ error: 'Missing appstate' });
    return;
  }

  try {
    const parsed = JSON.parse(appstate) as unknown;

    if (!Array.isArray(parsed) || parsed.length === 0) {
      res.status(200).json({ valid: false, error: 'Invalid appstate: must be a non-empty JSON array' });
      return;
    }

    // Every entry must have `key` and `value` fields — minimum fca-unofficial cookie shape
    const structureValid = (parsed as unknown[]).every((cookie) => {
      if (typeof cookie !== 'object' || cookie === null) return false;
      const c = cookie as Record<string, unknown>;
      return 'key' in c && 'value' in c;
    });
    if (!structureValid) {
      res.status(200).json({
        valid: false,
        error: 'Invalid appstate: each cookie must have key and value fields',
      });
      return;
    }

    // c_user (Facebook UID) and xs (session token) are mandatory for any authenticated session
    const cookieKeys = (parsed as Array<{ key: string }>).map((c) => c.key);
    const requiredKeys = ['c_user', 'xs'];
    const missingKeys = requiredKeys.filter((k) => !cookieKeys.includes(k));
    if (missingKeys.length > 0) {
      res.status(200).json({
        valid: false,
        error: `Invalid appstate: missing required cookies (${missingKeys.join(', ')})`,
      });
    return;
    }

    // Structural checks passed — attempt a live fca-unofficial login to confirm the session is
    // still active. startBot() authenticates via the cookie blob but never calls listenMqtt,
    // so no persistent MQTT connection is opened or left dangling after this call.
    try {
      // dummy session logger to avoid undefined error
      const sessionLogger = createLogger({
          userId: '',
          platformId: '',
          sessionId: '',
      });
        
      // Use non-null assertion since appstate has been validated above
      const { api } = await startBot({ appstate: appstate! }, sessionLogger);

      const botId = api.getCurrentUserID();
      
      const getBotInfo = await new Promise<Record<string, { name?: string; vanity?: string | null }>>((resolve, reject) => {
        api.getUserInfo([String(botId)], (err, info) => {
          if (err) reject(err);
          // Typecast to satisfy structural requirement without throwing TS mismatch on vanity property
          else resolve((info ?? {}) as Record<string, { name?: string; vanity?: string | null }>);
        });
      });
   
      const botName = getBotInfo[String(botId)];
      res.status(200).json({ valid: true, botName: botName?.name ?? botName?.vanity  });
    } catch (loginErr) {
      // isAuthError covers expired sessions, login-blocked accounts, and fca-unofficial auth
      // rejections — these cannot be fixed by retrying with the same appstate.
      // Non-auth errors (network, transient) surface a softer retry prompt instead.
      const errorMessage = isAuthError(loginErr)
        ? 'Appstate is invalid or the Facebook session has expired. Please generate a new appstate.'
        : 'Login attempt failed — check your network connection or generate a fresh appstate.';
      logger.warn('[validate] Facebook Messenger live login check failed', { error: loginErr });
      res.status(200).json({ valid: false, error: errorMessage });
    }
  } catch {
    res.status(200).json({ valid: false, error: 'Invalid appstate: not valid JSON' });
  }
}
