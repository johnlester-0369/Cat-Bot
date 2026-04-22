# Models Adapter Layer — Architecture

## Overview

The `src/engine/adapters/models/` directory is the **unified contract layer** for Cat-Bot. It defines the data shapes, abstract API surface, and context factories that every platform adapter (Discord, Telegram, Facebook Messenger, Facebook Page) must conform to.

The core design principle is **Write once. Deploy everywhere**: command and event modules are authored against the unified contract once. The platform adapters below translate native platform primitives (discord.js `Message`, Telegraf `Context`, fca-unofficial MQTT events, Graph API webhooks) into the shapes defined here. The controller layer above consumes only these shapes — never platform-native types.

This means:

- A command calling `ctx.chat.replyMessage()` works identically on Discord, Telegram, Facebook Messenger, and Facebook Page.
- An event module subscribing to `log:subscribe` receives the same `PROTO_EVENT_THREAD_EVENT` shape regardless of whether a member joined a Discord guild or a Messenger group.
- A platform adapter can be added, replaced, or removed without touching a single command or event module.

---

## Module File Tree

```
src/engine/adapters/models/
│
├── index.ts                                    — Barrel: single public import surface for the entire
│                                                 models layer; platform wrappers and the controller
│                                                 layer import from here, never from sub-directories;
│                                                 re-exports UnifiedApi, formatEvent, all context
│                                                 factories, UnifiedUserInfo, UnifiedThreadInfo, all
│                                                 enums, all prototypes, and all interface types
│
├── api.model.ts                                — UnifiedApi abstract base class: the write-once contract
│                                                 that every platform wrapper extends; defines the
│                                                 complete surface of platform operations (sendMessage,
│                                                 replyMessage, editMessage, unsendMessage, reactToMessage,
│                                                 getBotID, getUserInfo, getFullUserInfo, getFullThreadInfo,
│                                                 getUserName, getThreadName, getAvatarUrl, setGroupName,
│                                                 setGroupImage, removeGroupImage, addUserToGroup,
│                                                 removeUserFromGroup, setGroupReaction, setNickname);
│                                                 all methods throw by default — platform wrappers
│                                                 override only what their transport supports; the
│                                                 handler layer calls these methods without knowing
│                                                 which platform is underneath
│
├── context.model.ts                            — Context factory layer: six factory functions that bind
│                                                 a UnifiedApi instance and a raw event object into
│                                                 ergonomic, scope-aware context objects injected as
│                                                 ctx.thread, ctx.chat, ctx.bot, ctx.user, ctx.state,
│                                                 and ctx.button inside every command handler; factories
│                                                 pre-fill thread IDs and message IDs from the event so
│                                                 command modules never reference raw event fields;
│                                                 createChatContext owns the Facebook Messenger button-
│                                                 fallback logic (numbered text menus) and the button
│                                                 ID resolution pipeline (commandName:buttonId prefix)
│                                                 so platform-specific UI concerns stay inside the
│                                                 model layer, not inside command modules
│
│   createThreadContext()  → ctx.thread         — Group/server operations: setName, setImage,
│                                                 removeImage, addUser, removeUser, setReaction,
│                                                 setNickname, getInfo, getName
│
│   createChatContext()    → ctx.chat           — Message operations: reply, replyMessage, reactMessage,
│                                                 unsendMessage, editMessage; owns button ID resolution
│                                                 (resolveButtons), FB Messenger numbered-menu fallback
│                                                 (buildButtonFallbackText, registerButtonFallbackState),
│                                                 and thread/message ID extraction from raw event
│
│   createBotContext()     → ctx.bot            — Bot identity: getID
│
│   createUserContext()    → ctx.user           — User queries: getInfo, getName, getAvatarUrl
│
│   createStateContext()   → ctx.state          — Pending flow management: generateID, create, delete;
│                                                 scopes state to sender (private) or thread (public)
│                                                 via composite keys for onReply and onReact flows
│
│   createButtonContext()  → ctx.button         — Button lifecycle: generateID (instance-unique, scoped
│                                                 or public), createContext, getContext, deleteContext,
│                                                 update (dynamic override), create (dynamic definition)
│
├── event.model.ts                              — Unified event contract: defines the UnifiedEvent
│                                                 discriminated union type (15 event variants keyed by
│                                                 the 'type' field) and the formatEvent() normalizer;
│                                                 platform event-routers call formatEvent() to convert
│                                                 native event objects into the unified shapes before
│                                                 emitting on the shared EventEmitter; the 'default'
│                                                 branch passes unknown events through as
│                                                 Record<string, unknown> so new platform events never
│                                                 cause runtime crashes; folds the fca-unofficial
│                                                 'change_thread_image' top-level type into
│                                                 EventType.EVENT + logMessageType 'log:thread-image'
│                                                 so all thread administrative events share one dispatch
│                                                 path regardless of source platform; re-exports all
│                                                 enums and prototypes for backward compatibility
│
├── thread.model.ts                             — Unified thread info shape: defines UnifiedThreadInfo
│                                                 (platform, threadID, name, isGroup, memberCount,
│                                                 participantIDs, adminIDs, avatarUrl), the frozen
│                                                 PROTO_UNIFIED_THREAD_INFO reference prototype, and
│                                                 the createUnifiedThreadInfo() factory that fills safe
│                                                 defaults for any absent field; all platform wrapper
│                                                 getFullThreadInfo() implementations must use this
│                                                 factory rather than constructing the shape inline so
│                                                 adding a new field requires one change here only;
│                                                 a dependency-free leaf — imports only the logger
│
├── user.model.ts                               — Unified user info shape: defines UnifiedUserInfo
│                                                 (platform, id, name, firstName, username, avatarUrl),
│                                                 the frozen PROTO_UNIFIED_USER_INFO reference prototype,
│                                                 and the createUnifiedUserInfo() factory; same
│                                                 single-change guarantee as thread.model; a
│                                                 dependency-free leaf — imports only the logger
│
├── enums/
│   │
│   ├── index.ts                                — Barrel: re-exports all three enum modules as a single
│   │                                             import point for consumers that need multiple enum types
│   │
│   ├── event-type.enum.ts                      — EventType frozen const object: top-level discriminant
│   │                                             strings for the 'type' field on every event object
│   │                                             (MESSAGE, MESSAGE_REPLY, MESSAGE_REACTION,
│   │                                             MESSAGE_UNSEND, TYP, PRESENCE, EVENT, READ_RECEIPT,
│   │                                             READ, READY, STOP_LISTEN, PARSE_ERROR, BUTTON_ACTION);
│   │                                             platform event-routers must set event.type to one of
│   │                                             these values before calling formatEvent()
│   │
│   ├── attachment-type.enum.ts                 — AttachmentType frozen const object: discriminant
│   │                                             strings for the 'type' field on attachment objects
│   │                                             (PHOTO, VIDEO, AUDIO, FILE, STICKER, ANIMATED_IMAGE,
│   │                                             SHARE, LOCATION, ERROR, UNKNOWN); platform wrappers
│   │                                             normalize native attachment formats to one of these
│   │                                             types; command modules switch on this value to handle
│   │                                             media without knowing the source platform
│   │
│   └── log-message-type.enum.ts               — LogMessageType frozen const object: sub-type strings
│                                                 for the 'logMessageType' field on EventType.EVENT
│                                                 objects (SUBSCRIBE, UNSUBSCRIBE, THREAD_NAME,
│                                                 THREAD_COLOR, THREAD_ICON, THREAD_IMAGE,
│                                                 USER_NICKNAME, CHANGE_THREAD_ADMINS,
│                                                 CHANGE_THREAD_APPROVAL_MODE, GROUP_POLL,
│                                                 MESSENGER_CALL_LOG, PARTICIPANT_JOINED_GROUP_CALL,
│                                                 MAGIC_WORDS, JOINABLE_GROUP_LINK_MODE_CHANGE,
│                                                 GENERIC_ADMIN_TEXT); event modules subscribe to
│                                                 specific logMessageType strings and receive matching
│                                                 events regardless of which platform sourced them
│
├── interfaces/
│   │
│   ├── index.ts                                — Barrel: re-exports all interface types as a single
│   │                                             import point; consumers import SendPayload, ButtonItem,
│   │                                             ThreadContext, ChatContext, etc. from this one path
│   │
│   ├── api.interfaces.ts                       — API data shape interfaces: MentionEntry (@mention
│   │                                             placeholder with tag + user_id), NamedStreamAttachment
│   │                                             (name + Readable/Buffer for upload), NamedUrlAttachment
│   │                                             (name + url for server-side fetch), UserInfo (minimal
│   │                                             name-only user record), ButtonItem (resolved button
│   │                                             definition with fully-qualified commandName:buttonId,
│   │                                             label, and style hint), SendPayload (message send
│   │                                             options), ReplyMessageOptions (reply with threading,
│   │                                             attachments, buttons, mentions, style), EditMessageOptions
│   │                                             (edit existing message body and components); these are
│   │                                             the shapes that platform wrapper method signatures
│   │                                             accept — adapters receive unified shapes, translate to
│   │                                             native API calls internally
│   │
│   ├── context.interfaces.ts                   — Context object interfaces: EditOptions, ThreadOptions,
│   │                                             MessageOptions (shared option sub-shapes), ThreadContext
│   │                                             (setName, setImage, removeImage, addUser, removeUser,
│   │                                             setReaction, setNickname, getInfo, getName), ReplyOptions,
│   │                                             ChatContext (reply, replyMessage, reactMessage,
│   │                                             unsendMessage, editMessage), BotContext (getID),
│   │                                             UserContext (getInfo, getName, getAvatarUrl),
│   │                                             StateContext (state.generateID, state.create,
│   │                                             state.delete), ButtonContext (button.generateID,
│   │                                             button.createContext, button.getContext,
│   │                                             button.deleteContext, button.update, button.create);
│   │                                             return types of the six context factories in
│   │                                             context.model.ts
│   │
│   └── send-payload.interface.ts               — Backward-compatibility re-export shim: re-exports
│                                                 SendPayload and ReplyMessageOptions from api.interfaces
│                                                 so existing consumers that import from the send-payload
│                                                 path continue to resolve without modification
│
└── prototypes/
    │
    ├── index.ts                                — Barrel: re-exports all prototype objects as a single
    │                                             import point for test fixtures and runtime guards
    │
    ├── attachment.prototypes.ts               — Frozen canonical attachment shape objects: one
    │                                             PROTO_ATTACHMENT_* constant per AttachmentType value
    │                                             (PHOTO, VIDEO, AUDIO, FILE, STICKER, ANIMATED_IMAGE,
    │                                             SHARE, LOCATION, ERROR, UNKNOWN); each constant
    │                                             documents every key a handler may safely read on that
    │                                             attachment variant; used as reference documentation,
    │                                             type-safe test fixture templates, and runtime
    │                                             structural guards; platform wrappers use these shapes
    │                                             when building the attachments[] array on normalized
    │                                             events
    │
    └── event.prototypes.ts                    — Frozen canonical event shape objects: one PROTO_EVENT_*
                                                  constant per EventType value plus PROTO_REPLIED_MESSAGE
                                                  and PROTO_ADDED_PARTICIPANT for inner nested shapes;
                                                  each constant documents every key a handler may safely
                                                  read on that event variant; platform event-routers
                                                  normalize native events to match these shapes before
                                                  emitting; serves as the authoritative field reference
                                                  for test fixture construction and integration test
                                                  event injection
```

---

## Architectural Layers

The models directory is organized as a **four-layer dependency stack**. Lower layers have no knowledge of higher layers — the dependency edges only point downward.

```
Layer 4 — Barrel (index.ts)
  └── re-exports everything; single import point for all consumers

Layer 3 — Factories and Contracts (api.model.ts, context.model.ts, event.model.ts)
  └── imports from Layer 2 + Layer 1; cannot import from Layer 4 or controller layer

Layer 2 — Data Shapes (thread.model.ts, user.model.ts, interfaces/, prototypes/)
  └── imports only from Layer 1 (enums) or the logger; no cross-layer imports

Layer 1 — Enumerations (enums/)
  └── no imports from the models layer at all; pure const objects and derived types
```

### Layer 1 — Enumerations

The `enums/` directory defines the discriminant string sets that the entire event pipeline is keyed on. `EventType` drives `formatEvent()` dispatch. `LogMessageType` drives event module subscription in the `EventModuleMap`. `AttachmentType` drives media handling in command modules. All three are frozen const objects — values are nominal strings assignable anywhere without importing the object.

### Layer 2 — Data Shapes

The `interfaces/` and `prototypes/` directories, along with `thread.model.ts` and `user.model.ts`, define the concrete record shapes that cross the platform boundary.

`interfaces/` shapes travel **downward** (platform wrappers accept them as method parameters) and **upward** (command modules receive them in context objects).

`prototypes/` shapes are frozen reference objects. They serve three roles simultaneously: documentation of every field a handler may safely read, type-safe templates for test fixture construction, and structural reference for integration tests that inject synthetic events without invoking a real platform.

`thread.model.ts` and `user.model.ts` are **dependency-free leaf nodes**. They define the unified output shapes for `getFullThreadInfo()` and `getFullUserInfo()` respectively. Both expose a factory function (`createUnifiedThreadInfo`, `createUnifiedUserInfo`) that fills safe defaults for any absent field — platform wrappers always go through the factory, so adding a new field to `UnifiedThreadInfo` or `UnifiedUserInfo` requires one edit here and one edit per platform wrapper, with no changes to command modules.

### Layer 3 — Factories and Contracts

`api.model.ts` defines the `UnifiedApi` abstract class. Every platform adapter (`discord/wrapper.ts`, `telegram/wrapper.ts`, `facebook-messenger/wrapper.ts`, `facebook-page/wrapper.ts`) extends `UnifiedApi` and overrides the methods its transport supports. Methods that a platform cannot support (`addUserToGroup` on Facebook Page, `setGroupReaction` on Telegram) remain as throw-only stubs grouped in each adapter's `unsupported.ts`. Command modules call `ctx.chat.replyMessage()` — they never know which `UnifiedApi` subclass is underneath.

`event.model.ts` defines the `UnifiedEvent` discriminated union and `formatEvent()`. Platform event-routers call `formatEvent()` to convert raw native event objects into the contract before emitting on the shared `EventEmitter`. The `formatEvent()` switch is keyed on `event.type` — platforms must assign one of the `EventType` enum values before calling. The `default` branch passes unknown events through as `Record<string, unknown>` rather than throwing, ensuring new or unrecognized event types from a platform never crash other sessions.

`context.model.ts` defines the six factory functions that produce the context objects injected into every command handler. The factories capture the `UnifiedApi` instance and the raw event object at dispatch time, pre-filling thread IDs, message IDs, and sender IDs from the event. This pre-binding is what allows command modules to call `ctx.chat.replyMessage({ message: 'Hello' })` without any thread ID argument — the factory already knows the target thread from the triggering event.

`createChatContext()` also owns the one cross-platform UI concern that cannot be abstracted away at the platform level: Facebook Messenger has no native interactive button components. When `chat.reply()` or `chat.replyMessage()` is called with a `button` array on the Messenger platform, `createChatContext()` builds a numbered text menu appended to the message body and registers a persistent `button_fallback` state in the state store so subsequent user replies route to the correct `button[id].onClick()` handler. Command modules call the same `chat.reply({ button: [...] })` API on all platforms — the fallback is transparent.

### Layer 4 — Barrel

`index.ts` is the single public surface of the models layer. All consumers — platform wrappers, the controller layer (`ctx.factory.ts`, dispatchers), and command modules that import types — import from `index.ts`. Internal sub-directory paths are an implementation detail. This means the internal file structure can be reorganized without changing any import paths in consuming files.

---

## Platform Consumption Pattern

Each of the four platform adapters consumes the models layer in the same three-phase pattern:

```
src/engine/adapters/platform/{platform}/
│
├── wrapper.ts          — Extends UnifiedApi; implements each method by delegating to lib/;
│                         the platform transport's native objects (discord.js Client,
│                         Telegraf Context, fca api handle, Graph API pageApi) are
│                         captured as private fields — never exposed upward
│
├── event-router.ts     — Calls formatEvent() on raw native events to produce UnifiedEvent;
│   (or event-handlers.ts)  sets event.type to an EventType value before calling;
│                         emits the normalized event on the shared EventEmitter with
│                         { api: UnifiedApi, event: UnifiedEvent, native: NativeContext }
│
└── lib/                — Pure operation functions; each accepts the minimal native object
                          it needs and the method parameters defined in api.interfaces.ts;
                          returns the UnifiedUserInfo / UnifiedThreadInfo shapes from the
                          model factories; independently testable with minimal mocks
```

The `native` field in every emitted payload carries the platform-specific context (session identity, raw platform object) for consumers like the controller layer that need session routing. Command and event modules never receive `native` directly — they receive the context objects produced by the factories in `context.model.ts`.

---

## Unified Event Flow

The path from a native platform event to a command handler call crosses the models layer twice:

```
Platform native event (discord.js MessageCreateEvent / Telegraf Context / fca MQTT delta / Graph API webhook entry)
  │
  ▼  platform event-router calls formatEvent()
UnifiedEvent (one of the 15 discriminated union members)
  │
  ▼  emitted on EventEmitter as { api, event, native }
app.ts platform.on() handler
  │
  ▼  buildBaseCtx() calls the six context factories
ctx.thread  ctx.chat  ctx.bot  ctx.user  ctx.state  ctx.button
  │
  ▼  dispatchers (command.dispatcher, event.dispatcher, reply.dispatcher, react.dispatcher, button.dispatcher)
Command / event module handler receives AppCtx
```

At no point in this path does a command module import from `discord.js`, `telegraf`, `fca-unofficial`, or `axios`. The models layer is the only shared vocabulary.

---

## Key Design Decisions

**UnifiedApi defaults to throw.** Every method on `UnifiedApi` throws a descriptive error naming the platform. Platform wrappers override only the methods their transport supports. This means an unsupported operation fails loudly with a clear message rather than silently doing nothing. Command modules that call operations not supported on a given platform surface the error through the normal error-handling path, which can then provide a user-facing message.

**formatEvent() default branch passthrough.** Unknown event types from new platform APIs or future fca-unofficial versions pass through as `Record<string, unknown>` rather than throwing. The handler layer can choose to ignore or log them without crashing. Crashless forward-compatibility is worth the loose typing at the passthrough boundary.

**Leaf-node factories with safe defaults.** `createUnifiedThreadInfo()` and `createUnifiedUserInfo()` accept `Partial<T>` and fill every absent field with a documented default. Platform wrappers never construct these shapes with object literals — all field-presence guarantees are centralized in the factory. New fields added to the unified shapes only require updating the factory and the platform wrappers that can populate the new field.

**context.model.ts owns button fallback.** The numbered text menu fallback for Facebook Messenger is implemented inside `createChatContext()` rather than inside the Facebook Messenger platform adapter or inside each command module. Centralizing it here means: (a) the fallback activates automatically for any command that uses `button`, not just commands that know about the fallback, and (b) the Facebook Messenger adapter does not need to know about the command name or button structure at the transport level.

**Prototypes as live documentation.** The `PROTO_*` objects are not used at runtime for object creation — they are frozen reference shapes. Their value is as accurate, always-up-to-date documentation of every field available on each event and attachment variant. Because they are compiled TypeScript, they are verified by the type checker on every build. Stale documentation is not possible.