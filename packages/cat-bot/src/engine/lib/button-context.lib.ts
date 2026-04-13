/**
 * Button Context Store — In-Memory state tracker for button clicks.
 *
 * Used to pass data from a command execution (onCommand) to a button click
 * handler (onClick) without encoding it all into the callback payload.
 *
 * Like the conversational stateStore, this resides in memory. A bot restart
 * resets active button contexts.
 */

export const buttonContextStore = new Map<string, Record<string, unknown>>();

export interface ButtonOverride {
  label?: string;
  style?: string;
  onClick?: (...args: unknown[]) => unknown;
}

export const buttonOverridesStore = new Map<string, ButtonOverride>();

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
