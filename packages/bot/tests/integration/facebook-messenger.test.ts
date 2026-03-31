import { describe, beforeAll, afterAll, afterEach } from 'vitest';
import { setupFbMessenger } from './setups/facebook-messenger.setup.js';
import {
  runChatSuite,
  runThreadSuite,
  runUserSuite,
  runSelfInteractionSuite,
  runMentionsSuite,
} from './shared/test-suites.js';
import {
  initializeSharedAssets,
  finalizeSharedAssets,
} from './shared/test-assets.js';
import type { PlatformTestContext } from './shared/test-types.js';

beforeAll(async () => {
  await initializeSharedAssets();
}, 45_000);

afterAll(() => {
  finalizeSharedAssets();
});

describe('Platform: Facebook Messenger', () => {
  let ctx: PlatformTestContext | null = null;

  beforeAll(async () => {
    ctx = await setupFbMessenger();
  }, 90_000);

  afterAll(async () => {
    if (ctx?.teardown) await ctx.teardown();
  });

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 5000));
  });

  const getCtx = () => ctx;

  runChatSuite('FB Messenger', getCtx);
  runThreadSuite('FB Messenger', getCtx);
  runUserSuite('FB Messenger', getCtx);
  runSelfInteractionSuite('FB Messenger', getCtx);
  runMentionsSuite('FB Messenger', getCtx);
});
