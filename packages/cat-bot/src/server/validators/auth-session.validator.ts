import type { Request, Response } from 'express';
import { auth, adminAuth } from '@/server/lib/better-auth.lib.js';
import { toHeaders } from './request-headers.validator.js';

/**
 * Verifies the user auth session cookie via better-auth and returns the userId.
 *
 * Centralises the auth.api.getSession() + 401 guard that every user-facing
 * controller previously duplicated under its own local name: `requireAuth` in
 * ValidationController, `requireSession` in BotSessionConfigController, and
 * inline in all eight BotController methods and WebhookController.
 *
 * Returns the authenticated userId string on success, or writes a 401 response
 * and returns null so the caller can do `if (!userId) return;` cleanly.
 */
export async function requireSession(
  req: Request,
  res: Response,
): Promise<string | null> {
  const sessionData = await auth.api.getSession({ headers: toHeaders(req) });
  if (!sessionData) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return sessionData.user.id;
}

/**
 * Verifies the admin auth session cookie AND enforces role === 'admin'.
 *
 * Uses adminAuth (not auth) so the ba-admin.session_token cookie is checked —
 * the user portal's better-auth.session_token is never accepted here, keeping
 * the two auth surfaces strictly isolated. Previously lived as a local function
 * inside AdminController alongside its own copy of toHeaders().
 *
 * Returns { id: userId } on success, or writes a 401/403 response and returns null.
 */
export async function requireAdmin(
  req: Request,
  res: Response,
): Promise<{ id: string } | null> {
  const sessionData = await adminAuth.api.getSession({
    headers: toHeaders(req),
  });
  if (!sessionData) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  if (sessionData.user.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden: admin role required' });
    return null;
  }
  return { id: sessionData.user.id };
}

/**
 * Non-throwing admin role probe via the REGULAR user auth session.
 *
 * WHY `auth` and NOT `adminAuth`:
 *   The better-auth admin plugin persists `role` on the user row in the database.
 *   `auth.api.getSession()` always returns the full user record including the `role`
 *   field — so any user whose account has role='admin' will expose that fact through
 *   their normal session cookie (better-auth.session_token).
 *
 *   `adminAuth` is the SEPARATE admin-portal auth instance that issues its own
 *   `ba-admin.session_token` cookie. Dashboard users only carry the regular cookie,
 *   so calling `adminAuth.api.getSession()` here always returns null for them —
 *   which was the bug: the check silently passed as non-admin for everyone on the
 *   user dashboard, but worked only when the admin-portal cookie was also present.
 *
 * Returns true when the request carries a valid regular session where the user's
 * database role === 'admin'. Returns false for all other cases (no session, wrong
 * role, or any error). Never writes an HTTP response — safe to call as a secondary
 * check alongside requireSession() without risking a double-response.
 */
export async function checkAdminSession(req: Request): Promise<boolean> {
  try {
    const sessionData = await auth.api.getSession({ headers: toHeaders(req) });
    return sessionData?.user.role === 'admin';
  } catch {
    return false;
  }
}