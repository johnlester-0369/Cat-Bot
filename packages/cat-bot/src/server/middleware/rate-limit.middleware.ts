/**
 * In-Memory Rate Limiter — Express Middleware
 *
 * Fixed-window counter keyed by client IP address. Simple and zero-dependency —
 * correct for Cat-Bot's single-process architecture. If the service ever scales
 * to multiple Node processes, swap `store` for a shared Redis/Valkey instance
 * and the logic here remains identical.
 *
 * ── Window strategy ───────────────────────────────────────────────────────────
 * Fixed window (not sliding): the counter resets hard at `resetAt`. This means
 * a burst of `max` requests at the end of window N followed by `max` at the
 * start of window N+1 is technically allowed. For bot management APIs this is
 * an acceptable trade-off; the implementation is O(1) per request with no
 * background sorted-set maintenance that a true sliding window would require.
 *
 * ── Headers returned ──────────────────────────────────────────────────────────
 *   X-RateLimit-Limit      — max requests allowed per window
 *   X-RateLimit-Remaining  — requests remaining in the current window
 *   X-RateLimit-Reset      — Unix timestamp (seconds) when the window resets
 *   Retry-After            — seconds until the client may retry (429 only)
 */

import type { RequestHandler } from 'express';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RateLimitOptions {
  /** Window duration in milliseconds. */
  windowMs: number;
  /** Maximum number of requests allowed per IP within the window. */
  max: number;
  /** Response body error text when the limit is exceeded. */
  message?: string;
}

interface WindowRecord {
  count: number;
  /** Unix ms timestamp at which the window resets and count returns to 0. */
  resetAt: number;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Creates an Express RequestHandler that enforces a fixed-window rate limit
 * keyed by client IP address. The IP is resolved from `req.ip`, which honours
 * Express's `trust proxy` setting — so `X-Forwarded-For` is used in production
 * when `app.set('trust proxy', 1)` is active (set in server/app.ts).
 */
export function createRateLimiter(options: RateLimitOptions): RequestHandler {
  const { windowMs, max } = options;
  const message = options.message ?? 'Too Many Requests';

  // IP → current window record. Entries are reset lazily on the first request
  // after expiry, so no background timer is required for correctness.
  const store = new Map<string, WindowRecord>();

  // Periodic cleanup prevents unbounded growth from IPs that never return after
  // their window expires. Runs every windowMs — worst case a stale entry lives
  // for 2× windowMs before eviction, which is acceptable for management APIs.
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of store) {
      if (now >= record.resetAt) store.delete(ip);
    }
  }, windowMs);

  // Unref so the cleanup timer never prevents a graceful process shutdown.
  cleanupTimer.unref();

  return (req, res, next): void => {
    // `req.ip` can be undefined when trust proxy is misconfigured; fall back
    // to the raw socket address so rate limiting never silently no-ops.
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const now = Date.now();

    const existing = store.get(ip);

    let record: WindowRecord;
    if (existing === undefined || now >= existing.resetAt) {
      // First request in a fresh window — open a new record.
      record = { count: 1, resetAt: now + windowMs };
      store.set(ip, record);
    } else {
      existing.count += 1;
      record = existing;
    }

    const remaining = Math.max(0, max - record.count);
    const resetSeconds = Math.ceil(record.resetAt / 1000);

    // Always set informational headers so clients can implement backoff
    // without waiting for a 429 to discover the window parameters.
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(resetSeconds));

    if (record.count > max) {
      // Retry-After in seconds so HTTP clients and bots can schedule retries
      // without computing the delta themselves from X-RateLimit-Reset.
      const retryAfter = Math.ceil((record.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: message });
      return;
    }

    next();
  };
}

// ── Pre-configured presets ────────────────────────────────────────────────────
// Import the preset you need rather than hard-coding numbers at the call site.
// Each preset creates its own Map store, so counts are tracked independently —
// a request to /api/v1/validate is counted in VALIDATE_LIMIT AND REST_LIMIT,
// which is intentional: heavy validate traffic also drains the general budget.

/**
 * General REST API — applied to all /api/v1/* endpoints.
 * 120 requests per minute is generous for a legitimate dashboard user
 * but will throttle automated scanners running at hundreds of req/s.
 */
export const REST_LIMIT = createRateLimiter({
  windowMs: 60_000,
  max: 120,
});

/**
 * Credential validation endpoints (/api/v1/validate/*).
 * Stricter than the general limit — each call may perform a live Discord /
 * Telegram REST round-trip or an fca-unofficial login, which is expensive.
 * 20 attempts per minute is generous for a human working through a wizard
 * but blocks automated token probing.
 */
export const VALIDATE_LIMIT = createRateLimiter({
  windowMs: 60_000,
  max: 20,
  message: 'Too many validation attempts. Please wait before trying again.',
});

/**
 * Admin REST API (/api/v1/admin/*).
 * Lower ceiling than the general limit — reduces blast radius if an admin
 * session cookie is stolen and used for automated enumeration or bulk operations.
 */
export const ADMIN_LIMIT = createRateLimiter({
  windowMs: 60_000,
  max: 60,
});