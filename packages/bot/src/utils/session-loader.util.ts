/**
 * Session Credential Loader — Multi-Session Edition
 *
 * Dynamically discovers every numeric sub-directory under session/{platform}/ and
 * loads credentials for each one, returning arrays of resolved configs. Adding a new
 * account requires only creating a new numbered folder — no code changes needed.
 *
 * Expected directory layout (relative to packages/bot/):
 *   session/{userId}/discord/{id}/config.json            → { "PREFIX": "/" }
 *   session/{userId}/discord/{id}/credential.json        → { "DISCORD_TOKEN": "...", "DISCORD_CLIENT_ID": "..." }
 *   session/{userId}/telegram/{id}/config.json           → { "PREFIX": "/" }
 *   session/{userId}/telegram/{id}/credential.json       → { "TELEGRAM_BOT_TOKEN": "..." }
 *   session/{userId}/facebook-page/{id}/config.json      → { "PREFIX": "/" }
 *   session/{userId}/facebook-page/{id}/credential.json  → { "FB_PAGE_ACCESS_TOKEN": "...", "FB_PAGE_VERIFY_TOKEN": "..." }
 *   session/{userId}/facebook-messenger/{id}/config.json → { "PREFIX": "/" }
 *   session/{userId}/facebook-messenger/{id}/appstate.json → (fca-unofficial session cookies)
 *
 * {userId} is any top-level numeric directory under session/ (e.g. "1", "2").
 * Multiple users are supported — each owns their own set of platform sessions.
 * PREFIX resolution: each session's config.json is authoritative for that session.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Two levels up from src/utils/ reaches packages/bot/ where session/ sits alongside src/
const SESSION_ROOT = path.join(__dirname, '..', '..', 'session');

// ── Resolved config shapes (exported for consumers) ───────────────────────────

/** Resolved Discord session config — one entry per discovered session directory. */
export interface ResolvedDiscordConfig {
  token: string;
  clientId: string;
  prefix: string;
  userId: string;
  sessionId: string;
}

/** Resolved Telegram session config — one entry per discovered session directory. */
export interface ResolvedTelegramConfig {
  botToken: string;
  prefix: string;
  userId: string;
  sessionId: string;
}

/** Resolved Facebook Page session config — one entry per discovered session directory. */
export interface ResolvedFbPageConfig {
  pageAccessToken: string;
  verifyToken: string;
  /** Facebook Page ID — read directly from credential.json (FB_PAGE_ID) to avoid the
   *  pages_read_engagement permission that GET /me requires but most app reviews block. */
  pageId: string;
  /** Numeric user directory name (e.g. "1") — used as the :user_id URL segment in /facebook-page/:user_id. */
  userId: string;
  /** Numeric session directory name (e.g. "1", "2") — identifies the session within the user namespace. */
  sessionId: string;
  prefix: string;
}

/**
 * Resolved Facebook Messenger session config — one entry per discovered session directory.
 * Messenger auth uses appstate.json (cookies) rather than a credential.json token.
 */
export interface ResolvedFbMessengerConfig {
  /** Absolute path to the session directory that contains appstate.json. */
  sessionPath: string;
  prefix: string;
  userId: string;
  sessionId: string;
}

/** Fully-resolved configuration for all platforms, consumed by app.ts. */
export interface SessionConfigs {
  discord: ResolvedDiscordConfig[];
  telegram: ResolvedTelegramConfig[];
  fbPage: ResolvedFbPageConfig[];
  fbMessenger: ResolvedFbMessengerConfig[];
}

// ── Internal raw shapes (file-parsing only) ───────────────────────────────────

interface RawDiscordCredential {
  DISCORD_TOKEN?: string;
  DISCORD_CLIENT_ID?: string;
}

interface RawTelegramCredential {
  TELEGRAM_BOT_TOKEN?: string;
}

interface RawFbPageCredential {
  FB_PAGE_ACCESS_TOKEN?: string;
  FB_PAGE_ID?: string;
}

/** Shared per-user verify token — lives at session/{userId}/facebook-page/verify_token.json */
interface RawFbPageVerifyToken {
  FB_PAGE_VERIFY_TOKEN?: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Reads and JSON-parses a session file.
 * Returns null on any file-system or JSON parse error — callers treat absence
 * as "not configured" without duplicating try/catch at every call site.
 */
function readSessionJson<T>(
  userId: string,
  platform: string,
  sessionId: string,
  filename: string,
): T | null {
  // Path includes the user-id tier: session/{userId}/{platform}/{sessionId}/{filename}
  const filePath = path.join(
    SESSION_ROOT,
    userId,
    platform,
    sessionId,
    filename,
  );
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

/**
 * Reads and JSON-parses a platform-level file (no session sub-directory).
 * Used for files shared across all sessions of a platform — e.g. verify_token.json,
 * which is scoped to a userId rather than an individual session directory.
 * Returns null on any file-system or JSON parse error — callers treat absence as unconfigured.
 */
function readPlatformJson<T>(
  userId: string,
  platform: string,
  filename: string,
): T | null {
  const filePath = path.join(SESSION_ROOT, userId, platform, filename);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

/**
 * Discovers all numeric user directories directly under session/.
 * Each user directory owns one or more platform sub-directories.
 * Returns an empty array when the session root is absent or unreadable.
 */
function discoverUserIds(): string[] {
  if (!fs.existsSync(SESSION_ROOT)) return [];
  try {
    return fs
      .readdirSync(SESSION_ROOT)
      .filter((name) => /^\d+$/.test(name))
      .sort((a, b) => Number(a) - Number(b));
  } catch {
    return [];
  }
}

/**
 * Discovers all numeric session directories under session/{userId}/{platform}/.
 * Results are sorted ascending (1, 2, 3, …) so session 1 is always first — identical
 * behaviour to the previous single-session implementation for existing deployments.
 * Returns an empty array when the platform directory is absent or unreadable.
 */
function discoverSessionIds(userId: string, platform: string): string[] {
  const platformDir = path.join(SESSION_ROOT, userId, platform);
  if (!fs.existsSync(platformDir)) return [];
  try {
    return fs
      .readdirSync(platformDir)
      .filter((name) => /^\d+$/.test(name))
      .sort((a, b) => Number(a) - Number(b));
  } catch {
    return [];
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Loads and validates all platform credentials from session/ JSON files.
 * Iterates user directories first, then platforms within each user — supporting
 * multiple independent users each owning separate sets of platform sessions.
 * All missing required fields are collected before process.exit(1) so operators
 * see the full error list in a single restart rather than fixing one gap at a time.
 *
 * Platforms with no session directories are silently skipped — the bot starts
 * without that transport rather than failing the entire process.
 */
export function loadSessionConfigs(): SessionConfigs {
  // Discover all user directories — each is an independent credential namespace
  const userIds = discoverUserIds();

  const discord: ResolvedDiscordConfig[] = [];
  const telegram: ResolvedTelegramConfig[] = [];
  const fbPage: ResolvedFbPageConfig[] = [];
  const fbMessenger: ResolvedFbMessengerConfig[] = [];
  // Collected across all users before exit so operators see every missing field at once
  const missing: string[] = [];

  for (const userId of userIds) {
    const discordIds = discoverSessionIds(userId, 'discord');
    const telegramIds = discoverSessionIds(userId, 'telegram');
    const fbPageIds = discoverSessionIds(userId, 'facebook-page');
    const fbMessengerIds = discoverSessionIds(userId, 'facebook-messenger');

    // ── Discord sessions for this user ─────────────────────────────────────
    for (const id of discordIds) {
      const cred =
        readSessionJson<RawDiscordCredential>(
          userId,
          'discord',
          id,
          'credential.json',
        ) ?? {};
      if (!cred.DISCORD_TOKEN)
        missing.push(
          `session/${userId}/discord/${id}/credential.json → DISCORD_TOKEN`,
        );
      else if (!cred.DISCORD_CLIENT_ID)
        missing.push(
          `session/${userId}/discord/${id}/credential.json → DISCORD_CLIENT_ID`,
        );
      else {
        // WHY: Attach prefix explicitly to session configuration instead of global scoping
        const cfg =
          readSessionJson<{ PREFIX?: string }>(
            userId,
            'discord',
            id,
            'config.json',
          ) ?? {};
        discord.push({
          token: cred.DISCORD_TOKEN,
          clientId: cred.DISCORD_CLIENT_ID,
          prefix: cfg.PREFIX ?? '/',
          userId,
          sessionId: id,
        });
      }
    }

    // ── Telegram sessions for this user ────────────────────────────────────
    for (const id of telegramIds) {
      const cred =
        readSessionJson<RawTelegramCredential>(
          userId,
          'telegram',
          id,
          'credential.json',
        ) ?? {};
      if (!cred.TELEGRAM_BOT_TOKEN)
        missing.push(
          `session/${userId}/telegram/${id}/credential.json → TELEGRAM_BOT_TOKEN`,
        );
      else {
        const cfg =
          readSessionJson<{ PREFIX?: string }>(
            userId,
            'telegram',
            id,
            'config.json',
          ) ?? {};
        telegram.push({
          botToken: cred.TELEGRAM_BOT_TOKEN,
          prefix: cfg.PREFIX ?? '/',
          userId,
          sessionId: id,
        });
      }
    }

    // ── Facebook Page sessions for this user ───────────────────────────────
    // verify_token.json lives at session/{userId}/facebook-page/verify_token.json —
    // one token per user, shared across every session directory under that user.
    // Reading it once before the session loop avoids redundant file I/O per session.
    const verifyTokenCfg =
      readPlatformJson<RawFbPageVerifyToken>(
        userId,
        'facebook-page',
        'verify_token.json',
      ) ?? {};

    for (const id of fbPageIds) {
      const cred =
        readSessionJson<RawFbPageCredential>(
          userId,
          'facebook-page',
          id,
          'credential.json',
        ) ?? {};
      if (!cred.FB_PAGE_ACCESS_TOKEN)
        missing.push(
          `session/${userId}/facebook-page/${id}/credential.json → FB_PAGE_ACCESS_TOKEN`,
        );
      else if (!verifyTokenCfg.FB_PAGE_VERIFY_TOKEN)
        // Points to the new shared location so operators know exactly which file to populate
        missing.push(
          `session/${userId}/facebook-page/verify_token.json → FB_PAGE_VERIFY_TOKEN`,
        );
      else if (!cred.FB_PAGE_ID)
        missing.push(
          `session/${userId}/facebook-page/${id}/credential.json → FB_PAGE_ID`,
        );
      else {
        const cfg =
          readSessionJson<{ PREFIX?: string }>(
            userId,
            'facebook-page',
            id,
            'config.json',
          ) ?? {};
        // exactOptionalPropertyTypes forbids assigning undefined to an optional slot —
        // port is no longer resolved here; webhook.ts reads process.env.PORT directly
        const resolved: ResolvedFbPageConfig = {
          pageAccessToken: cred.FB_PAGE_ACCESS_TOKEN,
          // Narrowed to string by the else-if guard above — safe without a ?? fallback
          verifyToken: verifyTokenCfg.FB_PAGE_VERIFY_TOKEN,
          pageId: cred.FB_PAGE_ID,
          userId,
          sessionId: id,
          prefix: cfg.PREFIX ?? '/',
        };
        fbPage.push(resolved);
      }
    }

    // ── Facebook Messenger sessions for this user ──────────────────────────
    // Messenger authenticates via appstate.json (session cookies) — no credential.json.
    // sessionPath includes userId so each user's appstate is fully isolated.
    for (const id of fbMessengerIds) {
      const cfg =
        readSessionJson<{ PREFIX?: string }>(
          userId,
          'facebook-messenger',
          id,
          'config.json',
        ) ?? {};
      fbMessenger.push({
        sessionPath: path.join(SESSION_ROOT, userId, 'facebook-messenger', id),
        prefix: cfg.PREFIX ?? '/',
        userId,
        sessionId: id,
      });
    }
  }

  // ── Validation gate ────────────────────────────────────────────────────────
  if (missing.length > 0) {
    console.error('❌ Missing required session credentials:');
    for (const m of missing) console.error(`   - ${m}`);
    console.error(
      '   Populate the credential.json files under session/ and restart.',
    );
    process.exit(1);
  }

  return {
    discord,
    telegram,
    fbPage,
    fbMessenger,
  };
}
