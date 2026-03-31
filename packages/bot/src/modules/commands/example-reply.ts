/**
 * /example-reply — onReply System Integration Test
 *
 * Demonstrates a two-step conversation flow using the onReply handler:
 *
 *   User: /example-reply
 *   Bot:  What is your name?
 *   User: [quotes bot] John Lester
 *   Bot:  How old are you?
 *   User: [quotes bot] 18
 *   Bot:  Done! John Lester, 18
 *
 * The key mechanic:
 *   1. chat.replyMessage() sends a plain (non-threaded) message and returns the bot's message ID.
 *   2. state.create() registers that ID with a state key and mutable context.
 *   3. When the user quotes (replies to) the bot's message, a message_reply event fires
 *      with event.messageReply.messageID === the registered bot message ID.
 *   4. dispatchOnReply() in controllers/index.js matches the ID and calls the correct handler.
 *   5. Handlers chain steps by removing the old state and registering a new one.
 *
 * Platform requirement: the underlying api.replyMessage() must return the sent message ID
 * (a string). This works on Discord via channel.send().id. Platforms that return undefined
 * are detected and surfaced with a clear error message.
 */

import type {
  ChatContext,
  StateContext,
} from '@/adapters/models/context.model.js';

export const config = {
  name: 'example-reply',
  description: 'Tests the onReply conversation flow (name → age)',
};

const STATE = {
  awaiting_name: 'awaiting_name',
  awaiting_age: 'awaiting_age',
};

export const onCommand = async ({
  chat,
  state,
}: {
  chat: ChatContext;
  state: StateContext['state'];
}) => {
  const messageID = await chat.replyMessage({ message: 'What is your name?' });

  // Guard: platforms that do not return a message ID from replyMessage cannot support onReply
  // because there is no stable key to register the pending state against.
  if (!messageID) {
    await chat.replyMessage({
      message:
        '❌ onReply unavailable: this platform did not return a message ID from chat.replyMessage().',
    });
    return;
  }

  state.create({
    id: state.generateID({ id: String(messageID) }),
    state: STATE.awaiting_name,
    context: {},
  });
};

export const onReply = {
  /**
   * Step 1 — user replied with their name.
   * Stores the name, removes the awaiting_name state, asks for age.
   */
  [STATE.awaiting_name]: async ({
    chat,
    session,
    event,
    state,
  }: {
    chat: ChatContext;
    session: { id: string; context: Record<string, unknown> };
    event: Record<string, unknown>;
    state: StateContext['state'];
  }) => {
    // event.message is the user's reply text (the name they typed)
    session.context.name = event['message'];

    const messageID = await chat.replyMessage({ message: 'How old are you?' });

    // Remove the current state before registering the next one — prevents double-firing
    // if the user somehow quotes the same bot message again after the flow has advanced.
    state.delete(session.id);

    if (messageID) {
      state.create({
        id: state.generateID({ id: String(messageID) }),
        state: STATE.awaiting_age,
        // Carry session.context forward so awaiting_age can read session.context.name
        context: session.context,
      });
    }
  },

  /**
   * Step 2 — user replied with their age.
   * Completes the conversation; cleans up state.
   */
  [STATE.awaiting_age]: async ({
    chat,
    session,
    event,
    state,
  }: {
    chat: ChatContext;
    session: { id: string; context: Record<string, unknown> };
    event: Record<string, unknown>;
    state: StateContext['state'];
  }) => {
    session.context.age = event['message'];

    // Remove state before sending the final reply so no stale entry remains in the store
    state.delete(session.id);

    await chat.replyMessage({
      message: `Done! ${session.context.name}, ${session.context.age}`,
    });
  },
};
