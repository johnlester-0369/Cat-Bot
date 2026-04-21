import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { startBot } from '@/engine/adapters/platform/facebook-messenger/index.js';
import { createFacebookApi } from '@/engine/adapters/platform/facebook-messenger/wrapper.js';
import {
  createThreadContext,
  createChatContext,
  createBotContext,
  createUserContext,
} from '@/engine/adapters/models/context.model.js';
import {
  FB_MESSENGER_TID,
  FB_MESSENGER_MESSAGE_ID,
  FB_MESSENGER_TARGET_USER_ID,
} from '../shared/test-ids.js';
import type { PlatformTestContext } from '../shared/test-types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function setupFbMessenger(): Promise<PlatformTestContext | null> {
  const sessionDir = path.join(
    __dirname,
    '../../../../session/facebook-messenger',
  );
  const appStatePath = path.join(sessionDir, 'appstate.json');

  if (!fs.existsSync(appStatePath)) {
    console.warn(
      '[FB-Messenger] appstate.json not found — populate with Facebook session cookies',
    );
    return null;
  }

  try {
    const appState = JSON.parse(fs.readFileSync(appStatePath, 'utf8'));
    if (!Array.isArray(appState) || appState.length === 0) {
      console.warn(
        '[FB-Messenger] appstate.json is empty — add your Facebook session cookies and restart',
      );
      return null;
    }

    const { api: rawFcaApi } = await startBot({ sessionPath: sessionDir });
    const fbMessengerApi = createFacebookApi(rawFcaApi);

    const baseEvent = {
      threadID: FB_MESSENGER_TID,
      messageID: FB_MESSENGER_MESSAGE_ID,
      senderID: FB_MESSENGER_TARGET_USER_ID,
      userID: FB_MESSENGER_TARGET_USER_ID,
    };

    rawFcaApi.setOptions({ emitReady: true });
    await new Promise<void>((resolve) => {
      rawFcaApi.listenMqtt((a: { type?: string } | undefined) => {
        if (a?.type === 'ready') resolve();
      });
    });

    console.info('[FB-Messenger] Logged in and MQTT connection ready');

    return {
      platformName: 'FB Messenger',
      api: fbMessengerApi,
      chatCtx: createChatContext(fbMessengerApi, baseEvent),
      threadCtx: createThreadContext(fbMessengerApi, baseEvent),
      userCtx: createUserContext(fbMessengerApi),
      botCtx: createBotContext(fbMessengerApi),
      botUserId: null, // Fetched dynamically via context
      targetUserId: FB_MESSENGER_TARGET_USER_ID,
      threadId: FB_MESSENGER_TID,
      messageId: FB_MESSENGER_MESSAGE_ID,
      teardown: () => {}, // FCA keeps connection alive but Vitest process exit kills it safely
    };
  } catch (err) {
    console.warn(`[FB-Messenger] Setup failed: ${(err as Error).message}`);
    return null;
  }
}
