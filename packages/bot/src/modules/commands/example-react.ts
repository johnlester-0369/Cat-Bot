/**
 * /example-react — onReact System Integration Test
 *
 * Demonstrates an emoji-keyed, state-driven reaction flow:
 *
 *   User: /example-react
 *   Bot:  React to this message! ❤️ love  😂 funny  😢 sad
 *   User: [reacts with ❤️ to the bot's message]
 *   Bot:  You chose: love ❤️
 *
 * Key mechanics — mirrors onReply but emoji-keyed instead of step-keyed:
 *   1. chat.replyMessage() sends a message and returns the bot's message ID.
 *   2. state.create() registers that ID in the unified stateStore with
 *      the command name and mutable context.
 *   3. When the user reacts (message_reaction event fires), dispatchOnReact()
 *      in controllers/index.js matches the messageID, then dispatches to
 *      onReact[event.reaction] — the emoji string is the handler map key.
 *   4. Unlike onReply where stored.state is the conversation step name,
 *      onReact dispatches purely on event.reaction (the actual emoji reacted).
 *      One setState call therefore covers all emojis defined in the onReact map.
 *
 * Scoping: generateID() creates a private key (messageID:senderID) by default,
 * so only the user who ran /example-react can advance the flow by reacting. Pass
 * { public: true } to scope to threadID for shared/group-poll reaction flows.
 *
 * Platform requirement: api.replyMessage() must return the sent message ID.
 * message_reaction events are available on Discord, Telegram (group admin only),
 * Facebook Messenger, and Facebook Page (with message_reactions webhook field).
 */

import type {
  ChatContext,
  StateContext,
} from '@/adapters/models/context.model.js';

export const config = {
  name: 'react',
  description: 'Tests the onReact emoji-reaction flow (❤️ / 😂 / 😢)',
};

// STATE values ARE the emoji strings — they become the keys in the onReact handler map.
// Centralising them here avoids emoji typos when the same string is referenced
// in both onCommand (setState) and onReact (handler key).
const STATE = {
  heart: '❤️',
  laugh: '😂',
  sad: '😢',
};

export const onCommand = async ({
  chat,
  state,
}: {
  chat: ChatContext;
  state: StateContext['state'];
}) => {
  const messageID = await chat.replyMessage({
    message: 'React to this message!\n❤️ love  😂 funny  😢 sad',
  });

  // Guard: platforms that do not return a message ID from replyMessage cannot support
  // onReact because there is no stable key to register the pending state against.
  if (!messageID) {
    await chat.replyMessage({
      message:
        '❌ onReact unavailable: this platform did not return a message ID from chat.replyMessage().',
    });
    return;
  }

  // One create() call covers all emojis — dispatchOnReact routes to onReact[event.reaction]
  // at dispatch time, not to onReact[stored.state]. The state field here is a label for
  // context/debugging; the actual emoji dispatch key comes from the live reaction event.
  state.create({
    id: state.generateID({ id: String(messageID) }),
    state: STATE.heart,
    context: {},
  });
};

export const onReact = {
  /**
   * User reacted with ❤️ — confirms love reaction and tears down state.
   */
  [STATE.heart]: async ({
    chat,
    session,
    state,
  }: {
    chat: ChatContext;
    session: { id: string; context: Record<string, unknown> };
    state: StateContext['state'];
  }) => {
    // Remove state before replying so a second ❤️ reaction on the same message
    // does not re-trigger this handler after the conversation is complete.
    state.delete(session.id);
    await chat.reply({ message: 'You chose: love ❤️' });
  },

  /**
   * User reacted with 😂 — confirms funny reaction and tears down state.
   */
  [STATE.laugh]: async ({
    chat,
    session,
    state,
  }: {
    chat: ChatContext;
    session: { id: string; context: Record<string, unknown> };
    state: StateContext['state'];
  }) => {
    state.delete(session.id);
    await chat.reply({ message: 'You chose: funny 😂' });
  },

  /**
   * User reacted with 😢 — confirms sad reaction and tears down state.
   */
  [STATE.sad]: async ({
    chat,
    session,
    state,
  }: {
    chat: ChatContext;
    session: { id: string; context: Record<string, unknown> };
    state: StateContext['state'];
  }) => {
    state.delete(session.id);
    await chat.reply({ message: 'You chose: sad 😢' });
  },
};
