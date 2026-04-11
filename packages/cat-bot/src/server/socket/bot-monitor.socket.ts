/**
 * Bot Monitor — Socket.IO Handlers for Real-Time Status & Log Streaming
 *
 * Registers two push channels onto the shared Socket.IO server:
 *
 *   1. LOG STREAMING
 *      Subscribes to the logRelay EventEmitter (fed by logger.lib.ts's relay
 *      transport) and broadcasts each entry to all authenticated connections as
 *      'bot:log'. All clients see all process logs — acceptable for self-hosted
 *      deployments where every authenticated user is an operator.
 *
 *   2. BOT STATUS
 *      'bot:status:request' { sessionIds }  → query current active state
 *      'bot:status:response' { statuses }   → Map<sessionId, boolean> response
 *      'bot:status:change' { key, active }  → pushed on every markActive/markInactive
 *
 * Authentication is handled by validation.socket.ts's io.use() middleware which
 * rejects unauthenticated connections before any handler fires.
 */

import type { Server as SocketIOServer } from 'socket.io';
import { sessionManager } from '@/engine/modules/session/session-manager.lib.js';
import { logRelay } from '@/engine/modules/logger/log-relay.lib.js';

export function registerBotMonitorHandlers(io: SocketIOServer): void {
  // ── Global log broadcast ─────────────────────────────────────────────────────
  // Each log entry is forwarded to all connected (authenticated) sockets so every
  // open console tab receives the same live stream without per-session filtering.
  // entry is a raw ANSI string — the client renders it with ansi-to-react.
  logRelay.on('log', (entry: string) => {
    io.emit('bot:log', entry);
  });

  // ── Per-session log forwarding ────────────────────────────────────────────────
  // Routes each keyed log entry to the Socket.IO room for that session so clients
  // subscribed to a specific bot only receive that bot's log stream.
  logRelay.on('log:keyed', (data: { key: string; entry: string }) => {
    io.to(`bot-log:${data.key}`).emit('bot:log:keyed', data.entry);
  });

  // ── Session status broadcast ──────────────────────────────────────────────────
  // Session manager emits 'status' whenever markActive/markInactive is called.
  // The key is the full `${userId}:${platform}:${sessionId}` string; the web client
  // extracts the sessionId (UUID) by splitting on ':' and taking the last segment.
  sessionManager.on(
    'status',
    (data: { key: string; active: boolean; startedAt?: number }) => {
      io.emit('bot:status:change', data);
    },
  );

  // ── Per-connection request handler ────────────────────────────────────────────
  io.on('connection', (socket) => {
    /**
     * Client emits this on page load to receive the current active/inactive state
     * for a list of sessionIds. Returns a flat map of sessionId → boolean so the
     * caller never needs to know the full key format.
     */
    socket.on('bot:status:request', (data: unknown) => {
      const sessionIds =
        data !== null &&
        typeof data === 'object' &&
        Array.isArray((data as Record<string, unknown>)['sessionIds'])
          ? (
              (data as Record<string, unknown>)['sessionIds'] as unknown[]
            ).filter((s): s is string => typeof s === 'string')
          : [];

      const statuses: Record<
        string,
        { active: boolean; startedAt: number | null }
      > = {};
      for (const sid of sessionIds) {
        statuses[sid] = {
          active: sessionManager.getStatusBySessionId(sid),
          startedAt: sessionManager.getStartTimeBySessionId(sid),
        };
      }

      socket.emit('bot:status:response', { statuses });
    });

    // Client requests the sliding window history on page load
    // so the dashboard doesn't start with a blank console
    socket.on('bot:log:request_history', () => {
      socket.emit('bot:log:history', logRelay.getHistory());
    });

    // Subscribe the requesting socket to the session-specific log room and immediately
    // hydrate with the buffered history — prevents a blank console on initial page load.
    socket.on('bot:log:subscribe', (key: unknown) => {
      if (typeof key !== 'string') return;
      void socket.join(`bot-log:${key}`);
      socket.emit('bot:log:history', logRelay.getKeyedHistory(key));
    });

    socket.on('bot:log:unsubscribe', (key: unknown) => {
      if (typeof key !== 'string') return;
      void socket.leave(`bot-log:${key}`);
    });
  });
}
