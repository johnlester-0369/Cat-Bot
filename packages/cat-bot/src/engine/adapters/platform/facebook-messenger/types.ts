/**
 * Facebook Messenger — Shared Type Definitions
 *
 * Single source of truth for all types used across the facebook-messenger adapter.
 * Keeping types in one file eliminates duplicate FcaApi declarations and makes
 * the contract surface easy to audit when fca-unofficial changes.
 */

import type { Readable } from 'stream';
import type { EventEmitter } from 'events';

/**
 * Full interface for the fca-unofficial api object.
 * fca-unofficial has no published @types package — this declaration captures
 * every method consumed by any lib/ file in this adapter.
 */
export interface FcaApi {
  sendMessage(
    msg: string | object,
    threadID: string,
    cb: (err: unknown, info?: { messageID?: string }) => void,
    replyToMessageID?: string,
  ): void;
  unsendMessage(messageID: string, cb: () => void): void;
  editMessage(
    body: string,
    messageID: string,
    cb: (err: unknown) => void,
  ): void;
  changeNickname(
    nickname: string,
    threadID: string,
    participantID: string,
    cb: (err: unknown) => void,
  ): void;
  getUserInfo(
    ids: string[],
    cb: (
      err: unknown,
      users:
        | Record<
            string,
            {
              name?: string;
              firstName?: string;
              vanity?: string | null;
              thumbSrc?: string | null;
              profileUrl?: string | null;
              [key: string]: unknown;
            }
          >
        | undefined,
    ) => void,
  ): void;
  setTitle?: (
    name: string,
    threadID: string,
    cb: (err: unknown) => void,
  ) => void;
  changeGroupImage(
    stream: Readable,
    threadID: string,
    cb: (err: unknown) => void,
  ): void;
  addUserToGroup(
    userID: string,
    threadID: string,
    cb: (err: unknown) => void,
  ): void;
  removeUserFromGroup(
    userID: string,
    threadID: string,
    cb: (err: unknown) => void,
  ): void;
  changeThreadEmoji(
    emoji: string,
    threadID: string,
    cb: (err: unknown) => void,
  ): void;
  setMessageReaction(
    emoji: string,
    messageID: string,
    threadID: string,
    cb: (err: unknown) => void,
    force: boolean,
  ): void;
  getCurrentUserID(): string | number;
  getThreadInfo(
    threadID: string,
    cb: (
      err: unknown,
      info: {
        adminIDs?: Array<string | { id: string }>;
        threadName?: string | null;
        isGroup?: boolean;
        participantIDs?: string[];
        imageSrc?: string | null;
      },
    ) => void,
  ): void;
  setOptions(opts: Record<string, unknown>): void;
  refreshFb_dtsg?: (
    cb: (err: unknown, info: { data?: { fb_dtsg?: string } }) => void,
  ) => void;
  listenMqtt(cb: (err: unknown, event: Record<string, unknown>) => void): {
    stopListeningAsync: () => Promise<void>;
  };
}

/** Configuration accepted by startBot(). */
export interface StartBotConfig {
  prefix?: string;
  /** JSON.stringify'd fca-unofficial session cookie blob loaded from the database. */
  appstate: string;
}

/** Result of startBot() — raw fca api handle + null listener placeholder. */
export interface StartBotResult {
  api: FcaApi;
  listener: null;
}

/** Shape of the EventEmitter returned by createFacebookMessengerListener(). */
export type FacebookMessengerEmitter = EventEmitter & {
  start: () => Promise<void>;
  stop: (signal?: string) => Promise<void>;
};
