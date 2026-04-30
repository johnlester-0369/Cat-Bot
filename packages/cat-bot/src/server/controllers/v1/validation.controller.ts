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
// randomBytes removed — HMAC-signed tokens no longer need random bytes for token generation.
// createHmac: signs the token payload so validity is self-contained (no server-side Map).
// timingSafeEqual: prevents HMAC oracle timing attacks during signature comparison.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { sendMail } from '@/server/lib/mailer.lib.js';
import { env } from '@/engine/config/env.config.js';
import { requireSession } from '@/server/validators/auth-session.validator.js';
import { logger, createLogger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module
import { auth } from '@/server/lib/better-auth.lib.js';
import axios from 'axios';
import { startBot } from '@/engine/adapters/platform/facebook-messenger/index.js';
import {
  isAuthError,
  withRetry,
  isNetworkError,
} from '@/engine/lib/retry.lib.js';
import {
  buildEmailLayout,
  buildButton,
  COLORS,
} from '@/server/email-template/index.js';

// ── Discord ───────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/validate/discord
 * Body: { discordToken: string }
 *
 * Calls GET /v10/users/@me with Bot token authentication.
 * A 200 response proves the token is a valid bot token — no guild membership required.
 */
export async function validateDiscord(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = await requireSession(req, res);
  if (!userId) return;

  const { discordToken } = req.body as { discordToken?: string };
  if (!discordToken) {
    res.status(400).json({ error: 'Missing discordToken' });
    return;
  }

  try {
    const response = await withRetry(
      () =>
        axios.get<{ username: string; id: string }>(
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
    res.status(200).json({
      valid: true,
      botName: response.data.username,
      botId: response.data.id,
    });
  } catch (err) {
    const e = err as { response?: { status: number } };
    if (e.response?.status === 401) {
      res
        .status(200)
        .json({ valid: false, error: 'Invalid Discord bot token' });
      return;
    }
    logger.error('[validate] Discord validation request failed', {
      error: err,
    });
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
export async function validateTelegram(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = await requireSession(req, res);
  if (!userId) return;

  const { telegramToken } = req.body as { telegramToken?: string };
  if (!telegramToken) {
    res.status(400).json({ error: 'Missing telegramToken' });
    return;
  }

  try {
    const response = await withRetry(
      () =>
        axios.get<{
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
      res
        .status(200)
        .json({ valid: true, botName: r?.first_name ?? r?.username });
    } else {
      res
        .status(200)
        .json({ valid: false, error: 'Invalid Telegram bot token' });
    }
  } catch (err) {
    const e = err as { response?: { status: number } };
    if (e.response?.status === 401) {
      res
        .status(200)
        .json({ valid: false, error: 'Invalid Telegram bot token' });
      return;
    }
    logger.error('[validate] Telegram validation request failed', {
      error: err,
    });
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
export async function validateFacebookMessenger(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = await requireSession(req, res);
  if (!userId) return;

  const { appstate } = req.body as { appstate?: string };
  if (!appstate) {
    res.status(400).json({ error: 'Missing appstate' });
    return;
  }

  try {
    const parsed = JSON.parse(appstate) as unknown;

    if (!Array.isArray(parsed) || parsed.length === 0) {
      res.status(200).json({
        valid: false,
        error: 'Invalid appstate: must be a non-empty JSON array',
      });
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

      const getBotInfo = await new Promise<
        Record<string, { name?: string; vanity?: string | null }>
      >((resolve, reject) => {
        api.getUserInfo([String(botId)], (err, info) => {
          if (err) reject(err);
          // Typecast to satisfy structural requirement without throwing TS mismatch on vanity property
          else
            resolve(
              (info ?? {}) as Record<
                string,
                { name?: string; vanity?: string | null }
              >,
            );
        });
      });

      const botName = getBotInfo[String(botId)];
      res
        .status(200)
        .json({ valid: true, botName: botName?.name ?? botName?.vanity });
    } catch (loginErr) {
      // isAuthError covers expired sessions, login-blocked accounts, and fca-unofficial auth
      // rejections — these cannot be fixed by retrying with the same appstate.
      // Non-auth errors (network, transient) surface a softer retry prompt instead.
      const errorMessage = isAuthError(loginErr)
        ? 'Appstate is invalid or the Facebook session has expired. Please generate a new appstate.'
        : 'Login attempt failed — check your network connection or generate a fresh appstate.';
      logger.warn('[validate] Facebook Messenger live login check failed', {
        error: loginErr,
      });
      res.status(200).json({ valid: false, error: errorMessage });
    }
  } catch {
    res
      .status(200)
      .json({ valid: false, error: 'Invalid appstate: not valid JSON' });
  }
}

// ── Email Reset Validation ────────────────────────────────────────────────────

/**
 * POST /api/v1/validate/email-reset
 * Body: { email: string; adminOnly?: boolean }
 *
 * Checks whether an email address is registered in the auth database and,
 * when adminOnly = true, verifies the account holds the 'admin' role.
 *
 * Called by the forgot-password pages BEFORE requestPasswordReset so the UI can
 * surface a clear "not found" or "not an admin account" error. better-auth
 * deliberately hides this information in requestPasswordReset to prevent user
 * enumeration — this endpoint restores that UX explicitly and is protected by
 * VALIDATE_LIMIT (20 req / 60 s per IP) applied at the app.ts routing layer.
 */
export async function validateEmailForPasswordReset(
  req: Request,
  res: Response,
): Promise<void> {
  const { email, adminOnly } = req.body as {
    email?: string;
    adminOnly?: boolean;
  };

  if (!email || typeof email !== 'string') {
    res.status(400).json({ error: 'Missing email' });
    return;
  }

  try {
    // auth.$context exposes the underlying database adapter — same pattern used
    // in admin.controller.ts updateUser() to perform a pre-write email collision check.
    const ctx = await auth.$context;
    const user = await ctx.adapter.findOne<Record<string, unknown>>({
      model: 'user',
      where: [{ field: 'email', value: email.toLowerCase().trim() }],
    });

    if (!user) {
      res.status(200).json({
        valid: false,
        error: 'No account found with this email address.',
      });
      return;
    }

    // Admin-only path: reject accounts that exist but do not hold the admin role.
    // Used by the admin forgot-password page to prevent non-admin users from
    // probing for valid addresses via the admin portal password reset flow.
    if (adminOnly === true && user['role'] !== 'admin') {
      res.status(200).json({
        valid: false,
        error: 'No admin account found with this email address.',
      });
      return;
    }

    res.status(200).json({ valid: true });
  } catch (error) {
    logger.error('[validate] Email reset validation failed', { error });
    res.status(500).json({ error: 'Failed to validate email' });
  }
}

// ── Email Status Check ────────────────────────────────────────────────────────

/**
 * POST /api/v1/validate/email-status
 * Body: { email: string }
 * Returns the existence and verification status of an email address.
 * Used during sign-up to determine whether to surface an "already exists" error
 * or redirect the user to the verification flow.
 */
export async function checkEmailStatus(
  req: Request,
  res: Response,
): Promise<void> {
  const { email } = req.body as { email?: string };

  if (!email || typeof email !== 'string') {
    res.status(400).json({ error: 'Missing email' });
    return;
  }

  try {
    const ctx = await auth.$context;
    const user = await ctx.adapter.findOne<Record<string, unknown>>({
      model: 'user',
      where: [{ field: 'email', value: email.toLowerCase().trim() }],
    });

    if (!user) {
      res.status(200).json({ exists: false, verified: false });
      return;
    }

    res.status(200).json({
      exists: true,
      verified: user['emailVerified'] === true,
    });
  } catch (error) {
    logger.error('[validate] Email status check failed', { error });
    res.status(500).json({ error: 'Failed to check email status' });
  }
}

// ── HMAC-signed Password Reset Token Flow ─────────────────────────────────────
//
// WHY stateless HMAC tokens instead of the previous in-memory Map:
//
//   The old Map<string, ResetToken> lived at module scope. Every time `tsx watch`
//   detects a file change and hot-reloads the module (which happens constantly
//   during development — even an auto-save wipes it), the Map is re-initialised
//   to empty. Tokens emailed a few seconds earlier become instantly invalid.
//   The same wipe happens on any production process restart.
//
//   HMAC-signed tokens are self-validating: the email address, expiry timestamp,
//   and adminOnly flag are embedded in a base64url-encoded JSON payload. The
//   server signs that payload with BETTER_AUTH_SECRET via HMAC-SHA256. Verification
//   only requires re-computing the signature — no server-side state needed.
//   Tokens survive any number of process restarts because nothing is stored.
//
// Token format: <base64url(JSON payload)>.<hex HMAC-SHA256 signature>
//
// Single-use enforcement: only confirmed resets are tracked in usedTokenSigs
// (a Set of hex signature strings). Pending tokens that were verified but never
// submitted are not stored, keeping the Set tiny under all realistic usage patterns.

interface TokenPayload {
  email: string;
  expiresAt: number;
  adminOnly: boolean;
}

/** Returns the HMAC signing key bound to this server's BETTER_AUTH_SECRET. */
function getSigningKey(): string {
  const secret = process.env['BETTER_AUTH_SECRET'];
  if (!secret) {
    // Warn loudly but don't crash — a weak fallback is safer than a boot failure.
    // In production, BETTER_AUTH_SECRET must be set for tokens to be unguessable.
    logger.warn(
      '[validate] BETTER_AUTH_SECRET is not set — reset tokens are using an insecure fallback key. Set this env var before going to production.',
    );
    return 'cat-bot-reset-fallback-insecure';
  }
  return secret;
}

/**
 * Creates a signed reset token encoding email, expiry, and adminOnly scope.
 * The token is safe to embed directly in a URL query string (base64url + hex).
 */
function createSignedToken(email: string, adminOnly: boolean): string {
  const payload = Buffer.from(
    JSON.stringify({
      email: email.toLowerCase().trim(),
      expiresAt: Date.now() + 3_600_000, // 1 hour
      adminOnly,
    } satisfies TokenPayload),
  ).toString('base64url');

  const sig = createHmac('sha256', getSigningKey())
    .update(payload)
    .digest('hex');

  return `${payload}.${sig}`;
}

/**
 * Verifies the HMAC signature, expiry, adminOnly scope, and single-use status.
 * Returns the decoded email on success so callers never need to re-parse the token.
 */
function verifySignedToken(
  token: string,
  adminOnly: boolean,
): { valid: true; email: string; sig: string } | { valid: false } {
  // Token must contain exactly one dot separator between payload and signature
  const dotIdx = token.lastIndexOf('.');
  if (dotIdx === -1) return { valid: false };

  const payload = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);

  // Re-compute expected signature and compare in constant time.
  // timingSafeEqual prevents HMAC oracle attacks where an attacker probes one
  // byte at a time by measuring response latency differences.
  const expectedSig = createHmac('sha256', getSigningKey())
    .update(payload)
    .digest('hex');

  let sigMatch = false;
  try {
    const sigBuf = Buffer.from(sig, 'hex');
    const expectedBuf = Buffer.from(expectedSig, 'hex');
    // timingSafeEqual requires equal-length buffers; a length mismatch is itself a failure
    if (sigBuf.length !== expectedBuf.length) return { valid: false };
    sigMatch = timingSafeEqual(sigBuf, expectedBuf);
  } catch {
    return { valid: false };
  }
  if (!sigMatch) return { valid: false };

  // Reject already-consumed signatures before parsing payload — fast path avoids
  // JSON.parse cost on replay attempts hitting an already-used token
  if (usedTokenSigs.has(sig)) return { valid: false };

  try {
    const data = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf-8'),
    ) as TokenPayload;

    if (Date.now() > data.expiresAt) return { valid: false };
    if (data.adminOnly !== adminOnly) return { valid: false };

    return { valid: true, email: data.email, sig };
  } catch {
    return { valid: false };
  }
}

// Tracks hex signatures of tokens that have been consumed by a successful reset.
// One entry per completed password reset — far smaller than the old pending-tokens Map.
const usedTokenSigs = new Set<string>();

// Hourly sweep: if the Set has somehow grown beyond 10k entries (impossible under
// any realistic traffic pattern — that would be 10k completed resets in one hour),
// clear it entirely rather than letting it grow without bound.
setInterval(() => {
  if (usedTokenSigs.size > 10_000) usedTokenSigs.clear();
}, 3_600_000).unref();

/**
 * POST /api/v1/validate/reset-password/request
 * Body: { email: string, adminOnly: boolean }
 * Generates an HMAC-signed token and sends a reset email if the user exists.
 */
export async function requestPasswordResetCustom(
  req: Request,
  res: Response,
): Promise<void> {
  const { email, adminOnly } = req.body as {
    email?: string;
    adminOnly?: boolean;
  };

  if (!email || typeof email !== 'string') {
    res.status(400).json({ error: 'Missing email' });
    return;
  }

  try {
    const ctx = await auth.$context;
    const user = await ctx.adapter.findOne<Record<string, unknown>>({
      model: 'user',
      where: [{ field: 'email', value: email.toLowerCase().trim() }],
    });

    // To prevent user enumeration, always return success even if user not found
    if (!user) {
      res.status(200).json({ success: true });
      return;
    }

    if (adminOnly && user['role'] !== 'admin') {
      res.status(200).json({ success: true });
      return;
    }

    // HMAC-signed token — encodes email/expiry/adminOnly in a tamper-proof payload.
    // No server-side Map entry needed; the token itself proves its own validity.
    const token = createSignedToken(email, !!adminOnly);

    // Prevent malformed double slashes if env.VITE_URL contains a trailing slash
    const baseUrl = (
      env.VITE_URL || `${req.protocol}://${req.get('host')}`
    ).replace(/\/$/, '');

    const targetEmail = String(user['email'] ?? email);
    const url = `${baseUrl}${adminOnly ? '/admin' : ''}/reset-password?token=${token}&email=${encodeURIComponent(targetEmail)}`;
    const targetName = String(user['name'] ?? email);

    await sendMail({
      to: targetEmail,
      subject: adminOnly
        ? 'Reset your Cat-Bot Admin password'
        : 'Reset your Cat-Bot password',
      html: buildEmailLayout(
        `
        <p style="margin: 0 0 16px 0; color: ${COLORS.onSurface}; font-weight: 500;">Hello ${targetName},</p>
        <p style="margin: 0 0 24px 0;">Click the button below to securely reset your ${adminOnly ? 'admin ' : ''}password:</p>
        ${buildButton(url, 'Reset Password')}
        <p style="margin: 24px 0 0 0; color: ${COLORS.outlineVariant}; font-size: 14px;">This link expires in 1 hour. If you did not request this, you can safely ignore this email.</p>
      `,
        'Securely reset your password',
      ),
      text: `Reset your password by visiting: ${url}`,
    });

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('[validate] Custom request reset failed', { error });
    res.status(500).json({ error: 'Failed to request reset' });
  }
}

/**
 * POST /api/v1/validate/reset-password/verify-token
 * Body: { token: string, adminOnly: boolean }
 * Validates whether an HMAC-signed token has a valid signature, is unexpired,
 * and has not already been consumed by a successful reset.
 */
export async function verifyResetTokenCustom(
  req: Request,
  res: Response,
): Promise<void> {
  const body = req.body as { token?: string; adminOnly?: boolean };
  // Defensively strip any trailing whitespaces/newlines injected by email client link parsers
  // or user copy-paste errors to prevent map lookup misses.
  const token = body.token?.trim();
  const adminOnly = body.adminOnly;

  if (!token) {
    res.status(400).json({ error: 'Missing token' });
    return;
  }

  const result = verifySignedToken(token, !!adminOnly);
  if (!result.valid) {
    res.status(200).json({ valid: false });
    return;
  }

  res.status(200).json({ valid: true });
}

/**
 * POST /api/v1/validate/reset-password/confirm
 * Body: { token: string, password: string, adminOnly: boolean }
 * Verifies the HMAC token, updates the password, and marks the token signature
 * as consumed so it cannot be replayed.
 */
export async function confirmPasswordResetCustom(
  req: Request,
  res: Response,
): Promise<void> {
  const body = req.body as {
    token?: string;
    password?: string;
    adminOnly?: boolean;
  };
  // Protect against whitespace injection exactly as the verification endpoint does
  const token = body.token?.trim();
  const password = body.password;
  const adminOnly = body.adminOnly;

  if (!token || !password) {
    res.status(400).json({ error: 'Missing token or password' });
    return;
  }

  const tokenResult = verifySignedToken(token, !!adminOnly);
  if (!tokenResult.valid) {
    res.status(400).json({ error: 'Invalid or expired token' });
    return;
  }

  try {
    const ctx = await auth.$context;
    const user = await ctx.adapter.findOne<Record<string, unknown>>({
      model: 'user',
      where: [{ field: 'email', value: tokenResult.email }],
    });

    if (!user) {
      res.status(400).json({ error: 'User no longer exists' });
      return;
    }

    const hashed = await hashPassword(password);

    const accounts = await ctx.adapter.findMany<Record<string, unknown>>({
      model: 'account',
      where: [
        { field: 'userId', value: user['id'] as string },
        { field: 'providerId', value: 'credential' },
      ],
    });

    if (accounts && accounts.length > 0) {
      await ctx.adapter.update({
        model: 'account',
        where: [{ field: 'id', value: accounts[0]!['id'] as string }],
        update: { password: hashed },
      });
    } else {
      // In case they only had social login before
      await ctx.adapter.create({
        model: 'account',
        data: {
          userId: user['id'] as string, // Cast required to satisfy strict generic DB interfaces
          accountId: tokenResult.email,
          providerId: 'credential',
          password: hashed,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }

    // Mark the token signature as consumed — prevents replay of the same link.
    // Only one entry is added per completed reset; the Set stays tiny.
    usedTokenSigs.add(tokenResult.sig);

    // Force sign-out of all devices by clearing sessions
    await ctx.adapter.deleteMany({
      model: 'session',
      where: [{ field: 'userId', value: user['id'] as string }],
    });

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('[validate] Custom confirm reset failed', { error });
    res.status(500).json({ error: 'Failed to reset password' });
  }
}
