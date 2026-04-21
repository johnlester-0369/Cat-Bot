import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { createFbPageApi } from '@/engine/adapters/platform/facebook-page/wrapper.js';
import { createPageApi } from '@/engine/adapters/platform/facebook-page/pageApi.js';
import {
  createThreadContext,
  createChatContext,
  createBotContext,
  createUserContext,
} from '@/engine/adapters/models/context.model.js';
import { FB_PAGE_TID, FB_PAGE_MESSAGE_ID } from '../shared/test-ids.js';
import type { PlatformTestContext } from '../shared/test-types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function setupFbPage(): Promise<PlatformTestContext | null> {
  let token: string | undefined;
  let pageId = 'test_page_id';

  try {
    const credPath = path.join(
      __dirname,
      '../../../../session/facebook-page/credential.json',
    );
    const creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
    token = creds.FB_PAGE_ACCESS_TOKEN;
    if (creds.FB_PAGE_ID) pageId = creds.FB_PAGE_ID;
  } catch {
    // Graceful fallback
  }

  if (!token) {
    console.warn(
      '[FB-Page] FB_PAGE_ACCESS_TOKEN missing in credential.json — Facebook Page tests will be skipped',
    );
    return null;
  }

  try {
    const pageApi = createPageApi(token, pageId);
    const fbPageApi = createFbPageApi(pageApi);

    const baseEvent = {
      threadID: FB_PAGE_TID,
      messageID: FB_PAGE_MESSAGE_ID,
      senderID: FB_PAGE_TID,
      userID: FB_PAGE_TID,
    };

    console.info('[FB-Page] Page API client constructed');

    return {
      platformName: 'FB Page',
      api: fbPageApi,
      chatCtx: createChatContext(fbPageApi, baseEvent),
      threadCtx: createThreadContext(fbPageApi, baseEvent),
      userCtx: createUserContext(fbPageApi),
      botCtx: createBotContext(fbPageApi),
      botUserId: null, // Not applicable
      targetUserId: FB_PAGE_TID,
      threadId: FB_PAGE_TID,
      messageId: FB_PAGE_MESSAGE_ID,
      teardown: () => {},
    };
  } catch (err) {
    console.warn(`[FB-Page] Setup failed: ${(err as Error).message}`);
    return null;
  }
}
