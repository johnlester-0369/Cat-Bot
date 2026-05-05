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

import type { StartBotConfig, StartBotResult } from './types.js';
import type { SessionLogger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module

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
    sessionLogger.error(
      '[facebook-messenger] Failed to parse appstate from database',
      { error: err },
    );
    throw new Error(
      '[facebook-messenger] Invalid appstate: JSON.parse failed — ' +
        'ensure the appstate column contains a valid JSON-serialised array',
      // Attach root cause to preserve the full error stack for debugging
      { cause: err },
    );
  }

  // Dynamic obscure import prevents tsc from compiling fca-cat-bot's broken .ts files
  const pkg = 'fca-cat-bot';
  const { fcaInstance } = (await import(pkg)) as any;

  // Obtain the login fn and EventEmitter logger from fcaInstance. emitLogger:true routes all
  // fca internal output through fcaLogger events instead of raw stderr — keeps process output
  // clean and ensures fca login/MQTT messages flow to the dashboard console via SessionLogger.
  const { login, fcaLogger } = fcaInstance({ emitLogger: true });
  // Bridge fca structured log entries ({level, message}) to the session-scoped logger so the
  // dashboard console receives the full fca login sequence and MQTT lifecycle output.
  fcaLogger.on('info', (l: { message: string }) =>
    sessionLogger.info(`[facebook-messenger] ${l.message}`),
  );
  fcaLogger.on('warn', (l: { message: string }) =>
    sessionLogger.warn(`[facebook-messenger] ${l.message}`),
  );
  fcaLogger.on('error', (l: { message: string }) =>
    sessionLogger.error(`[facebook-messenger] ${l.message}`),
  );
  fcaLogger.on('log', (l: { message: string }) =>
    sessionLogger.info(`[facebook-messenger] ${l.message}`),
  );

  return new Promise((resolve, reject) => {
    login({ appState }, async (err: any, api: any) => {
      if (err) {
        sessionLogger.error('[facebook-messenger] Login failed', {
          error: err,
        });
        reject(err);
        return;
      }
      api.setOptions({
        listenEvents: true,
        selfListen: false,
        forceLogin: true
      });

      // extra layer of login validation to ensure the appstate is valid
      await new Promise<void>((r) => {
        api.refreshFb_dtsg?.(
          (_err: unknown, info: { data?: { fb_dtsg?: string } }) => {
            if (!info?.data?.fb_dtsg)
              reject({
                message:
                  'Could not find fb_dtsg in HTML after requesting Facebook.',
              });
            r(undefined);
          },
        );
      });
      sessionLogger.info('[facebook-messenger] Bot initialised successfully!');
      resolve({ api, listener: null });
    });
  });
}
