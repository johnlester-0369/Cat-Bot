-- ============================================================================
-- NeonDB Schema — Cat-Bot
-- Run this file once against your Neon project via the SQL editor or psql.
-- All statements use IF NOT EXISTS and are safe to re-run.
--
-- Alternatively, call initDb() from client.ts at application boot.
-- Better-Auth tables (user, session, account, verification) are also created
-- by `npx @better-auth/cli migrate` — both approaches are equivalent.
-- ============================================================================

-- IMPORTANT: Column names are camelCase — better-auth's Kysely adapter writes
-- camelCase field names directly; snake_case columns cause 42703 errors.
CREATE TABLE IF NOT EXISTS "user" (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  "emailVerified" BOOLEAN NOT NULL DEFAULT FALSE,
  image          TEXT,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "session" (
  id         TEXT PRIMARY KEY,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  token      TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId"    TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "account" (
  id                       TEXT PRIMARY KEY,
  "accountId"               TEXT NOT NULL,
  "providerId"              TEXT NOT NULL,
  "userId"                  TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "accessToken"             TEXT,
  "refreshToken"            TEXT,
  "idToken"                 TEXT,
  "accessTokenExpiresAt"  TIMESTAMPTZ,
  "refreshTokenExpiresAt" TIMESTAMPTZ,
  scope                    TEXT,
  password                 TEXT,
  "createdAt"              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "verification" (
  id         TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value      TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Bot identity tables ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_users (
  platform_id INTEGER NOT NULL,
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  first_name  TEXT,
  username    TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bot_threads (
  platform_id  INTEGER NOT NULL,
  id           TEXT PRIMARY KEY,
  name         TEXT,
  is_group     BOOLEAN NOT NULL DEFAULT FALSE,
  member_count INTEGER,
  avatar_url   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- M:M junction tables replacing Prisma's implicit @relation join tables
CREATE TABLE IF NOT EXISTS bot_thread_participants (
  thread_id TEXT NOT NULL REFERENCES bot_threads(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES bot_users(id)   ON DELETE CASCADE,
  PRIMARY KEY (thread_id, user_id)
);

CREATE TABLE IF NOT EXISTS bot_thread_admins (
  thread_id TEXT NOT NULL REFERENCES bot_threads(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES bot_users(id)   ON DELETE CASCADE,
  PRIMARY KEY (thread_id, user_id)
);

-- ── Session-level config ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_session (
  user_id     TEXT    NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  platform_id INTEGER NOT NULL,
  session_id  TEXT    NOT NULL,
  nickname    TEXT,
  prefix      TEXT,
  is_running  BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (user_id, platform_id, session_id)
);

CREATE TABLE IF NOT EXISTS bot_admin (
  user_id     TEXT    NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  platform_id INTEGER NOT NULL,
  session_id  TEXT    NOT NULL,
  admin_id    TEXT    NOT NULL,
  PRIMARY KEY (user_id, platform_id, session_id, admin_id)
);

-- ── Platform credentials ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_credential_discord (
  user_id             TEXT    NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  platform_id         INTEGER NOT NULL,
  session_id          TEXT    NOT NULL,
  discord_token       TEXT    NOT NULL,
  discord_client_id   TEXT    NOT NULL,
  is_command_register BOOLEAN NOT NULL DEFAULT FALSE,
  command_hash        TEXT,
  PRIMARY KEY (user_id, platform_id, session_id)
);

CREATE TABLE IF NOT EXISTS bot_credential_telegram (
  user_id             TEXT    NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  platform_id         INTEGER NOT NULL,
  session_id          TEXT    NOT NULL,
  telegram_token      TEXT    NOT NULL,
  is_command_register BOOLEAN NOT NULL DEFAULT FALSE,
  command_hash        TEXT,
  PRIMARY KEY (user_id, platform_id, session_id)
);

CREATE TABLE IF NOT EXISTS bot_credential_facebook_page (
  user_id         TEXT    NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  platform_id     INTEGER NOT NULL,
  session_id      TEXT    NOT NULL,
  fb_access_token TEXT    NOT NULL,
  fb_page_id      TEXT    NOT NULL,
  PRIMARY KEY (user_id, platform_id, session_id)
);

CREATE TABLE IF NOT EXISTS bot_credential_facebook_messenger (
  user_id     TEXT    NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  platform_id INTEGER NOT NULL,
  session_id  TEXT    NOT NULL,
  appstate    TEXT    NOT NULL,
  PRIMARY KEY (user_id, platform_id, session_id)
);

-- ── Session tracking join tables ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_users_session (
  user_id         TEXT    NOT NULL,
  platform_id     INTEGER NOT NULL,
  session_id      TEXT    NOT NULL,
  bot_user_id     TEXT    NOT NULL REFERENCES bot_users(id),
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data            TEXT,
  PRIMARY KEY (user_id, platform_id, session_id, bot_user_id)
);

CREATE TABLE IF NOT EXISTS bot_threads_session (
  user_id         TEXT    NOT NULL,
  platform_id     INTEGER NOT NULL,
  session_id      TEXT    NOT NULL,
  bot_thread_id   TEXT    NOT NULL REFERENCES bot_threads(id),
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data            TEXT,
  PRIMARY KEY (user_id, platform_id, session_id, bot_thread_id)
);

-- ── Webhook ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fb_page_webhook (
  user_id     TEXT    PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE
);

-- ── Command / event overrides ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_session_commands (
  user_id      TEXT    NOT NULL,
  platform_id  INTEGER NOT NULL,
  session_id   TEXT    NOT NULL,
  command_name TEXT    NOT NULL,
  is_enable    BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (user_id, platform_id, session_id, command_name)
);

CREATE TABLE IF NOT EXISTS bot_session_events (
  user_id     TEXT    NOT NULL,
  platform_id INTEGER NOT NULL,
  session_id  TEXT    NOT NULL,
  event_name  TEXT    NOT NULL,
  is_enable   BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (user_id, platform_id, session_id, event_name)
);

-- ── Ban records ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_users_session_banned (
  user_id     TEXT    NOT NULL,
  platform_id INTEGER NOT NULL,
  session_id  TEXT    NOT NULL,
  bot_user_id TEXT    NOT NULL,
  is_banned   BOOLEAN NOT NULL DEFAULT TRUE,
  reason      TEXT,
  PRIMARY KEY (user_id, platform_id, session_id, bot_user_id)
);

CREATE TABLE IF NOT EXISTS bot_threads_session_banned (
  user_id       TEXT    NOT NULL,
  platform_id   INTEGER NOT NULL,
  session_id    TEXT    NOT NULL,
  bot_thread_id TEXT    NOT NULL,
  is_banned     BOOLEAN NOT NULL DEFAULT TRUE,
  reason        TEXT,
  PRIMARY KEY (user_id, platform_id, session_id, bot_thread_id)
);
