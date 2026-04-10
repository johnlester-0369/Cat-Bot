/**
 * Facebook Messenger — Authentication
 *
 * Handles the fca-unofficial login flow using the appstate loaded from the database.
 * Separated from the event listener so login logic can be tested and reused independently
 * (e.g., integration tests that need the raw api).
 *
 * Does NOT start MQTT listening — that is owned exclusively by the platform
 * listener's start() method to prevent competing listeners on the same connection.
 *
 * appstate is stored as JSON.stringify'd text in BotCredentialFacebookMessenger.appstate.
 * JSON.parse() is applied here, keeping the DB column as plain TEXT and the login
 * signature as a simple string — no filesystem access required.
 */

import type { FcaApi, StartBotConfig, StartBotResult } from './types.js';
import type { SessionLogger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module

// fca-unofficial has no published @types package — import as unknown and cast at call sites
// @ts-expect-error - no published @types package
import login from '@johnlester-0369/fca-unofficial';

/**
 * Logs in via fca-unofficial using the appstate string loaded from the database.
 *
 * Throws (rejects) rather than calling process.exit() so the caller's withRetry
 * loop can handle transient failures without taking the entire process down.
 */
export async function startBot(
  config: StartBotConfig,
  sessionLogger: SessionLogger,
): Promise<StartBotResult> {
  let appState: unknown;
  try {
    // appstate is JSON.stringify'd in the DB — parse it back to the array fca-unofficial expects
    appState = JSON.parse(config.appstate) as unknown;
  } catch (err) {
    sessionLogger.error('[facebook-messenger] Failed to parse appstate from database', { error: err });
    throw new Error(
      '[facebook-messenger] Invalid appstate: JSON.parse failed — ' +
        'ensure the appstate column contains a valid JSON-serialised array',
      // Attach root cause to preserve the full error stack for debugging
      { cause: err }
    );
  }

  return new Promise((resolve, reject) => {
    (
      login as (
        opts: { appState: unknown },
        cb: (err: unknown, api: FcaApi) => void,
      ) => void
    )({ appState }, async(err, api) => {
      if (err) {
        sessionLogger.error('[facebook-messenger] Login failed', { error: err });
        reject(err);
        return;
      }
      api.setOptions({
        listenEvents: true,
        selfListen: false,
        forceLogin: true,
        logLevel: 'silent',
      });

      // extra layer of login validation to ensure the appstate is valid
      await new Promise<void>((r) => {
        api.refreshFb_dtsg?.((_err: unknown, info: { data?: { fb_dtsg?: string } }) => {
          if(!info?.data?.fb_dtsg) reject({message: "Could not find fb_dtsg in HTML after requesting Facebook."})
          r(undefined)
        })
      })
      sessionLogger.info('[facebook-messenger] Bot initialised successfully!');
      resolve({ api, listener: null });
    });
  });
}
