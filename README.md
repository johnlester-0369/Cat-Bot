<div align="center">
  <img src="assets/cover.png" alt="Cat-Bot Cover" width="100%" />

  <h1>Cat-Bot</h1>

  <p><strong>Write once. Deploy everywhere.</strong></p>
  <p>A unified multi-platform, multi-instance chatbot framework for Discord, Telegram, Facebook Page, and Facebook Messenger — managed from a single dashboard.</p>

  <p>
    <img src="https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord" />
    <img src="https://img.shields.io/badge/Telegram-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram" />
    <img src="https://img.shields.io/badge/Facebook_Page-0866FF?style=for-the-badge&logo=facebook&logoColor=white" alt="Facebook Page" />
    <img src="https://img.shields.io/badge/Facebook_Messenger-0084FF?style=for-the-badge&logo=messenger&logoColor=white" alt="Facebook Messenger" />
  </p>

  <p>
    <img src="https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Node.js-ESM-green?logo=node.js" alt="Node.js ESM" />
    <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React 19" />
    <img src="https://img.shields.io/badge/License-ISC-lightgrey" alt="License" />
  </p>

  <p>
    <a href="https://github.com/johnlester-0369/Cat-Bot">GitHub Repository</a>
  </p>
</div>

---

## The Problem Cat-Bot Solves

Most chatbot projects are locked into a single platform and a single running instance. If you want your bot on Discord *and* Telegram, you write two separate codebases — and maintain them separately forever. If you want to run multiple bot accounts, you juggle multiple processes with no central control.

**Cat-Bot solves both problems at once:**

- **Multi-platform** — one command module runs natively on Discord, Telegram, Facebook Page, and Facebook Messenger with zero per-platform branching in your code.
- **Multi-instance** — manage any number of independent bot sessions simultaneously, each with its own credentials, prefix, command roster, and admin list, all from a single dashboard.

The platform transport layer absorbs every SDK difference (discord.js gateway, Telegraf polling, fca-unofficial MQTT, Graph API webhooks) and presents your command code with a uniform API. You write `await chat.replyMessage({ message: 'Hello!' })` once and it works everywhere.

---

## Table of Contents

1. [Screenshots](#screenshots)
2. [Features](#features)
3. [Architecture at a Glance](#architecture-at-a-glance)
4. [Quick Start — Development (JSON, zero setup)](#quick-start--development-json-zero-setup)
5. [Production Setup](#production-setup)
6. [Philosophy](#philosophy)
7. [Writing Commands](#writing-commands)
8. [Writing Event Handlers](#writing-event-handlers)
9. [Database Adapters](#database-adapters)
10. [Environment Variables](#environment-variables)
11. [npm Scripts](#npm-scripts)
12. [Authors](#authors)

---

## Screenshots

### User Portal

<table>
  <tr>
    <td align="center"><strong>Home Page</strong></td>
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
    <td align="center"><strong>Bot Manager Dashboard</strong></td>
    <td align="center"><strong>User Settings</strong></td>
  </tr>
  <tr>
    <td><img src="assets/users/dashboard.png" alt="Dashboard" /></td>
    <td><img src="assets/users/dashboard-settings.png" alt="Dashboard Settings" /></td>
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

---

## Features

| Feature | Description |
|---|---|
| **Multi-platform** | One command module runs on Discord, Telegram, Facebook Page, and Facebook Messenger — no per-platform code |
| **Multi-instance** | Run any number of independent bot sessions concurrently, each with its own credentials and config |
| **Unified Dashboard** | React 19 SPA — monitor live logs, toggle commands on/off per session, update credentials, start/stop/restart bots |
| **Conversation State** | Scoped `onReply` and `onReact` flows replace the global-array anti-pattern; two users can run the same flow simultaneously with zero interference |
| **Interactive Buttons** | `export const button` in your command file — Discord gets `ActionRowBuilder`, Telegram gets inline keyboards, Messenger gets a numbered text menu, Facebook Page gets a Button Template. Same code everywhere |
| **Admin Portal** | Independent admin dashboard with separate session cookies — ban users, stop their sessions, manage system admins |
| **Pluggable Database** | Switch between SQLite (Prisma), JSON, MongoDB, and Neon PostgreSQL via one environment variable |
| **Role-Based Access** | Five role levels (`ANYONE`, `THREAD_ADMIN`, `BOT_ADMIN`, `PREMIUM`, `SYSTEM_ADMIN`) enforced before `onCommand` runs |
| **Cooldown & Ban System** | Per-user cooldown, per-user and per-thread bans enforced by the middleware pipeline |
| **Slash Command Sync** | Discord and Telegram slash menus stay current with a SHA-based idempotency gate — no redundant REST calls on restart |
| **Economy API** | Built-in `currencies` context (`getMoney`, `increaseMoney`, `decreaseMoney`) backed by the database layer |
| **AI Agent** | Groq-powered ReAct agent with `execute_command`, `test_command`, and `help` tools |
| **Live Log Streaming** | Socket.IO pushes bot console output to the dashboard in real time with a 100-entry sliding window buffer |

---

## Architecture at a Glance

Cat-Bot is organized as an ESM TypeScript monorepo with three independent packages.

```
Cat-Bot/
├── packages/
│   ├── cat-bot/          — Bot engine + Express REST API + Socket.IO
│   │   ├── src/engine/   — Platform adapters, middleware pipeline, controller/dispatcher layer
│   │   └── src/server/   — Dashboard API, better-auth, Facebook Page webhook receiver
│   ├── database/         — Raw database adapters (no caching); selected by DATABASE_TYPE env var
│   │   └── adapters/
│   │       ├── json/         — In-memory JSON flat-file; zero runtime dependencies
│   │       ├── prisma-sqlite/ — Prisma v7 + better-sqlite3 (default)
│   │       ├── mongodb/      — MongoDB driver adapter
│   │       └── neondb/       — Neon PostgreSQL (node-postgres)
│   └── web/              — Vite + React 19 management dashboard SPA
└── packages/cat-bot/src/app/
    ├── commands/          — Your command modules (one file each)
    └── events/            — Your event handler modules
```

**Event pipeline — every incoming message follows this exact path:**

```
Platform Transport   →   Middleware Chain   →   Controller Dispatch
   (Discord /             (enforceNotBanned      (onCommand / onReply /
    Telegram /             enforceCooldown         onReact / onEvent /
    Messenger /            chatPassthrough)         button.onClick)
    Facebook Page)
```

The unified `UnifiedApi` abstract class sits between your command code and the platform SDKs. Calling `chat.replyMessage()` triggers `editReply()` on Discord, `ctx.reply()` on Telegram, `api.sendMessage()` on Messenger, and a Graph API POST on Facebook Page — all from the same call site in your command module.

---

## Quick Start — Development (JSON, zero setup)

The `json` adapter stores all data in a single flat file with **no external database required**. It is the fastest path from clone to running bot.

### Prerequisites

- Node.js 20+
- npm 10+

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

Edit `.env` — the minimum required fields for JSON development:

```env
PORT=3000
NODE_ENV=development
LOG_LEVEL=info

# Use the JSON adapter — no external database needed
DATABASE_TYPE=json

# Authentication secret — generate with: openssl rand -base64 32
BETTER_AUTH_SECRET=your_secret_here
BETTER_AUTH_URL=http://localhost:3000

# For web dev proxy
VITE_URL=http://localhost:5173

# Credential encryption key — generate with: openssl rand -hex 32
ENCRYPTION_KEY=your_64_hex_char_key_here
```

### 3. Seed the admin account

```bash
npm run seed:admin -w packages/cat-bot
```

Follow the prompts to create your system admin account. You can use this to log in to both the user portal (`/login`) and the admin portal (`/admin`).

### 4. Start the bot engine

```bash
# From the repo root:
npm run dev

# In a separate terminal, start the dashboard:
npm run dev:web
```

- **Dashboard:** http://localhost:5173
- **API:** http://localhost:3000

### 5. Add a bot session

1. Open http://localhost:5173 and sign up / log in.
2. Click **Create New Bot**.
3. Choose a platform and paste your bot credentials (Discord token, Telegram token, etc.).
4. Click **Verify** — Cat-Bot validates the credentials against the platform API before saving.
5. Click **Create**. The bot starts automatically.

> **Tip:** Write your command files in `packages/cat-bot/src/app/commands/` and event files in `packages/cat-bot/src/app/events/`. The engine hot-reloads via `tsx watch` — save a file and the changes are live.

---

## Production Setup

For production, use **NeonDB** (managed serverless PostgreSQL) or **MongoDB** for durable persistence across restarts and multi-process safety. Both support the same feature set as the JSON adapter.

### Option A — NeonDB (Recommended)

NeonDB is a serverless PostgreSQL service with a free tier. Cat-Bot's NeonDB adapter runs schema initialization automatically at boot — no manual migration step required.

**1. Create a project at [console.neon.tech](https://console.neon.tech) and copy the connection string.**

**2. Set environment variables:**

```env
DATABASE_TYPE=neondb
NEON_DATABASE_URL=postgres://username:password@ep-xxxx.us-east-2.aws.neon.tech/neondb?sslmode=require

BETTER_AUTH_SECRET=your_production_secret
BETTER_AUTH_URL=https://your-domain.com
ENCRYPTION_KEY=your_64_hex_char_key_here

NODE_ENV=production
LOG_LEVEL=warn
```

**3. Run the better-auth schema migration** (required once for auth tables):

```bash
cd packages/cat-bot
npx @better-auth/cli migrate
```

**4. Seed the admin account:**

```bash
npm run seed:admin -w packages/cat-bot
```

**5. Build and start:**

```bash
npm run build:db      # compile the database package
npm run build         # compile cat-bot
npm run build:web     # compile the React dashboard
npm start             # serve everything from one process
```

---

### Option B — MongoDB

MongoDB Atlas M0 (free tier) works out of the box.

**1. Create a cluster at [cloud.mongodb.com](https://cloud.mongodb.com) and get your connection URI.**

**2. Set environment variables:**

```env
DATABASE_TYPE=mongodb
MONGODB_URI=mongodb+srv://username:<PASSWORD>@cluster0.mongodb.net?retryWrites=true&w=majority
MONGO_PASSWORD=your_mongodb_password
MONGO_DATABASE_NAME=catbot

BETTER_AUTH_SECRET=your_production_secret
BETTER_AUTH_URL=https://your-domain.com
ENCRYPTION_KEY=your_64_hex_char_key_here
```

**3. Seed the admin account and build:**

```bash
npm run seed:admin -w packages/cat-bot
npm run build:db && npm run build && npm run build:web
npm start
```

---

### Telegram Webhooks (Optional)

By default, Telegram sessions use long-polling which works without a public domain. For webhook mode (lower latency), set:

```env
TELEGRAM_WEBHOOK_DOMAIN=https://your-domain.com
```

The Telegram adapter automatically switches to webhook mode when this variable is present.

---

## Philosophy

Cat-Bot eliminates `global` variables for conversation state. The old pattern looked like this:

```js
// ❌ Old approach — fragile, shared mutable state, hard to debug
global.client.handleReply.push({
  name: 'quiz',
  messageID: info.messageID,
  author: event.senderID,
  answer: 'True'
})
```

Cat-Bot replaces this with scoped, typed, garbage-collected state:

```ts
// ✅ Cat-Bot approach — scoped to this message, auto-cleaned, type-safe
state.create({
  id: state.generateID({ id: String(messageID) }),
  state: 'awaiting_answer',
  context: { answer: 'True' },
})
```

Every value you need in a follow-up handler arrives through the `session` object — no global lookup, no shared mutable arrays, no race conditions between concurrent conversations.

The API is designed so that every parameter is **named** inside an object literal:

```ts
// ✅ Semantic — you know what each field does without reading docs
await chat.replyMessage({
  style: MessageStyle.MARKDOWN,
  message: '**Hello!**',
})

// ❌ Positional — you have to count arguments and memorise order
await message.reply(style, '**Hello!**', threadID)
```

---

## Writing Commands

Create a file in `packages/cat-bot/src/app/commands/`. The engine loads every `.ts`/`.js` file in this directory at startup.

### Minimal command

```ts
// src/app/commands/hello.ts
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

### CommandConfig fields

| Field | Required | Description |
|---|---|---|
| `name` | ✅ | Command name (lowercase). Matched after the prefix is stripped. |
| `version` | ✅ | Semantic version string. |
| `role` | ✅ | Minimum role. Use `Role.ANYONE` for public commands. |
| `author` | ✅ | Author name shown in help output. |
| `description` | ✅ | One-line description; shown in Discord's `/` menu. |
| `cooldown` | ✅ | Per-user cooldown in seconds. `0` disables. |
| `aliases` | — | Alternative command names. |
| `platform` | — | Restrict to specific platforms. Absent = all platforms. |
| `hasPrefix` | — | Set `false` for prefix-less (on-chat) commands. |
| `options` | — | Named options for slash command typed arguments. |
| `guide` | — | Multi-line usage guide shown by `ctx.usage()`. |

### Conversation flows (onReply)

```ts
const STATE = { awaiting_name: 'awaiting_name', awaiting_age: 'awaiting_age' }

export const onReply = {
  [STATE.awaiting_name]: async ({ chat, session, event, state }: AppCtx) => {
    const name = event['message'] as string
    const msgId = await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '**How old are you?**',
    })
    state.delete(session.id)
    if (msgId) {
      state.create({
        id: state.generateID({ id: String(msgId) }),
        state: STATE.awaiting_age,
        context: { name },
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

export const onCommand = async ({ chat, state }: AppCtx) => {
  const msgId = await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: '**Step 1/2:** What is your name?',
  })
  if (!msgId) return
  state.create({
    id: state.generateID({ id: String(msgId) }),
    state: STATE.awaiting_name,
    context: {},
  })
}
```

### Interactive buttons

```ts
import { ButtonStyle } from '@/engine/constants/button-style.constants.js'

export const button = {
  confirm: {
    label: '✅ Confirm',
    style: ButtonStyle.SUCCESS,
    onClick: async ({ chat, event }: AppCtx) => {
      await chat.editMessage({
        message_id_to_edit: event['messageID'] as string,
        message: '✅ Confirmed!',
        button: [],  // clear buttons after action
      })
    },
  },
  cancel: {
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
  const confirmId = btn.generateID({ id: 'confirm' })
  const cancelId = btn.generateID({ id: 'cancel' })
  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: '**Are you sure?**',
    button: [confirmId, cancelId],
  })
}
```

> Discord renders `ActionRowBuilder` buttons, Telegram renders inline keyboards, Messenger renders a numbered text menu, and Facebook Page renders a Button Template — all from the same `button` export.

### Platform filtering

```ts
import { Platforms } from '@/engine/modules/platform/platform.constants.js'

export const config: CommandConfig = {
  // ...
  platform: [Platforms.Discord, Platforms.Telegram], // only runs on these two
}
```

### AppCtx fields

| Field | Description |
|---|---|
| `chat` | Send, edit, react — `reply`, `replyMessage`, `editMessage`, `reactMessage`, `unsendMessage` |
| `thread` | Group operations — `setName`, `setImage`, `addUser`, `removeUser`, `getInfo` |
| `user` | `getInfo(uid)`, `getName(uid)`, `getAvatarUrl(uid)` |
| `state` | Pending state CRUD — `generateID`, `create`, `delete` |
| `button` | Button lifecycle — `generateID`, `createContext`, `update` |
| `session` | Auto-resolved flow context in `onReply`/`onReact`/`onClick` — `id`, `state`, `context` |
| `db` | Per-user and per-thread collections — `db.users.collection(uid)`, `db.threads.collection(tid)` |
| `currencies` | Economy — `getMoney`, `increaseMoney`, `decreaseMoney` |
| `args` | Token array after the command name |
| `options` | Named slash-command / key:value options |
| `event` | Raw unified event (`senderID`, `threadID`, `messageID`, `message`, …) |
| `native` | Platform identity + raw platform object for SDK-level access |
| `logger` | Session-scoped structured logger |
| `prefix` | Active command prefix |
| `usage` | Replies with the formatted usage guide |

---

## Writing Event Handlers

Create a file in `packages/cat-bot/src/app/events/`.

```ts
// src/app/events/join.ts
import type { AppCtx } from '@/engine/types/controller.types.js'
import { MessageStyle } from '@/engine/constants/message-style.constants.js'
import type { EventConfig } from '@/engine/types/module-config.types.js'

export const config: EventConfig = {
  name: 'join',
  eventType: ['log:subscribe'],   // fires when a member joins a group
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

**Common `eventType` values:**

| Value | Trigger |
|---|---|
| `log:subscribe` | Member(s) joined a group |
| `log:unsubscribe` | Member left or was removed |
| `log:thread-name` | Group name changed |
| `log:thread-image` | Group photo changed |
| `log:thread-icon` | Group emoji changed |
| `log:user-nickname` | A nickname was changed |
| `change_thread_admins` | Admin status changed |

---

## Database Adapters

| Adapter | `DATABASE_TYPE` | Best For | Notes |
|---|---|---|---|
| **JSON** | `json` | Local development, demos | Zero runtime deps; data in `packages/database/database/database.json`; not suitable for production |
| **Prisma + SQLite** | *(unset)* | Single-server production | Requires `prisma generate` + `prisma migrate dev`; WAL mode enabled for concurrent reads |
| **MongoDB** | `mongodb` | Production, cloud | Atlas free tier supported; non-transactional (Atlas M0 limitation) |
| **NeonDB** | `neondb` | Production, serverless | Schema auto-initialized at boot via `dbReady` promise; connection pooling via `pg.Pool` |

### Switching adapters

Change `DATABASE_TYPE` in your `.env` and restart. If you have existing data, use the migration scripts:

```bash
# Example: move data from JSON to NeonDB
npx tsx packages/database/scripts/migrate-json-to-neondb.ts
```

All 12 cross-adapter migration directions are available in `packages/database/scripts/`.

---

## Environment Variables

Full reference from `packages/cat-bot/.env.example`:

```env
# Server
PORT=3000
NODE_ENV=development               # development | production
LOG_LEVEL=info                     # error | warn | info | http | verbose | debug | silly

# Auth
BETTER_AUTH_SECRET=                # openssl rand -base64 32
BETTER_AUTH_URL=http://localhost:3000
VITE_URL=http://localhost:5173     # dev proxy origin

# Database — choose one
DATABASE_TYPE=json                 # json | mongodb | neondb | (unset = prisma-sqlite)

# NeonDB (when DATABASE_TYPE=neondb)
NEON_DATABASE_URL=postgres://...

# MongoDB (when DATABASE_TYPE=mongodb)
MONGODB_URI=mongodb+srv://username:<PASSWORD>@cluster0.mongodb.net?...
MONGO_PASSWORD=
MONGO_DATABASE_NAME=catbot

# Telegram Webhooks (optional; omit for long-polling)
TELEGRAM_WEBHOOK_DOMAIN=https://your-domain.com

# Credential encryption at rest
ENCRYPTION_KEY=                    # openssl rand -hex 32
```

---

## npm Scripts

### Root (monorepo)

| Script | Description |
|---|---|
| `npm run dev` | Start bot engine in watch mode (`tsx watch`) |
| `npm run dev:web` | Start Vite dev server for the dashboard |
| `npm run build:db` | Compile the database package |
| `npm run build` | Compile cat-bot (TypeScript + tsc-alias) |
| `npm run build:web` | Compile the React dashboard |
| `npm start` | Start the compiled production server |
| `npm test` | Run Vitest unit and integration tests |

### `packages/cat-bot`

| Script | Description |
|---|---|
| `npm run seed:admin` | Create the initial system admin account |
| `npm run reset:password` | Reset an admin account password |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |
| `npm run test:watch` | Vitest in watch mode |

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

## Repository

**[https://github.com/johnlester-0369/Cat-Bot](https://github.com/johnlester-0369/Cat-Bot)**

---

## License

ISC
