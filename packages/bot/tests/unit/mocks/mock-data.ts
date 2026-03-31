import { vi } from 'vitest';
import type { UnifiedApi } from '@/adapters/models/api.model.js';

/**
 * WHY: Centralizing mock generation prevents duplicating vi.fn() boilerplate
 * across 10+ controller and middleware test files. This ensures structural
 * consistency if UnifiedApi ever changes.
 */
export function createMockApi(overrides: Partial<UnifiedApi> = {}): UnifiedApi {
  return {
    platform: 'mock-platform',
    sendMessage: vi.fn().mockResolvedValue('msg-id-123'),
    unsendMessage: vi.fn().mockResolvedValue(undefined),
    editMessage: vi.fn().mockResolvedValue(undefined),
    getUserInfo: vi.fn().mockResolvedValue({}),
    setGroupName: vi.fn().mockResolvedValue(undefined),
    setGroupImage: vi.fn().mockResolvedValue(undefined),
    removeGroupImage: vi.fn().mockResolvedValue(undefined),
    addUserToGroup: vi.fn().mockResolvedValue(undefined),
    removeUserFromGroup: vi.fn().mockResolvedValue(undefined),
    setGroupReaction: vi.fn().mockResolvedValue(undefined),
    replyMessage: vi.fn().mockResolvedValue('reply-msg-id-123'),
    reactToMessage: vi.fn().mockResolvedValue(undefined),
    setNickname: vi.fn().mockResolvedValue(undefined),
    getBotID: vi.fn().mockResolvedValue('bot-123'),
    getFullThreadInfo: vi.fn().mockResolvedValue({}),
    getFullUserInfo: vi.fn().mockResolvedValue({}),
    ...overrides,
  } as unknown as UnifiedApi;
}

/**
 * WHY: Provides a standard raw event object for dispatch tests,
 * overriding only the fields relevant to the specific test suite.
 */
export function createMockEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'message',
    threadID: 'thread-1',
    messageID: 'msg-1',
    senderID: 'user-1',
    body: 'mock body content',
    ...overrides,
  };
}
