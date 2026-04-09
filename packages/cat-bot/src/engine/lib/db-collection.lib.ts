/**
 * Collection Library — named per-user-session JSON data stores
 *
 * Provides a rich dot-path CRUD surface on top of the `data` TEXT column in
 * bot_users_session. Each "collection" is a top-level key in that JSON blob.
 *
 * Usage from command handlers:
 *   const userColl = db.users.collection(senderID);    // scoped to session
 *   await userColl.createCollection('daily');
 *   const daily = await userColl.getCollection('daily');
 *   await daily.set('cooldown', Date.now());
 *
 * Design decisions:
 *   - Read-modify-write on every mutation — simplest correct model for SQLite without
 *     distributed transactions; acceptable for single-process bot deployments.
 *   - writeCollection re-reads the full data blob before patching the collection key so
 *     concurrent mutations to DIFFERENT collections in the same session don't clobber each other.
 *   - All dot-path operations are pure in-memory; only the top-level read/write hits the DB.
 *   - Business logic (cooldown math, reward amounts) lives in command modules, never here.
 */

import { getUserSessionData, setUserSessionData } from '@/engine/repos/users.repo.js';
import { getThreadSessionData, setThreadSessionData } from '@/engine/repos/threads.repo.js';

// ── Dot-path helpers ──────────────────────────────────────────────────────────

function parsePath(path: string): string[] {
  return path.split('.').filter(Boolean);
}

/** Traverses obj by dot-separated path. Returns undefined for any missing segment. */
function getByPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  let cur: unknown = obj;
  for (const key of parsePath(path)) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Sets value at dot-path, creating intermediate objects as needed. */
function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = parsePath(path);
  if (parts.length === 0) return;
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!; // safe: i is always < parts.length - 1
    if (typeof cur[key] !== 'object' || cur[key] === null) cur[key] = {};
    cur = cur[key] as Record<string, unknown>;
  }
  const lastKey = parts.at(-1)!; // safe: parts.length > 0 guarded above
  cur[lastKey] = value;
}

/** Removes the value at dot-path. Silently no-ops on missing intermediate segments. */
function deleteByPath(obj: Record<string, unknown>, path: string): void {
  const parts = parsePath(path);
  if (parts.length === 0) return;
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (typeof cur[key] !== 'object' || cur[key] === null) return;
    cur = cur[key] as Record<string, unknown>;
  }
  delete cur[parts.at(-1)!];
}

// ── Public types ──────────────────────────────────────────────────────────────

/** Rich CRUD surface for a single named collection within a user session's data blob. */
export interface CollectionHandle {
  // Nested object / array operations
  get(path?: string): Promise<unknown>;
  set(path: string, value: unknown): Promise<void>;
  /** Shallow-merges value when both existing and new are objects; overwrites otherwise. */
  update(path: string, value: unknown): Promise<void>;
  delete(path?: string): Promise<void>;
  push(path: string, value: unknown): Promise<void>;
  pull(path: string, value: unknown): Promise<void>;
  unshift(path: string, value: unknown): Promise<void>;
  shift(path: string): Promise<unknown>;
  pop(path: string): Promise<unknown>;
  /** Removes 1 element at index and inserts items in its place. Returns removed elements. */
  splice(path: string, index: number, ...items: unknown[]): Promise<unknown[]>;
  find(path: string, predicate: (item: unknown) => boolean): Promise<unknown[]>;
  findOne(path: string, predicate: (item: unknown) => boolean): Promise<unknown>;

  // Primitive (single-value) operations
  increment(path: string, amount?: number): Promise<void>;
  decrement(path: string, amount?: number): Promise<void>;
  reset(path: string, defaultValue: unknown): Promise<void>;
  exists(path: string): Promise<boolean>;

  // Metadata & utilities
  keys(path?: string): Promise<string[]>;
  length(path: string): Promise<number>;
  clear(path?: string): Promise<void>;
  /** Unconditional set (create or replace). Semantically distinct from update for clarity. */
  upsert(path: string, value: unknown): Promise<void>;
  /** Always shallow-merges into existing object; no-ops gracefully on non-object targets. */
  merge(path: string, value: Record<string, unknown>): Promise<void>;
}

/** Collection namespace for a specific bot_users_session row (scoped by botUserId). */
export interface CollectionManager {
  isCollectionExist(name: string): Promise<boolean>;
  createCollection(name: string): Promise<void>;
  getCollection(name: string): Promise<CollectionHandle>;
}

// ── Internal factory ──────────────────────────────────────────────────────────

function createCollectionHandle(
  collectionName: string,
  readAll: () => Promise<Record<string, unknown>>,
  writeAll: (data: Record<string, unknown>) => Promise<void>,
): CollectionHandle {
  /** Reads only the named collection from the full data blob. Returns {} when absent. */
  const readCollection = async (): Promise<Record<string, unknown>> => {
    const data = await readAll();
    const col = data[collectionName];
    if (typeof col !== 'object' || col === null || Array.isArray(col)) return {};
    return col as Record<string, unknown>;
  };

  /**
   * Re-reads the full data blob, patches the named collection key, then writes.
   * Re-reading before write ensures concurrent mutations to DIFFERENT collections
   * don't overwrite each other's changes.
   */
  const writeCollection = async (col: Record<string, unknown>): Promise<void> => {
    const data = await readAll();
    data[collectionName] = col;
    await writeAll(data);
  };

  return {
    async get(path?: string): Promise<unknown> {
      const col = await readCollection();
      if (!path) return col;
      return getByPath(col, path);
    },

    async set(path: string, value: unknown): Promise<void> {
      const col = await readCollection();
      setByPath(col, path, value);
      await writeCollection(col);
    },

    async update(path: string, value: unknown): Promise<void> {
      const col = await readCollection();
      const existing = getByPath(col, path);
      // Shallow merge when both sides are objects; overwrite for primitives and arrays
      if (
        typeof existing === 'object' && existing !== null && !Array.isArray(existing) &&
        typeof value === 'object' && value !== null && !Array.isArray(value)
      ) {
        setByPath(col, path, { ...(existing as object), ...(value as object) });
      } else {
        setByPath(col, path, value);
      }
      await writeCollection(col);
    },

    async delete(path?: string): Promise<void> {
      const col = await readCollection();
      if (!path) {
        await writeCollection({});
        return;
      }
      deleteByPath(col, path);
      await writeCollection(col);
    },

    async push(path: string, value: unknown): Promise<void> {
      const col = await readCollection();
      const arr = getByPath(col, path);
      setByPath(col, path, Array.isArray(arr) ? [...arr, value] : [value]);
      await writeCollection(col);
    },

    async pull(path: string, value: unknown): Promise<void> {
      const col = await readCollection();
      const arr = getByPath(col, path);
      if (!Array.isArray(arr)) return;
      setByPath(col, path, arr.filter((item) => item !== value));
      await writeCollection(col);
    },

    async unshift(path: string, value: unknown): Promise<void> {
      const col = await readCollection();
      const arr = getByPath(col, path);
      setByPath(col, path, Array.isArray(arr) ? [value, ...arr] : [value]);
      await writeCollection(col);
    },

    async shift(path: string): Promise<unknown> {
      const col = await readCollection();
      const arr = getByPath(col, path);
      if (!Array.isArray(arr) || arr.length === 0) return undefined;
      const first = arr[0]; // noUncheckedIndexedAccess: unknown | undefined; arr.length > 0 guarantees defined
      setByPath(col, path, arr.slice(1));
      await writeCollection(col);
      return first;
    },

    async pop(path: string): Promise<unknown> {
      const col = await readCollection();
      const arr = getByPath(col, path);
      if (!Array.isArray(arr) || arr.length === 0) return undefined;
      const last = arr.at(-1); // arr.length > 0 guarantees defined
      setByPath(col, path, arr.slice(0, -1));
      await writeCollection(col);
      return last;
    },

    async splice(path: string, index: number, ...items: unknown[]): Promise<unknown[]> {
      const col = await readCollection();
      const arr = getByPath(col, path);
      if (!Array.isArray(arr)) return [];
      // Mutates arr in-place: removes 1 element at index, inserts items there
      const removed = (arr as unknown[]).splice(index, 1, ...items);
      setByPath(col, path, arr);
      await writeCollection(col);
      return removed;
    },

    async find(path: string, predicate: (item: unknown) => boolean): Promise<unknown[]> {
      const col = await readCollection();
      const arr = getByPath(col, path);
      if (!Array.isArray(arr)) return [];
      return arr.filter(predicate);
    },

    async findOne(path: string, predicate: (item: unknown) => boolean): Promise<unknown> {
      const col = await readCollection();
      const arr = getByPath(col, path);
      if (!Array.isArray(arr)) return undefined;
      return arr.find(predicate);
    },

    async increment(path: string, amount = 1): Promise<void> {
      const col = await readCollection();
      const val = getByPath(col, path);
      setByPath(col, path, (typeof val === 'number' ? val : 0) + amount);
      await writeCollection(col);
    },

    async decrement(path: string, amount = 1): Promise<void> {
      const col = await readCollection();
      const val = getByPath(col, path);
      setByPath(col, path, (typeof val === 'number' ? val : 0) - amount);
      await writeCollection(col);
    },

    async reset(path: string, defaultValue: unknown): Promise<void> {
      const col = await readCollection();
      setByPath(col, path, defaultValue);
      await writeCollection(col);
    },

    async exists(path: string): Promise<boolean> {
      const col = await readCollection();
      return getByPath(col, path) !== undefined;
    },

    async keys(path?: string): Promise<string[]> {
      const col = await readCollection();
      const target = path ? getByPath(col, path) : col;
      if (typeof target !== 'object' || target === null || Array.isArray(target)) return [];
      return Object.keys(target as object);
    },

    async length(path: string): Promise<number> {
      const col = await readCollection();
      const target = getByPath(col, path);
      if (Array.isArray(target)) return target.length;
      if (typeof target === 'object' && target !== null) return Object.keys(target).length;
      return 0;
    },

    async clear(path?: string): Promise<void> {
      const col = await readCollection();
      if (!path) {
        await writeCollection({});
        return;
      }
      const target = getByPath(col, path);
      if (Array.isArray(target)) {
        setByPath(col, path, []);
      } else if (typeof target === 'object' && target !== null) {
        setByPath(col, path, {});
      }
      await writeCollection(col);
    },

    async upsert(path: string, value: unknown): Promise<void> {
      const col = await readCollection();
      setByPath(col, path, value);
      await writeCollection(col);
    },

    async merge(path: string, value: Record<string, unknown>): Promise<void> {
      const col = await readCollection();
      const existing = getByPath(col, path);
      if (typeof existing === 'object' && existing !== null && !Array.isArray(existing)) {
        setByPath(col, path, { ...(existing as object), ...value });
      } else {
        // Target is absent or not an object — initialise with the provided value
        setByPath(col, path, value);
      }
      await writeCollection(col);
    },
  };
}

// ── Public factory ────────────────────────────────────────────────────────────

/**
 * Returns a factory function bound to (sessionOwnerUserId, platform, sessionId).
 * Call the returned function with botUserId to get a CollectionManager scoped to
 * that specific bot_users_session row.
 *
 * Called once per message/event in the handler layer so command modules never
 * need to know session context coordinates.
 */
export function createCollectionManager(
  sessionOwnerUserId: string,
  platform: string,
  sessionId: string,
): (botUserId: string) => CollectionManager {
  return (botUserId: string): CollectionManager => {
    const readAll = () => getUserSessionData(sessionOwnerUserId, platform, sessionId, botUserId);
    const writeAll = (data: Record<string, unknown>) =>
      setUserSessionData(sessionOwnerUserId, platform, sessionId, botUserId, data);

    return {
      async isCollectionExist(name: string): Promise<boolean> {
        const data = await readAll();
        return Object.prototype.hasOwnProperty.call(data, name);
      },

      async createCollection(name: string): Promise<void> {
        const data = await readAll();
        // Idempotent — never overwrites an existing collection
        if (!Object.prototype.hasOwnProperty.call(data, name)) {
          data[name] = {};
          await writeAll(data);
        }
      },

      async getCollection(name: string): Promise<CollectionHandle> {
        return createCollectionHandle(name, readAll, writeAll);
      },
    };
  };
}

/**
 * Returns a factory function bound to (sessionOwnerUserId, platform, sessionId).
 * Call the returned function with botThreadId to get a CollectionManager scoped to
 * that specific bot_threads_session row.
 *
 * Symmetric with createCollectionManager but reads/writes bot_threads_session.data
 * instead of bot_users_session.data — enables per-thread feature flags like the
 * rankup notification toggle without a separate database table.
 *
 * Called once per message/event in the handler layer so command modules never
 * need to know session context coordinates.
 */
export function createThreadCollectionManager(
  sessionOwnerUserId: string,
  platform: string,
  sessionId: string,
): (botThreadId: string) => CollectionManager {
  return (botThreadId: string): CollectionManager => {
    const readAll = () => getThreadSessionData(sessionOwnerUserId, platform, sessionId, botThreadId);
    const writeAll = (data: Record<string, unknown>) =>
      setThreadSessionData(sessionOwnerUserId, platform, sessionId, botThreadId, data);

    return {
      async isCollectionExist(name: string): Promise<boolean> {
        const data = await readAll();
        return Object.prototype.hasOwnProperty.call(data, name);
      },

      async createCollection(name: string): Promise<void> {
        const data = await readAll();
        // Idempotent — never overwrites an existing collection
        if (!Object.prototype.hasOwnProperty.call(data, name)) {
          data[name] = {};
          await writeAll(data);
        }
      },

      async getCollection(name: string): Promise<CollectionHandle> {
        return createCollectionHandle(name, readAll, writeAll);
      },
    };
  };
}
