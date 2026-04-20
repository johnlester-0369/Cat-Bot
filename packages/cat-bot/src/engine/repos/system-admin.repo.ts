/**
 * System Admin Repo — LRU cache layer over the database adapter.
 *
 * isSystemAdmin is invoked on every command dispatch when Role.SYSTEM_ADMIN
 * enforcement is active and in enforceNotBanned as a bypass gate. The system
 * admin set is global across all bot sessions and changes only when an admin
 * is added or removed via the dashboard or seed script — making it an ideal
 * candidate for aggressive caching without complex invalidation logic.
 *
 * Cache invalidation note: system admin mutations originate exclusively from
 * the server layer (dashboard/seed), never from in-chat commands. The LRU TTL
 * provides sufficient freshness — no explicit write-through eviction is wired
 * here because there is no command pathway that mutates the system_admin table.
 */
import { isSystemAdmin as _isSystemAdmin } from 'database';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';

// ── Cache key helpers ──────────────────────────────────────────────────────────

const systemAdminCheckKey = (adminId: string): string =>
  `system:admin:check:${adminId}`;

// ── isSystemAdmin ──────────────────────────────────────────────────────────────

/**
 * Returns true when adminId is registered as a global system admin.
 * System admins bypass all role gates (ANYONE through BOT_ADMIN) and all
 * ban enforcement across every bot session and platform.
 */
export async function isSystemAdmin(adminId: string): Promise<boolean> {
  const key = systemAdminCheckKey(adminId);
  const cached = lruCache.get<boolean>(key);
  if (cached !== undefined) return cached;
  const result = await _isSystemAdmin(adminId);
  lruCache.set(key, result);
  return result;
}