/**
 * Utility for verifying incoming Meta webhooks based on deterministic hashes.
 * Duplicated locally to ensure `bot` and `server` packages remain strictly decoupled.
 */

import { createHash } from 'node:crypto';
import { env } from '@/engine/config/env.config.js';

export function generateVerifyToken(userId: string): string {
  return createHash('sha256')
    .update(userId + 'verify')
    .digest('hex')
    .substring(0, 10);
}

/**
 * Derives a per-session Telegram webhook secret token from ENCRYPTION_KEY + userId + sessionId.
 * Telegram Bot API requires: A–Z, a–z, 0–9, _ and - (1–256 chars).
 * SHA-256 hex is 64 lowercase hex chars — fully within that character set.
 * Each session gets a unique token without any additional env variable.
 */
export function generateTelegramSecretToken(
  userId: string,
  sessionId: string,
): string {
  return createHash('sha256')
    .update(`${userId}:${sessionId}:${env.ENCRYPTION_KEY}`)
    .digest('hex');
}
