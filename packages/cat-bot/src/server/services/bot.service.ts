import { randomUUID } from 'node:crypto';
import axios from 'axios';
import { botRepo } from '@/server/repos/bot.repo.js';
import { spawnDynamicSession } from '@/engine/adapters/platform/index.js';
import { sessionManager } from '@/engine/modules/session/session-manager.lib.js';
import { logger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module
import { prefixManager } from '@/engine/modules/prefix/prefix-manager.lib.js';
import { triggerSlashSync } from '@/engine/modules/prefix/slash-sync.lib.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import {
  withRetry,
  isNetworkError,
  isAuthError,
} from '@/engine/lib/retry.lib.js';
import type {
  CreateBotRequestDto,
  CreateBotResponseDto,
  GetBotListResponseDto,
  GetBotDetailResponseDto,
  UpdateBotRequestDto,
} from '@/server/dtos/bot.dto.js';

// Fetches the Discord Application (Client) ID via the bot token.
// GET /users/@me with a Bot token returns the bot user object whose `id` equals
// the Application ID — removes the need for users to find it in the Developer Portal.
async function fetchDiscordClientId(discordToken: string): Promise<string> {
  const response = await withRetry(
    () =>
      axios.get<{ id: string }>('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bot ${discordToken}` },
      }),
    {
      maxAttempts: 3,
      initialDelayMs: 1000,
      // Auth errors (bad token → 401/403) are immediately fatal; Discord REST 5xx/network
      // faults during bot creation or update should be retried before surfacing to the user
      shouldRetry: (err) => !isAuthError(err) && isNetworkError(err),
    },
  );
  return response.data.id;
}

export class BotService {
  async createBot(
    userId: string,
    dto: CreateBotRequestDto,
  ): Promise<CreateBotResponseDto> {
    // UUID sessionId is generated here, not in the repo, so the service layer
    // owns the identity of each bot instance. One user can run multiple bots
    // per platform under separate sessionIds without composite-PK collisions.
    const sessionId = randomUUID();
    // Always resolve client ID from Discord — web clients omit it; overriding here
    // ensures the repo always receives an authoritative string value for storage.
    const credentials =
      dto.credentials.platform === 'discord'
        ? {
            ...dto.credentials,
            discordClientId: await fetchDiscordClientId(
              dto.credentials.discordToken,
            ),
          }
        : dto.credentials;

    const result = await botRepo.create(userId, sessionId, {
      ...dto,
      credentials,
    });

    // DTO platform types use underscores (e.g. facebook_page) while runtime uses hyphens
    // credentials.platform is already hyphen-format (e.g. 'facebook-page') — no normalisation needed
    const platformStr = credentials.platform;

    let sessionConfig: Parameters<typeof spawnDynamicSession>[1] | undefined;
    if (platformStr === Platforms.Discord && 'discordToken' in credentials) {
      sessionConfig = {
        token: credentials.discordToken,
        clientId: credentials.discordClientId,
        prefix: dto.botPrefix,
        userId,
        sessionId,
      };
    } else if (
      platformStr === Platforms.Telegram &&
      'telegramToken' in credentials
    ) {
      sessionConfig = {
        botToken: credentials.telegramToken,
        prefix: dto.botPrefix,
        userId,
        sessionId,
      };
    } else if (
      platformStr === Platforms.FacebookPage &&
      'fbAccessToken' in credentials
    ) {
      sessionConfig = {
        pageAccessToken: credentials.fbAccessToken,
        pageId: credentials.fbPageId,
        prefix: dto.botPrefix,
        userId,
        sessionId,
      };
    } else if (
      platformStr === Platforms.FacebookMessenger &&
      'appstate' in credentials
    ) {
      sessionConfig = {
        appstate: credentials.appstate,
        prefix: dto.botPrefix,
        userId,
        sessionId,
      };
    }

    // Dynamically set prefix so it's instantly available without querying DB
    prefixManager.setPrefix(userId, platformStr, sessionId, dto.botPrefix);

    if (sessionConfig) {
      // Fire-and-forget: spawn the listener concurrently so the API responds instantly.
      spawnDynamicSession(platformStr, sessionConfig).catch((err) => {
        console.error('[bot.service] Failed to spawn dynamic session:', err);
      });
    }

    return result;
  }

  async getBot(
    userId: string,
    sessionId: string,
  ): Promise<GetBotDetailResponseDto | null> {
    return botRepo.getById(userId, sessionId);
  }

  async updateBot(
    userId: string,
    sessionId: string,
    dto: UpdateBotRequestDto,
  ): Promise<void> {
    const botDetail = await botRepo.getById(userId, sessionId);

    // Re-fetch client ID on update
    const credentials =
      dto.credentials.platform === 'discord'
        ? {
            ...dto.credentials,
            discordClientId: await fetchDiscordClientId(
              dto.credentials.discordToken,
            ),
          }
        : dto.credentials;

    // Determine if credentials changed so we can bypass live slash sync and force a DB hash reset
    const isCredentialsModified = (() => {
      if (!botDetail) return true;
      if (
        botDetail.credentials.platform === Platforms.Discord &&
        credentials.platform === Platforms.Discord
      ) {
        return (
          botDetail.credentials.discordToken !== credentials.discordToken ||
          botDetail.credentials.discordClientId !== credentials.discordClientId
        );
      }
      if (
        botDetail.credentials.platform === Platforms.Telegram &&
        credentials.platform === Platforms.Telegram
      ) {
        return (
          botDetail.credentials.telegramToken !== credentials.telegramToken
        );
      }
      if (
        botDetail.credentials.platform === Platforms.FacebookPage &&
        credentials.platform === Platforms.FacebookPage
      ) {
        return (
          botDetail.credentials.fbAccessToken !== credentials.fbAccessToken ||
          botDetail.credentials.fbPageId !== credentials.fbPageId
        );
      }
      if (
        botDetail.credentials.platform === Platforms.FacebookMessenger &&
        credentials.platform === Platforms.FacebookMessenger
      ) {
        return botDetail.credentials.appstate !== credentials.appstate;
      }
      return true;
    })();

    await botRepo.update(
      userId,
      sessionId,
      { ...dto, credentials },
      isCredentialsModified,
    );

    // credentials.platform is already hyphen-format — no normalisation needed
    const platformStr = dto.credentials.platform;
    prefixManager.setPrefix(userId, platformStr, sessionId, dto.botPrefix);

    const key = `${userId}:${platformStr}:${sessionId}`;
    const isActive = sessionManager.isActive(key);
    const isCurrentlyRetrying = sessionManager.isRetrying(key);

    if (!isCredentialsModified) {
      // Prefix or non-credential settings changed — sync the live slash menu.
      triggerSlashSync(key).catch((err) => {
        logger.warn(
          '[bot.service] Slash sync trigger failed on prefix update',
          { error: err },
        );
      });
      // Stale closure should only be cleared when the session is fully at rest.
      if (!isActive && !isCurrentlyRetrying) {
        await sessionManager.unregister(key);
      }
    } else {
      // Credentials changed — auto-restart so new tokens take effect immediately
      // rather than waiting for a manual dashboard restart.
      if (isActive || isCurrentlyRetrying) {
        // abortRetry() cancels any live back-off loop before the restart; it is a
        // no-op when the session is active-and-running (not retrying).
        sessionManager.abortRetry(key);
        // Fire-and-forget: the API response must not block on transport boot time.
        // After abortRetry the isRetrying guard inside restartBot is already cleared.
        void this.restartBot(userId, sessionId).catch((err) => {
          logger.error(
            '[bot.service] Auto-restart on credential update failed (non-fatal)',
            { error: err },
          );
        });
      } else {
        // Session was intentionally stopped — only evict the stale lifecycle closure.
        await sessionManager.unregister(key);
      }
    }
  }

  // Thin delegation — no additional business logic for listing.
  // Auth is enforced upstream in the controller; service stays auth-agnostic.
  async listBots(userId: string): Promise<GetBotListResponseDto> {
    return botRepo.list(userId);
  }

  /**
   * Sets isRunning = true in the DB then boots the transport.
   * Prefers the registered SessionManager lifecycle (in-process session already initialised).
   * Falls back to spawnDynamicSession when the session was never registered or the process restarted
   * — rebuilds the platform config from stored credentials so no extra API call is needed.
   */
  async startBot(userId: string, sessionId: string): Promise<void> {
    const botDetail = await botRepo.getById(userId, sessionId);
    if (!botDetail) throw new Error(`Bot session ${sessionId} not found`);
    const key = `${userId}:${botDetail.platform}:${sessionId}`;
    // Start is the only action permitted during retry — abort the back-off loop so
    // the session boots immediately with the latest credentials from the database.
    sessionManager.abortRetry(key);
    if (sessionManager.isLocked(key)) {
      throw new Error(`Session is locked processing another action.`);
    }

    await botRepo.updateIsRunning(userId, sessionId, true);

    // Fast path — session lifecycle already registered (was stopped via stop(), not process-killed)
    try {
      await sessionManager.start(key);
      return;
    } catch {
      // Not registered — fall through to fresh spawn
    }

    // Slow path — rebuild config from DB credentials and spawn a fresh transport
    const { credentials, prefix } = botDetail;
    let sessionConfig: Parameters<typeof spawnDynamicSession>[1] | undefined;

    if (credentials.platform === Platforms.Discord) {
      sessionConfig = {
        token: credentials.discordToken,
        clientId: credentials.discordClientId ?? '',
        prefix,
        userId,
        sessionId,
      };
    } else if (credentials.platform === Platforms.Telegram) {
      sessionConfig = {
        botToken: credentials.telegramToken,
        prefix,
        userId,
        sessionId,
      };
    } else if (credentials.platform === Platforms.FacebookPage) {
      sessionConfig = {
        pageAccessToken: credentials.fbAccessToken,
        pageId: credentials.fbPageId,
        prefix,
        userId,
        sessionId,
      };
    } else {
      // facebook-messenger — appstate is the serialised cookie blob
      sessionConfig = {
        appstate: (credentials as { appstate: string }).appstate,
        prefix,
        userId,
        sessionId,
      };
    }

    // botDetail.platform is already hyphen-format ('facebook-page') — matches spawnDynamicSession contract
    spawnDynamicSession(botDetail.platform, sessionConfig).catch(
      (err: unknown) => {
        logger.error('[bot.service] Failed to spawn session on startBot', {
          error: err,
        });
      },
    );
  }

  /**
   * Sets isRunning = false in the DB then tears down the live transport.
   * Silently swallows "not found" from the manager — the session may already be stopped.
   */
  async stopBot(userId: string, sessionId: string): Promise<void> {
    const botDetail = await botRepo.getById(userId, sessionId);
    if (!botDetail) throw new Error(`Bot session ${sessionId} not found`);
    const key = `${userId}:${botDetail.platform}:${sessionId}`;
    // Stop is blocked during retry — only Start may cancel the back-off loop.
    // Allowing Stop here would leave the retry loop running orphaned in the background.
    if (sessionManager.isRetrying(key)) {
      throw new Error(
        `Session is in retry state — use Start to abort the retry first, then Stop.`,
      );
    }
    if (sessionManager.isLocked(key)) {
      throw new Error(`Session is locked processing another action.`);
    }

    await botRepo.updateIsRunning(userId, sessionId, false);

    try {
      await sessionManager.stop(key);
    } catch {
      // Already stopped or process-restarted; DB flag update is sufficient
      logger.warn(
        `[bot.service] stopBot: session ${key} not found in manager (already stopped)`,
      );
    }
  }

  /**
   * Restarts the live transport without touching isRunning.
   * Throws when the session is not registered — only works on sessions currently active in memory.
   */
  async restartBot(userId: string, sessionId: string): Promise<void> {
    const botDetail = await botRepo.getById(userId, sessionId);
    if (!botDetail) throw new Error(`Bot session ${sessionId} not found`);

    const key = `${userId}:${botDetail.platform}:${sessionId}`;
    // Restart is blocked during retry for the same reason as Stop — only Start can
    // cancel the back-off loop safely. updateBot calls abortRetry() before calling
    // restartBot(), so credential-update auto-restarts bypass this guard correctly.
    if (sessionManager.isRetrying(key)) {
      throw new Error(
        `Session is in retry state — use Start to abort the retry first.`,
      );
    }
    if (sessionManager.isLocked(key)) {
      throw new Error(`Session is locked processing another action.`);
    }

    // Force a complete teardown of the old session and rebuild from DB
    if (sessionManager.isActive(key)) {
      try {
        await sessionManager.stop(key);
      } catch (e) {
        logger.warn(`[bot.service] restartBot: failed to stop ${key}`, {
          error: e,
        });
      }
    }
    // Unregister so startBot falls through to a fresh spawn with new credentials
    await sessionManager.unregister(key);
    await this.startBot(userId, sessionId);
  }

  /**
   * Permanently destroys a bot session:
   *   1. Stop the live transport (if running) so no more events are dispatched.
   *   2. Unregister the session closure so the dead key never appears in getActiveKeys().
   *   3. Wipe every DB row that references this (userId, sessionId) pair.
   *
   * This is intentionally more aggressive than stopBot — there is no "undo" path.
   */
  async deleteBot(userId: string, sessionId: string): Promise<void> {
    const botDetail = await botRepo.getById(userId, sessionId);
    if (!botDetail) throw new Error(`Bot session ${sessionId} not found`);

    const key = `${userId}:${botDetail.platform}:${sessionId}`;
    if (sessionManager.isLocked(key)) {
      throw new Error(`Session is locked processing another action.`);
    }

    // Gracefully drain the transport before touching the DB so in-flight messages
    // don't crash against missing credential rows.
    if (sessionManager.isActive(key)) {
      try {
        await sessionManager.stop(key);
      } catch (e) {
        logger.warn(`[bot.service] deleteBot: failed to stop ${key}`, {
          error: e,
        });
      }
    }
    await sessionManager.unregister(key);

    await botRepo.deleteById(userId, sessionId);
    logger.info(`[bot.service] Deleted bot session ${key}`);
  }

  /**
   * Ban-path orchestrator: tears down every live transport for a userId, updates
   * isRunning=false in the DB for all their sessions, and prunes all in-memory state.
   *
   * Order matters:
   *   1. Stop transports first — prevents in-flight messages from landing after DB writes.
   *   2. Set isRunning=false — session-loader skips these on the next boot.
   *   3. Unregister closures — stale lifecycle handles are removed from the manager.
   *   4. Clear LRU cache — ensures subsequent reads see the updated DB state.
   *   5. Clear prefix map — frees memory; entries are re-populated on unban/next message.
   */
  async stopAllUserSessions(userId: string): Promise<void> {
    const { bots } = await botRepo.list(userId);
    if (bots.length === 0) return;

    // Halt all live transports in parallel before touching the DB
    await sessionManager.stopAllByUserId(userId);

    // Persist the stopped state so session-loader never boots these sessions while banned
    await Promise.all(
      bots.map((bot) =>
        botRepo
          .updateIsRunning(userId, bot.sessionId, false)
          .catch((err) =>
            logger.error(
              `[bot.service] Failed to set isRunning=false for ${bot.sessionId} on ban`,
              { error: err },
            ),
          ),
      ),
    );

    // Remove stale closures and all LRU / prefix memory for this user
    await sessionManager.unregisterAllByUserId(userId);
    botRepo.clearUserCache(userId);
    prefixManager.clearAllByUserId(userId);

    logger.info(
      `[bot.service] Stopped ${bots.length} session(s) for banned user ${userId}`,
    );
  }

  /**
   * Unban-path orchestrator: sets isRunning=true and boots a fresh transport for every
   * session that belonged to the user, exactly as if the process had just restarted.
   * startBot handles credential lookup, DB flag update, and spawnDynamicSession internally.
   */
  async startAllUserSessions(userId: string): Promise<void> {
    const { bots } = await botRepo.list(userId);
    if (bots.length === 0) return;

    await Promise.all(
      bots.map(async (bot) => {
        try {
          await this.startBot(userId, bot.sessionId);
        } catch (err) {
          logger.error(
            `[bot.service] Failed to start session ${bot.sessionId} on unban`,
            { error: err },
          );
        }
      }),
    );

    logger.info(
      `[bot.service] Started ${bots.length} session(s) for unbanned user ${userId}`,
    );
  }
}

export const botService = new BotService();
