<div align="center">
  <img src="assets/cover.png" alt="Cat-Bot Cover" width="100%" />

  <h1>Cat-Bot</h1>

  <p><strong>Write once. Deploy everywhere.</strong></p>
  <p>
    A unified multi-platform, multi-instance chatbot framework for Discord, Telegram,
    Facebook Page, and Facebook Messenger — managed from a single dashboard.
  </p>

  <p>
    <img src="https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord" />
    <img src="https://img.shields.io/badge/Telegram-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram" />
    <img src="https://img.shields.io/badge/Facebook_Page-0866FF?style=for-the-badge&logo=facebook&logoColor=white" alt="Facebook Page" />
    <img src="https://img.shields.io/badge/Facebook_Messenger-0084FF?style=for-the-badge&logo=messenger&logoColor=white" alt="Facebook Messenger" />
  </p>

  <p>
    <img src="https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript" alt="TypeScript 5.9" />
    <img src="https://img.shields.io/badge/Node.js-ESM-green?logo=node.js" alt="Node.js ESM" />
    <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React 19" />
    <img src="https://img.shields.io/badge/License-ISC-lightgrey" alt="License ISC" />
  </p>

  <p>
    <a href="https://github.com/johnlester-0369/Cat-Bot">GitHub Repository</a>
  </p>
</div>

---

## The Problem

Most chatbot projects are locked into one platform and one running instance. Deploying on Discord _and_ Telegram means writing two separate codebases. Each SDK has its own event model, attachment format, button system, and conversation-state pattern — quadruple the surface area, quadruple the maintenance.

Cat-Bot solves both problems simultaneously:

- **Multi-platform** — one command module runs natively on Discord, Telegram, Facebook Page, and Facebook Messenger. No `if platform === 'discord'` branches in your handler code.
- **Multi-instance** — any number of independent bot sessions run concurrently, each with its own credentials, prefix, command roster, and admin list, all controlled from a single web dashboard.

The platform transport layer absorbs every SDK difference (discord.js gateway, Telegraf polling, fca-unofficial MQTT, Graph API webhooks). Your command code calls `await chat.replyMessage({ message: 'Hello!' })` and it works everywhere.

---

## Table of Contents

1. [Quick Start — 5 Minutes](#quick-start--5-minutes)
2. [What Cat-Bot Provides](#what-cat-bot-provides)
3. [Philosophy](#philosophy)
4. [Platform API Comparison: Native vs Unified](#platform-api-comparison-native-vs-unified)
5. [Demo](#demo)
6. [Screenshots](#screenshots)
7. [Features](#features)
8. [Architecture](#architecture)
9. [Production Setup](#production-setup)
10. [Cloud Deployment](#cloud-deployment)
11. [Writing Commands](#writing-commands)
12. [Converting Existing Commands](#converting-existing-commands)
13. [Writing Event Handlers](#writing-event-handlers)
14. [Constants & Type Safety](#constants--type-safety)
15. [Developer Reference](#developer-reference)
16. [Database Adapters](#database-adapters)
17. [Environment Variables](#environment-variables)
18. [Facebook Messenger — E2EE Trade-offs](#facebook-messenger--e2ee-trade-offs)
19. [npm Scripts](#npm-scripts)
20. [Authors](#authors)

---

## Quick Start — 5 Minutes

The `json` adapter stores everything in a single flat file with no external database. It is the fastest path from clone to running bot.

**Prerequisites:** Node.js 20+, npm 10+

### 1. Clone and install

```bash
git clone https://github.com/johnlester-0369/Cat-Bot.git
cd Cat-Bot
npm install
```

### 2. Configure environment

```bash
cd packages/cat-bot
cp .env.example .env
```

#### Getting OpenSSL

`BETTER_AUTH_SECRET` and `ENCRYPTION_KEY` require a cryptographically-secure random value — never use a simple password or a hardcoded string. If you don't have OpenSSL, pick one of the options below.

**Option A — Install OpenSSL locally (recommended)**

Running `openssl rand` on your own machine means the generated secret never touches any external server.

| OS | How to install |
|---|---|
| **Windows** | Via [Git for Windows](https://git-scm.com/download/win) (easiest — OpenSSL is bundled), or with a package manager: `choco install openssl` (Chocolatey) / `scoop install openssl` (Scoop) |
| **macOS** | LibreSSL is pre-installed and compatible for key generation. For full OpenSSL: `brew install openssl` |
| **Linux (Debian / Ubuntu)** | `sudo apt install openssl` |
| **Linux (Fedora / RHEL)** | `sudo dnf install openssl` |

Verify your installation:

```bash
openssl version
```

**Option B — Generate online (no install required)**

Both tools use the **Web Crypto API** — the same CSPRNG source as OpenSSL — and generate entirely in your browser. Nothing is transmitted to any server.

| Tool | URL | Notes |
|---|---|---|
| **HexHero Random Key Generator** ⭐ | [hexhero.com/tools/random-key-generator](https://www.hexhero.com/tools/random-key-generator) | Explicitly matches `openssl rand` output; selectable Base64 / hex / 128–512 bit |
| **RandomKeygen** | [randomkeygen.com](https://randomkeygen.com) | Quick all-purpose generator; widely used |

> **Security reminder:** Never commit generated secrets to version control. Always load them exclusively from your `.env` file.

Minimum required fields for local development:

```env
PORT=3000
DATABASE_TYPE=json

# Generate with: openssl rand -base64 32
BETTER_AUTH_SECRET=your_secret_here
BETTER_AUTH_URL=http://localhost:3000
VITE_URL=http://localhost:5173

# Generate with: openssl rand -hex 32
ENCRYPTION_KEY=your_64_hex_char_key_here
```

### 3. Create your admin account

```bash
npm run seed:admin
```

This account works for both the user portal (`/login`) and the admin portal (`/admin`).

### 4. Start the bot engine and dashboard

```bash
npm run dev:all
```

- **Dashboard:** http://localhost:5173
- **API:** http://localhost:3000

### 5. Add your first bot

1. Open http://localhost:5173 and sign in.
2. Click **Create New Bot**.
3. Select a platform and paste your credentials (Discord bot token, Telegram token, etc.).
4. Click **Verify** — Cat-Bot validates credentials against the live platform API before saving.
5. Click **Create**. The bot starts automatically.

> **Hot reload:** Command files in `packages/cat-bot/src/app/commands/` are watched by `tsx watch`. Save a file and the changes are live.

---

## What Cat-Bot Provides

The core insight is that the _bot problem_ and the _platform problem_ are separate concerns. Cat-Bot handles the platform problem so your code only addresses the bot problem.

### One API surface for four platforms

Every platform SDK solves the same tasks differently. Here is what sending a single message looks like natively, and what it looks like in Cat-Bot:

<table>
<tr><th>Native (four different SDKs)</th><th>Cat-Bot (one call)</th></tr>
<tr>
<td>

```js
// discord.js — slash command
await interaction.deferReply();
await interaction.editReply("Hello!");

// Telegraf
await ctx.reply("Hello!");

// fca-unofficial
api.sendMessage({ body: "Hello!" }, threadID, cb);

// Facebook Page — raw HTTP
await axios.post(graphUrl, {
  recipient: { id: psid },
  message: { text: "Hello!" },
});
```

</td>
<td>

```ts
await chat.replyMessage({
  style: MessageStyle.MARKDOWN,
  message: "**Hello!**",
});
```

</td>
</tr>
</table>

The same unification applies to file attachments, interactive buttons, conversation flows, and group management — all documented in the [Developer Reference](#developer-reference).

### Scoped conversation state

The standard global-array pattern creates race conditions the moment two users run the same command simultaneously:

```js
// ❌ Old pattern — shared mutable global, concurrent users corrupt each other's state
global.client.handleReply.push({
  name: "quiz",
  messageID: info.messageID,
  author: event.senderID,
  answer: "True",
});
```

Cat-Bot scopes every pending state to a composite key (`messageId:userId` for private flows, `messageId:threadId` for public flows):

```ts
// ✅ Cat-Bot — isolated per message and per user, zero global mutations
state.create({
  id: state.generateID({ id: String(messageID) }),
  state: "awaiting_answer",
  context: { answer: "True" },
});
```

Two users running the same flow simultaneously each have a completely independent state entry.

---

## Philosophy

Cat-Bot is built on one foundational idea: **every handler owns exactly one responsibility.**

This shapes the entire API — from how conversation states are defined to how button actions are declared.

### One Handler, One Job

In classic bot frameworks, all conversation flows are routed through a single monolithic dispatcher. Every step in a conversation adds another `case` to the same `switch`:

```js
// GoatBot / Mirai pattern — the entire state machine lives in one function
module.exports.handleReply = async ({ event, handleReply, api }) => {
  switch (handleReply.type) {
    case "userCallAdmin": {
      /* forward message to admin */ break;
    }
    case "adminReply": {
      /* forward reply to user */ break;
    }
    case "awaiting_name": {
      /* step 1 of registration */ break;
    }
    case "awaiting_age": {
      /* step 2 of registration */ break;
    }
  }
};
```

The function has no bounded scope — it owns the entire conversation state machine. Adding a new step means opening this function and modifying it. Changing one `case` risks regressions in all the others.

Cat-Bot inverts this. Each state gets its own named function:

```ts
// Cat-Bot — each step is a self-contained function with one job
export const onReply = {
  awaiting_name: async ({ chat, event, state, session }: AppCtx) => {
    // Only responsibility: receive the name, ask for age, register the next state
  },
  awaiting_age: async ({ chat, event, state, session }: AppCtx) => {
    // Only responsibility: receive the age, complete the registration flow
  },
};
```

Adding a new step is a new key. Modifying step 2 cannot break step 1. The same principle applies to `onReact` — each emoji maps to its own independent function, never sharing a dispatcher.

### One Button, One Object

**discord.js v14** — Buttons require `ActionRowBuilder` and `ButtonBuilder`. The click handler is a global `interactionCreate` listener registered separately on the Client — the code that sends buttons and the code that handles clicks are structurally disconnected, linked only by a raw string ID embedded manually in `customId`. Every interaction must be acknowledged within 3 seconds or Discord shows "interaction failed":

```js
// discord.js v14 — send and handle are two separate registration sites
const row = new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setCustomId('confirm:12345')  // embed userId manually for ownership check
    .setLabel('✅ Confirm')
    .setStyle(ButtonStyle.Success),
  new ButtonBuilder()
    .setCustomId('cancel:12345')
    .setLabel('❌ Cancel')
    .setStyle(ButtonStyle.Danger)
)
await message.channel.send({ content: 'Are you sure?', components: [row] })

// Registered globally on the Client — completely separate from the send site
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return
  await interaction.deferUpdate()  // MUST call within 3 seconds
  const [action, userId] = interaction.customId.split(':')
  if (interaction.user.id !== userId) return  // manual ownership check
  if (action === 'confirm') await interaction.editReply({ content: '✅ Confirmed!', components: [] })
})
```

**Telegraf v4** — Inline keyboard buttons carry `callback_data` (max 64 bytes). Clicks arrive via `bot.on('callback_query')` registered separately from the command handler. `ctx.answerCbQuery()` must be called to dismiss the loading spinner:

```js
// Telegraf v4 — inline keyboard (send site and click handler are separate)
await ctx.reply('Are you sure?', {
  reply_markup: {
    inline_keyboard: [[
      { text: '✅ Confirm', callback_data: `confirm:${ctx.from.id}` },
      { text: '❌ Cancel',  callback_data: `cancel:${ctx.from.id}` }
    ]]
  }
})

bot.on('callback_query', async ctx => {
  await ctx.answerCbQuery()  // dismiss the loading spinner — must call explicitly
  const [action, userId] = ctx.callbackQuery.data.split(':')
  if (ctx.from.id.toString() !== userId) return
  if (action === 'confirm') await ctx.editMessageText('✅ Confirmed!')
})
```

**fca-unofficial** — No native button component exists on Messenger's MQTT protocol. Buttons must be emulated with numbered text menus. State is stored in a global mutable array shared across all concurrent commands, creating race conditions when two users invoke the same command simultaneously:

```js
// fca-unofficial — text menu + global handleReply array (no native buttons)
api.sendMessage(
  'Are you sure?\n1. ✅ Confirm\n2. ❌ Cancel',
  threadID,
  (err, info) => {
    if (err) return
    global.client.handleReply.push({
      name: 'myCommand', messageID: info.messageID,
      author: event.senderID, type: 'awaiting_confirm',
    })
  }
)

module.exports.handleReply = async ({ event, handleReply, api }) => {
  if (handleReply.author !== event.senderID) return  // manual ownership check
  const idx = global.client.handleReply.findIndex(r => r.messageID === handleReply.messageID)
  global.client.handleReply.splice(idx, 1)  // manual cleanup — races with concurrent pushes
  const choice = event.body.trim()
  if (choice === '1') api.sendMessage('✅ Confirmed!', event.threadID, () => {})
  else api.sendMessage('❌ Cancelled.', event.threadID, () => {})
}
```

**Facebook Page Graph API** — The Button Template is the only interactive construct, limited to 3 buttons with titles capped at 20 characters. Clicks arrive as `postback` webhook events in a completely separate Express handler — there is no concept of collocating the send and the click handler:

```js
// Facebook Page — Button Template (max 3 buttons) + postback handler (separate file)
await axios.post(`${GRAPH}?access_token=${TOKEN}`, {
  recipient: { id: psid },
  message: {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'button', text: 'Are you sure?',
        buttons: [
          { type: 'postback', title: '✅ Confirm', payload: `CONFIRM_${psid}` },
          { type: 'postback', title: '❌ Cancel',  payload: `CANCEL_${psid}` },
        ]
      }
    }
  }
})

app.post('/webhook', (req, res) => {
  res.sendStatus(200)
  req.body.entry.forEach(entry => entry.messaging.forEach(async event => {
    if (!event.postback) return
    const [action, userId] = event.postback.payload.split('_')
    if (event.sender.id !== userId) return
    if (action === 'CONFIRM') await axios.post(`${GRAPH}?access_token=${TOKEN}`,
      { recipient: { id: event.sender.id }, message: { text: '✅ Confirmed!' } })
  }))
})
```

**Cat-Bot — all four platforms:**

```ts
const BUTTON_ID = { confirm: 'confirm', cancel: 'cancel' }

export const button = {
  [BUTTON_ID.confirm]: {
    label: '✅ Confirm',
    style: ButtonStyle.SUCCESS,
    onClick: async ({ chat, event }: AppCtx) => {
      await chat.editMessage({
        message_id_to_edit: event['messageID'] as string,
        message: '✅ Confirmed!',
        button: [],
      })
    },
  },
  [BUTTON_ID.cancel]: {
    label: '❌ Cancel',
    style: ButtonStyle.DANGER,
    onClick: async ({ chat, event }: AppCtx) => {
      await chat.editMessage({
        message_id_to_edit: event['messageID'] as string,
        message: '❌ Cancelled.',
        button: [],
      })
    },
  },
}

export const onCommand = async ({ chat, button: btn }: AppCtx) => {
  const confirmId = btn.generateID({ id: BUTTON_ID.confirm })
  const cancelId  = btn.generateID({ id: BUTTON_ID.cancel })
  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: '**Are you sure?**',
    button: [confirmId, cancelId],
  })
}
```

Every button is a self-contained object — its `label`, `style`, and `onClick` live in the same file as `onCommand`. On Discord: an `ActionRowBuilder` with `deferUpdate()` called by the adapter before `onClick` fires. On Telegram: an `inline_keyboard` with `answerCbQuery()` handled transparently. On Messenger: a numbered text menu routed to the matching `onClick`. On Facebook Page: a Button Template. Your command code is identical for all four outcomes.

### Why This Matters

When every handler has a single, bounded responsibility:

- **Reading is linear.** Follow one function to understand one outcome — no `switch` to navigate.
- **Changes are local.** Modifying `awaiting_age` cannot introduce a regression in `awaiting_name`.
- **New features are additive.** A new reply step or a new button is a new key; existing logic is untouched.
- **Bugs are isolated.** A failure in one `onClick` does not affect other buttons in the same command.

This is the Single Responsibility Principle applied consistently at every level of the bot API: each state has one function, each button has one object, each function has one job.

### Predictable Middleware Pipeline

Most chatbot frameworks wire validation logic directly inside each dispatcher or command handler. Permission checks, cooldown guards, and ban enforcement end up scattered across individual command files — or worse, embedded inline inside the routing function that also decides _which_ handler to call. When something fails, you have to chase through multiple dispatchers to find out which guard ran, in what order, and why it blocked execution.

**Cat-Bot's middleware pipeline is inspired by Express.js.** Guards are registered once as discrete middleware functions and run in a declared, auditable order before any dispatcher or command handler executes.

```ts
// Cat-Bot middleware/index.ts — registered once at boot; applies to every command automatically
use.onCommand([
  enforceNotBanned, // ← first: banned actors never reach any further check
  enforcePermission, // ← second: unauthorized users are rejected before cooldown is consumed
  enforceCooldown, // ← third: rate-limited after auth; options parsing never runs on blocked commands
  validateCommandOptions, // ← fourth: parse and validate typed options only for commands that will actually run
]);
```

Each function in the chain calls `next()` to continue or returns early to halt — exactly like Express middleware. The order is declared in one place and applies uniformly to every command:

```ts
// src/engine/middleware/on-command.middleware.ts
export const enforceNotBanned: MiddlewareFn<OnCommandCtx> = async (
  ctx,
  next,
) => {
  const banned = await isUserBanned(
    sessionUserId,
    platform,
    sessionId,
    senderID,
  );
  if (banned) {
    await ctx.chat.replyMessage({ message: "you are unable to use bot" });
    return; // ← omitting next() halts the chain; the command never executes
  }
  await next();
};
```

Command modules never implement guards. They receive control only after the full pipeline has passed — ban cleared, permission granted, cooldown window open, options validated. Adding a new cross-cutting concern (audit logging, feature flags, IP filtering) means registering one middleware function, not editing every command file.

**The execution contract is always visible at the registration site:**

```
onCommand:    enforceNotBanned → enforcePermission → enforceCooldown
              → validateCommandOptions → [your middlewares] → onCommand handler

onChat:       chatPassthrough → chatLogThread → [your middlewares] → onChat fan-out

onReply:      replyStateValidation → [your middlewares] → onReply handler

onReact:      reactStateValidation → [your middlewares] → onReact handler

onButtonClick: enforceButtonScope → [your middlewares] → button.onClick handler
```

When a command does not execute, the failure belongs to exactly one middleware. You do not grep through dispatcher files — you look at the registered chain and the function that did not call `next()`. The flow is linear, the order is explicit, and the extension point is always `use.onCommand([yourMiddleware])` in a single file.

---

## Platform API Comparison: Native vs Unified

Every platform SDK solves the same problems differently, forcing bot authors to maintain four separate mental models simultaneously. discord.js, Telegraf, fca-unofficial, and the Facebook Graph API are each well-designed for their own domain. Cat-Bot does not replace them — it sits on top of all four, absorbing every per-platform difference so your feature code never needs to.

This section shows, side-by-side, how each native library approaches common bot tasks and how Cat-Bot's unified surface eliminates that per-platform boilerplate. The goal is to make the architectural choices concrete: not "why abstraction is good in theory," but "here is the code you no longer have to write."

---

### Sending a Text Message

**discord.js v14** has two distinct code paths depending on whether the trigger is a slash command (interaction) or a text-prefix message. Slash interactions must be acknowledged within 3 seconds or Discord renders "interaction failed" for the user. The methods differ between the two paths:

```js
// discord.js v14 — text-prefix message
await message.channel.send('Hello, world!')

// discord.js v14 — slash command (must deferReply within 3 seconds)
await interaction.deferReply()
// ... async work ...
await interaction.editReply('Hello, world!')
// Subsequent sends after the first reply use followUp
await interaction.followUp('Here is more information.')
```

**Telegraf v4** provides `ctx.reply()` as a shortcut for same-chat replies, but sending to a different destination (admin DM, relay channel) requires the explicit `ctx.telegram.sendMessage(chatId, text)` form. The two paths have different method names and argument shapes:

```js
// Telegraf v4 — same-chat reply
await ctx.reply('Hello, world!')

// Telegraf v4 — send to a different chat (e.g. admin DM)
await ctx.telegram.sendMessage(adminChatId, 'You have a new message.')
```

**fca-unofficial** is callback-based with positional arguments. The text field is `body`, not `text` or `message`. Every send is asynchronous through a Node.js-style `(err, info)` callback:

```js
// fca-unofficial
api.sendMessage({ body: 'Hello, world!' }, threadID, (err, info) => {
  if (err) return console.error(err)
  const sentMessageID = info.messageID
})
```

**Facebook Page Graph API** requires a raw HTTP POST with a structured `recipient` + `message` JSON body. There is no SDK; every operation is a manual HTTP call:

```js
// Facebook Page — raw Graph API via axios
await axios.post(
  `https://graph.facebook.com/v22.0/me/messages?access_token=${PAGE_TOKEN}`,
  { recipient: { id: psid }, message: { text: 'Hello, world!' } }
)
```

**Cat-Bot — all four platforms:**

```ts
await chat.replyMessage({
  style: MessageStyle.MARKDOWN,
  message: '**Hello, world!**',
})
```

One call. The adapter handles the deferral window on Discord, the `ctx.reply` routing on Telegram, the `api.sendMessage` callback on Messenger, and the Graph API POST on Facebook Page.

---

### Sending a File Attachment

**discord.js v14** uses `AttachmentBuilder` for binary data. The send call differs between slash interactions and text-prefix commands — two different method chains for the same outcome:

```js
// discord.js v14
const { AttachmentBuilder } = require('discord.js')
const file = new AttachmentBuilder(imageBuffer, { name: 'photo.jpg' })

// Text-prefix path
await message.channel.send({ content: 'Here is your image:', files: [file] })
// Slash interaction path (after deferReply)
await interaction.editReply({ content: 'Here is your image:', files: [file] })
```

**Telegraf v4** uses separate methods per media type. `replyWithPhoto`, `replyWithDocument`, `replyWithAudio` — the caller must know the media type at the call site. URL, Buffer, and Readable stream each have slightly different argument shapes:

```js
// Telegraf v4 — must select the correct method per media type
await ctx.replyWithPhoto({ source: imageBuffer }, { caption: 'Here is your image.' })
// Photo from URL — different argument shape from buffer
await ctx.replyWithPhoto('https://example.com/image.jpg')
// Generic file upload — different method name entirely
await ctx.replyWithDocument({ source: pdfBuffer, filename: 'report.pdf' })
```

**fca-unofficial** requires a Readable stream with a `.path` property set. MIME type is inferred from the `.path` file extension — Buffers must be manually wrapped into a named `PassThrough` stream:

```js
// fca-unofficial — Buffer must be wrapped; .path drives MIME detection
const { Readable } = require('stream')
const stream = Readable.from(imageBuffer)
stream.path = 'photo.jpg'  // must be set — fca reads this for Content-Type

api.sendMessage(
  { body: 'Here is your image:', attachment: stream },
  threadID,
  callback
)
```

**Facebook Page Graph API** has two entirely separate code paths: a `FormData` multipart upload for binary content, and a different JSON payload for URL-based assets:

```js
// Facebook Page — URL reference (Graph API fetches server-side)
await axios.post(`${GRAPH}?access_token=${TOKEN}`, {
  recipient: { id: psid },
  message: { attachment: { type: 'image', payload: { url: imageUrl } } }
})

// Facebook Page — binary upload (multipart FormData — different code path entirely)
const form = new FormData()
form.append('recipient', JSON.stringify({ id: psid }))
form.append('message', JSON.stringify({ attachment: { type: 'image', payload: {} } }))
form.append('filedata', imageBuffer, { filename: 'photo.jpg', contentType: 'image/jpeg' })
await axios.post(`${GRAPH}?access_token=${TOKEN}`, form, { headers: form.getHeaders() })
```

**Cat-Bot — all four platforms:**

```ts
// Buffer or Readable stream
await chat.replyMessage({
  message: 'Here is your image:',
  attachment: [{ name: 'photo.jpg', stream: imageBuffer }],
})

// URL-based (platform adapter handles server-side fetch vs local download)
await chat.replyMessage({
  message: 'Here is your image:',
  attachment_url: [{ name: 'photo.jpg', url: 'https://example.com/image.jpg' }],
})
```

The platform wrapper selects `AttachmentBuilder` on Discord, chooses `replyWithPhoto`/`replyWithDocument`/`replyWithAudio` on Telegram by filename extension, wraps the buffer as a named stream on Messenger, and dispatches to multipart upload or URL-reference on Facebook Page. You never choose a method based on media type.

---

### Interactive Buttons

This is where per-platform divergence becomes most costly. Each platform has a completely different button model, different routing mechanism, and different acknowledgment requirements.

**discord.js v14** — Buttons require `ActionRowBuilder` and `ButtonBuilder`. The click handler is a global `interactionCreate` listener registered separately on the Client, and must acknowledge within 3 seconds or Discord shows "interaction failed." Button IDs are plain global strings — nothing prevents an unrelated user from matching a `customId`:

```js
// discord.js v14 — build and send buttons
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js')

const row = new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setCustomId('confirm:12345')  // embed userId manually for ownership check
    .setLabel('✅ Confirm')
    .setStyle(ButtonStyle.Success),
  new ButtonBuilder()
    .setCustomId('cancel:12345')
    .setLabel('❌ Cancel')
    .setStyle(ButtonStyle.Danger)
)
await message.channel.send({ content: 'Are you sure?', components: [row] })

// discord.js — handle click (registered separately on the Client globally)
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return
  await interaction.deferUpdate()  // MUST call within 3 seconds
  const [action, userId] = interaction.customId.split(':')
  if (interaction.user.id !== userId) {
    return interaction.followUp({ content: 'Not your button!', ephemeral: true })
  }
  if (action === 'confirm') {
    await interaction.editReply({ content: '✅ Confirmed!', components: [] })
  }
})
```

**Telegraf v4** — Inline keyboard buttons carry `callback_data` (max 64 bytes). Clicks arrive via `bot.on('callback_query')` registered separately from the command. `ctx.answerCbQuery()` must be called to dismiss the loading spinner:

```js
// Telegraf v4 — send inline keyboard
await ctx.reply('Are you sure?', {
  reply_markup: {
    inline_keyboard: [[
      { text: '✅ Confirm', callback_data: `confirm:${ctx.from.id}` },
      { text: '❌ Cancel',  callback_data: `cancel:${ctx.from.id}`  }
    ]]
  }
})

// Telegraf — handle click (registered separately)
bot.on('callback_query', async ctx => {
  await ctx.answerCbQuery()  // dismiss the loading spinner
  const [action, userId] = ctx.callbackQuery.data.split(':')
  if (ctx.from.id.toString() !== userId) {
    return ctx.answerCbQuery('Not your button!', { show_alert: true })
  }
  if (action === 'confirm') await ctx.editMessageText('✅ Confirmed!')
})
```

**fca-unofficial** — The Messenger MQTT protocol has no native button component. Buttons must be emulated with numbered text menus. Conversation state is stored in a global mutable array that all concurrent commands share:

```js
// fca-unofficial — "buttons" via numbered text menu (no native buttons exist)
api.sendMessage(
  'Are you sure?\n1. ✅ Confirm\n2. ❌ Cancel',
  threadID,
  (err, info) => {
    if (err) return
    global.client.handleReply.push({
      name: 'myCommand', messageID: info.messageID,
      author: event.senderID, type: 'awaiting_confirm',
    })
  }
)

module.exports.handleReply = async ({ event, handleReply, api }) => {
  if (handleReply.author !== event.senderID) return  // manual ownership check
  const idx = global.client.handleReply.findIndex(r => r.messageID === handleReply.messageID)
  global.client.handleReply.splice(idx, 1)  // manual cleanup — races with concurrent handlers
  const choice = event.body.trim()
  if (choice === '1') api.sendMessage('✅ Confirmed!', event.threadID, () => {})
  else api.sendMessage('❌ Cancelled.', event.threadID, () => {})
}
```

**Facebook Page Graph API** — The Button Template is the only interactive construct, limited to 3 buttons per message with titles capped at 20 characters. Clicks arrive as `postback` webhook events routed by string matching:

```js
// Facebook Page — Button Template (max 3 buttons, title ≤20 chars)
await axios.post(`${GRAPH}?access_token=${TOKEN}`, {
  recipient: { id: psid },
  message: {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'button',
        text: 'Are you sure?',
        buttons: [
          { type: 'postback', title: '✅ Confirm', payload: `CONFIRM_${psid}` },
          { type: 'postback', title: '❌ Cancel',  payload: `CANCEL_${psid}` },
        ]
      }
    }
  }
})

// Facebook Page — postback handler (in the Express webhook, completely separate file)
app.post('/webhook', (req, res) => {
  res.sendStatus(200)  // must respond within 20 seconds
  req.body.entry.forEach(entry =>
    entry.messaging.forEach(async event => {
      if (!event.postback) return
      const [action, userId] = event.postback.payload.split('_')
      if (event.sender.id !== userId) return  // manual ownership check
      if (action === 'CONFIRM') {
        await axios.post(`${GRAPH}?access_token=${TOKEN}`, {
          recipient: { id: event.sender.id },
          message: { text: '✅ Confirmed!' }
        })
      }
    })
  )
})
```

**Cat-Bot — all four platforms:**

```ts
const BUTTON_ID = {
  confirm: 'confirm',
  cancel: 'cancel'
}

// Button handlers and the command that sends them live in the same file
export const button = {
  [BUTTON_ID.confirm]: {
    label: '✅ Confirm',
    style: ButtonStyle.SUCCESS,
    // Called after the adapter has already handled the acknowledgment window
    onClick: async ({ chat, event }: AppCtx) => {
      await chat.editMessage({
        message_id_to_edit: event['messageID'] as string,
        style: MessageStyle.MARKDOWN,
        message: '✅ **Confirmed!**',
        button: [],  // clear buttons after the action
      })
    },
  },
  [BUTTON_ID.cancel]: {
    label: '❌ Cancel',
    style: ButtonStyle.DANGER,
    onClick: async ({ chat, event }: AppCtx) => {
      await chat.editMessage({
        message_id_to_edit: event['messageID'] as string,
        message: '❌ Cancelled.',
        button: [],
      })
    },
  },
}

export const onCommand = async ({ chat, button: btn }: AppCtx) => {
  // Private scope by default — only the invoking user can click
  const confirmId = btn.generateID({ id: BUTTON_ID.confirm })
  const cancelId  = btn.generateID({ id: BUTTON_ID.cancel })

  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: '**Are you sure?**',
    button: [confirmId, cancelId],
  })
}
```

On Discord: becomes an `ActionRowBuilder` with two `ButtonBuilder` entries; `deferUpdate()` is called by the adapter before `onClick` receives control. On Telegram: becomes an `inline_keyboard`; `answerCbQuery()` is handled before `onClick` fires. On Messenger: `"1. ✅ Confirm\n2. ❌ Cancel"` is appended to the message body, and the numbered reply is transparently routed to the matching `onClick` handler. On Facebook Page: becomes a Button Template with two postback buttons. Your command code is identical for all four outcomes.

---

### Conversation Flows (Waiting for a Reply)

Chaining a multi-step conversation — ask a question, wait for the user to quote-reply to that specific message, ask another, complete — requires very different approaches per platform.

**discord.js v14** — `createMessageCollector()` with a filter function and a timeout. Steps are nested callbacks, and timeout handling must be replicated at every step:

```js
// discord.js — two-step conversation flow
await message.reply('What is your name?')

const filter = m => m.author.id === message.author.id
const nameCollector = message.channel.createMessageCollector({ filter, max: 1, time: 30_000 })
nameCollector.on('collect', async nameMsg => {
  const name = nameMsg.content
  const nextMsg = await nameMsg.reply('How old are you?')

  const ageCollector = nextMsg.channel.createMessageCollector({ filter, max: 1, time: 30_000 })
  ageCollector.on('collect', async ageMsg => {
    await ageMsg.reply(`Done! ${name}, ${ageMsg.content}`)
  })
  ageCollector.on('end', (_, reason) => {
    if (reason === 'time') nextMsg.reply('Timed out.')
  })
})
nameCollector.on('end', (_, reason) => {
  if (reason === 'time') message.reply('Timed out.')
})
```

**Telegraf v4** — `Scenes.WizardScene` with `session()` middleware. A separate concept to learn and register as middleware. Wizard state is Telegram-only; there is no equivalent abstraction that carries to other platforms:

```js
// Telegraf — two-step conversation via WizardScene
const { Scenes, session } = require('telegraf')

const wizard = new Scenes.WizardScene('my-wizard',
  async ctx => { await ctx.reply('What is your name?'); return ctx.wizard.next() },
  async ctx => {
    ctx.wizard.state.name = ctx.message.text
    await ctx.reply('How old are you?')
    return ctx.wizard.next()
  },
  async ctx => {
    await ctx.reply(`Done! ${ctx.wizard.state.name}, ${ctx.message.text}`)
    return ctx.scene.leave()
  }
)
const stage = new Scenes.Stage([wizard])
bot.use(session())           // must register — stores wizard state between updates
bot.use(stage.middleware())  // must register — activates scene routing
bot.command('register', ctx => ctx.scene.enter('my-wizard'))
```

**fca-unofficial** — Global `handleReply` array with manual push, manual cleanup via `splice`, and manual ownership check. Two simultaneous users running the same command share the same global array, creating a real race condition:

```js
// fca-unofficial — two-step conversation via global array
api.sendMessage('What is your name?', threadID, (err, info) => {
  if (err) return
  global.client.handleReply.push({
    name: 'myCommand', messageID: info.messageID,
    author: event.senderID, type: 'awaiting_name', data: {}
  })
})

module.exports.handleReply = async ({ event, handleReply, api }) => {
  if (handleReply.author !== event.senderID) return  // manual ownership check
  const idx = global.client.handleReply.findIndex(r => r.messageID === handleReply.messageID)
  global.client.handleReply.splice(idx, 1)  // manual cleanup — races with concurrent pushes

  if (handleReply.type === 'awaiting_name') {
    handleReply.data.name = event.body
    api.sendMessage('How old are you?', event.threadID, (err, info) => {
      global.client.handleReply.push({
        name: 'myCommand', messageID: info.messageID,
        author: event.senderID, type: 'awaiting_age', data: handleReply.data
      })
    })
  } else if (handleReply.type === 'awaiting_age') {
    api.sendMessage(
      `Done! ${handleReply.data.name}, ${event.body}`,
      event.threadID, () => {}
    )
  }
}
```

**Cat-Bot — all four platforms:**

```ts
const STATE = { awaiting_name: 'awaiting_name', awaiting_age: 'awaiting_age' }

export const onReply = {
  [STATE.awaiting_name]: async ({ chat, event, session, state }: AppCtx) => {
    const name = event['message'] as string
    const msgId = await chat.replyMessage({
      style: MessageStyle.MARKDOWN, message: '**How old are you?**',
    })
    state.delete(session.id)  // remove the current step before creating the next
    if (msgId) {
      state.create({
        id: state.generateID({ id: String(msgId) }),
        state: STATE.awaiting_age,
        context: { name },  // carry data forward in the context object
      })
    }
  },
  [STATE.awaiting_age]: async ({ chat, event, session, state }: AppCtx) => {
    const { name } = session.context as { name: string }
    state.delete(session.id)
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `Done! **${name}**, ${event['message'] as string}`,
    })
  },
}

export const onCommand = async ({ chat, state }: AppCtx) => {
  const msgId = await chat.replyMessage({
    style: MessageStyle.MARKDOWN, message: '**What is your name?**',
  })
  if (msgId) {
    state.create({
      id: state.generateID({ id: String(msgId) }),
      state: STATE.awaiting_name,
      context: {},
    })
  }
}
```

No nested callbacks. No wizard middleware to register. No global array to splice. State is scoped to `messageID:senderID` automatically — two users running this command simultaneously each have a completely isolated conversation with zero interference.

---

### Dynamically Updating Button Labels

Updating the text on a button that is already rendered in a message forces each native SDK to
rebuild the entire component tree — there is no in-place label mutation API in either discord.js
or Telegraf.

**discord.js v14** — components received from the API are frozen by design. The v14 migration
guide documents [`ButtonBuilder.from()`](https://discordjs.guide/additional-info/changes-in-v14.html)
as the canonical way to clone an existing component into a mutable builder, but you must still
reconstruct a fresh `ActionRowBuilder` around the updated button and call `interaction.editReply()`.
There is no "change label" method on a live button:

```js
// discord.js v14 — update a button label inside a button-click handler
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return
  await interaction.deferUpdate()           // must acknowledge within 3 seconds

  // API-received components are immutable — clone into a mutable builder first
  const original = interaction.message.components[0].components[0]
  const count = parseInt(original.label.match(/\d+/)?.[0] ?? '0') + 1

  const updatedButton = ButtonBuilder.from(original).setLabel(`🔄 Refresh (${count})`)
  const updatedRow    = new ActionRowBuilder().addComponents(updatedButton)

  // Must rebuild the entire ActionRow — no direct label setter on a live button
  await interaction.editReply({ components: [updatedRow] })
})
```

**Telegraf v4** — there is no mutable button object. To change a label you call
`ctx.editMessageText()` or `ctx.editMessageReplyMarkup()` and pass a completely reconstructed
`inline_keyboard` array. Every button in every row must be redeclared, even when only one label
is changing:

```js
// Telegraf v4 — update a button label inside a callback_query handler
bot.action('refresh', async ctx => {
  await ctx.answerCbQuery()                 // dismiss loading spinner — required

  // No direct access to button state — must parse count from the rendered label string
  const currentLabel = ctx.callbackQuery.message.reply_markup.inline_keyboard[0][0].text
  const count = parseInt(currentLabel.match(/\d+/)?.[0] ?? '0') + 1

  // Must redeclare the entire keyboard just to change one button label
  await ctx.editMessageText(ctx.callbackQuery.message.text, {
    reply_markup: {
      inline_keyboard: [[
        { text: `🔄 Refresh (${count})`, callback_data: 'refresh' }
      ]]
    }
  })
})
```

**Cat-Bot — all four platforms:**

```ts
const BUTTON_ID = { refresh: 'refresh' } as const

export const button = {
  [BUTTON_ID.refresh]: {
    label: '🔄 Refresh (1)',
    style: ButtonStyle.SECONDARY,
    onClick: async ({ chat, startTime, event, button, session }: AppCtx) => {
      const count = (session.context.count as number) + 1
      // One call — the registry update is all that is needed; the platform adapter
      // rebuilds the native component automatically on the next editMessage call.
      button.update({ id: session.id, label: `🔄 Refresh (${count})` })
      button.createContext({ id: session.id, context: { count } })
      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: event['messageID'] as string,
        message: `🏓 Pong! Latency: \`${Date.now() - startTime}ms\``,
        button: [session.id],
      })
    },
  },
}
```

No `ButtonBuilder.from()`. No `ActionRowBuilder` reconstruction. No `answerCbQuery()` call. No
regex-parsing of the current label from a message payload. `button.update()` stores the new label
in the button registry; `chat.editMessage()` tells the adapter to re-render — it reads the
registry and builds the correct native component for Discord, Telegram, Messenger, or Facebook
Page automatically.

---

### What Cat-Bot Solves — Problem by Problem

**The 3-Second Acknowledgment Window.** Discord's slash commands and button interactions must be acknowledged within 3 seconds or the user sees "interaction failed." Telegraf's callback queries must be answered within ~10 seconds to dismiss the loading spinner. In Cat-Bot, the platform adapter calls `deferReply()` or `deferUpdate()` immediately when the interaction arrives — before dispatching to your handler. Your `onCommand` and `button.onClick` functions receive control only after the acknowledgment has already been sent. You never race a timing window in your command code.

**The Global State Race Condition.** `global.client.handleReply` is a mutable array shared across every active conversation. When two users run the same command simultaneously, their state objects coexist in the same array. A `splice(idx, 1)` in one handler races with a `push` in another, producing entries that point to the wrong conversation context. Cat-Bot's `state.create()` stores each entry under a composite key: `${messageID}:${senderID}` for private flows, `${messageID}:${threadID}` for public flows. Two simultaneous conversations produce two distinct keys. There is no array to splice and no possibility of one user's flow advancing another's.

**The Platform Branching Problem.** Any feature that must run on more than one platform requires branching in native code — three separate implementation paths maintained in sync forever. Cat-Bot's `UnifiedApi` contract eliminates this. `chat.replyMessage({ button: [...] })` produces an `ActionRowBuilder` on Discord, an `inline_keyboard` on Telegram, a numbered text menu on Messenger (handled transparently by `createChatContext`), and a Button Template on Facebook Page. The feature is implemented once and runs correctly on all four platforms.

**The Button Ownership Problem.** Discord's `customId` is a global string. Any user who intercepts the interaction payload can trigger a button they did not generate. Telegraf's `callback_data` has the same property. Cat-Bot's `button.generateID({ id: 'confirm' })` embeds the invoking user's ID in the generated key. The `enforceButtonScope` middleware rejects clicks from users who did not generate the button. Passing `{ public: true }` explicitly opts into thread-scoped buttons when you want group interaction. The default is always private.

**The Handler Colocation Problem.** In every native SDK, the code that sends a button and the code that handles its click live in different places. A `client.on('interactionCreate')` in discord.js, a `bot.on('callback_query')` in Telegraf, a `handleReply` export in fca — all are global registrations that route by string matching. Reading the command that sends a button tells you nothing about what happens when it is clicked. In Cat-Bot, `export const button` lives in the same file as `export const onCommand`. A developer reading the file sees the complete behavior: what is sent, what each button does, and how the conversation ends.

**The Architectural Insight.** The breakthrough in Cat-Bot's design is that the bot problem and the platform problem are separate concerns. The bot problem is: how do I model a conversation, route commands, manage state, and respond to the user? The platform problem is: how do I translate that model into the specific API calls, acknowledgment windows, and data shapes that Discord, Telegram, or Facebook require? Every native SDK conflates these two — you write bot logic in the SDK's own idiom, and the logic is inseparable from the transport mechanism. Cat-Bot separates them cleanly:

```
Your command module (bot logic — onCommand, onReply, button.onClick)
      │
      ▼
UnifiedApi + context factories (shared vocabulary — chat, state, button, thread, user)
      │
      ▼
Platform adapter (transport translation — the code you no longer write)
      │
      ▼
discord.js v14  /  Telegraf v4  /  fca-unofficial  /  Facebook Graph API
```

Your command module never imports `discord.js`. Your button handler never calls `ctx.answerCbQuery()`. Your reply handler never pushes to a global array. The adapter layer absorbs every platform difference and presents a uniform surface to your code.

---

## Demo

### Admin Demo

[▶ Watch Admin Demo](https://drive.google.com/file/d/1i5Eqv3_t_DfvAPLRFE1EMSBYbERKhRKD/view?usp=sharing)

### User Demo

[▶ Watch User Demo](https://drive.google.com/file/d/1ALlApNwCwm06_SPqk-NRamr5ylguHt0W/view?usp=sharing)

---

## Screenshots

### User Portal

<table>
  <tr>
    <td align="center"><strong>Home</strong></td>
    <td align="center"><strong>Login</strong></td>
    <td align="center"><strong>Sign Up</strong></td>
  </tr>
  <tr>
    <td><img src="assets/users/home.png" alt="Home Page" /></td>
    <td><img src="assets/users/login.png" alt="Login" /></td>
    <td><img src="assets/users/sign-up.png" alt="Sign Up" /></td>
  </tr>
</table>

<table>
  <tr>
    <td align="center"><strong>Bot Manager</strong></td>
    <td align="center"><strong>User Settings</strong></td>
  </tr>
  <tr>
    <td><img src="assets/users/dashboard.png" alt="Dashboard" /></td>
    <td><img src="assets/users/dashboard-settings.png" alt="Settings" /></td>
  </tr>
</table>

**Create New Bot — 3-Step Wizard**

<table>
  <tr>
    <td align="center"><strong>Step 1 — Identity</strong></td>
    <td align="center"><strong>Step 2 — Platform & Credentials</strong></td>
  </tr>
  <tr>
    <td><img src="assets/users/create-new-bot-step-1.png" alt="Create Bot Step 1" /></td>
    <td><img src="assets/users/create-new-bot-step-2-select-platform.png" alt="Create Bot Step 2" /></td>
  </tr>
  <tr>
    <td align="center"><strong>Step 2 — Verified</strong></td>
    <td align="center"><strong>Step 3 — Review</strong></td>
  </tr>
  <tr>
    <td><img src="assets/users/create-new-bot-step-2-verified.png" alt="Credentials Verified" /></td>
    <td><img src="assets/users/create-new-bot-step-3.png" alt="Create Bot Step 3" /></td>
  </tr>
</table>

**Bot Detail Tabs**

<table>
  <tr>
    <td align="center"><strong>Live Console</strong></td>
    <td align="center"><strong>Commands</strong></td>
  </tr>
  <tr>
    <td><img src="assets/users/dashboard-bot-console.png" alt="Bot Console" /></td>
    <td><img src="assets/users/dashboard-bot-commands.png" alt="Bot Commands" /></td>
  </tr>
  <tr>
    <td align="center"><strong>Event Handlers</strong></td>
    <td align="center"><strong>Bot Settings</strong></td>
  </tr>
  <tr>
    <td><img src="assets/users/dashboard-bot-events.png" alt="Bot Events" /></td>
    <td><img src="assets/users/dashboard-bot-settings.png" alt="Bot Settings" /></td>
  </tr>
</table>

### Admin Portal

<table>
  <tr>
    <td align="center"><strong>Admin Login</strong></td>
    <td align="center"><strong>Admin Dashboard</strong></td>
  </tr>
  <tr>
    <td><img src="assets/admin/login.png" alt="Admin Login" /></td>
    <td><img src="assets/admin/dashboard.png" alt="Admin Dashboard" /></td>
  </tr>
  <tr>
    <td align="center"><strong>User Management</strong></td>
    <td align="center"><strong>Bot Sessions (All Users)</strong></td>
  </tr>
  <tr>
    <td><img src="assets/admin/dashboard-users.png" alt="Admin Users" /></td>
    <td><img src="assets/admin/dashboard-bot-sessions.png" alt="Admin Bot Sessions" /></td>
  </tr>
  <tr>
    <td align="center"><strong>Admin Settings</strong></td>
  </tr>
  <tr>
    <td><img src="assets/admin/dashboard-settings.png" alt="Admin Settings" /></td>
  </tr>
</table>

### Platform Chat Examples

#### `ping` — Across All Platforms

<table>
  <tr>
    <td align="center"><strong>Discord</strong></td>
    <td align="center"><strong>Telegram</strong></td>
  </tr>
  <tr>
    <td><img src="assets/discord.jpg" alt="Ping on Discord" /></td>
    <td><img src="assets/telegram.jpg" alt="Ping on Telegram" /></td>
  </tr>
  <tr>
    <td align="center"><strong>Facebook Page</strong></td>
    <td align="center"><strong>Facebook Messenger</strong></td>
  </tr>
  <tr>
    <td><img src="assets/fb-page.jpg" alt="Ping on Facebook Page" /></td>
    <td><img src="assets/fb-messenger.jpg" alt="Ping on Facebook Messenger" /></td>
  </tr>
</table>

#### AI Agent

<table>
  <tr>
    <td><img src="assets/agent.jpg" alt="AI Agent running daily and work commands" width="50%" /></td>
  </tr>
</table>

---

## Features

| Feature                   | Description                                                                                                                                                                                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Multi-platform**        | One command module runs on Discord, Telegram, Facebook Page, and Facebook Messenger — no per-platform branches in your handler code                                                                                                                                                                        |
| **Multi-instance**        | Run any number of independent bot sessions concurrently, each with its own credentials, prefix, and admin list                                                                                                                                                                                             |
| **Unified Dashboard**     | React 19 SPA — monitor live logs, toggle commands on/off per session, update credentials, start/stop/restart bots                                                                                                                                                                                          |
| **Conversation State**    | Scoped `onReply` and `onReact` flows replace the global-array anti-pattern; concurrent users never interfere with each other's flow                                                                                                                                                                        |
| **Interactive Buttons**   | `export const button` in your command file — Discord gets `ActionRowBuilder`, Telegram gets inline keyboards, Messenger gets a numbered text menu, Facebook Page gets a Button Template                                                                                                                    |
| **Admin Portal**          | Independent admin dashboard with separate session cookies — ban users, halt their sessions, manage system admins                                                                                                                                                                                           |
| **Pluggable Database**    | Four interchangeable backends — JSON (zero dependencies), SQLite via Prisma, MongoDB, and Neon PostgreSQL — selected at runtime with a single `DATABASE_TYPE` environment variable; 12 bidirectional migration scripts cover every adapter pair so switching storage backends never means re-entering data |
| **Role-Based Access**     | Five role levels (`ANYONE`, `THREAD_ADMIN`, `BOT_ADMIN`, `PREMIUM`, `SYSTEM_ADMIN`) enforced by middleware before `onCommand` runs                                                                                                                                                                         |
| **Cooldown & Ban System** | Per-user cooldown and per-user/per-thread bans enforced by the middleware pipeline                                                                                                                                                                                                                         |
| **Slash Command Sync**    | Discord and Telegram slash menus stay current with a SHA-based idempotency gate — no redundant REST calls on restart                                                                                                                                                                                       |
| **Economy API**           | Built-in `currencies` context (`getMoney`, `increaseMoney`, `decreaseMoney`) backed by the active database adapter                                                                                                                                                                                         |
| **AI Agent**              | Groq-powered ReAct agent with `execute_command`, `test_command`, and `help` tools accessible from chat                                                                                                                                                                                                     |
| **Live Log Streaming**    | Socket.IO pushes bot console output to the dashboard in real time with a 100-entry sliding window buffer                                                                                                                                                                                                   |
| **LRU Cache Layer**       | A 2,000-entry LRU cache sits between the bot engine and every database adapter — permission checks, cooldown lookups, and credential reads are served from memory on repeated access; all writes are write-through so command handlers never observe stale data                                            |

---

## Architecture

Cat-Bot is an ESM TypeScript monorepo with three independent packages.

```
Cat-Bot/
├── packages/
│   ├── cat-bot/          — Bot engine + Express REST API + Socket.IO
│   │   ├── src/engine/   — Platform adapters, middleware pipeline, controller/dispatcher layer
│   │   └── src/server/   — Dashboard API, better-auth, Facebook Page webhook receiver
│   ├── database/         — Raw database adapters; selected by DATABASE_TYPE env var
│   │   └── adapters/
│   │       ├── json/            — Flat JSON file; zero runtime dependencies
│   │       ├── prisma-sqlite/   — Prisma v7 + better-sqlite3 (default)
│   │       ├── mongodb/         — MongoDB driver adapter
│   │       └── neondb/          — Neon PostgreSQL (node-postgres)
│   └── web/              — Vite + React 19 management dashboard SPA
└── packages/cat-bot/src/app/
    ├── commands/          — Your command modules (one file each)
    └── events/            — Your event handler modules
```

Every incoming message from every platform follows this fixed path:

```
Platform Transport  →  Middleware Chain       →  Controller Dispatch
  (Discord /            enforceNotBanned          onCommand / onReply /
   Telegram /           enforcePermission          onReact / onEvent /
   Messenger /          enforceCooldown            button.onClick
   Facebook Page)       chatPassthrough
```

The `UnifiedApi` abstract class sits between your command code and the platform SDKs. Calling `chat.replyMessage()` triggers `editReply()` on Discord, `ctx.reply()` on Telegram, `api.sendMessage()` on Messenger, and a Graph API POST on Facebook Page — all from the same call site.

For deep-dive architecture documentation covering each platform adapter, the middleware pipeline, the database access pattern, and the web dashboard: see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Production Setup

For production deployments use **NeonDB** (serverless PostgreSQL) or **MongoDB** for durable persistence. Both support the full feature set.

> **⚠️ CRITICAL: Remove `VITE_URL` in Production**
> Ensure `VITE_URL` is completely removed from your environment variables when deploying to platforms like Render or Railway. Leaving it set (e.g., to `http://localhost:5173`) will cause "trusted origin" errors in the authentication layer (`better-auth`). In production, same-origin is inherently trusted.

### Option A — NeonDB (Recommended)

NeonDB runs schema initialization automatically at boot via the `dbReady` promise — no manual migration step.

1. Create a project at [console.neon.tech](https://console.neon.tech) and copy the connection string.

2. Set environment variables:

```env
DATABASE_TYPE=neondb
NEON_DATABASE_URL=postgres://username:password@ep-xxxx.us-east-2.aws.neon.tech/neondb?sslmode=require

BETTER_AUTH_SECRET=your_production_secret
BETTER_AUTH_URL=https://your-domain.com
ENCRYPTION_KEY=your_64_hex_char_key_here

LOG_LEVEL=warn
```

3. Seed the admin account:

```bash
npm run seed:admin
```

4. Build the project:

```bash
npm install && npm run build:all
```

5. Start the production server:

```bash
npm start
```

### Option B — MongoDB

MongoDB Atlas M0 (free tier) works without changes.

```env
DATABASE_TYPE=mongodb
MONGODB_URI=mongodb+srv://username:<PASSWORD>@cluster0.mongodb.net?retryWrites=true&w=majority
MONGO_PASSWORD=your_mongodb_password
MONGO_DATABASE_NAME=catbot
```

Then seed, build, and start as above.

### Email Verification — Gmail SMTP (Recommended for Production)

When both Gmail variables are set, Cat-Bot sends a verification link to every new user on sign-up. Users must click the link before they can sign in. If either variable is missing, sign-ups succeed but verification emails are silently skipped (a warning is logged per attempt).

**Google App Password setup:**

1. Enable 2-Step Verification: [myaccount.google.com → Security → 2-Step Verification](https://myaccount.google.com/security)
2. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
3. Name it "Cat-Bot" and click **Create**
4. Copy the 16-character password (spaces included or removed — both work)

> **Note:** Use a dedicated Gmail address for sending; never use your primary account password.

Add to your `.env`:

```env
GMAIL_USER=your-gmail@gmail.com
GOOGLE_APP_PASSWORD=xxxx xxxx xxxx xxxx

# Enables email verification on sign-up and password-reset flows in the dashboard
VITE_EMAIL_SERVICES_ENABLE=true
```

### Groq API Key (AI Agent)

The `/ai` command and the Agentic AI features (`onChat` conversational trigger, `test_command`, `send_result`, `help` tools) all require a **Groq API key**. Without it, the bot starts normally but every AI invocation returns an error.

> **Free tier:** Groq's hosted inference API has a generous free tier with no credit card required — ideal for development and personal deployments.

**How to get your `GROQ_API_KEY`:**

1. Go to [console.groq.com](https://console.groq.com) and sign up with your email or Google account.
2. After logging in, open the **API Keys** section from the left sidebar (or navigate directly to [console.groq.com/keys](https://console.groq.com/keys)).
3. Click **Create API Key**, give it a descriptive name (e.g. `cat-bot`), and click **Submit**.
4. **Copy the key immediately** — Groq only shows it once. Store it in a password manager or secure notes application.

> **Security note:** Your API key is equivalent to a password. Never commit it to version control or share it publicly. Always load it from your `.env` file or an environment variable.

Add to your `.env`:

```env
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

> **Rate limits (free tier, 2026):** Rate limits are per organization, not per API key. Creating multiple keys under the same organization shares the same request bucket — create a separate organization if you need independent rate limit pools.

If `GROQ_API_KEY` is absent, the bot starts normally. The `/ai` command and the conversational `onChat` trigger will respond with:
```
AI Error: GROQ_API_KEY environment variable is not set. AI capabilities are disabled.
```

### Telegram Webhooks (recommended for production)

By default, Telegram sessions use long-polling — no public domain required. However, for production deployments, webhook mode is highly recommended for better reliability and scalability:

```env
TELEGRAM_WEBHOOK_DOMAIN=https://your-domain.com
```

The Telegram adapter switches to webhook mode automatically when this variable is present.

---

## Cloud Deployment

The build and start commands are the same for every platform:

| | Command |
|---|---|
| **Build** | `npm install && npm run build:all` |
| **Start** | `npm start` |

> **`BETTER_AUTH_URL` = `TELEGRAM_WEBHOOK_DOMAIN`** — both must be set to your public deployment URL.

---

### Render

Render provisions a unique `*.onrender.com` HTTPS subdomain automatically and manages TLS certificates.

**Steps:**

1. Go to [render.com](https://render.com) and sign in (or create an account).
2. In the dashboard, click **New → Web Service**.
3. Select **Build and deploy from a Git repository** → click **Next**.
4. Connect your GitHub account and select the **Cat-Bot** repository → click **Connect**.
5. Fill in the service creation form:
   - **Name:** any name (becomes your subdomain, e.g. `cat-bot.onrender.com`)
   - **Region:** closest to your users
   - **Branch:** `main`
   - **Build Command:** `npm install && npm run build:all`
   - **Start Command:** `npm start`
6. Choose an instance type and click **Create Web Service**. Render kicks off the first build — the deploy log streams in real time.
7. Once the first deploy finishes, copy your assigned `onrender.com` URL (e.g. `https://cat-bot.onrender.com`).
8. Open the **Environment** tab → click **Add Environment Variable** and add all required variables (see [Environment Variables](#environment-variables)):
   - `BETTER_AUTH_URL` → `https://your-service.onrender.com`
   - `TELEGRAM_WEBHOOK_DOMAIN` → same value as `BETTER_AUTH_URL`
   - Remove `VITE_URL` entirely — it must not be set in production (causes trusted-origin errors in better-auth)
9. Click **Save Changes** → Render triggers an automatic redeploy with the new variables applied.

> **Free tier note:** Free Render instances spin down after 15 minutes of inactivity and spin back up on the next request (cold start ~30 s). Use a paid instance for always-on bot sessions.

---

### Railway

Railway does not assign a public domain until you explicitly generate one — the domain is needed before you can fill in `BETTER_AUTH_URL` and `TELEGRAM_WEBHOOK_DOMAIN`, so the sequence differs from Render.

**Steps:**

1. Go to [railway.com](https://railway.com) and sign in with your GitHub account.
2. In the dashboard, click **New Project → Deploy from GitHub repo**.
3. Select the **Cat-Bot** repository → click **Deploy Now**. Railway detects the Node.js project via Railpack and kicks off an initial build on your default branch.
4. Once the project canvas appears, click on your service to open the service panel.
5. Go to **Settings → Networking** and click **Generate Domain** — Railway provisions a `*.up.railway.app` subdomain (e.g. `https://cat-bot-production.up.railway.app`). Copy it.
6. Open the **Variables** tab and add all required environment variables (see [Environment Variables](#environment-variables)):
   - `BETTER_AUTH_URL` → your Railway domain (e.g. `https://cat-bot-production.up.railway.app`)
   - `TELEGRAM_WEBHOOK_DOMAIN` → same value as `BETTER_AUTH_URL`
   - Remove `VITE_URL` entirely — it must not be set in production
7. Click **Deploy** (or push a new commit to your linked branch) — Railway redeploys with the variables applied.

> **Auto-deploys:** Every push to your linked branch (default `main`) triggers an automatic rebuild and redeploy with zero downtime.

---

## Writing Commands

Create a file in `packages/cat-bot/src/app/commands/`. The engine loads every `.ts`/`.js` file in this directory at startup.

### Minimal command

```ts
// src/app/commands/hello.ts
import type { AppCtx } from "@/engine/types/controller.types.js";
import type { CommandConfig } from "@/engine/types/module-config.types.js";
import { Role } from "@/engine/constants/role.constants.js";
import { MessageStyle } from "@/engine/constants/message-style.constants.js";

export const config: CommandConfig = {
  name: "hello",
  version: "1.0.0",
  role: Role.ANYONE,
  author: "your-name",
  description: "Says hello",
  usage: "",
  cooldown: 5,
  hasPrefix: true,
};

export const onCommand = async ({ chat }: AppCtx): Promise<void> => {
  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: "👋 **Hello, world!**",
  });
};
```

### CommandConfig fields

| Field         | Required | Description                                                     |
| ------------- | -------- | --------------------------------------------------------------- |
| `name`        | ✅       | Command name (lowercase). Matched after the prefix is stripped. |
| `version`     | ✅       | Semantic version string.                                        |
| `role`        | ✅       | Minimum role. Use `Role.ANYONE` for public commands.            |
| `author`      | ✅       | Author name shown in help output.                               |
| `description` | ✅       | One-line description; shown in Discord's `/` menu.              |
| `cooldown`    | ✅       | Per-user cooldown in seconds. `0` disables.                     |
| `aliases`     | —        | Alternative command names that map to the same handler.         |
| `platform`    | —        | Restrict to specific platforms. Absent = all platforms.         |
| `hasPrefix`   | —        | Set `false` for prefix-less (on-chat) commands.                 |
| `options`     | —        | Named options for slash command typed arguments.                |
| `guide`       | —        | Multi-line usage guide shown by `ctx.usage()`.                  |

### Conversation flows

```ts
const STATE = { awaiting_name: "awaiting_name", awaiting_age: "awaiting_age" };

export const onReply = {
  [STATE.awaiting_name]: async ({ chat, session, event, state }: AppCtx) => {
    const name = event["message"] as string;
    const msgId = await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: "**How old are you?**",
    });
    state.delete(session.id);
    if (msgId) {
      state.create({
        id: state.generateID({ id: String(msgId) }),
        state: STATE.awaiting_age,
        context: { name },
      });
    }
  },
  [STATE.awaiting_age]: async ({ chat, session, event, state }: AppCtx) => {
    const { name } = session.context as { name: string };
    state.delete(session.id);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `✅ Registered: **${name}**, age **${event["message"] as string}**`,
    });
  },
};

export const onCommand = async ({ chat, state }: AppCtx) => {
  const msgId = await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: "**Step 1/2:** What is your name?",
  });
  if (!msgId) return;
  state.create({
    id: state.generateID({ id: String(msgId) }),
    state: STATE.awaiting_name,
    context: {},
  });
};
```

### Interactive buttons

```ts
import { ButtonStyle } from "@/engine/constants/button-style.constants.js";

const BUTTON_ID = {
  confirm: "confirm",
  cancel: "cancel",
};

export const button = {
  [BUTTON_ID.confirm]: {
    label: "✅ Confirm",
    style: ButtonStyle.SUCCESS,
    onClick: async ({ chat, event }: AppCtx) => {
      await chat.editMessage({
        message_id_to_edit: event["messageID"] as string,
        message: "✅ Confirmed!",
        button: [], // clear buttons after the action
      });
    },
  },
  [BUTTON_ID.cancel]: {
    label: "❌ Cancel",
    style: ButtonStyle.DANGER,
    onClick: async ({ chat, event }: AppCtx) => {
      await chat.editMessage({
        message_id_to_edit: event["messageID"] as string,
        message: "❌ Cancelled.",
        button: [],
      });
    },
  },
};

export const onCommand = async ({ chat, button: btn }: AppCtx) => {
  const confirmId = btn.generateID({ id: BUTTON_ID.confirm });
  const cancelId = btn.generateID({ id: BUTTON_ID.cancel });
  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: "**Are you sure?**",
    button: [confirmId, cancelId],
  });
};
```

> On Discord this produces an `ActionRowBuilder` with two buttons. On Telegram it produces an inline keyboard. On Messenger it produces a numbered text menu. On Facebook Page it produces a Button Template. The same `button` export drives all four outcomes.

### Platform filtering

```ts
import { Platforms } from "@/engine/modules/platform/platform.constants.js";

export const config: CommandConfig = {
  // ...
  platform: [Platforms.Discord, Platforms.Telegram],
};
```

### AppCtx quick reference

| Field        | Description                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------- |
| `chat`       | Send, edit, react — `reply`, `replyMessage`, `editMessage`, `reactMessage`, `unsendMessage`    |
| `thread`     | Group operations — `setName`, `setImage`, `addUser`, `removeUser`, `getInfo`                   |
| `user`       | `getInfo(uid)`, `getName(uid)`, `getAvatarUrl(uid)`                                            |
| `state`      | Pending state CRUD — `generateID`, `create`, `delete`                                          |
| `button`     | Button lifecycle — `generateID`, `createContext`, `update`                                     |
| `session`    | Auto-resolved flow context in `onReply`/`onReact`/`onClick` — `id`, `state`, `context`         |
| `db`         | Per-user and per-thread collections — `db.users.collection(uid)`, `db.threads.collection(tid)` |
| `currencies` | Economy — `getMoney`, `increaseMoney`, `decreaseMoney`                                         |
| `args`       | Token array after the command name                                                             |
| `options`    | Named slash-command / `key:value` options                                                      |
| `event`      | Raw unified event (`senderID`, `threadID`, `messageID`, `message`, …)                          |
| `native`     | Platform identity + raw platform object for SDK-level access                                   |
| `logger`     | Session-scoped structured logger                                                               |
| `prefix`     | Active command prefix                                                                          |
| `usage`      | Replies with the formatted usage guide                                                         |

---

## Converting Existing Commands

If you have command files from another bot project — GoatBot, Mirai, fca-unofficial-based bots, or any other framework — and want to port them to Cat-Bot, use the prompt below with [Claude AI](https://claude.ai).

**How to use:**

1. Open [Claude AI](https://claude.ai)
2. Copy the entire prompt block below
3. Replace `[your code]` at the bottom with the command file you want to convert
4. Paste it into Claude and send

~~~markdown
> **⚠️ CRITICAL — Read Before Proceeding**
> You MUST fetch the documentation URL in Step 1 **before** writing any code.
> The fetched documentation is your **only** source of truth.
> Do NOT invent, assume, or borrow patterns from other bot frameworks (e.g. Discord.js, Telegraf, Baileys, or any other project). If it is not in the documentation, it does not exist in Cat Bot.

---

## Task: Convert Code to Cat Bot

### Step 1 — Fetch Documentation (Required)

Fetch the URL below and confirm it is successfully retrieved before doing anything else.

- [ ] `https://raw.githubusercontent.com/johnlester-0369/Cat-Bot/refs/heads/main/docs/llms.txt?v=7`

---

### Step 2 — Acknowledge & Ground Yourself

After fetching, confirm the following before proceeding:
- Summarize Cat Bot's structure, code patterns, and conventions **as described in the documentation only**
- Flag anything in the code to convert that has **no equivalent** in Cat Bot's documented API — do not silently fill gaps with assumptions

---

### Step 3 — Convert the Code

Convert the code below into Cat Bot **strictly and exclusively** using what is documented in the fetched URL.

**Rules:**
- ✅ Only use APIs, methods, patterns, and structures that exist in the documentation
- ❌ Do not invent helper functions or abstractions not shown in the docs
- ❌ Do not mirror patterns from other frameworks even if they "seem right"
- ❌ If something cannot be done within Cat Bot's documented API, say so explicitly — do not improvise

```
[your code]
```
~~~

---

## Writing Event Handlers

Create a file in `packages/cat-bot/src/app/events/`.

```ts
// src/app/events/join.ts
import type { AppCtx } from "@/engine/types/controller.types.js";
import type { EventConfig } from "@/engine/types/module-config.types.js";
import { MessageStyle } from "@/engine/constants/message-style.constants.js";

export const config: EventConfig = {
  name: "join",
  eventType: ["log:subscribe"],
  version: "1.0.0",
  author: "your-name",
  description: "Welcomes new members",
};

export const onEvent = async ({ chat, event }: AppCtx): Promise<void> => {
  const data = event["logMessageData"] as Record<string, unknown> | undefined;
  const added =
    (data?.["addedParticipants"] as Record<string, unknown>[]) ?? [];
  for (const p of added) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `👋 Welcome **${String(p["fullName"] ?? p["firstName"] ?? "new member")}**!`,
    });
  }
};
```

**Common `eventType` values:**

| Value                  | Trigger                    |
| ---------------------- | -------------------------- |
| `log:subscribe`        | Member(s) joined a group   |
| `log:unsubscribe`      | Member left or was removed |
| `log:thread-name`      | Group name changed         |
| `log:thread-image`     | Group photo changed        |
| `log:thread-icon`      | Group emoji changed        |
| `log:user-nickname`    | A nickname was changed     |
| `change_thread_admins` | Admin status changed       |

---

## Constants & Type Safety

Cat-Bot ships a set of **frozen const objects** that act as single sources of truth for every value the engine tests at runtime. Using these constants instead of raw string or numeric literals prevents silent failures — a typo like `'Discord'` instead of `'discord'` compiles cleanly but silently skips every platform check at runtime.

### Why Constants Matter

Every place the engine compares a value — role enforcement, platform filtering, event routing, message rendering — it tests against the exact values these constants define. A raw literal that differs by one character silently misses the comparison:

```ts
// ❌ Magic number — no autocomplete, no refactor safety, silently broken if Role values shift
export const config = { role: 4 };

// ✅ Single source of truth — TypeScript flags a stale value immediately if the constant changes
export const config = { role: Role.SYSTEM_ADMIN };
```

### Role

```ts
import { Role } from "@/engine/constants/role.constants.js";
```

| Constant            | Value | Who can invoke                                |
| ------------------- | ----- | --------------------------------------------- |
| `Role.ANYONE`       | `0`   | All users — every role can invoke ANYONE commands |
| `Role.THREAD_ADMIN` | `1`   | Thread/group admins — also: `PREMIUM`, `BOT_ADMIN`, `SYSTEM_ADMIN` |
| `Role.PREMIUM`      | `2`   | Premium users — also: `BOT_ADMIN`, `SYSTEM_ADMIN`; thread admins alone **denied** |
| `Role.BOT_ADMIN`    | `3`   | Bot admins — also: `SYSTEM_ADMIN` only; premium-only users **denied** |
| `Role.SYSTEM_ADMIN` | `4`   | System admins **only** — bypasses every gate |

**Access Truth Table — invoker role (rows) vs required command role (columns):**

| Invoker ↓ / Required → | ANYONE (0) | THREAD_ADMIN (1) | PREMIUM (2) | BOT_ADMIN (3) | SYSTEM_ADMIN (4) |
|---|---|---|---|---|---|
| **Any user** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **THREAD_ADMIN** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **PREMIUM** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **BOT_ADMIN** | ✅ | ✅ | ✅ | ✅ | ❌ |
| **SYSTEM_ADMIN** | ✅ | ✅ | ✅ | ✅ | ✅ |

Role access is strictly hierarchical by numeric value: higher value = stricter gate and greater authority.
A role can always invoke commands requiring a lower-numbered role.
### MessageStyle

```ts
import { MessageStyle } from "@/engine/constants/message-style.constants.js";

// ❌ Raw string — if the engine's value set changes, this silently stops rendering Markdown
await chat.replyMessage({ style: "markdown", message: "**Hello**" });

// ✅ TypeScript flags any mismatch at compile time
await chat.replyMessage({ style: MessageStyle.MARKDOWN, message: "**Hello**" });
```

| Constant                | Behaviour                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `MessageStyle.MARKDOWN` | Renders Markdown on Discord/Telegram; converts `**bold**` and `_italic_` to styled Unicode on Messenger/Page |
| `MessageStyle.TEXT`     | Escapes Markdown syntax — content displays literally                                                         |

### ButtonStyle

```ts
import { ButtonStyle } from "@/engine/constants/button-style.constants.js";

export const button = {
  confirm: {
    label: "✅ Confirm",
    style: ButtonStyle.SUCCESS, // not the raw string 'success'
    onClick: async (ctx: AppCtx) => {
      /* ... */
    },
  },
};
```

| Constant                | Discord colour              |
| ----------------------- | --------------------------- |
| `ButtonStyle.PRIMARY`   | Blue                        |
| `ButtonStyle.SECONDARY` | Grey (default when omitted) |
| `ButtonStyle.SUCCESS`   | Green                       |
| `ButtonStyle.DANGER`    | Red                         |

Telegram and Facebook Page render the button label only — `style` has no visual effect on those platforms.

### Platforms

```ts
import { Platforms } from "@/engine/modules/platform/platform.constants.js";

// ❌ Subtle capitalisation difference — 'Facebook-Messenger' never matches 'facebook-messenger'
export const config = { platform: ["Facebook-Messenger"] };

// ✅ Autocompleted, typo-proof, refactor-safe
export const config = { platform: [Platforms.FacebookMessenger] };
```

| Constant                      | Value                  |
| ----------------------------- | ---------------------- |
| `Platforms.Discord`           | `'discord'`            |
| `Platforms.Telegram`          | `'telegram'`           |
| `Platforms.FacebookMessenger` | `'facebook-messenger'` |
| `Platforms.FacebookPage`      | `'facebook-page'`      |

The same constants are used for runtime narrowing inside handlers:

```ts
export const onCommand = async ({ native, chat }: AppCtx) => {
  if (native.platform === Platforms.Telegram) {
    // Telegram-only logic
  }
};
```

### EventType Strings

The `eventType[]` array in `EventConfig` is matched against the engine's internal routing table. A single character off means the handler is registered but never called:

```ts
// ❌ 'log:subscibe' — one missing letter, handler silently receives zero events
export const config: EventConfig = { eventType: ["log:subscibe"] };

// ✅ Exact string matched against the LogMessageType registry
export const config: EventConfig = { eventType: ["log:subscribe"] };
```

| String                   | Trigger                    |
| ------------------------ | -------------------------- |
| `'log:subscribe'`        | Member(s) joined a group   |
| `'log:unsubscribe'`      | Member left or was removed |
| `'log:thread-name'`      | Group name changed         |
| `'log:thread-image'`     | Group photo changed        |
| `'log:thread-icon'`      | Group emoji changed        |
| `'log:user-nickname'`    | A nickname was changed     |
| `'change_thread_admins'` | Admin status changed       |

The full reference — including `OptionType` constants for slash command options — is in [DOCS.md](DOCS.md).

---

## Developer Reference

The complete API reference for command and event module authors

**[`DOCS.md`](DOCS.md)**

It covers, among other things:

- Side-by-side comparisons of native SDK code vs. the Cat-Bot equivalent for every major operation
- How the 3-second Discord acknowledgment window is handled transparently
- The button ownership model and how `public: true` opts into thread-scoped buttons
- How to extend the middleware pipeline with custom guards
- The full `onReply`, `onReact`, and `button.onClick` lifecycle contract
- Native platform access patterns (`native.ctx` on Telegram, `native.message` on Discord, `native.api` on Messenger, `native.messaging` on Facebook Page)

---

## Database Adapters

| Adapter             | `DATABASE_TYPE` | Best For                 | Notes                                                                                              |
| ------------------- | --------------- | ------------------------ | -------------------------------------------------------------------------------------------------- |
| **JSON**            | `json`          | Local development, demos | Zero runtime deps; data in `packages/database/database/database.json`; not suitable for production |
| **Prisma + SQLite** | `prisma-sqlite` | Single-server production | Requires `prisma generate` + `prisma migrate dev`; WAL mode enabled for concurrent reads           |
| **MongoDB**         | `mongodb`       | Production, cloud        | Atlas M0 free tier supported; non-transactional on M0                                              |
| **NeonDB**          | `neondb`        | Production, serverless   | Schema auto-initialized at boot via `dbReady` promise; connection pooling via `pg.Pool`            |

### Switching adapters

Change `DATABASE_TYPE` in `.env` and restart. To migrate existing data, use one of the 12 cross-adapter scripts:

```bash
# Example: move data from JSON to NeonDB
npx tsx packages/database/scripts/migrate-json-to-neondb.ts
```

All bidirectional migration directions (`json ↔ sqlite ↔ mongodb ↔ neondb`) are available in `packages/database/scripts/`.

---

## Environment Variables

Full reference from `packages/cat-bot/.env.example`:

```env
# Server
PORT=3000
LOG_LEVEL=info                     # error | warn | info | http | verbose | debug | silly

# Auth
BETTER_AUTH_SECRET=                # openssl rand -base64 32
BETTER_AUTH_URL=http://localhost:3000
VITE_URL=http://localhost:5173     # dev proxy origin (REMOVE in production to avoid trusted origin errors)

# Database — choose one
DATABASE_TYPE=json                 # json | mongodb | neondb | prisma-sqlite

# NeonDB (when DATABASE_TYPE=neondb)
NEON_DATABASE_URL=postgres://...

# MongoDB (when DATABASE_TYPE=mongodb)
MONGODB_URI=mongodb+srv://username:<PASSWORD>@cluster0.mongodb.net?...
MONGO_PASSWORD=
MONGO_DATABASE_NAME=catbot

# Telegram Webhooks (optional — recommended for production)
TELEGRAM_WEBHOOK_DOMAIN=https://your-domain.com

# Gmail SMTP / Email Verification (optional — recommended for production)
GMAIL_USER=your-gmail@gmail.com
GOOGLE_APP_PASSWORD=xxxx xxxx xxxx xxxx
VITE_EMAIL_SERVICES_ENABLE=false   # set to true in production when SMTP is configured

# Credential encryption at rest
ENCRYPTION_KEY=                    # openssl rand -hex 32
```

---

## Facebook Messenger — E2EE Trade-offs

When `FCA_ENABLE_E2EE=true` (the default), `listenMqtt` internally spins up **two concurrent WebSocket connections per session**: the standard MQTT connection to Facebook's edge servers, and a separate **meta-messenger.js** WebSocket that handles the E2EE channel. The session is not considered fully ready until both connections are established (`_socketReady` AND `_e2eeFullyReady`). The E2EE bridge also maintains cryptographic key state and device registration data for each session.

If you run many concurrent Facebook Messenger sessions on a server with limited memory or connections, consider setting `FCA_ENABLE_E2EE=false` in your `.env`. This reduces each session to a single MQTT connection and drops the meta-messenger.js bridge entirely. **However, disabling E2EE means the bot cannot respond to private messages (DMs) at all** — private Messenger chats use the E2EE channel handled by the reverse-engineered meta-messenger.js library (via whatsmeow), so without the bridge the bot receives no DM events and cannot reply to them. The bot will only function in group chats.

> **⚠️ Only set `FCA_ENABLE_E2EE=false` if your bot is exclusively group-chat-based.**

---

## npm Scripts

### Monorepo root

| Script              | Description                                  |
| ------------------- | -------------------------------------------- |
| `npm run dev`       | Start bot engine in watch mode (`tsx watch`) |
| `npm run dev:web`   | Start Vite dev server for the dashboard      |
| `npm run build:db`  | Compile the database package                 |
| `npm run build`     | Compile cat-bot (TypeScript + tsc-alias)     |
| `npm run format`    | Prettier                                     |
| `npm run test`      | Run Vitest unit and integration tests        |
| `npm run test:watch`| Vitest in watch mode                         |
| `npm run seed:admin`| Create the initial system admin account      |
| `npm run dev:all`   | Start bot engine + web dashboard concurrently |
| `npm run build:all` | Compile bot + web dashboard concurrently      |

### `packages/cat-bot`

| Script                   | Description                             |
| ------------------------ | --------------------------------------- |
| `npm run seed:admin`     | Create the initial system admin account |
| `npm run reset:password` | Reset an admin account password         |
| `npm run lint`           | ESLint                                  |
| `npm run format`         | Prettier                                |
| `npm run test:watch`     | Vitest in watch mode                    |

---

## Authors

<table>
  <tr>
    <td align="center">
      <a href="https://github.com/johnlester-0369">
        <img src="https://github.com/johnlester-0369.png" width="80" height="80" style="border-radius:50%" alt="John Lester" /><br />
        <strong>John Lester</strong>
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/ajirodesu">
        <img src="https://github.com/ajirodesu.png" width="80" height="80" style="border-radius:50%" alt="Lance Cochangco" /><br />
        <strong>Lance Cochangco</strong>
      </a>
    </td>
  </tr>
</table>

---

**[https://github.com/johnlester-0369/Cat-Bot](https://github.com/johnlester-0369/Cat-Bot)** · ISC License
