# Cat-Bot — Command & Event Developer Reference

> **Audience:** Developers writing commands (`src/app/commands/`) and event handlers (`src/app/events/`).  
> **Goal:** Understand every API available inside a handler so you can build features without reading engine source code.
---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Module Structure](#module-structure)
   - [CommandConfig](#commandconfig)
   - [EventConfig](#eventconfig)
3. [The Context Object — `AppCtx`](#the-context-object--appctx)
4. [Chat API](#chat-api)
   - [chat.reply](#chatreply)
   - [chat.replyMessage](#chatreply-message)
   - [chat.editMessage](#chateditmessage)
   - [chat.reactMessage](#chatreactmessage)
   - [chat.unsendMessage](#chatunsendmessage)
5. [State API — Conversation Flows](#state-api--conversation-flows)
   - [state.generateID](#stategenerateid)
   - [state.create](#statecreate)
   - [state.delete](#statedelete)
6. [Button API — Interactive Buttons](#button-api--interactive-buttons)
   - [button.generateID](#buttongenerateid)
   - [button.createContext](#buttoncreatecontext)
   - [button.update / button.create](#buttonupdate--buttoncreate)
7. [session — Auto-Resolved Flow Context](#session--auto-resolved-flow-context)
8. [Lifecycle Hooks](#lifecycle-hooks)
   - [onCommand](#oncommand)
   - [onChat](#onchat)
   - [onReply](#onreply)
   - [onReact](#onreact)
   - [onEvent](#onevent)
   - [button.onClick](#buttononclick)
9. [args and options](#args-and-options)
10. [MessageStyle](#messagestyle)
11. [Role](#role)
12. [ButtonStyle](#buttonstyle)
13. [Platform Filtering](#platform-filtering)
14. [Database Collections](#database-collections)
15. [Native Platform Access](#native-platform-access)
16. [Remaining Context Fields](#remaining-context-fields)
17. [Full Examples](#full-examples)
18. [Migration Notes — From Global-Variable Bots](#migration-notes--from-global-variable-bots)
19. [Event Pipeline — Under the Hood](#event-pipeline--under-the-hood)
20. [Extending the Middleware Pipeline](#extending-the-middleware-pipeline)
21. [Adapters Models Reference — Event & Data Structures](#adapters-models-reference--event--data-structures)
22. [Repos Reference — Database Cache Layer](#repos-reference--database-cache-layer)

---

## Quick Start

**Minimal command** (`src/app/commands/hello.ts`):

```ts
import type { AppCtx } from '@/engine/types/controller.types.js'
import { Role } from '@/engine/constants/role.constants.js'
import { MessageStyle } from '@/engine/constants/message-style.constants.js'
import type { CommandConfig } from '@/engine/types/module-config.types.js'

export const config: CommandConfig = {
  name: 'hello',
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'your-name',
  description: 'Says hello',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
}

export const onCommand = async ({ chat }: AppCtx): Promise<void> => {
  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: '👋 **Hello, world!**',
  })
}
```

**Minimal event handler** (`src/app/events/join.ts`):

```ts
import type { AppCtx } from '@/engine/types/controller.types.js'
import { MessageStyle } from '@/engine/constants/message-style.constants.js'
import type { EventConfig } from '@/engine/types/module-config.types.js'

export const config: EventConfig = {
  name: 'join',
  eventType: ['log:subscribe'],
  version: '1.0.0',
  author: 'your-name',
  description: 'Welcomes new members',
}

export const onEvent = async ({ chat, event }: AppCtx): Promise<void> => {
  const data = event['logMessageData'] as Record<string, unknown> | undefined
  const added = (data?.['addedParticipants'] as Record<string, unknown>[]) ?? []
  for (const p of added) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `👋 Welcome **${String(p['fullName'] ?? p['firstName'] ?? 'new member')}**!`,
    })
  }
}
```

---

## Module Structure

### CommandConfig

All fields you can set on `export const config: CommandConfig`:

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | ✅ | Command name, lowercase. Matched after the prefix is stripped. |
| `version` | `string` | ✅ | Semantic version (e.g. `'1.0.0'`). Shown in help output. |
| `role` | `RoleLevel` | ✅ | Minimum role to invoke. Use `Role.ANYONE` for public commands. See [Role](#role). |
| `author` | `string` | ✅ | Author name shown in help and error context. |
| `description` | `string` | ✅ | One-line description shown in Discord's `/` menu and `help`. |
| `cooldown` | `number` | ✅ | Per-user cooldown in **seconds**. `0` disables cooldown. |
| `usage` | `string` | — | Argument pattern shown by `ctx.usage()`. e.g. `'<add|list|remove> [uid]'`. |
| `hasPrefix` | `boolean` | — | Set `false` for prefix-less commands. Defaults to `true`. |
| `aliases` | `string[]` | — | Alternative command names that map to the same handler. |
| `category` | `string` | — | Display group in help output (e.g. `'Admin'`, `'Fun'`). |
| `platform` | `PlatformName[]` | — | Restrict to specific platforms. Absent = all platforms. See [Platform Filtering](#platform-filtering). |
| `options` | `CommandOption[]` | — | Typed named options for Discord slash commands and `key:value` parsing. See [args and options](#args-and-options). |
| `guide` | `string[]` | — | Multi-line usage guide. Each string is one line. Takes precedence over `usage`. |

### EventConfig

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | ✅ | Handler name registered in the dashboard. |
| `eventType` | `string[]` | ✅ | Unified event type strings to subscribe to. A single module can subscribe to multiple types. |
| `version` | `string` | ✅ | Semantic version. |
| `author` | `string` | ✅ | Author name. |
| `description` | `string` | ✅ | One-line description. |
| `platform` | `PlatformName[]` | — | Restrict to specific platforms. |

**Common `eventType` values:**

| Value | Meaning |
|---|---|
| `'log:subscribe'` | Member(s) joined a group |
| `'log:unsubscribe'` | Member left or was removed |
| `'log:thread-name'` | Group name changed |
| `'log:thread-image'` | Group photo changed |
| `'log:thread-icon'` | Group emoji changed |
| `'log:user-nickname'` | A nickname was changed |
| `'change_thread_admins'` | Admin status changed |

---

## The Context Object — `AppCtx`

Every handler (`onCommand`, `onChat`, `onReply`, `onReact`, `onEvent`, `button.onClick`) receives a single `AppCtx` object. Destructure exactly what you need:

```ts
export const onCommand = async ({
  chat,
  state,
  args,
  event,
  native,
  db,
  prefix,
}: AppCtx): Promise<void> => { /* ... */ }
```

Top-level fields:

| Field | Type | Available in | Description |
|---|---|---|---|
| `chat` | `ChatContext` | All hooks | Send, edit, react to messages |
| `thread` | `ThreadContext` | All hooks | Group operations (rename, set image, add/remove users) |
| `user` | `UserContext` | All hooks | Look up user info and avatars |
| `bot` | `BotContext` | All hooks | Get the bot's own platform user ID |
| `state` | `StateContext['state']` | onCommand, onReply, onReact, onClick | Manage pending conversation states |
| `button` | `ButtonContext['button']` | onCommand, onClick | Generate and manage interactive button IDs |
| `session` | `{ id, context, command, state }` | onReply, onReact, onClick | Auto-resolved conversation context |
| `args` | `string[]` | onCommand | Space-separated tokens after the command name |
| `options` | `OptionsMap` | onCommand | Named options parsed from the message body or Discord slash interaction |
| `parsed` | `{ name, args }` | onCommand | Parsed command name and raw args |
| `event` | `Record<string, unknown>` | All hooks | The raw unified event (senderID, threadID, messageID, message, …) |
| `native` | `NativeContext` | All hooks | Platform identity: `platform`, `userId`, `sessionId` |
| `db` | `{ users, threads }` | All hooks | Per-user and per-thread data collections |
| `logger` | `SessionLogger` | All hooks | Structured logger scoped to this session |
| `prefix` | `string` | onCommand | The active command prefix (e.g. `'!'`, `'/'`) |
| `usage` | `() => Promise<void>` | onCommand | Reply with a formatted usage guide for this command |
| `currencies` | `CurrenciesContext` | onCommand, onReply, onReact, onClick | Economy: getMoney / increaseMoney / decreaseMoney |
| `startTime` | `number` | All hooks | `Date.now()` at the moment the event entered the pipeline |
| `messageID` | `string` | onReact, onClick | The message ID the reaction or button click targeted |
| `emoji` | `string` | onReact | The emoji string that was reacted with |

---

## Chat API

### chat.reply

Sends a message to the current thread **without** threading it to any specific earlier message. Use this when you want a standalone reply that is not visually attached to the triggering message.

```ts
await chat.reply({
  style: MessageStyle.MARKDOWN,
  message: '📣 Announcement text',
})
```

To send to a **different thread** (e.g. a DM to an admin), pass `thread_id`:

```ts
await chat.reply({
  style: MessageStyle.MARKDOWN,
  message: '📨 You have a new message',
  thread_id: adminUserId,           // send to another thread
})
```

To reply to a specific earlier message (quote-style), pass `reply_to_message_id` manually:

```ts
await chat.reply({
  style: MessageStyle.MARKDOWN,
  message: 'Responding to your question',
  reply_to_message_id: event['messageID'] as string,
})
```

### chat.replyMessage

Sends a message **threaded** to the event's current message — the triggering message becomes the quote target automatically. You do not need to pass a message ID.

```ts
await chat.replyMessage({
  style: MessageStyle.MARKDOWN,
  message: '**Hello!**',
})
```

**Key difference from `chat.reply`:** `replyMessage` automatically attaches `reply_to_message_id` using the event's `messageID`. It also **returns the sent message ID**, which you need for `state.create` and `button.createContext` in interactive flows.

```ts
const msgId = await chat.replyMessage({
  style: MessageStyle.MARKDOWN,
  message: '**What is your name?**',
})

if (!msgId) return  // platform did not return a message ID — onReply unavailable

state.create({
  id: state.generateID({ id: String(msgId) }),
  state: 'awaiting_name',
  context: {},
})
```

**Common options for both `chat.reply` and `chat.replyMessage`:**

| Option | Type | Description |
|---|---|---|
| `message` | `string` | Text content |
| `style` | `MessageStyleValue` | `MessageStyle.MARKDOWN` or `MessageStyle.TEXT` |
| `attachment` | `NamedStreamAttachment[]` | File attachments as streams or Buffers |
| `attachment_url` | `NamedUrlAttachment[]` | File attachments as `{ name, url }` — downloaded before send |
| `button` | `string[] \| string[][]` | Button IDs from `button.generateID()`. Flat = one row; nested = multiple rows |
| `thread_id` / `threadID` | `string` | Override target thread (defaults to event thread) |
| `reply_to_message_id` | `string` | Quote-reply to a specific message ID (`replyMessage` sets this automatically) |

**Attachment — `stream` accepts `Buffer` or `Readable`:**

`attachment` takes `{ name, stream }[]` where `stream` is either a raw `Buffer` (in-memory bytes) or a Node.js `Readable` stream. The `name` field sets the download filename; its extension determines the MIME type used by the platform wrapper.

```ts
// Buffer — for in-memory data fetched via axios arraybuffer (most common for image commands)
const { data } = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer' })
await chat.replyMessage({
  style: MessageStyle.MARKDOWN,
  message: '🖼️ Here is your image:',
  attachment: [{ name: 'photo.jpg', stream: Buffer.from(data) }],
})

// Readable stream — for piped file data (e.g. fs.createReadStream, got stream)
import { createReadStream } from 'fs'
await chat.replyMessage({
  message: '📄 Here is your file:',
  attachment: [{ name: 'document.pdf', stream: createReadStream('./file.pdf') }],
})

// Multiple attachments in one message
await chat.replyMessage({
  message: 'Files attached:',
  attachment: [
    { name: 'image.png',  stream: imageBuffer },
    { name: 'audio.mp3',  stream: audioStream },
  ],
})
```

**Button grid — 2D array layout (`button: string[][]`):**

Pass `button` as `string[][]` to arrange buttons across multiple rows. Each inner array is one row. A flat `string[]` always collapses to a single row regardless of its length.

```ts
// Flat — all 3 buttons in one row (equivalent to [[ aId, bId, cId ]])
button: [aId, bId, cId]

// 2D — two rows of three  (2 × 3 grid)
button: [
  [randomId, natureId, spaceId],  // Row 1
  [cityId,   sunsetId, animeId],  // Row 2
]

// Mixed-width rows
button: [
  [prevId, nextId],               // Row 1 — 2 navigation buttons
  [likeId, shareId, closeId],     // Row 2 — 3 action buttons
]
```

> **Platform limits:** Discord — max 5 buttons per `ActionRow`, max 5 rows; Telegram — no hard per-row button limit; Facebook Messenger — all buttons are flattened to a numbered text menu regardless of row structure; Facebook Page — max 3 buttons per Button Template row.

### chat.editMessage

Edits a previously sent bot message in-place. Accepts `message_id_to_edit`. Use this for updating quiz results, ping latency refreshes, or replacing buttons after a choice is made.

```ts
await chat.editMessage({
  style: MessageStyle.MARKDOWN,
  message_id_to_edit: event['messageID'] as string,
  message: '✅ Done!',
  button: [refreshButtonId],     // replace buttons too
})
```

| Option | Type | Description |
|---|---|---|
| `message_id_to_edit` | `string` | ID of the message to edit |
| `message` | `string` | New text content |
| `style` | `MessageStyleValue` | Rendering style |
| `button` | `string[] \| string[][]` | New button layout |
| `attachment` | `NamedStreamAttachment[]` | Replace file attachments |
| `attachment_url` | `NamedUrlAttachment[]` | Replace with URL-based attachments |

### chat.reactMessage

Reacts to the triggering message with an emoji.

```ts
await chat.reactMessage('❤️')

// Or with explicit options:
await chat.reactMessage({ emoji: '❤️', messageID: someOtherMessageId })
```

### chat.unsendMessage

Deletes a specific message by its ID (bot-sent messages only on most platforms).

```ts
await chat.unsendMessage(messageId)

// Or:
await chat.unsendMessage({ targetMessageID: messageId })
```

---

## State API — Conversation Flows

The state system lets a command "wait" for a user's next reply or reaction without polling or globals. The engine matches incoming events to registered states using the bot's sent message ID.

### state.generateID

Builds the composite key used to register and look up a pending state. You must call this to get the ID before calling `state.create`.

```ts
// Private (default): only the user who triggered the command can advance
const id = state.generateID({ id: String(messageID) })

// Public: anyone in the thread can advance (polls, shared flows)
const id = state.generateID({ id: String(messageID), public: true })
```

**`public: false` (default):**  
The key is `${messageID}:${senderID}`. Only the sender of the original command can trigger `onReply` or `onReact` for this state.

**`public: true`:**  
The key is `${messageID}:${threadID}`. Any member of the thread can reply or react to advance the flow.

### state.create

Registers a pending state against a key. The engine looks this up when a reply (`message_reply`) or reaction (`message_reaction`) event arrives.

```ts
const STATE = { awaiting_name: 'awaiting_name' }
state.create({
  id: state.generateID({ id: String(messageID) }),
  state: STATE.awaiting_name,      // string label; becomes the handler key in onReply
  context: { step: 1 },            // arbitrary data carried into the handler via session.context
})
```

For `onReact` flows, `state` can also be a **string array** acting as an emoji allowlist:

```ts
state.create({
  id: state.generateID({ id: String(messageID) }),
  state: ['❤️', '😢'],             // only these emojis advance this state
  context: { question: 'Is water wet?' },
})
```

### state.delete

Removes a pending state. Always call this at the end of a flow (or before registering the next step in a multi-step reply chain) to prevent stale states from re-triggering.

```ts
state.delete(session.id)    // session.id is the matched key, auto-provided in onReply/onReact
```

---

## Button API — Interactive Buttons

Buttons work similarly to states but are embedded in a message as clickable components on Discord, Telegram, and Facebook Page. On Facebook Messenger (which has no native button components), the engine automatically renders a numbered text menu and routes the user's numeric reply to the appropriate `onClick` handler — your code stays identical across all platforms.

### button.generateID

Generates a fully qualified callback ID for a button. The ID must be used in two places: the `button.createContext` call and the `button` array in `chat.reply` / `chat.replyMessage`.

```ts
// Private: only the user who ran the command can click this button
const btnId = button.generateID({ id: 'refresh' })

// Public: any member of the thread can click
const btnId = button.generateID({ id: 'vote', public: true })
```

The `id` you pass must match a key in the `export const button` object of your command module.

### button.createContext

Stores arbitrary data associated with a specific button instance. Retrieved as `session.context` inside the `onClick` handler.

```ts
button.createContext({
  id: btnId,
  context: {
    answer: 'True',
    difficulty: 'medium',
  },
})
```

### button.update / button.create

Mutates an already-generated button's label or style. Call `button.update()` before sending the
message (to set the initial label) or inside an `onClick` handler (to reflect updated state after
each re-render).

**`button.update(options)`**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | ✅ | The scoped button ID returned by `button.generateID()` |
| `label` | `string` | — | New button label text; at least one of `label` or `style` must be provided |
| `style` | `ButtonStyleValue` | — | New visual style (see [ButtonStyle](#buttonstyle)) |

```ts
const scopedId = button.generateID({ id: BUTTON_ID.refresh })
// Set the initial label BEFORE sending — the platform adapter reads from
// the registry when building the component payload for the first message.
button.update({ id: scopedId, label: `🔄 Refresh (1)` })

await chat.replyMessage({
  style: MessageStyle.MARKDOWN,
  message: `🏓 Pong! Latency: \`${Date.now() - startTime}ms\``,
  button: [scopedId],
})
```

**Full counter lifecycle — the ping pattern** (from `ping.ts`):

On every click the `onClick` handler reads the previous count from `session.context`, increments
it, calls `button.update()` to mutate the registry entry, then calls `chat.editMessage()` to push
the updated component to the platform:

```ts
onClick: async ({ chat, startTime, event, button, session }: AppCtx) => {
  const count = (session.context.count as number) + 1
  // Mutate the registry entry BEFORE editMessage — the adapter reads from the
  // registry when constructing the platform-native component payload on re-render.
  button.update({ id: session.id, label: `🔄 Refresh (${count})` })
  button.createContext({ id: session.id, context: { count } })
  await chat.editMessage({
    style: MessageStyle.MARKDOWN,
    message_id_to_edit: event['messageID'] as string,
    message: `🏓 Pong! Latency: \`${Date.now() - startTime}ms\``,
    button: [session.id],
  })
}
```

**`button.create(options)`** registers a brand-new button definition at runtime — use this when
there is no corresponding static key in `export const button`. It accepts the same shape as a
static entry (`label`, `style`, `onClick`).

**When to use each:**

| Scenario | Method |
|---|---|
| Change the label or style of an existing `export const button` key | `button.update()` |
| Add a button at runtime with no static `export const button` key | `button.create()` |

### Connecting buttons to handlers

Buttons require an `export const button` object exported from your command file. Keys are the **base IDs** (without the scoped suffix generated by `button.generateID`).

```ts
// In your command file:

const BUTTON_ID = { confirm: 'confirm', cancel: 'cancel' }

export const button = {
  [BUTTON_ID.confirm]: {
    label: '✅ Confirm',
    style: ButtonStyle.SUCCESS,
    onClick: async ({ chat, session }: AppCtx) => {
      // session.context holds what you passed to button.createContext()
      const data = session.context as { itemName: string }
      state.delete(session.id)
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `Confirmed: **${data.itemName}**`,
      })
    },
  },
  [BUTTON_ID.cancel]: {
    label: '❌ Cancel',
    style: ButtonStyle.DANGER,
    onClick: async ({ chat }: AppCtx) => {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: 'Cancelled.',
      })
    },
  },
}

export const onCommand = async ({ chat, button: btn }: AppCtx) => {
  const confirmId = btn.generateID({ id: BUTTON_ID.confirm })
  const cancelId = btn.generateID({ id: BUTTON_ID.cancel })

  btn.createContext({
    id: confirmId,
    context: { itemName: 'my item' },
  })

  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: '**Are you sure?**',
    button: [confirmId, cancelId],
  })
}
```

### Multi-row button grid — 2D array

To build a grid layout, pass `button` as `string[][]` — each inner array maps to one row. This is the only way to produce multi-row layouts; a flat `string[]` always collapses to a single row.

```ts
import { ButtonStyle } from '@/engine/constants/button-style.constants.js'

const BUTTON_ID = {
  prev: 'prev', next: 'next', close: 'close',
  like: 'like', share: 'share', save: 'save',
}

export const button = {
  [BUTTON_ID.prev]:  { label: '◀ Prev',  style: ButtonStyle.SECONDARY, onClick: async (_ctx: AppCtx) => { /* ... */ } },
  [BUTTON_ID.next]:  { label: '▶ Next',  style: ButtonStyle.SECONDARY, onClick: async (_ctx: AppCtx) => { /* ... */ } },
  [BUTTON_ID.close]: { label: '✕ Close', style: ButtonStyle.DANGER,    onClick: async (_ctx: AppCtx) => { /* ... */ } },
  [BUTTON_ID.like]:  { label: '❤ Like',  style: ButtonStyle.PRIMARY,   onClick: async (_ctx: AppCtx) => { /* ... */ } },
  [BUTTON_ID.share]: { label: '↗ Share', style: ButtonStyle.SUCCESS,   onClick: async (_ctx: AppCtx) => { /* ... */ } },
  [BUTTON_ID.save]:  { label: '💾 Save', style: ButtonStyle.SECONDARY, onClick: async (_ctx: AppCtx) => { /* ... */ } },
}

export const onCommand = async ({ chat, button: btn }: AppCtx) => {
  // Public — any thread member can click; scoped (default) — only the invoker can click
  const prevId  = btn.generateID({ id: BUTTON_ID.prev,  public: true })
  const nextId  = btn.generateID({ id: BUTTON_ID.next,  public: true })
  const closeId = btn.generateID({ id: BUTTON_ID.close })        // scoped to invoker
  const likeId  = btn.generateID({ id: BUTTON_ID.like,  public: true })
  const shareId = btn.generateID({ id: BUTTON_ID.share, public: true })
  const saveId  = btn.generateID({ id: BUTTON_ID.save })         // scoped to invoker

  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: '**Page 1 of 5**',
    button: [
      [prevId, nextId, closeId],  // Row 1 — navigation (3 buttons)
      [likeId, shareId, saveId],  // Row 2 — engagement (3 buttons)
    ],
  })
}
```

**Platform notes for 2D grids:**
- **Discord** — each inner array is one `ActionRow`; max 5 buttons per row, max 5 rows total per message.
- **Telegram** — each inner array is one inline keyboard row; no hard per-row button limit.
- **Facebook Messenger** — row structure is ignored; all buttons are flattened to a numbered text menu appended to the message body.
- **Facebook Page** — each inner array is one Button Template row; max 3 buttons per row.


---

## session — Auto-Resolved Flow Context

Inside `onReply`, `onReact`, and `button.onClick`, the `session` object is populated automatically by the engine — you never construct it yourself.

```ts
session: {
  id: string                  // the matched state key (use for state.delete)
  command: string             // the command name that registered this state
  state: string | string[]    // the state label from state.create (or the emoji allowlist)
  context: Record<string, unknown>  // whatever you passed as context in state.create / button.createContext
}
```

Reading context data:

```ts
// In onReply:
[STATE.awaiting_age]: async ({ chat, session, event, state }: AppCtx) => {
  const name = session.context['name'] as string  // carried from previous step

  state.delete(session.id)
  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: `Done! **${name}**, you entered: ${event['message'] as string}`,
  })
},
```

---

## Lifecycle Hooks

### onCommand

Called when a user sends a message starting with the prefix followed by `config.name` (or one of its `aliases`).

```ts
export const onCommand = async ({ chat, args, event, native }: AppCtx): Promise<void> => {
  // args[0] is the first token after the command name
  // event['senderID'] is the platform user ID of the invoker
  // native.platform is 'discord' | 'telegram' | 'facebook-messenger' | 'facebook-page'
}
```

### onChat

Called for **every incoming message** before prefix parsing and command dispatch. Use for passive cross-cutting features: XP trackers, word filters, auto-responders.

```ts
export const onChat = async ({ event, chat }: AppCtx): Promise<void> => {
  const message = event['message'] as string
  if (!message) return
  if (message.toLowerCase().includes('hello')) {
    await chat.reactMessage('👋')
  }
}
```

> Note: `onChat` runs even when the message is a command invocation — it fires before the prefix is checked.

### onReply

A map of state-label → handler function. The engine dispatches to the correct entry when a user quotes (replies to) the bot's registered message.

```ts
export const onReply = {
  [STATE.awaiting_name]: async ({ chat, session, event, state }: AppCtx) => {
    session.context.name = event['message']

    const messageID = await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '**How old are you?**',
    })

    state.delete(session.id)          // remove old state BEFORE creating next

    if (messageID) {
      state.create({
        id: state.generateID({ id: String(messageID) }),
        state: STATE.awaiting_age,
        context: session.context,     // carry data forward
      })
    }
  },

  [STATE.awaiting_age]: async ({ chat, session, event, state }: AppCtx) => {
    state.delete(session.id)
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `Done! **${session.context.name}**, age: ${event['message'] as string}`,
    })
  },
}
```

### onReact

A map of **emoji string** → handler function. The engine dispatches when a user reacts with a matching emoji to the bot's registered message.

```ts
const STATE = {
  heart: '❤️',
  laugh: '😂',
}

export const onReact = {
  [STATE.heart]: async ({ chat, session, state }: AppCtx) => {
    state.delete(session.id)
    await chat.reply({
      style: MessageStyle.MARKDOWN,
      message: 'You chose: **love ❤️**',
    })
  },
  [STATE.laugh]: async ({ chat, session, state }: AppCtx) => {
    state.delete(session.id)
    await chat.reply({
      style: MessageStyle.MARKDOWN,
      message: 'You chose: **funny 😂**',
    })
  },
}
```

### onEvent

Handles platform-level events (member join/leave, thread rename, etc.). The event type is matched to a handler by the `eventType` array in `config`.

```ts
export const onEvent = async ({ event, chat }: AppCtx): Promise<void> => {
  const logMessageData = event['logMessageData'] as Record<string, unknown> | undefined
  // Use logMessageData fields specific to the eventType you subscribed to
}
```

### button.onClick

Defined as methods inside `export const button`. Called when a user clicks (or text-selects on Messenger) the corresponding button.

```ts
const BUTTON_ID = { refresh: 'refresh' }

export const button = {
  [BUTTON_ID.refresh]: {
    label: '🔄 Refresh',
    style: ButtonStyle.SECONDARY,
    onClick: async ({ chat, event, button: btn, session }: AppCtx) => {
      // session.context = what you passed to button.createContext()
      await chat.editMessage({
        message_id_to_edit: event['messageID'] as string,
        style: MessageStyle.MARKDOWN,
        message: `Updated content`,
      })
    },
  },
}
```

---

## args and options

### args

Plain token array from the raw message body, after the command name is stripped:

```
User sends: !weather New York City
args = ['New', 'York', 'City']
args.join(' ') = 'New York City'
```

### options

`config.options` defines **named** arguments. These work two ways:

1. **Discord slash commands (`/` prefix):** The user fills in fields in Discord's native slash menu. Values are pre-resolved with type coercion.
2. **All other platforms / prefix commands:** The engine scans the message body for `key:value` or `key: value` patterns.

```ts
options: [
  { type: OptionType.string, name: 'action', description: 'add | list | remove', required: true },
  { type: OptionType.string, name: 'uid', description: 'User ID', required: false },
]
```

Reading options inside `onCommand`:

```ts
import { Platforms } from '@/engine/modules/platform/platform.constants.js'

export const onCommand = async ({ options, args, usage, native }: AppCtx) => {
  // args is the reliable cross-platform token array — always populated regardless of prefix style or platform
  let action = args[0]
  let uid = args[1]
  // options.get() resolves Discord slash inputs via the native interaction API;
  // on all other platforms (Telegram, FB Messenger, FB Page) key:value body scanning
  // is less predictable than positional args — guard explicitly to avoid silent failures
  if (native.platform === Platforms.Discord) {
    action = options.get('action') ?? action
    uid = options.get('uid') ?? uid
  }
  if (!action) return usage()
}
```

`args` is the recommended primary source for all platforms. Use `options.get(name)` only inside a `native.platform === Platforms.Discord` guard when you specifically need to read values pre-resolved from Discord's native slash command interaction API.

---

## MessageStyle

Controls how message text is rendered on each platform:

| Value | Discord | Telegram | Facebook Messenger / Page |
|---|---|---|---|
| `MessageStyle.MARKDOWN` | Renders natively | `MarkdownV2` parse mode | Converts `**bold**`, `_italic_`, `` `code` `` → Unicode styled text |
| `MessageStyle.TEXT` | Markdown syntax is escaped — displays literally | No parse mode | Raw text sent as-is |

```ts
import { MessageStyle } from '@/engine/constants/message-style.constants.js'

await chat.replyMessage({
  style: MessageStyle.MARKDOWN,
  message: '**Bold**, _italic_, `code`',
})
```

When `style` is omitted, the historic platform default is preserved (backward compatible).

---

## Role

Declared in `config.role`. Enforced before `onCommand` runs — no boilerplate needed inside the handler.

| Constant | Value | Who can invoke |
|---|---|---|
| `Role.ANYONE` | `0` | All users (default) |
| `Role.THREAD_ADMIN` | `1` | Thread/group admins only |
| `Role.BOT_ADMIN` | `2` | Bot admins added via `/admin add` |
| `Role.PREMIUM` | `3` | Premium users; inherits ANYONE + THREAD_ADMIN |
| `Role.SYSTEM_ADMIN` | `4` | System-level admins; global authority |

> **System Admin Setup:** System admin IDs are registered in the web dashboard at
> `/admin/dashboard/settings`. Only users who are already system admins can grant or
> revoke the role. System admins bypass every role gate — they can invoke any command
> regardless of its declared `role` level, and this short-circuit fires before
> `Role.THREAD_ADMIN`, `Role.BOT_ADMIN`, and `Role.PREMIUM` checks run.

```ts
import { Role } from '@/engine/constants/role.constants.js'

export const config = {
  // ...
  role: Role.BOT_ADMIN,
}
```

Higher roles automatically inherit access to commands requiring lower roles (e.g. a bot admin can always run thread-admin commands).

---

## ButtonStyle

Visual hint for button appearance. Only meaningful on Discord; Telegram and Facebook Page use the label exclusively.

| Constant | Discord color |
|---|---|
| `ButtonStyle.PRIMARY` | Blue |
| `ButtonStyle.SECONDARY` | Grey (default) |
| `ButtonStyle.SUCCESS` | Green |
| `ButtonStyle.DANGER` | Red |

```ts
import { ButtonStyle } from '@/engine/constants/button-style.constants.js'

const BUTTON_ID = { confirm: 'confirm' }

export const button = {
  [BUTTON_ID.confirm]: {
    label: '✅ Confirm',
    style: ButtonStyle.SUCCESS,
    onClick: async (ctx: AppCtx) => { /* ... */ },
  },
}
```

---

## Platform Filtering

Restrict a command or event to specific platforms using `config.platform`:

```ts
import { Platforms } from '@/engine/modules/platform/platform.constants.js'

export const config = {
  // ...
  platform: [Platforms.Discord, Platforms.Telegram],
}
```

**Platform identifiers:**

| Constant | Value | Notes |
|---|---|---|
| `Platforms.Discord` | `'discord'` | |
| `Platforms.Telegram` | `'telegram'` | |
| `Platforms.FacebookMessenger` | `'facebook-messenger'` | fca-unofficial MQTT |
| `Platforms.FacebookPage` | `'facebook-page'` | Webhook — no native buttons, no PSID |

When `platform` is absent or an empty array, the command runs on all platforms.

Checking the current platform at runtime:

```ts
export const onCommand = async ({ native, chat }: AppCtx) => {
  if (native.platform === Platforms.FacebookPage) {
    await chat.replyMessage({ message: 'This feature is not available on Facebook Page.' })
    return
  }
  // platform-specific code
}
```

For checking whether a platform supports native button components:

```ts
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js'

await chat.replyMessage({
  style: MessageStyle.MARKDOWN,
  message: `🏓 Pong!`,
  ...(hasNativeButtons(native.platform) ? { button: [refreshId] } : {}),
})
```

---

## Database Collections

`db.users.collection(userId)` and `db.threads.collection(threadId)` give you a scoped JSON store per user or thread. Use them for per-user cooldowns, XP, preferences, and per-thread settings.

> **Multi-instance Safety:** `db` is pre-scoped to the running bot's
> `(sessionOwnerUserId, platform, sessionId)` triplet before it reaches your command
> handler. Every read and write targets only records that belong to this exact session —
> multiple bot instances sharing the same database (SQLite, MongoDB, NeonDB) never
> collide or overwrite each other's data, even when executing the same command
> simultaneously for different users on different sessions.

```ts
export const onCommand = async ({ db, event }: AppCtx) => {
  const senderID = event['senderID'] as string
  const userColl = db.users.collection(senderID)

  // Create the 'xp' collection the first time
  if (!(await userColl.isCollectionExist('xp'))) {
    await userColl.createCollection('xp')
  }

  const xp = await userColl.getCollection('xp')

  const current = (await xp.get('total')) as number ?? 0
  await xp.set('total', current + 10)
  await xp.set('lastSeen', Date.now())

  await chat.replyMessage({
    message: `Your XP: ${current + 10}`,
  })
}
```

**CollectionHandle methods** (all async, all operate on dot-path keys):

| Method | Description |
|---|---|
| `get(path?)` | Read value at dot-path; no path = entire collection |
| `set(path, value)` | Write value |
| `update(path, value)` | Shallow-merge objects; overwrite primitives |
| `delete(path?)` | Delete at path; no path = clear entire collection |
| `increment(path, amount?)` | Numeric add (default +1) |
| `decrement(path, amount?)` | Numeric subtract (default -1) |
| `push(path, value)` | Append to array |
| `pull(path, value)` | Remove matching element from array |
| `exists(path)` | Returns `boolean` |
| `keys(path?)` | Returns `string[]` of object keys |
| `length(path)` | Array or object key count |
| `clear(path?)` | Empty array or object at path |
| `upsert(path, value)` | Unconditional set (alias for set, clearer intent) |
| `merge(path, value)` | Always shallow-merge into object at path |
| `find(path, predicate)` | Filter array elements |
| `findOne(path, predicate)` | First matching element |

**Per-thread collections** follow the same API via `db.threads.collection(threadId)`:

```ts
const threadID = event['threadID'] as string
const threadColl = db.threads.collection(threadID)
if (!(await threadColl.isCollectionExist('settings'))) {
  await threadColl.createCollection('settings')
}
const settings = await threadColl.getCollection('settings')
await settings.set('welcomeEnabled', true)
```

**Economy shortcut — `ctx.currencies`:**

The `currencies` context provides a high-level economy API that operates on each user's
running coin total. It is always pre-scoped to the current bot session — the same
`(sessionOwnerUserId, platform, sessionId)` triplet that scopes `db` — so concurrent
sessions never interfere with each other's balances.

**Methods:**

| Method | Signature | Returns | Description |
|---|---|---|---|
| `getMoney` | `getMoney(userId: string)` | `Promise<number>` | Returns the user's current coin balance. Returns `0` when the user has no record yet — safe to call without an existence check. |
| `increaseMoney` | `increaseMoney({ user_id: string, money: number })` | `Promise<void>` | Adds `money` coins to the user's balance. Creates the money record automatically on first call — no prior `createCollection` call is needed. |
| `decreaseMoney` | `decreaseMoney({ user_id: string, money: number })` | `Promise<void>` | Subtracts `money` coins from the user's balance. **Does not enforce a floor** — the balance can go below zero if the caller does not validate first. Always check the balance before calling. |

**Basic usage:**

```ts
export const onCommand = async ({ chat, event, currencies }: AppCtx) => {
  const senderID = event['senderID'] as string

  // getMoney always returns a number — 0 when the user has never earned coins
  const balance = await currencies.getMoney(senderID)

  await currencies.increaseMoney({ user_id: senderID, money: 100 })
  await currencies.decreaseMoney({ user_id: senderID, money: 50 })

  await chat.replyMessage({
    message: `Balance: ${balance.toLocaleString()} coins`,
  })
}
```

**Checking balance before a deduction (e.g. gambling or purchase commands):**

`decreaseMoney` does not guard against a negative balance — always validate the current
balance before deducting so users cannot go into debt unintentionally:

```ts
export const onCommand = async ({ chat, event, currencies, args }: AppCtx) => {
  const senderID = event['senderID'] as string
  const bet = Number(args[0])
  const balance = await currencies.getMoney(senderID)

  // decreaseMoney has no floor — reject the bet explicitly before it is applied
  if (bet > balance) {
    await chat.replyMessage({
      message: `⚠️ You only have ${balance.toLocaleString()} coins.`,
    })
    return
  }

  await currencies.decreaseMoney({ user_id: senderID, money: bet })
  // ... game logic ...
}
```

**Showing another user's balance (mention path — used by `/balance`):**

`getMoney` returns `0` for any userId that has never earned coins, so the multi-user
mention loop never throws — no existence check is needed before the loop:

```ts
export const onCommand = async ({ chat, event, currencies }: AppCtx) => {
  const mentions = event['mentions'] as Record<string, string> | undefined
  const mentionIDs = Object.keys(mentions ?? {})

  if (mentionIDs.length > 0) {
    const lines: string[] = []
    for (const uid of mentionIDs) {
      // Platforms embed '@' in the mention display name — strip it for cleaner output
      const displayName = (mentions?.[uid] ?? uid).replace(/^@/, '')
      const coins = await currencies.getMoney(uid)  // 0 for users with no coins yet
      lines.push(`**${displayName}:** ${coins.toLocaleString()} coins`)
    }
    await chat.replyMessage({ message: lines.join('\n') })
    return
  }
  // ... self-balance path ...
}
```

**Running currency and state updates in parallel (used by `/slot`):**

When a currency write and a separate state write are independent, `Promise.all` eliminates
the sequential await overhead — useful for any command that persists both a game/work state
and a coin total in the same operation:

```ts
// Both writes are independent — no ordering dependency between currency and game state
const currencyUpdate =
  won > 0
    ? currencies.increaseMoney({ user_id: senderID, money: won })
    : currencies.decreaseMoney({ user_id: senderID, money: lost })

await Promise.all([currencyUpdate, saveGameState(ctx, state)])
```

**Integration with `db.users` collections:**

`currencies` and `db.users` share the same underlying session row. The `/daily` and `/work`
commands write their own metadata (last-claim timestamp, streak, job count) to separate
named collections on the same row, then call `currencies.increaseMoney` to update the
shared coin total. `getMoney` always reflects the running total across every economy
command — metadata collections and the coin total are updated independently but stored
together:

```ts
// Write command-specific metadata to its own named collection
await daily.set('lastClaim', Date.now())
await daily.set('streak', newStreak)

// Credit coins via currencies — updates the shared coin total on the same session row
await currencies.increaseMoney({ user_id: senderID, money: totalCoins })

// getMoney later returns the full accumulated balance across all economy commands
const balance = await currencies.getMoney(senderID)
```

---

## Native Platform Access

Every handler receives a `native` object alongside the unified `ctx`. While the unified API (`ctx.chat`, `ctx.thread`, etc.) covers the vast majority of use cases, `native` gives you direct access to the underlying platform SDK objects when you need capabilities the unified API does not expose.

> ⚠️ **Use sparingly.** Native access creates a hard dependency on a specific transport. Always guard with a platform check and wrap calls in `try/catch` — native errors are not absorbed by the engine's error pipeline.

```ts
import { Platforms } from '@/engine/modules/platform/platform.constants.js'

export const onCommand = async ({ native, chat }: AppCtx) => {
  if (native.platform === Platforms.Telegram) {
    const { ctx } = native as { ctx: import('telegraf').Context }
    // Full Telegraf Context is now available
    const me = await ctx.telegram.getMe()
    await chat.replyMessage({ message: `Bot username: @${me.username}` })
  }
}
```

---

### Telegram

The Telegram adapter uses **Telegraf v4**. Every event type delivers the same `ctx` — a full [`Context`](https://telegraf.js.org/) object bound to the current update.

| Event | Native fields |
|---|---|
| `message`, `message_reply` | `ctx: Context` |
| `event` (join / leave) | `ctx: Context` |
| `message_reaction` | `ctx: Context` |
| `button_action` (callback query) | `ctx: Context`, `ack(text?, showAlert?)` |

**`ctx`** — The Telegraf `Context` for this update. Exposes `ctx.telegram` (every raw Bot API method), `ctx.chat`, `ctx.from`, `ctx.message`, and all Telegraf shortcut methods.

```ts
import { Platforms } from '@/engine/modules/platform/platform.constants.js'
import type { Context } from 'telegraf'

export const onCommand = async ({ native }: AppCtx) => {
  if (native.platform === Platforms.Telegram) {
    const { ctx } = native as { ctx: Context }

    // Fetch member count directly from the Bot API
    const count = await ctx.telegram.getChatMembersCount(ctx.chat!.id)

    // Pin a message by its ID
    await ctx.telegram.pinChatMessage(ctx.chat!.id, Number(someMessageId))

    // Create a one-time invite link
    const link = await ctx.telegram.createChatInviteLink(ctx.chat!.id, {
      member_limit: 1,
    })
  }
}
```

**`ack(text?, showAlert?)`** — Only present on `button_action` events. Calling it answers the Telegram `callback_query` (dismisses the loading spinner). `button.dispatcher` calls this automatically for normal button flows; only reach for it directly if you bypass the standard button pipeline.

```ts
export const onCommand = async ({ native }: AppCtx) => {
  if (native.platform === Platforms.Telegram) {
    const { ack } = native as { ack?: (text?: string, showAlert?: boolean) => Promise<void> }
    // Show a popup modal visible only to the button clicker
    await ack?.('You are not authorised to use this button.', true)
  }
}
```

---

### Discord

The Discord adapter uses **discord.js v14**. The `native` shape differs by event type because discord.js exposes different objects depending on the update (message vs. interaction vs. guild member event).

#### Text-prefix message events (`message`, `message_reply`)

| Field | Type |
|---|---|
| `message` | `discord.js Message` |
| `userId` | `string` (bot owner's better-auth user ID) |
| `sessionId` | `string` |

```ts
import { Platforms } from '@/engine/modules/platform/platform.constants.js'
import type { Message } from 'discord.js'

export const onCommand = async ({ native }: AppCtx) => {
  if (native.platform === Platforms.Discord) {
    const { message } = native as { message?: Message }
    if (!message) return // slash command path has no message object

    const guild = message.guild
    if (guild) {
      // Read guild-level data not exposed by ctx.thread
      const boostTier = guild.premiumTier          // 0 | 1 | 2 | 3
      const emojiCount = guild.emojis.cache.size
      const memberCount = guild.memberCount
    }

    // Access the raw author object
    const authorTag = `${message.author.username}#${message.author.discriminator}`
  }
}
```

#### Slash command interactions (`message` via `/` prefix)

Slash commands are dispatched internally as `message` events. The `interaction` field replaces `message`.

| Field | Type |
|---|---|
| `interaction` | `discord.js ChatInputCommandInteraction` |

```ts
import { Platforms } from '@/engine/modules/platform/platform.constants.js'
import type { ChatInputCommandInteraction } from 'discord.js'

export const onCommand = async ({ native }: AppCtx) => {
  if (native.platform === Platforms.Discord) {
    const { interaction } = native as { interaction?: ChatInputCommandInteraction }
    if (!interaction) return // text-prefix path has no interaction object

    // Access the guild where the command was invoked
    const guildId = interaction.guildId

    // Fetch the resolved User object from a user-type slash option
    const targetUser = interaction.options.getUser('target')
  }
}
```

#### Button interactions (`button_action`)

| Field | Type |
|---|---|
| `interaction` | `discord.js ButtonInteraction` (via `RepliableInteraction`) |
| `ack(text?)` | Sends an ephemeral follow-up if `text` is provided |

```ts
import { Platforms } from '@/engine/modules/platform/platform.constants.js'
import type { ButtonInteraction, MessageFlags } from 'discord.js'

export const button = {
  myButton: {
    label: 'Click me',
    onClick: async ({ native }: AppCtx) => {
      if (native.platform === Platforms.Discord) {
        const { interaction } = native as { interaction?: ButtonInteraction }
        if (interaction) {
          // Access the original message the button is attached to
          const originalMsgId = interaction.message.id
        }
        // Send a private (ephemeral) message only the clicker sees
        const { ack } = native as { ack?: (text?: string) => Promise<void> }
        await ack?.('Only you can see this.')
      }
    },
  },
}
```

#### Guild member events (`event`)

| Field | Type |
|---|---|
| `member` | `discord.js GuildMember \| PartialGuildMember` |

```ts
import { Platforms } from '@/engine/modules/platform/platform.constants.js'
import type { GuildMember } from 'discord.js'

export const onEvent = async ({ native }: AppCtx) => {
  if (native.platform === Platforms.Discord) {
    const { member } = native as { member?: GuildMember }
    if (member) {
      const joinedAt = member.joinedAt       // Date | null
      const roles = [...member.roles.cache.values()].map(r => r.name)
      const isAdmin = member.permissions.has('Administrator')
    }
  }
}
```

#### Reaction events (`message_reaction`)

| Field | Type |
|---|---|
| `reaction` | `discord.js MessageReaction` (fully fetched, not partial) |
| `user` | `discord.js User` |

```ts
import { Platforms } from '@/engine/modules/platform/platform.constants.js'
import type { MessageReaction, User } from 'discord.js'

export const onEvent = async ({ native }: AppCtx) => {
  if (native.platform === Platforms.Discord) {
    const { reaction, user } = native as { reaction?: MessageReaction; user?: User }
    if (reaction && user) {
      const emoji = reaction.emoji.name      // Standard emoji or custom emoji name
      const count = reaction.count           // Total reaction count on this message
    }
  }
}
```

---

### Facebook Messenger

The Facebook Messenger adapter uses **fca-unofficial** over a persistent MQTT connection. Every event delivers the same two fields.

| Event | Native fields |
|---|---|
| All event types | `api` (raw fca-unofficial api handle), `event` (raw MQTT event object) |

**`api`** — The raw `fca-unofficial` api object. Exposes every fca method including ones not surfaced by Cat-Bot's `UnifiedApi`, such as `muteThread`, `changeBlockedStatus`, `createPoll`, etc.

**`event`** — The raw MQTT event payload before normalisation. Contains every field fca-unofficial delivers, including fields the normaliser strips.

```ts
import { Platforms } from '@/engine/modules/platform/platform.constants.js'

export const onCommand = async ({ event, native }: AppCtx) => {
  if (native.platform === Platforms.FacebookMessenger) {
    // fca-unofficial has no published TypeScript types — use Record<string, unknown>
    const { api } = native as { api: Record<string, unknown> & {
      muteThread: (threadID: string, muteSeconds: number, cb: (err: unknown) => void) => void
    }}

    const threadID = event['threadID'] as string

    // Mute this thread for 1 hour (not available via UnifiedApi)
    api.muteThread(threadID, 3600, (err) => {
      if (err) console.error('muteThread failed', err)
    })

    // Inspect raw event fields stripped by the normaliser
    const { event: rawEvent } = native as { event: Record<string, unknown> }
    const rawTimestamp = rawEvent['timestamp']
    const isUnread = rawEvent['isUnread']
  }
}
```

> ⚠️ **fca-unofficial is an unofficial library** — its API surface changes without notice and carries no TypeScript types. Always wrap native calls in `try/catch` and test after upgrading the `@johnlester-0369/fca-unofficial` package.

---

### Facebook Page

The Facebook Page adapter is stateless and webhook-driven. Every event delivers the raw `messaging` entry exactly as received from the Meta Graph API.

| Event | Native fields |
|---|---|
| All event types | `messaging` (raw Graph API `messaging[]` entry) |

**`messaging`** — The unmodified webhook payload entry. Useful for accessing fields the normaliser does not map, such as NLP data, referral information, or opt-in payloads.

```ts
import { Platforms } from '@/engine/modules/platform/platform.constants.js'

export const onCommand = async ({ native }: AppCtx) => {
  if (native.platform === Platforms.FacebookPage) {
    const { messaging } = native as { messaging: Record<string, unknown> }

    // Raw sender PSID (same as event.senderID but from the webhook directly)
    const sender = messaging['sender'] as { id: string } | undefined

    // Access NLP entities if you have Wit.ai NLP enabled on your app
    const message = messaging['message'] as Record<string, unknown> | undefined
    const nlp = message?.['nlp'] as Record<string, unknown> | undefined
    const intents = nlp?.['intents'] as Array<{ name: string; confidence: number }> | undefined

    // Referral data — set when a user clicks a Messenger link with a ref parameter
    const referral = messaging['referral'] as { ref?: string; source?: string } | undefined
    if (referral?.ref) {
      // User came from a specific referral link
    }
  }
}
```

---

### Safe-Narrowing Pattern

Because `NativeContext` is a union of all platform shapes, using a `switch` statement gives TypeScript the best opportunity to narrow the type and catches unhandled platforms at compile time when `noImplicitReturns` is active.

```ts
import { Platforms } from '@/engine/modules/platform/platform.constants.js'
import type { Context } from 'telegraf'
import type { Message } from 'discord.js'

export const onCommand = async ({ native, chat }: AppCtx) => {
  switch (native.platform) {
    case Platforms.Telegram: {
      const { ctx } = native as { ctx: Context }
      // Telegram-specific code here
      break
    }
    case Platforms.Discord: {
      const { message } = native as { message?: Message }
      if (message?.guild) {
        // Discord guild-specific code here
      }
      break
    }
    case Platforms.FacebookMessenger: {
      const { api } = native as { api: Record<string, unknown> }
      // fca-specific code here
      break
    }
    case Platforms.FacebookPage: {
      const { messaging } = native as { messaging: Record<string, unknown> }
      // Graph API webhook data here
      break
    }
  }
}
```

---

## Remaining Context Fields

### thread

Group/channel operations:

```ts
await thread.setName('New group name')
await thread.setImage('https://example.com/image.jpg')
await thread.removeImage()
await thread.addUser(userId)
await thread.removeUser(userId)
await thread.setReaction('🔥')               // set the group's default reaction emoji
await thread.setNickname({ user_id: userId, nickname: 'Cool Name' })
const info = await thread.getInfo()          // returns UnifiedThreadInfo
const name = await thread.getName()          // cache-first display name
```

### user

User information queries:

```ts
const info = await user.getInfo(userId)      // returns UnifiedUserInfo
const name = await user.getName(userId)      // display name (cache-first)
const avatar = await user.getAvatarUrl(userId) // URL or null
```

### bot

```ts
const botId = await bot.getID()
```

### usage

Sends a formatted usage guide derived from `config.guide` (or falls back to `config.usage` + `config.description`). Call it when an argument is missing or invalid:

```ts
export const onCommand = async ({ chat, args, usage }: AppCtx) => {
  const action = args[0]
  if (!action) return usage()   // replies with the usage guide and returns
}
```

### logger

Structured logger scoped to the current session:

```ts
logger.info('Processing request', { userId: senderID })
logger.warn('Unexpected value', { value: someVar })
logger.error('Operation failed', { error: err })
```

### db.users.getAll / db.threads.getGroupIds

```ts
// All user session rows for this bot session (useful for /top commands)
const allUsers = await db.users.getAll()
// [{ botUserId: '123', data: { xp: { total: 250 } } }, ...]

// All group thread IDs (used for broadcasts)
const groupIds = await db.threads.getGroupIds()
```

---

## Full Examples

### Example 1 — Two-Step Conversation (onReply)

```ts
import type { AppCtx } from '@/engine/types/controller.types.js'
import { Role } from '@/engine/constants/role.constants.js'
import { MessageStyle } from '@/engine/constants/message-style.constants.js'
import type { CommandConfig } from '@/engine/types/module-config.types.js'

export const config: CommandConfig = {
  name: 'register',
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'you',
  description: 'Registers your name and age',
  category: 'Example'
  usage: '',
  cooldown: 5,
  hasPrefix: true,
}

const STATE = {
  awaiting_name: 'awaiting_name',
  awaiting_age: 'awaiting_age',
}

export const onCommand = async ({ chat, state }: AppCtx) => {
  const msgId = await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: '**Step 1/2:** What is your name?',
  })
  if (!msgId) return   // platform did not return a message ID

  state.create({
    id: state.generateID({ id: String(msgId) }),
    state: STATE.awaiting_name,
    context: {},
  })
}

export const onReply = {
  [STATE.awaiting_name]: async ({ chat, session, event, state }: AppCtx) => {
    const name = event['message'] as string
    const msgId = await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '**Step 2/2:** How old are you?',
    })
    state.delete(session.id)
    if (msgId) {
      state.create({
        id: state.generateID({ id: String(msgId) }),
        state: STATE.awaiting_age,
        context: { name },   // carry name into next step
      })
    }
  },

  [STATE.awaiting_age]: async ({ chat, session, event, state }: AppCtx) => {
    const { name } = session.context as { name: string }
    state.delete(session.id)
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `✅ Registered: **${name}**, age **${event['message'] as string}**`,
    })
  },
}
```

### Example 2 — Emoji Reaction Flow (onReact)

```ts
const STATE = { like: '❤️', dislike: '😢' }

export const onCommand = async ({ chat, state }: AppCtx) => {
  const msgId = await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: '❤️ = Yes    😢 = No\n\nDo you like cats?',
  })
  if (!msgId) return

  state.create({
    id: state.generateID({ id: String(msgId) }),
    state: [STATE.like, STATE.dislike],   // emoji allowlist — only these advance the flow
    context: {},
  })
}

export const onReact = {
  [STATE.like]: async ({ chat, session, state }: AppCtx) => {
    state.delete(session.id)
    await chat.reply({ style: MessageStyle.MARKDOWN, message: '🐱 Great taste!' })
  },
  [STATE.dislike]: async ({ chat, session, state }: AppCtx) => {
    state.delete(session.id)
    await chat.reply({ style: MessageStyle.MARKDOWN, message: '😢 Fair enough.' })
  },
}
```

### Example 3 — Interactive Buttons

```ts
import { ButtonStyle } from '@/engine/constants/button-style.constants.js'
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js'

const BUTTON_ID = { yes: 'yes', no: 'no' }

export const button = {
  [BUTTON_ID.yes]: {
    label: '✅ Yes',
    style: ButtonStyle.SUCCESS,
    onClick: async ({ chat, session, state: _s }: AppCtx) => {
      const { question } = session.context as { question: string }
      await chat.editMessage({
        message_id_to_edit: session.context['messageID'] as string,
        style: MessageStyle.MARKDOWN,
        message: `You said **Yes** to: _${question}_`,
        button: [],   // remove buttons after answer
      })
    },
  },
  [BUTTON_ID.no]: {
    label: '❌ No',
    style: ButtonStyle.DANGER,
    onClick: async ({ chat, session }: AppCtx) => {
      await chat.editMessage({
        message_id_to_edit: session.context['messageID'] as string,
        style: MessageStyle.MARKDOWN,
        message: `You said **No** to: _${session.context['question'] as string}_`,
        button: [],
      })
    },
  },
}

export const onCommand = async ({ chat, button: btn, native }: AppCtx) => {
  const question = 'Do you want to continue?'
  const yesId = btn.generateID({ id: BUTTON_ID.yes })
  const noId = btn.generateID({ id: BUTTON_ID.no })

  const msgId = await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: `**${question}**`,
    ...(hasNativeButtons(native.platform) ? { button: [yesId, noId] } : {}),
  })

  if (msgId) {
    const ctx = { question, messageID: String(msgId) }
    btn.createContext({ id: yesId, context: ctx })
    btn.createContext({ id: noId, context: ctx })
  }
}
```

### Example 4 — Per-User Data Store

```ts
export const onCommand = async ({ chat, db, event }: AppCtx) => {
  const senderID = event['senderID'] as string
  const userColl = db.users.collection(senderID)

  if (!(await userColl.isCollectionExist('profile'))) {
    await userColl.createCollection('profile')
  }
  const profile = await userColl.getCollection('profile')

  const visits = ((await profile.get('visits')) as number) ?? 0
  await profile.set('visits', visits + 1)
  await profile.set('lastSeen', new Date().toISOString())

  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: `👤 You have used this bot **${visits + 1}** time(s).`,
  })
}
```

---

## Event Pipeline — Under the Hood

When a user sends a message or triggers an event, it travels through this fixed pipeline:

```
[User Event] → [Platform Transport] → [Middleware Chain] → [Controller Dispatch]
```

### Stage 1 — Platform Transport

Platform adapters (Discord, Telegram, Facebook Messenger, Facebook Page) receive native
SDK events and normalise them into the unified `UnifiedEvent` contract before emitting on
the shared `EventEmitter`. Your command and event modules never import `discord.js`,
`telegraf`, or `fca-unofficial` — the adapter layer absorbs every platform difference.

The payload emitted to `app.ts` always has three fields:

```
{ api: UnifiedApi, event: Record<string, unknown>, native: NativeContext }
```

`api` is the platform write surface (`chat.replyMessage` etc.), `event` is the normalised
event object, and `native` carries platform identity (`platform`, `userId`, `sessionId`)
plus the raw platform object for consumers that need it directly.

### Stage 2 — Middleware Chain

Every `message` event passes through the `onChat` chain first, regardless of whether it
triggers a command. If the message matches a command (prefixed or `hasPrefix: false`), the
`onCommand` chain runs next. Each guard calls `next()` to continue or returns without
calling it to halt:

```
onCommand: enforceNotBanned → enforcePermission → enforceCooldown → validateCommandOptions
onChat:    chatPassthrough (thread/user DB sync) → chatLogThread
onReply:   replyStateValidation
onReact:   reactStateValidation
onButtonClick: enforceButtonScope (tilde-scope ownership)
```

`chatPassthrough` is the middleware that keeps `db.users` and `db.threads` current — it
upserts the thread and sender into the database on first encounter and re-syncs once per
hour thereafter. This runs before any command handler, so `ctx.db` always reflects
up-to-date records when your `onCommand` executes.

### Stage 3 — Controller Dispatch

After middleware, the controller layer routes to the correct handler based on event type:

| Handler | Triggered by | What it does |
|---|---|---|
| `handleMessage` | `message`, `message_reply` | Runs `onChat` fan-out → checks `onReply` state → prefix-parses → dispatches `onCommand` |
| `handleEvent` | `event`, `message_reaction`, `message_unsend` | Checks `onReact` state → routes by `logMessageType` to `onEvent` handlers |
| `handleButtonAction` | `button_action` | Runs `onButtonClick` middleware → calls `button[id].onClick` |

### Priority rules

**`onReply` and `onReact` take precedence over new command dispatch.** When a user quotes
a bot message that has a registered `state.create()` entry, the reply dispatcher intercepts
it before prefix parsing — the user does not need to type a command prefix to continue a
conversation flow. Similarly, a reaction on a pending bot message routes to `onReact`
before any generic event handler sees it.

**`onChat` always fires, even on command invocations.** If your module exports `onChat`, it
receives every message in the thread regardless of prefix or command matching. Deduplicate
by checking `event['message']` rather than relying on module-level call count — the engine
skips duplicate calls for aliased modules automatically.

---

## Extending the Middleware Pipeline

The middleware pipeline is the correct place for cross-cutting command-level concerns.
Do not re-implement guards (auth checks, rate limiting, audit logging) inside individual
command modules — add them once here and they apply to every command automatically.

### Adding a custom guard

```ts
// src/engine/middleware/index.ts — append after the built-in registrations, or
// call use.onCommand([...]) anywhere after the side-effect import in app.ts.

import { use } from '@/engine/middleware/index.js'
import type { MiddlewareFn, OnCommandCtx } from '@/engine/middleware/index.js'

const myGuard: MiddlewareFn<OnCommandCtx> = async (ctx, next) => {
  // ctx carries the full BaseCtx + parsed command info + current options
  const senderID = ctx.event['senderID'] as string

  if (/* your rejection condition */) {
    await ctx.chat.replyMessage({ message: '🚫 Not allowed.' })
    return   // ← omitting next() halts the chain; onCommand never executes
  }

  await next()  // ← passes control to the next middleware, then the final handler
}

use.onCommand([myGuard])
```

### Available registration hooks

| Hook | Runs when | Common uses |
|---|---|---|
| `use.onCommand([...])` | After prefix match, before `onCommand` | Permission checks, rate limiting, feature flags |
| `use.onChat([...])` | Every message before the `onChat` fan-out | Audit logging, spam detection, passive analytics |
| `use.onReply([...])` | Reply flow matched, before the step handler | Conversation timeouts, input sanitisation |
| `use.onReact([...])` | Reaction flow matched, before the emoji handler | Emoji allowlist enforcement, per-reaction cooldowns |
| `use.onButtonClick([...])` | Button click matched, before `onClick` | Additional ownership or feature-flag checks |

### Short-circuit contract

A middleware that does **not** call `next()` halts the chain completely — no subsequent
middleware and no final handler will execute. This is the standard pattern for guard
clauses that need to reject a request and optionally send an error reply.

`ctx.chat.replyMessage()` is available inside every middleware for sending user-facing
rejection messages. For `onButtonClick`, `ctx.ack` (populated by `enforceButtonScope`)
lets you send a private modal alert visible only to the button clicker on Telegram and
Discord before halting:

```ts
const scopeGuard: MiddlewareFn<OnButtonClickCtx> = async (ctx, next) => {
  // ctx.ack is the platform-native acknowledgement callback
  if (/* not authorised */) {
    await ctx.ack?.('🔒 You are not allowed to use this button.', true)
    return
  }
  await next()
}
use.onButtonClick([scopeGuard])
```

### Execution order

Middlewares execute in registration order within each hook. The engine's built-in chain
runs first; your additions append to the end unless you edit `src/engine/middleware/index.ts`
directly to insert at a specific position:

```
onCommand:    enforceNotBanned → enforcePermission → enforceCooldown
              → validateCommandOptions → [your middlewares]
onChat:       chatPassthrough → chatLogThread → [your middlewares]
onReply:      replyStateValidation → [your middlewares]
onReact:      reactStateValidation → [your middlewares]
onButtonClick: enforceButtonScope → [your middlewares]
```

## Adapters Models Reference — Event & Data Structures

The `packages/cat-bot/src/engine/adapters/models/` directory is the single source of truth for every data contract in the Cat-Bot engine. Platform adapters normalise their native events into these shapes before they reach your handler. This reference documents the shape of each event type, every attachment variant, and every interface so you can safely read raw `event[...]` fields without inspecting engine source code.

---

### EventType Enum

`import { EventType } from '@/engine/adapters/models/enums/event-type.enum.js'`

Discriminant values for the top-level `type` field on every event object.

| Constant | Value | Description |
|---|---|---|
| `EventType.MESSAGE` | `'message'` | Standard chat message — text, attachments, or both |
| `EventType.MESSAGE_REPLY` | `'message_reply'` | A reply to a specific earlier message in the thread |
| `EventType.MESSAGE_REACTION` | `'message_reaction'` | Emoji reaction added to a message |
| `EventType.MESSAGE_UNSEND` | `'message_unsend'` | A sent message was retracted by its sender |
| `EventType.EVENT` | `'event'` | Thread-level administrative event; narrowed further by `logMessageType` |
| `EventType.BUTTON_ACTION` | `'button_action'` | A user clicked an interactive button (Discord, Telegram, Facebook Page) |

---

### AttachmentType Enum

`import { AttachmentType } from '@/engine/adapters/models/enums/attachment-type.enum.js'`

Discriminant values for the `type` field on every attachment object inside `event['attachments']`.

| Constant | Value | Description |
|---|---|---|
| `AttachmentType.PHOTO` | `'photo'` | Static image |
| `AttachmentType.VIDEO` | `'video'` | Playable video file |
| `AttachmentType.AUDIO` | `'audio'` | Playable audio file or voice message |
| `AttachmentType.ANIMATED_IMAGE` | `'animated_image'` | Animated GIF or WebP image |

---

### LogMessageType Enum

`import { LogMessageType } from '@/engine/adapters/models/enums/log-message-type.enum.js'`

Discriminant values for the `logMessageType` field on `EventType.EVENT` objects. Use these strings as `eventType` values in your `EventConfig` to subscribe to specific thread administrative events.

| Constant | Value | Description |
|---|---|---|
| `LogMessageType.SUBSCRIBE` | `'log:subscribe'` | One or more users were added to the group |
| `LogMessageType.UNSUBSCRIBE` | `'log:unsubscribe'` | A user was removed or left the group |
| `LogMessageType.THREAD_NAME` | `'log:thread-name'` | The conversation / group name was changed |
| `LogMessageType.THREAD_COLOR` | `'log:thread-color'` | The group theme colour was changed |
| `LogMessageType.THREAD_ICON` | `'log:thread-icon'` | The group emoji icon was changed |
| `LogMessageType.THREAD_IMAGE` | `'log:thread-image'` | The group photo was changed or removed |
| `LogMessageType.USER_NICKNAME` | `'log:user-nickname'` | A participant's nickname inside this thread was set or cleared |
| `LogMessageType.CHANGE_THREAD_ADMINS` | `'change_thread_admins'` | A participant's admin status in the group was changed |

---

### UnifiedEvent — All Event Shapes

Every event object your handler receives is one of the shapes below, discriminated on `event['type']`. `formatEvent()` in `event.model.ts` normalises all platform-native payloads into these contracts before they reach your code — you never receive a raw Discord `Message` or Telegraf `Context` through the `event` parameter.

#### `message`

Emitted for every standard chat message. Routed to `onChat` (all messages) and then to `onCommand` after prefix parsing.

| Field | Type | Notes |
|---|---|---|
| `type` | `'message'` | Discriminant |
| `senderID` | `string` | Platform user ID of the sender; use with `user.getInfo(senderID)` |
| `message` | `string` | The message body text |
| `threadID` | `string` | Platform thread/channel/chat ID; use with `db.threads.collection(threadID)` |
| `messageID` | `string` | Platform-assigned message ID; use as the key for `state.create()` and `button.createContext()` |
| `attachments` | `unknown[]` | Array of attachment objects — may be empty; narrow each item on `(att as {type:string}).type` (see [Attachment Data Shapes](#attachment-data-shapes)) |
| `mentions` | `Record<string, string>` | Map of `userID → mentionedText` (e.g. `{ '12345': '@Alice' }`) |
| `timestamp` | `string \| number \| null` | fca-unofficial sends a string ms timestamp; Discord/Telegram send a number; `null` when unavailable |
| `isGroup` | `boolean` | `false` in 1:1 DMs; `true` in group chats, channels, and servers |

---

#### `message_reply`

Emitted when a user sends a quote-reply to a specific earlier message. Checked against the `onReply` state store first; falls through to `onCommand` / `onChat` if no matching state is registered.

| Field | Type | Notes |
|---|---|---|
| `type` | `'message_reply'` | Discriminant |
| `threadID` | `string` | |
| `messageID` | `string` | ID of the reply message itself (not the original) |
| `senderID` | `string` | Who sent this reply |
| `attachments` | `unknown[]` | Attachments on the reply |
| `args` | `string[]` | Reply body split on whitespace — pre-tokenised |
| `message` | `string` | The reply body text |
| `isGroup` | `boolean` | |
| `mentions` | `Record<string, string>` | |
| `timestamp` | `number \| null` | |
| `messageReply` | `object \| null` | The quoted/replied-to message (see nested shape below); `null` when the platform could not fetch it |

**Nested `messageReply` object** (the original message being quoted):

| Field | Type | Notes |
|---|---|---|
| `threadID` | `string` | Same as the outer `threadID` |
| `messageID` | `string` | ID of the message being replied to — this is the key used in `state.create()` for `onReply` flows |
| `senderID` | `string` | Who sent the original message |
| `attachments` | `unknown[]` | Attachments on the original message |
| `args` | `string[]` | Original message body split on whitespace |
| `message` | `string` | Original message body text |
| `isGroup` | `boolean` | |
| `mentions` | `Record<string, string>` | |
| `timestamp` | `number` | Number ms — fca-unofficial uses a number here, unlike the outer event which uses a string |

---

#### `message_reaction`

Emitted when a user adds an emoji reaction to a message. Checked against the `onReact` state store; then falls through to generic event handling.

| Field | Type | Notes |
|---|---|---|
| `type` | `'message_reaction'` | Discriminant |
| `threadID` | `string` | Thread where the reaction occurred |
| `messageID` | `string` | ID of the message that received the reaction |
| `reaction` | `string` | The emoji string placed on the message, e.g. `'❤️'` |
| `senderID` | `string` | Who placed the reaction |
| `userID` | `string` | Whose message received the reaction (the original message author) |
| `timestamp` | `number \| null` | Unix ms when the reaction was set; `null` when the platform does not surface it |

---

#### `message_unsend`

Emitted when a sender retracts a previously sent message.

| Field | Type | Notes |
|---|---|---|
| `type` | `'message_unsend'` | Discriminant |
| `threadID` | `string` | |
| `messageID` | `string` | ID of the retracted message |
| `senderID` | `string` | Who retracted the message |
| `deletionTimestamp` | `number` | Unix ms when the deletion occurred |
| `timestamp` | `number \| undefined` | Original send timestamp — `undefined` (not `null`) intentionally preserves the fca-unofficial sentinel so consumers can distinguish "timestamp not present" from `timestamp === 0` |

---

#### `event` — Thread Administrative Events

Emitted for group-level administrative actions. The top-level `type` is always `'event'`; the actual sub-type is in `logMessageType`. Register your `EventConfig.eventType` with one or more `LogMessageType` values to receive specific sub-events.

| Field | Type | Notes |
|---|---|---|
| `type` | `'event'` | Discriminant |
| `threadID` | `string` | |
| `logMessageType` | `string` | One of the `LogMessageType` values — use this to distinguish sub-events |
| `logMessageData` | `Record<string, unknown> \| null` | Payload shape varies by `logMessageType` (see table below) |
| `logMessageBody` | `string` | Human-readable English description produced by the platform (e.g. `'Alice named the group …'`) |
| `author` | `string` | userID of the actor who triggered this event |

**`logMessageData` payload shape by `logMessageType`:**

| `logMessageType` | `logMessageData` shape |
|---|---|
| `'log:subscribe'` | `{ addedParticipants: AddedParticipant[] }` |
| `'log:unsubscribe'` | `{ leftParticipantFbId: string }` |
| `'log:thread-name'` | `{ name: string }` |
| `'log:thread-image'` | `{ image: { attachmentID: string \| null, width: number \| null, height: number \| null, url: string \| null } }` — `image` is `null` when a group photo is removed |
| `'log:thread-color'` | Raw `untypedData` object (shape varies by Facebook API version) |
| `'log:thread-icon'` | Raw `untypedData` object (shape varies by Facebook API version) |
| `'log:user-nickname'` | `{ nickname: string, participant_id: string }` |
| `'change_thread_admins'` | `{ TARGET_ID: string, ADMIN_TYPE: string }` |

**`AddedParticipant` shape** (each item in `logMessageData['addedParticipants']` for `'log:subscribe'`):

| Field | Type | Notes |
|---|---|---|
| `firstName` | `string` | |
| `fullName` | `string` | Prefer over `firstName` — this is the display name shown in the UI |
| `userFbId` | `string` | Platform user ID of the added member |

**Reading `logMessageData` in `onEvent` handlers:**

```ts
export const onEvent = async ({ event }: AppCtx) => {
  const type = event['logMessageType'] as string
  const data = event['logMessageData'] as Record<string, unknown> | undefined

  if (type === 'log:subscribe') {
    const added = (data?.['addedParticipants'] as Record<string, unknown>[]) ?? []
    for (const p of added) {
      const name = String(p['fullName'] || p['firstName'] || `User ${p['userFbId']}`)
    }
  }
  if (type === 'log:unsubscribe') {
    const leftId = String(data?.['leftParticipantFbId'] ?? '')
  }
  if (type === 'log:thread-name') {
    const newName = String(data?.['name'] ?? '')
  }
  if (type === 'log:thread-image') {
    const img = data?.['image'] as { url: string | null } | undefined
    const imageUrl = img?.url ?? null
  }
  if (type === 'log:user-nickname') {
    const nickname = String(data?.['nickname'] ?? '')
    const userId = String(data?.['participant_id'] ?? '')
  }
  if (type === 'change_thread_admins') {
    const targetId = String(data?.['TARGET_ID'] ?? '')
    const adminType = String(data?.['ADMIN_TYPE'] ?? '')
  }
}
```

---

#### `button_action`

Emitted when a user clicks an interactive button. Routed to `handleButtonAction` → `button[id].onClick`. In typical `onClick` handlers you read context via `session.context` rather than raw event fields.

| Field | Type | Notes |
|---|---|---|
| `type` | `'button_action'` | Discriminant |
| `platform` | `string` | Source platform identifier (e.g. `'discord'`, `'telegram'`) |
| `threadID` | `string` | |
| `senderID` | `string` | Who clicked the button |
| `messageID` | `string` | ID of the message that contained the button |
| `buttonId` | `string` | Fully-qualified ID in `"commandName:buttonId"` format; used by `handleButtonAction` for routing |
| `timestamp` | `number \| null` | |

---

### Attachment Data Shapes

Every item in `event['attachments']` carries a `type` field from `AttachmentType`. Always narrow on `type` before reading any other field to avoid accessing non-existent properties.

```ts
const attachments = event['attachments'] as Record<string, unknown>[]
for (const att of attachments) {
  switch (att['type'] as string) {
    case 'photo': {
      const url = att['url'] as string
      break
    }
    case 'audio': {
      const url = att['url'] as string
      break
    }
    case 'video': {
      const url = att['url'] as string
      break
    }
    // ... narrow remaining types similarly
  }
}
```

#### `photo`

| Field | Type | Notes |
|---|---|---|
| `type` | `'photo'` | |
| `url` | `string` | Full-resolution URL |

#### `video`

| Field | Type | Notes |
|---|---|---|
| `type` | `'video'` | |
| `url` | `string` | Playable video URL |

#### `audio`

| Field | Type | Notes |
|---|---|---|
| `type` | `'audio'` | |
| `url` | `string` | |

#### `file`

| Field | Type | Notes |
|---|---|---|
| `type` | `'file'` | |
| `url` | `string` | |


#### `animated_image`

| Field | Type | Notes |
|---|---|---|
| `type` | `'animated_image'` | |
| `url` | `string` | URL of the animated GIF / WebP |

---

## Repos Reference — Database Cache Layer

The `packages/cat-bot/src/engine/repos/` directory is the **only correct way to read and write
persistent bot data from inside engine code** (middleware, services, commands that import engine
internals directly). Every repo file is a thin LRU cache layer over the `database` package adapter
— the same adapter that backs `ctx.db`, `ctx.currencies`, and `ctx.chat`.

> **Command authors using `ctx.db`:** You do not need to import repos. The `ctx.db.users` and
> `ctx.db.threads` APIs already delegate through these repos internally. Import repos directly only
> when you are writing engine-level code (custom middleware, services) that runs outside a normal
> `AppCtx` handler.

### Caching Contract

All repos share the same design contract:

- **Read functions** check the LRU cache first; on miss they query the database, store the result,
  and return it. A cached `null` is a valid result (meaning "not found") — only `undefined` is a
  cache miss.
- **Write functions** call the database adapter, then immediately write the known post-write value
  into cache (write-through) so the next read within the TTL window sees the fresh value without
  a round-trip.
- **Invalidation** is explicit — writes target exactly the keys they affect; unrelated keys survive.
  TTL-based expiry provides eventual consistency for anything not explicitly invalidated.

---

### `banned.repo.ts` — User and Thread Bans

Called on every command invocation via `enforceNotBanned` middleware. Caches ban booleans
per (userId, platform, sessionId, botUserId/botThreadId) tuple.

```ts
import {
  banUser, unbanUser, isUserBanned,
  banThread, unbanThread, isThreadBanned,
} from '@/engine/repos/banned.repo.js'
```

| Function | Signature | Description |
|---|---|---|
| `banUser` | `(userId, platform, sessionId, botUserId, reason?)` → `Promise<void>` | Bans a user; writes `true` to cache immediately |
| `unbanUser` | `(userId, platform, sessionId, botUserId)` → `Promise<void>` | Removes ban; writes `false` to cache immediately |
| `isUserBanned` | `(userId, platform, sessionId, botUserId)` → `Promise<boolean>` | Cache-first ban check |
| `banThread` | `(userId, platform, sessionId, botThreadId, reason?)` → `Promise<void>` | Bans a thread; writes `true` to cache immediately |
| `unbanThread` | `(userId, platform, sessionId, botThreadId)` → `Promise<void>` | Removes thread ban; writes `false` to cache immediately |
| `isThreadBanned` | `(userId, platform, sessionId, botThreadId)` → `Promise<boolean>` | Cache-first thread ban check |

**Parameters:**
- `userId` — the bot owner's better-auth user ID (from `native.userId`)
- `platform` — platform string e.g. `'discord'` (from `native.platform`)
- `sessionId` — bot session ID (from `native.sessionId`)
- `botUserId` / `botThreadId` — the platform user/thread ID to ban

**Invalidation:** ban/unban mutations write the authoritative boolean directly into cache
rather than evicting — the next `isUserBanned` call always sees the post-write state.

---

### `credentials.repo.ts` — Bot Credentials, Admins, and Prefix

Covers Discord/Telegram/Facebook credentials, bot admin management, premium user management,
and per-session prefix updates. Called at startup (credential loading) and on privileged
command invocations.

```ts
import {
  // Credentials
  findDiscordCredentialState, updateDiscordCredentialCommandHash, findAllDiscordCredentials,
  findTelegramCredentialState, updateTelegramCredentialCommandHash, findAllTelegramCredentials,
  findAllFbPageCredentials, findAllFbMessengerCredentials, findAllBotSessions,
  // Bot admins
  isBotAdmin, addBotAdmin, removeBotAdmin, listBotAdmins,
  // Premium
  isBotPremium, addBotPremium, removeBotPremium, listBotPremiums,
  // Prefix
  updateBotSessionPrefix,
  // Shared cache key
  SESSIONS_ALL_KEY,
} from '@/engine/repos/credentials.repo.js'
```

#### Discord / Telegram Credentials

| Function | Description |
|---|---|
| `findDiscordCredentialState(userId, sessionId)` | Returns `{ isCommandRegister, commandHash } \| null`; cache-first |
| `updateDiscordCredentialCommandHash(userId, sessionId, data)` | Updates command hash; clears discord state + all-discord list from cache |
| `findAllDiscordCredentials()` | All Discord credentials; cached under a singleton key |
| `findTelegramCredentialState(userId, sessionId)` | Returns `{ isCommandRegister, commandHash } \| null`; cache-first |
| `updateTelegramCredentialCommandHash(userId, sessionId, data)` | Updates command hash; clears telegram state + all-telegram list from cache |
| `findAllTelegramCredentials()` | All Telegram credentials; cached under a singleton key |
| `findAllFbPageCredentials()` | All Facebook Page credentials; cached under a singleton key |
| `findAllFbMessengerCredentials()` | All Facebook Messenger credentials; cached under a singleton key |
| `findAllBotSessions()` | All bot sessions across all platforms; cached under `SESSIONS_ALL_KEY` |

#### Bot Admin Management

| Function | Signature | Description |
|---|---|---|
| `isBotAdmin` | `(userId, platform, sessionId, adminId)` → `Promise<boolean>` | Checks membership in the cached admin list (does not create a per-user cache entry) |
| `addBotAdmin` | `(userId, platform, sessionId, adminId)` → `Promise<void>` | Adds admin; write-through patches the list cache; clears `bot:detail` and `bot:list` dashboard caches |
| `removeBotAdmin` | `(userId, platform, sessionId, adminId)` → `Promise<void>` | Removes admin; write-through filters the list cache; clears dashboard caches |
| `listBotAdmins` | `(userId, platform, sessionId)` → `Promise<string[]>` | Returns full admin ID array; cached per session |

#### Premium User Management

| Function | Signature | Description |
|---|---|---|
| `isBotPremium` | `(userId, platform, sessionId, premiumId)` → `Promise<boolean>` | Checks membership in the cached premium list |
| `addBotPremium` | `(userId, platform, sessionId, premiumId)` → `Promise<void>` | Adds premium user; write-through patches list cache; clears dashboard caches |
| `removeBotPremium` | `(userId, platform, sessionId, premiumId)` → `Promise<void>` | Removes premium user; write-through filters list cache; clears dashboard caches |
| `listBotPremiums` | `(userId, platform, sessionId)` → `Promise<string[]>` | Returns full premium ID array; cached per session |

#### Session Prefix

| Function | Signature | Description |
|---|---|---|
| `updateBotSessionPrefix` | `(userId, platform, sessionId, prefix)` → `Promise<void>` | Persists new prefix; clears `SESSIONS_ALL_KEY` and dashboard caches so the next `findAllBotSessions` returns the updated prefix |

**`SESSIONS_ALL_KEY`** is an exported string constant shared with `server/repos/bot.repo.ts` — both repos invalidate it on session mutations so `session-loader` always reads an up-to-date list.

---

### `session.repo.ts` — Bot Nickname

Read on every AI command invocation and every passive `onChat` trigger phrase check.

```ts
import { getBotNickname } from '@/engine/repos/session.repo.js'
```

| Function | Signature | Description |
|---|---|---|
| `getBotNickname` | `(userId, platform, sessionId)` → `Promise<string \| null>` | Returns the configured display name for this session, or `null` when none is set. Callers should fall back to a generic identity when `null`. Cache-first. |

**Invalidation:** uses TTL-based expiry only. Nickname updates flow through `bot.repo.ts` in the server layer (which clears `bot:detail` and `bot:list`) — the nickname key here expires on its own schedule, providing eventual consistency without cross-repo coupling.

---

### `system-admin.repo.ts` — System Admin Checks

Called on every command dispatch via `enforcePermission` and `enforceNotBanned` middleware.
Uses a single `Set<string>` cache entry instead of per-sender boolean entries to avoid
crowding the LRU cache with O(unique_senders) false entries.

```ts
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js'
```

| Function | Signature | Description |
|---|---|---|
| `isSystemAdmin` | `(adminId: string)` → `Promise<boolean>` | Loads the full system admin ID set on first miss; subsequent calls for any sender resolve via `Set.has()` in O(1) without writing new cache entries |

**Invalidation:** TTL-based only. System admin mutations happen through the web dashboard — the 5-minute TTL provides sufficient eventual consistency since these changes are infrequent.

---

### `threads.repo.ts` — Thread Data

Called on every incoming message by `chatPassthrough` middleware (4–5 reads per message on the
hot path). Caching these eliminates the majority of DB round-trips in steady state.

```ts
import {
  upsertThread, threadExists, threadSessionExists,
  upsertThreadSession, isThreadAdmin, getThreadName,
  getThreadSessionData, setThreadSessionData,
  getAllGroupThreadIds, getThreadSessionUpdatedAt,
} from '@/engine/repos/threads.repo.js'
```

| Function | Signature | Description |
|---|---|---|
| `upsertThread(data)` | `(data: any)` → `Promise<void>` | Writes thread to DB; sets `threadExists=true` and populates a `Set<string>` of admin IDs in cache for O(1) `isThreadAdmin` lookups |
| `threadExists(platform, threadId)` | → `Promise<boolean>` | Cache-first existence check |
| `threadSessionExists(userId, platform, sessionId, threadId)` | → `Promise<boolean>` | Cache-first session row existence check |
| `upsertThreadSession(userId, platform, sessionId, threadId)` | → `Promise<void>` | Creates/updates session row; stamps `sessionExists=true` and `updatedAt=now` in cache optimistically; evicts group IDs list |
| `isThreadAdmin(threadId, userId)` | → `Promise<boolean>` | Resolves via cached `Set.has()` if `upsertThread` has run; falls through to DB on cold start |
| `getThreadName(threadId)` | → `Promise<string>` | Cache-first thread display name |
| `getThreadSessionData(userId, platform, sessionId, botThreadId)` | → `Promise<Record<string, unknown>>` | Cache-first per-thread-session data blob (prefix, toggles, etc.) |
| `setThreadSessionData(userId, platform, sessionId, botThreadId, data)` | → `Promise<void>` | Writes data blob; shallow-copies into cache immediately |
| `getAllGroupThreadIds(userId, platform, sessionId)` | → `Promise<string[]>` | Returns all group thread IDs for this session; used for broadcast commands |
| `getThreadSessionUpdatedAt(userId, platform, sessionId, threadId)` | → `Promise<Date \| null>` | Returns last-sync timestamp; `null` means the thread has never been synced |

**Admin ID caching strategy:** `upsertThread` stores `data.adminIDs` as a `Set<string>` under a single
key rather than one boolean per (thread, user) pair. This keeps the cache at O(threads) entries
instead of O(threads × participants).

**Invalidation summary:**
- `upsertThread` → refreshes exists + name; replaces admin Set
- `upsertThreadSession` → stamps sessionExists + updatedAt; evicts group IDs list
- `setThreadSessionData` → replaces data blob in cache

---

### `users.repo.ts` — User Data

Mirrors the thread repo pattern for user data. Called on every message for sync gating and
once per command for per-user data reads.

```ts
import {
  upsertUser, userExists, userSessionExists,
  upsertUserSession, getUserName, getUserSessionData,
  setUserSessionData, getAllUserSessionData, getUserSessionUpdatedAt,
} from '@/engine/repos/users.repo.js'
```

| Function | Signature | Description |
|---|---|---|
| `upsertUser(data)` | `(data: any)` → `Promise<void>` | Writes user to DB; sets `exists=true` and caches display name immediately |
| `userExists(platform, userId)` | → `Promise<boolean>` | Cache-first existence check |
| `userSessionExists(userId, platform, sessionId, botUserId)` | → `Promise<boolean>` | Cache-first session row check |
| `upsertUserSession(userId, platform, sessionId, botUserId)` | → `Promise<void>` | Creates/updates session row; stamps `sessionExists=true` and `updatedAt=now` in cache |
| `getUserName(userId)` | → `Promise<string>` | Cache-first display name |
| `getUserSessionData(userId, platform, sessionId, botUserId)` | → `Promise<Record<string, unknown>>` | Cache-first per-user session data blob |
| `setUserSessionData(userId, platform, sessionId, botUserId, data)` | → `Promise<void>` | Writes data blob; patches the matching slot in the aggregate `getAllUserSessionData` cache rather than evicting the whole list — rank leaderboard reads see fresh data without a full re-fetch |
| `getAllUserSessionData(userId, platform, sessionId)` | → `Promise<Array<{ botUserId: string; data: Record<string, unknown> }>>` | Returns all user session blobs for this session; used for leaderboard/top commands |
| `getUserSessionUpdatedAt(userId, platform, sessionId, botUserId)` | → `Promise<Date \| null>` | Returns last-sync timestamp; `null` means the user has never been synced |

**Invalidation summary:**
- `upsertUser` → refreshes exists + name
- `upsertUserSession` → stamps sessionExists + updatedAt
- `setUserSessionData` → patches individual blob + patches aggregate list in place; evicts aggregate only when the user has no existing entry in it

---

### `webhooks.repo.ts` — Facebook Page Webhook Verification

Called on every incoming Facebook Page event to confirm the webhook handshake is complete.
Verification transitions from `false` to `true` exactly once and never reverts — the cache
provides a permanent hit after the first handshake.

```ts
import {
  getFbPageWebhookVerification,
  upsertFbPageWebhookVerification,
} from '@/engine/repos/webhooks.repo.js'
```

| Function | Signature | Description |
|---|---|---|
| `getFbPageWebhookVerification(userId)` | → `Promise<{ isVerified: boolean } \| null>` | Cache-first verification record. `null` means no row exists yet (handshake not started). |
| `upsertFbPageWebhookVerification(userId)` | → `Promise<void>` | Marks verification complete in DB; writes `{ isVerified: true }` to cache immediately |

**Invalidation:** not needed — `isVerified` is write-once and never reverts to `false`.
---

## Migration Notes — From Global-Variable Bots

If you are familiar with GoatBot, Mirai, or similar `global.client.handleReply` / `global.client.handleReaction` patterns, here is the direct mapping:

| Old pattern | Cat-Bot equivalent |
|---|---|
| `global.client.handleReply.push({ name, messageID, author, ... })` | `state.create({ id: state.generateID({ id: messageID }), state: 'step_name', context: { ... } })` |
| `global.client.handleReaction.push({ name, messageID, author, answer })` | `state.create({ id: state.generateID({ id: messageID }), state: [emoji1, emoji2], context: { answer } })` |
| `module.exports.handleReply = async ({ handleReply }) => { switch (handleReply.type) }` | `export const onReply = { [STATE.step_name]: async ({ session }) => { ... } }` |
| `module.exports.handleReaction = async ({ handleReaction }) => { if (event.reaction == '👍') }` | `export const onReact = { ['👍']: async ({ session }) => { ... } }` |
| `api.sendMessage(body, threadID, callback)` | `await chat.replyMessage({ message: body })` |
| `api.sendMessage(body, threadID, messageID)` | `await chat.reply({ message: body })` — thread-level, no quote-reply |
| `api.sendMessage(body, adminUID)` | `await chat.reply({ message: body, thread_id: adminUID })` |
| `const name = await usersData.getName(uid)` | `const name = await user.getName(uid)` |
| `handleReply.author != event.senderID` | Not needed — `state.generateID({ public: false })` (default) scopes automatically |
| `global.utils.randomString(10)` | `Math.random().toString(36).substring(2, 12)` |
| `global.moduleData.shortcut = new Map()` | `db.threads.collection(threadID)` + collection API |

**The single biggest difference:** Cat-Bot never puts state in `global`. Every pending state is scoped to a specific bot message ID and a specific user or thread. Two users running the same command at the same time get completely independent state entries with no interference.
