/**
 * Webhooks Repo — LRU cache layer over the database adapter.
 *
 * getFbPageWebhookVerification is called on every incoming Facebook Page event
 * to confirm the webhook handshake is complete before dispatching to handlers.
 * Verification status changes once (false → true on first handshake) and never
 * reverts — caching provides permanent hit-rate after the first request.
 */
import {
  getFbPageWebhookVerification as _getFbPageWebhookVerification,
  upsertFbPageWebhookVerification as _upsertFbPageWebhookVerification,
} from 'database';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';

const webhookKey = (userId: string): string => `webhook:fbpage:${userId}`;

export async function getFbPageWebhookVerification(
  userId: string,
): Promise<Awaited<ReturnType<typeof _getFbPageWebhookVerification>>> {
  const key = webhookKey(userId);
  const cached = lruCache.get<Awaited<ReturnType<typeof _getFbPageWebhookVerification>>>(key);
  // null is a valid cached result (row does not exist yet) — only undefined is a cache miss.
  if (cached !== undefined) return cached;
  const result = await _getFbPageWebhookVerification(userId);
  lruCache.set(key, result);
  return result;
}

export async function upsertFbPageWebhookVerification(userId: string): Promise<void> {
  await _upsertFbPageWebhookVerification(userId);
  // The upsert always sets isVerified=true — write that directly into cache
  // so immediately-following getFbPageWebhookVerification reads don't go to DB.
  lruCache.set(webhookKey(userId), { isVerified: true });
}