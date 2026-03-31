import { describe, beforeAll, afterAll, afterEach } from 'vitest';
import { setupDiscord } from './setups/discord.setup.js';
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

describe('Platform: Discord', () => {
  let ctx: PlatformTestContext | null = null;

  beforeAll(async () => {
    ctx = await setupDiscord();
  }, 60_000);

  afterAll(async () => {
    if (ctx?.teardown) await ctx.teardown();
  });

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 5000));
  });

  const getCtx = () => ctx;

  runChatSuite('Discord', getCtx);
  runThreadSuite('Discord', getCtx);
  runUserSuite('Discord', getCtx);
  runSelfInteractionSuite('Discord', getCtx);
  runMentionsSuite('Discord', getCtx);
});
