/**
 * Currencies Library — Economy abstraction for coin balance management
 *
 * Wraps the raw db-collection money store so command modules never need to
 * repeat the isCollectionExist → createCollection → getCollection → get/increment
 * boilerplate. All three methods are null-safe: getMoney returns 0 for unknown
 * users, increaseMoney initialises the collection on first credit, and
 * decreaseMoney is a no-op when no collection exists.
 *
 * Exposed on AppCtx as ctx.currencies — built once per event by each dispatcher
 * so command handlers receive a ready-to-use economy API without knowing the
 * session coordinate details.
 *
 * NOTE: No import from controller.types.ts — that file imports CurrenciesContext
 * from here, so accepting raw string params avoids a circular dependency.
 */

import { createCollectionManager } from '@/engine/lib/db-collection.lib.js';

/** Economy interface exposed on AppCtx.currencies */
export interface CurrenciesContext {
  /** Returns the current coin balance for a platform user; 0 when the user has no money collection. */
  getMoney(userID: string): Promise<number>;
  /** Credits coins to a platform user, creating the money collection on first use. */
  increaseMoney(opts: { user_id: string; money: number }): Promise<void>;
  /** Debits coins from a platform user; silently no-ops when the user has no money collection. */
  decreaseMoney(opts: { user_id: string; money: number }): Promise<void>;
}

/**
 * Builds a CurrenciesContext scoped to the given session coordinates.
 * The session triplet mirrors the parameters expected by createCollectionManager —
 * call this once per event in each dispatcher and forward via AppCtx.
 */
export function createCurrenciesContext(
  sessionOwnerUserId: string,
  platform: string,
  sessionId: string,
): CurrenciesContext {
  // Bind the collection factory once — all three methods share the same session scope
  const collManager = createCollectionManager(
    sessionOwnerUserId,
    platform,
    sessionId,
  );

  return {
    async getMoney(userID: string): Promise<number> {
      const userColl = collManager(userID);
      // Fail-safe: return 0 rather than throwing when the user has never accumulated coins
      if (!(await userColl.isCollectionExist('money'))) return 0;
      const money = await userColl.getCollection('money');
      const coins = (await money.get('coins')) as number | undefined;
      return coins ?? 0;
    },

    async increaseMoney({
      user_id,
      money,
    }: {
      user_id: string;
      money: number;
    }): Promise<void> {
      const userColl = collManager(user_id);
      // Initialise on first credit — callers (e.g. /daily) should not need to pre-create the collection
      if (!(await userColl.isCollectionExist('money'))) {
        await userColl.createCollection('money');
      }
      const moneyColl = await userColl.getCollection('money');
      await moneyColl.increment('coins', money);
    },

    async decreaseMoney({
      user_id,
      money,
    }: {
      user_id: string;
      money: number;
    }): Promise<void> {
      const userColl = collManager(user_id);
      // No-op on absent collection — balance cannot go below zero from nothing
      if (!(await userColl.isCollectionExist('money'))) return;
      const moneyColl = await userColl.getCollection('money');
      await moneyColl.decrement('coins', money);
    },
  };
}