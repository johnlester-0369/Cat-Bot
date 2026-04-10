/**
 * Prefix Manager — Dynamic Prefix Synchronization
 *
 * In-memory, centralized store for active session prefixes. Allows the web dashboard
 * to instantly update a running bot's prefix without requiring a full process restart
 * or exposing database fetches to the hot event-dispatch path.
 */

import { logger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module

class PrefixManager {
  // Key format: `${userId}:${platform}:${sessionId}` (e.g. "cuid123:discord:uuid456")
  private prefixes = new Map<string, string>();

  private getKey(userId: string, platform: string, sessionId: string): string {
    return `${userId}:${platform}:${sessionId}`;
  }

  /**
   * Sets or updates the prefix for a specific bot session.
   */
  setPrefix(userId: string, platform: string, sessionId: string, prefix: string): void {
    const key = this.getKey(userId, platform, sessionId);
    this.prefixes.set(key, prefix);
    logger.debug(`[prefix-manager] Prefix for ${key} dynamically synced to "${prefix}"`);
  }

  /**
   * Retrieves the live prefix for a session. Defaults to '/' if absent.
   */
  getPrefix(userId: string, platform: string, sessionId: string): string {
    const key = this.getKey(userId, platform, sessionId);
    return this.prefixes.get(key) ?? '/';
  }
}

export const prefixManager = new PrefixManager();
