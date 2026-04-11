/**
 * Utility for verifying incoming Meta webhooks based on deterministic hashes.
 * Duplicated locally to ensure `bot` and `server` packages remain strictly decoupled.
 */

import { createHash } from 'node:crypto';

export function generateShortId(userId: string): string {
  return createHash('sha256').update(userId).digest('hex').substring(0, 8);
}

export function generateVerifyToken(userId: string): string {
  return createHash('sha256')
    .update(userId + 'verify')
    .digest('hex')
    .substring(0, 10);
}
