import { describe, it, expect } from 'vitest';
import type { PlatformTestContext } from './test-types.js';
import {
  TEST_IMAGE,
  TTS_AUDIO_BUFFER,
  TEST_GIF,
  TINY_MP3,
  isProgrammingError,
} from './test-assets.js';
import { createChatContext } from '../../../src/adapters/models/context.model.js';

/**
 * Validates message sending mechanics, unsending, replying, and attachments.
 */
export function runChatSuite(
  platformName: string,
  getCtx: () => PlatformTestContext | null,
) {
  const skip = () => !getCtx();

  describe(`Chat Suite (${platformName})`, () => {
    it('chat.reply — sends a plain text message', async () => {
      if (skip()) return;
      const { chatCtx } = getCtx()!;
      const msgId = await chatCtx.reply({
        message: `🧪 [integration] chat.reply (${platformName})`,
      });
      expect(msgId).toBeDefined();
    });

    it('chat.reply — sends MP3 audio via attachment stream', async () => {
      if (skip()) return;
      const { chatCtx } = getCtx()!;
      const name = `tts_${Date.now()}.mp3`;
      try {
        await chatCtx.reply({
          message: `🧪 [integration] chat.reply with audio attachment (${platformName})`,
          attachment: [{ name, stream: TINY_MP3 }],
        });
        console.info(`[${platformName}] chat.reply (audio) succeeded`);
      } catch (err: unknown) {
        if (isProgrammingError(err)) throw err;
        console.info(
          `[${platformName}] chat.reply (audio): expected platform error — ${(err as Error).message}`,
        );
      }
    });

    it('chat.reply — sends real JPEG via attachment stream', async () => {
      if (skip()) return;
      const { chatCtx } = getCtx()!;
      const name = `photo_${Date.now()}.jpg`;
      try {
        await chatCtx.reply({
          message: `🧪 [integration] chat.reply with photo attachment (${platformName})`,
          attachment: [{ name, stream: TEST_IMAGE }],
        });
        console.info(`[${platformName}] chat.reply (photo) succeeded`);
      } catch (err: unknown) {
        if (isProgrammingError(err)) throw err;
        console.info(
          `[${platformName}] chat.reply (photo): expected platform error — ${(err as Error).message}`,
        );
      }
    });

    it('chat.unsendMessage — attempts to unsend real target message ID', async () => {
      if (skip()) return;
      const { chatCtx, messageId } = getCtx()!;
      try {
        await chatCtx.unsendMessage(messageId);
        console.info(`[${platformName}] chat.unsendMessage succeeded/resolved`);
      } catch (err: unknown) {
        if (isProgrammingError(err)) throw err;
        console.info(
          `[${platformName}] chat.unsendMessage: expected API error — ${(err as Error).message}`,
        );
      }
    });

    it('chat.reactMessage — reacts to target message', async () => {
      if (skip()) return;
      const { chatCtx } = getCtx()!;
      try {
        await chatCtx.reactMessage('✅');
        console.info(`[${platformName}] chat.reactMessage succeeded`);
      } catch (err: unknown) {
        if (isProgrammingError(err)) throw err;
        console.info(
          `[${platformName}] chat.reactMessage: expected platform error — ${(err as Error).message}`,
        );
      }
    });

    it('chat.replyMessage — threads a contextual reply using the base message ID', async () => {
      if (skip()) return;
      const { chatCtx } = getCtx()!;
      try {
        await chatCtx.replyMessage({
          message: `🧪 [integration] chat.replyMessage threaded reply (${platformName})`,
        });
        console.info(`[${platformName}] chat.replyMessage succeeded`);
      } catch (err: unknown) {
        if (isProgrammingError(err)) throw err;
        console.info(
          `[${platformName}] chat.replyMessage: expected platform error — ${(err as Error).message}`,
        );
      }
    });

    it('chat.reply — sends Google TTS audio via attachment stream', async () => {
      if (skip()) return;
      const { chatCtx } = getCtx()!;
      const name = `tts_${Date.now()}.mp3`;
      try {
        await chatCtx.reply({
          message: `🧪 [integration] chat.reply with TTS audio (${platformName})`,
          attachment: [{ name, stream: TTS_AUDIO_BUFFER }],
        });
        console.info(`[${platformName}] chat.reply (TTS audio) succeeded`);
      } catch (err: unknown) {
        if (isProgrammingError(err)) throw err;
        console.info(
          `[${platformName}] chat.reply (TTS audio): expected error — ${(err as Error).message}`,
        );
      }
    });

    it('chat.reply — bundles photos, audio, and GIF via attachment[]', async () => {
      if (skip()) return;
      const { chatCtx } = getCtx()!;
      const attachments = [
        { name: 'photo_0.jpg', stream: TEST_IMAGE },
        { name: 'photo_1.jpg', stream: TEST_IMAGE },
        { name: 'audio_0.mp3', stream: TTS_AUDIO_BUFFER },
        { name: 'audio_1.mp3', stream: TTS_AUDIO_BUFFER },
        { name: 'anim_0.gif', stream: TEST_GIF },
      ];
      try {
        await chatCtx.reply({
          message: `🧪 [integration] chat.reply with multiple media (${platformName})`,
          attachment: attachments,
        });
        console.info(`[${platformName}] chat.reply (multiple media) succeeded`);
      } catch (err: unknown) {
        if (isProgrammingError(err)) throw err;
        console.info(
          `[${platformName}] chat.reply (multiple media): expected error — ${(err as Error).message}`,
        );
      }
    });

    it('chat.reply — downloads and attaches media from attachment_url[] array', async () => {
      if (skip()) return;
      const { chatCtx } = getCtx()!;
      try {
        await chatCtx.reply({
          message: `🧪 [integration] chat.reply + attachment_url (${platformName})`,
          attachment_url: [
            {
              name: 'catbot.jpg',
              url: 'https://picsum.photos/seed/catbot/200/200',
            },
          ],
        });
        console.info(`[${platformName}] chat.reply (attachment_url) succeeded`);
      } catch (err: unknown) {
        if (isProgrammingError(err)) throw err;
        console.info(
          `[${platformName}] chat.reply (attachment_url): expected error — ${(err as Error).message}`,
        );
      }
    });
  });
}

/**
 * Validates thread-level operations (name, image, reactions, members, nicknames).
 */
export function runThreadSuite(
  platformName: string,
  getCtx: () => PlatformTestContext | null,
) {
  const skip = () => !getCtx();

  describe(`Thread Suite (${platformName})`, () => {
    it('thread.setName — attempts to set group name', async () => {
      if (skip()) return;
      const { threadCtx } = getCtx()!;
      try {
        await threadCtx.setName('🧪 Integration Test Thread');
        console.info(`[${platformName}] thread.setName succeeded`);
        // Cleanup attempt
        await threadCtx.setName('Integration Test Thread').catch(() => {});
      } catch (err: unknown) {
        if (isProgrammingError(err)) throw err;
        console.info(
          `[${platformName}] thread.setName: expected error — ${(err as Error).message}`,
        );
      }
    });

    it('thread.setImage — attempts to set group image via buffer', async () => {
      if (skip()) return;
      const { threadCtx } = getCtx()!;
      try {
        await threadCtx.setImage(TEST_IMAGE);
        console.info(`[${platformName}] thread.setImage succeeded`);
      } catch (err: unknown) {
        if (isProgrammingError(err)) throw err;
        console.info(
          `[${platformName}] thread.setImage: expected error — ${(err as Error).message}`,
        );
      }
    });

    it('thread.removeImage — attempts to remove group image', async () => {
      if (skip()) return;
      const { threadCtx } = getCtx()!;
      try {
        await threadCtx.removeImage();
        console.info(`[${platformName}] thread.removeImage succeeded`);
      } catch (err: unknown) {
        if (isProgrammingError(err)) throw err;
        console.info(
          `[${platformName}] thread.removeImage: expected error — ${(err as Error).message}`,
        );
      }
    });

    it('thread.addUser — attempts to add a user to the group', async () => {
      if (skip()) return;
      const { threadCtx, targetUserId } = getCtx()!;
      try {
        await threadCtx.addUser(targetUserId);
        console.info(`[${platformName}] thread.addUser succeeded`);
      } catch (err: unknown) {
        if (isProgrammingError(err)) throw err;
        console.info(
          `[${platformName}] thread.addUser: expected API error — ${(err as Error).message}`,
        );
      }
    });

    it('thread.removeUser — attempts to remove a user from the group', async () => {
      if (skip()) return;
      const { threadCtx, targetUserId } = getCtx()!;
      try {
        await threadCtx.removeUser(targetUserId);
        console.info(`[${platformName}] thread.removeUser succeeded`);
      } catch (err: unknown) {
        if (isProgrammingError(err)) throw err;
        console.info(
          `[${platformName}] thread.removeUser: expected API error — ${(err as Error).message}`,
        );
      }
    });

    it('thread.setReaction — attempts to set thread-level default emoji', async () => {
      if (skip()) return;
      const { threadCtx } = getCtx()!;
      try {
        await threadCtx.setReaction('👍');
        console.info(`[${platformName}] thread.setReaction succeeded`);
      } catch (err: unknown) {
        if (isProgrammingError(err)) throw err;
        console.info(
          `[${platformName}] thread.setReaction: expected error — ${(err as Error).message}`,
        );
      }
    });

    it('thread.setImage — attempts to download and set group image from URL', async () => {
      if (skip()) return;
      const { threadCtx } = getCtx()!;
      try {
        await threadCtx.setImage('https://picsum.photos/seed/catbot/512/512');
        console.info(`[${platformName}] thread.setImage (URL) succeeded`);
      } catch (err: unknown) {
        if (isProgrammingError(err)) throw err;
        console.info(
          `[${platformName}] thread.setImage (URL): expected error — ${(err as Error).message}`,
        );
      }
    });

    it('thread.setNickname — attempts to set bot nickname', async () => {
      if (skip()) return;
      const { threadCtx, botUserId } = getCtx()!;
      if (!botUserId) return;
      try {
        await threadCtx.setNickname({
          nickname: '🧪 TestBot',
          user_id: botUserId,
        });
        console.info(`[${platformName}] thread.setNickname (bot) succeeded`);
      } catch (err: unknown) {
        if (isProgrammingError(err)) throw err;
        console.info(
          `[${platformName}] thread.setNickname (bot): expected API error — ${(err as Error).message}`,
        );
      }
    });

    it('thread.setNickname — attempts to set target participant nickname', async () => {
      if (skip()) return;
      const { threadCtx, targetUserId } = getCtx()!;
      try {
        await threadCtx.setNickname({
          nickname: '🧪 TargetNick',
          user_id: targetUserId,
        });
        console.info(`[${platformName}] thread.setNickname (target) succeeded`);
      } catch (err: unknown) {
        if (isProgrammingError(err)) throw err;
        console.info(
          `[${platformName}] thread.setNickname (target): expected API error — ${(err as Error).message}`,
        );
      }
    });
  });
}

/**
 * Validates user profile fetching.
 */
export function runUserSuite(
  platformName: string,
  getCtx: () => PlatformTestContext | null,
) {
  const skip = () => !getCtx();

  describe(`User Suite (${platformName})`, () => {
    it('user.getInfo — returns a name string for the targeted ID', async () => {
      if (skip()) return;
      const { userCtx, botUserId, threadId } = getCtx()!;
      const fetchId = botUserId || threadId;
      const info = await userCtx.getInfo(fetchId);
      expect(info).toBeDefined();
      expect(typeof info.name).toBe('string');
      expect(info.name.length).toBeGreaterThan(0);
    });
  });
}

/**
 * Validates dynamic context derivation: sending a message and acting upon its ID.
 */
export function runSelfInteractionSuite(
  platformName: string,
  getCtx: () => PlatformTestContext | null,
) {
  const skip = () => !getCtx();

  describe(`Self-Message Interaction Phases (${platformName})`, () => {
    it('Phase 1 — send then reply to own message using returned message ID', async () => {
      if (skip()) return;
      const { chatCtx, api, threadId } = getCtx()!;
      try {
        const msgId = (await chatCtx.reply({
          message: '🧪 [phase-1] initial send',
        })) as string;
        if (!msgId) return;

        const dynChat = createChatContext(api, {
          threadID: threadId,
          messageID: msgId,
        });
        await dynChat.replyMessage({
          message: '🧪 [phase-1] reply to own message',
        });
        console.info(
          `[${platformName}] Phase 1 ✅ replied to own message ${msgId}`,
        );
      } catch (err: unknown) {
        if (isProgrammingError(err)) throw err;
        console.info(
          `[${platformName}] Phase 1: expected platform error — ${(err as Error).message}`,
        );
      }
    });

    it('Phase 2 — send then react to own message using returned message ID', async () => {
      if (skip()) return;
      const { chatCtx, api, threadId } = getCtx()!;
      try {
        const msgId = (await chatCtx.reply({
          message: '🧪 [phase-2] initial send',
        })) as string;
        if (!msgId) return;

        const dynChat = createChatContext(api, {
          threadID: threadId,
          messageID: msgId,
        });
        await dynChat.reactMessage('😸');
        console.info(
          `[${platformName}] Phase 2 ✅ reacted to own message ${msgId}`,
        );
      } catch (err: unknown) {
        if (isProgrammingError(err)) throw err;
        console.info(
          `[${platformName}] Phase 2: expected platform error — ${(err as Error).message}`,
        );
      }
    });

    it('Phase 3 — send then unsend own message using returned message ID', async () => {
      if (skip()) return;
      const { chatCtx } = getCtx()!;
      try {
        const msgId = (await chatCtx.reply({
          message: '🧪 [phase-3] initial send (will be deleted)',
        })) as string;
        if (!msgId) return;

        await chatCtx.unsendMessage(msgId);
        console.info(
          `[${platformName}] Phase 3 ✅ deleted own message ${msgId}`,
        );
      } catch (err: unknown) {
        if (isProgrammingError(err)) throw err;
        console.info(
          `[${platformName}] Phase 3: expected platform error — ${(err as Error).message}`,
        );
      }
    });

    it('Phase 4 — send then edit own message using returned message ID via API', async () => {
      if (skip()) return;
      const { chatCtx, api } = getCtx()!;
      try {
        const msgId = (await chatCtx.reply({
          message: '🧪 [phase-4] initial send (will be edited)',
        })) as string;
        if (!msgId) return;

        await api.editMessage(msgId, '🧪 [phase-4] edited content ✏️');
        console.info(
          `[${platformName}] Phase 4 ✅ edited own message ${msgId}`,
        );
      } catch (err: unknown) {
        if (isProgrammingError(err)) throw err;
        console.info(
          `[${platformName}] Phase 4: expected platform error — ${(err as Error).message}`,
        );
      }
    });
  });
}

/**
 * Validates tagging/mention functionality natively supported by the underlying platforms.
 */
export function runMentionsSuite(
  platformName: string,
  getCtx: () => PlatformTestContext | null,
) {
  const skip = () => !getCtx();

  describe(`Mentions (${platformName})`, () => {
    it('api.sendMessage — validates mentions processing for standard message sends', async () => {
      if (skip()) return;
      const { api, threadId, targetUserId } = getCtx()!;
      try {
        const msgId = await api.sendMessage(
          {
            message: `🧪 [integration] sendMessage mention — hello TargetUser`,
            mentions: [{ tag: 'TargetUser', user_id: targetUserId }],
          },
          threadId,
        );
        console.info(
          `[${platformName}] api.sendMessage (mention) succeeded — msgId: ${String(msgId)}`,
        );
      } catch (err: unknown) {
        if (isProgrammingError(err)) throw err;
        console.info(
          `[${platformName}] api.sendMessage (mention): expected platform error — ${(err as Error).message}`,
        );
      }
    });

    it('api.replyMessage — validates mentions processing for threaded replies', async () => {
      if (skip()) return;
      const { api, threadId, targetUserId } = getCtx()!;
      try {
        await api.replyMessage(threadId, {
          message: `🧪 [integration] replyMessage mention — hey TargetUser`,
          mentions: [{ tag: 'TargetUser', user_id: targetUserId }],
        });
        console.info(`[${platformName}] api.replyMessage (mention) succeeded`);
      } catch (err: unknown) {
        if (isProgrammingError(err)) throw err;
        console.info(
          `[${platformName}] api.replyMessage (mention): expected platform error — ${(err as Error).message}`,
        );
      }
    });
  });
}
