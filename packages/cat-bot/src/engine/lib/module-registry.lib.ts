/**
 * Module Registry — Global in-memory store for loaded modules
 *
 * Populated by app.ts at boot. Exposes module configs (metadata)
 * to the API controllers so they can enrich database state without
 * executing a live scan of the filesystem or relying on a database schema change.
 */

export const commandRegistry = new Map<string, Record<string, unknown>>();
export const eventRegistry = new Map<string, Record<string, unknown>>();
