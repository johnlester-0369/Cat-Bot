import { describe, beforeAll, afterAll, afterEach } from 'vitest';
import { setupFbPage } from './setups/facebook-page.setup.js';
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

describe('Platform: Facebook Page', () => {
  let ctx: PlatformTestContext | null = null;

  beforeAll(async () => {
    ctx = await setupFbPage();
  }, 60_000);

  afterAll(async () => {
    if (ctx?.teardown) await ctx.teardown();
  });

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 5000));
  });

  const getCtx = () => ctx;

  runChatSuite('FB Page', getCtx);
  runThreadSuite('FB Page', getCtx);
  runUserSuite('FB Page', getCtx);
  runSelfInteractionSuite('FB Page', getCtx);
  runMentionsSuite('FB Page', getCtx);
});
