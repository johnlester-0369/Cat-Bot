/**
 * Platform Retry Utility — Exponential Backoff with Jitter
 *
 * Shared retry primitive consumed by all platform listeners for:
 *   - Startup failures (bad token, network down, rate-limited login)
 *   - Runtime reconnects (MQTT disconnect, polling error)
 *
 * Algorithm: delay(attempt) = min(initialDelayMs × backoffFactor^(attempt-1), maxDelayMs) ± 10% jitter.
 * Jitter prevents thundering-herd when multiple sessions restart simultaneously after a network outage.
 *
 * WHY: Centralising retry logic here prevents each platform from duplicating
 * ad-hoc setTimeout loops with different backoff constants and no logging,
 * and gives a single place to tune retry behavior for the whole system.
 */

import { logger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RetryOptions {
  /** Maximum number of attempts before giving up. Default: 5 */
  maxAttempts?: number;
  /** Initial delay in ms before the first retry. Default: 2000 */
  initialDelayMs?: number;
  /** Multiplier applied to delay on each retry. Default: 2 */
  backoffFactor?: number;
  /** Hard cap on delay regardless of backoff growth. Default: 60000 (1 min) */
  maxDelayMs?: number;
  /** Called just before each retry sleep; receives attempt number and the error. */
  onRetry?: (attempt: number, err: unknown) => void;
  /**
   * Optional guard — return false to abort retrying immediately without sleeping.
   * Designed for auth/credential errors where every additional attempt is futile.
   * When absent, all errors are retried up to maxAttempts (existing behaviour).
   */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Adds ±10% random jitter to avoid thundering-herd when multiple sessions
 * all fail at the same time and would otherwise retry in perfect lock-step.
 */
function jitter(ms: number): number {
  return ms * (0.9 + Math.random() * 0.2);
}

// ── Error classification helpers ──────────────────────────────────────────────

/** Node.js / OS network error codes that indicate a transient connectivity issue. */
const NETWORK_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ECONNABORTED',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

/**
 * Returns true for transient network faults — safe to retry with backoff.
 * Checks Node.js errno/code, HTTP 5xx/429 status codes, and node-fetch system errors.
 */
export function isNetworkError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  const code = (e['code'] ?? e['errno']) as string | undefined;
  if (code && NETWORK_ERROR_CODES.has(code)) return true;
  // node-fetch FetchError carries type: 'system' alongside the errno code
  if (e['type'] === 'system' && code && NETWORK_ERROR_CODES.has(code))
    return true;
  const resp = e['response'] as Record<string, unknown> | undefined;
  const status = (e['status'] ?? resp?.['status']) as number | undefined;
  if (typeof status === 'number' && (status === 429 || status >= 500))
    return true;
  return false;
}

/**
 * Returns true when the error signals an invalid credential — retrying will NOT help.
 * Covers Discord TokenInvalid, Telegram HTTP 401, and fca-unofficial session errors.
 * Callers should propagate these immediately rather than burning through retry attempts.
 */
export function isAuthError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  // Discord.js raises DiscordjsError with code === 'TokenInvalid' for bad bot tokens
  if ((e['code'] as string | undefined) === 'TokenInvalid') return true;
  // HTTP 401 / 403: Telegram Unauthorized, Graph API invalid token, fca auth rejection
  const resp = e['response'] as Record<string, unknown> | undefined;
  const status = (e['status'] ?? resp?.['status']) as number | undefined;
  if (status === 401 || status === 403) return true;

  // Capture structured MQTT auth errors from fca-unofficial (e.g. login_blocked)
  const errCode = String(e['error'] ?? '').toLowerCase();
  const reason = String(e['reason'] ?? '').toLowerCase();
  const typeStr = String(e['type'] ?? '').toLowerCase();

  // fca-unofficial and Telegram deliver auth failures as message strings
  const message = String(e['message'] ?? e['description'] ?? '').toLowerCase();
  return (
    message.includes('not logged in') ||
    message.includes('login blocked') ||
    message.includes('blocked the login') ||
    message.includes('invalid token') ||
    message.includes('tokeninvalid') ||
    message.includes('unauthorized') ||
    message.includes('invalid credentials') ||
    message.includes('login approval') ||
    message.includes(
      'could not find fb_dtsg in html after requesting facebook.',
    ) ||
    errCode === 'login_blocked' ||
    reason === 'auth_error' ||
    typeStr === 'account_inactive'
  );
}

// ── Core retry primitive ──────────────────────────────────────────────────────

/**
 * Calls `fn()` repeatedly until it resolves or `maxAttempts` is exhausted.
 * Uses exponential backoff with jitter between attempts.
 *
 * @throws The last error encountered if all attempts fail.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 5;
  const initialDelayMs = options?.initialDelayMs ?? 2000;
  const backoffFactor = options?.backoffFactor ?? 2;
  const maxDelayMs = options?.maxDelayMs ?? 60_000;

  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;

      // Abort immediately for errors that more attempts cannot fix (e.g. bad credentials).
      // Sleeping and retrying an auth error wastes budget and delays the offline log entry.
      if (options?.shouldRetry && !options.shouldRetry(err, attempt)) {
        throw err;
      }

      if (attempt === maxAttempts) break;

      const baseDelay = Math.min(
        initialDelayMs * Math.pow(backoffFactor, attempt - 1),
        maxDelayMs,
      );
      const delay = Math.round(jitter(baseDelay));

      if (options?.onRetry) {
        options.onRetry(attempt, err);
      } else {
        logger.warn(
          `[retry] Attempt ${attempt}/${maxAttempts} failed — retrying in ${delay}ms`,
          { error: err },
        );
      }

      await sleep(delay);
    }
  }

  throw lastErr;
}
