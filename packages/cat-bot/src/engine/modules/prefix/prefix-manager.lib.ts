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
  // Thread-level prefix overrides — keyed by platform threadId (Discord channelId, FB threadId, etc.).
  // A thread entry wins over the session prefix so individual groups can customise the trigger character.
  private threadPrefixes = new Map<string, string>();

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

  /**
   * Stores a thread-level prefix override, used by /prefix command to customise
   * the trigger character for a specific group without affecting other threads.
   */
  setThreadPrefix(threadId: string, prefix: string): void {
    this.threadPrefixes.set(threadId, prefix);
    logger.debug(`[prefix-manager] Thread prefix for ${threadId} set to "${prefix}"`);
  }

  /**
   * Returns the thread-level prefix override, or undefined when no override is registered.
   * Callers must fall back to getPrefix() when this returns undefined — this is intentional
   * so the system prefix remains the default without explicitly storing it per-thread.
   */
  getThreadPrefix(threadId: string): string | undefined {
    return this.threadPrefixes.get(threadId);
  }

  /**
   * Removes a thread-level prefix override (/prefix reset).
   * After clearing, getThreadPrefix() returns undefined and the session default takes over.
   */
  clearThreadPrefix(threadId: string): void {
    this.threadPrefixes.delete(threadId);
    logger.debug(`[prefix-manager] Thread prefix cleared for ${threadId} — reverting to session default`);
  }
}

export const prefixManager = new PrefixManager();
