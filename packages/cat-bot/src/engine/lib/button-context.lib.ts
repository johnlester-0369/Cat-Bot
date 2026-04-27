/**
 * Button Context Store — In-Memory State Tracker for Button Clicks
 *
 * Used to pass data from a command execution (onCommand) to a button click
 * handler (onClick) without encoding it all into the callback payload.
 *
 * Like the conversational stateStore, this resides in memory. A bot restart
 * resets active button contexts.
 *
 * TTL policy: 30-minute sliding window — contexts remain valid while the user
 * actively interacts with message buttons. Abandoned contexts (user never clicked)
 * auto-expire rather than accumulating for the full process lifetime.
 */

import { TTLMap } from '@/engine/lib/ttl-map.lib.js';

// 30-minute sliding TTL with a 5-minute background sweep. Sliding ensures
// multi-step button flows stay alive as long as the user keeps clicking.
export const buttonContextStore = new TTLMap<Record<string, unknown>>({
  ttlMs: 30 * 60 * 1000,
  sliding: true,
  cleanupIntervalMs: 5 * 60 * 1000,
});

export interface ButtonOverride {
  label?: string;
  style?: string;
  onClick?: (...args: unknown[]) => unknown;
}

// Overrides share the same 30-minute lifecycle as button contexts — an expired
// context has no associated override worth retrieving.
export const buttonOverridesStore = new TTLMap<ButtonOverride>({
  ttlMs: 30 * 60 * 1000,
  sliding: true,
  cleanupIntervalMs: 5 * 60 * 1000,
});

export const buttonContextLib = {
  create(key: string, context: Record<string, unknown>): void {
    buttonContextStore.set(key, context);
  },

  get(key: string): Record<string, unknown> | null {
    return buttonContextStore.get(key) ?? null;
  },

  delete(key: string): void {
    buttonContextStore.delete(key);
  },

  setOverride(key: string, def: ButtonOverride): void {
    buttonOverridesStore.set(key, def);
  },

  getOverride(key: string): ButtonOverride | null {
    return buttonOverridesStore.get(key) ?? null;
  },

  deleteOverride(key: string): void {
    buttonOverridesStore.delete(key);
  },
};
