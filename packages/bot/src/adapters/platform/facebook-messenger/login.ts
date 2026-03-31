/**
 * Facebook Messenger — Authentication & AppState Management
 *
 * Handles the fca-unofficial login flow and appstate.json persistence.
 * Separated from the event listener so login logic can be tested and
 * reused independently (e.g., integration tests that need the raw api).
 *
 * Does NOT start MQTT listening — that is owned exclusively by the platform
 * listener's start() method to prevent competing listeners on the same connection.
 */

import fs from 'fs';
import path from 'path';
import type { FcaApi, StartBotConfig, StartBotResult } from './types.js';
import { logger } from '@/lib/logger.lib.js';

// fca-unofficial has no published @types package — import as unknown and cast at call sites
// @ts-expect-error - no published @types package
import login from '@johnlester-0369/fca-unofficial';

/**
 * Logs in via fca-unofficial and resolves with the raw api handle.
 * Creates appstate.json placeholder on first run if missing.
 */
export async function startBot(
  config: StartBotConfig,
): Promise<StartBotResult> {
  // Derive appstate path from the caller-supplied session directory so each session
  // has its own independent cookie store — required for multiple account support.
  const APPSTATE_PATH = path.join(config.sessionPath, 'appstate.json');
  // Create appstate.json placeholder on first run so the operator knows what to fill in
  if (!fs.existsSync(APPSTATE_PATH)) {
    fs.writeFileSync(APPSTATE_PATH, '[]');
    logger.info(
      `Created ${APPSTATE_PATH} — add your Facebook session cookies and restart.`,
    );
    process.exit(0);
  }

  let appState: unknown;
  try {
    appState = JSON.parse(fs.readFileSync(APPSTATE_PATH, 'utf8'));
  } catch (err) {
    logger.error('Failed to parse appstate.json', err);
    process.exit(1);
  }

  return new Promise((resolve, reject) => {
    (
      login as (
        opts: { appState: unknown },
        cb: (err: unknown, api: FcaApi) => void,
      ) => void
    )({ appState }, (err, api) => {
      if (err) {
        logger.error('Login failed', { error: err });
        reject(err);
        return;
      }
      api.setOptions({
        listenEvents: true,
        selfListen: false,
        forceLogin: true,
        logLevel: 'silent',
      });
      logger.info('Bot initialised successfully!');
      resolve({ api, listener: null });
    });
  });
}
