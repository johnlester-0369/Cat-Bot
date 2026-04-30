/**
 * Bot Monitor — Socket.IO Handlers for Real-Time Status & Log Streaming
 *
 * Registers two push channels onto the shared Socket.IO server:
 *
 *   1. PER-SESSION LOG STREAMING
 *      Subscribes to logRelay's 'log:keyed' event and forwards each entry
 *      exclusively to the Socket.IO room scoped to that session key
 *      ('bot-log:<userId>:<platformId>:<sessionId>'). Only the client
 *      that subscribed via 'bot:log:subscribe' receives that session's logs.
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
  // ── Per-session log forwarding — keyed rooms only, no global broadcast ───────
  // Routes each keyed log entry to the Socket.IO room for that session so clients
  // subscribed to a specific bot only receive that bot's log stream.
  logRelay.on('log:keyed', (data: { key: string; entry: string }) => {
    // Include the session key in the payload so each client-side handler can filter by its
    // own sessionKey. The singleton socket may join multiple bot-log rooms simultaneously
    // (concurrent bot detail pages open), making the event name alone insufficient to isolate
    // which hook instance should process a given delivery.
    io.to(`bot-log:${data.key}`).emit('bot:log:keyed', { key: data.key, entry: data.entry });
  });

  // ── Session status broadcast ──────────────────────────────────────────────────
  // The key is the full `${userId}:${platform}:${sessionId}` string; the web client
  // extracts the sessionId (UUID) by splitting on ':' and taking the last segment.
  sessionManager.on(
    'status',
    (data: { key: string; active: boolean; startedAt?: number }) => {
      io.emit('bot:status:change', data);
    },
  );

  // Tracks which session keys each socket has subscribed to for accurate subscriber-count
  // cleanup on disconnect — prevents phantom entries from keeping emitKeyed emitting.
  const socketSubscriptions = new Map<string, Set<string>>();

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

    // Subscribe the socket to the session-specific room for real-time log streaming.
    // History is fetched separately via HTTP GET /api/v1/bots/:id/logs on mount —
    // decouples history hydration from the socket lifecycle and avoids global delivery.
    socket.on('bot:log:subscribe', (key: unknown) => {
      if (typeof key !== 'string') return;
      void socket.join(`bot-log:${key}`);
      // Guard: only count once per socket per key — a Set deduplicates so re-subscribing
      // without unsubscribing first does not inflate the count and corrupt later cleanup.
      const subs = socketSubscriptions.get(socket.id) ?? new Set<string>();
      socketSubscriptions.set(socket.id, subs);
      if (!subs.has(key)) {
        subs.add(key);
        logRelay.addSubscriber(key);
      }
    });

    socket.on('bot:log:unsubscribe', (key: unknown) => {
      if (typeof key !== 'string') return;
      void socket.leave(`bot-log:${key}`);
      // Only decrement when this socket was actually counted — prevents underflow from
      // duplicate unsubscribe calls that were never matched by an addSubscriber.
      if (socketSubscriptions.get(socket.id)?.delete(key)) {
        logRelay.removeSubscriber(key);
      }
    });

    // Purge the server-side history buffer so the next subscribe hydration on this session
    // key delivers only post-restart logs — client emits this before clearing its local state.
    socket.on('bot:log:clear', (key: unknown) => {
      if (typeof key !== 'string') return;
      logRelay.clearKeyedHistory(key);
    });

    // Decrement subscriber counts for every log room this socket had joined.
    // Without this, phantom subscriber entries keep emitKeyed emitting into empty rooms
    // after a browser tab closes — one leaked entry per page visit would accumulate.
    socket.on('disconnect', () => {
      const keys = socketSubscriptions.get(socket.id);
      if (keys) {
        for (const key of keys) {
          logRelay.removeSubscriber(key);
        }
        socketSubscriptions.delete(socket.id);
      }
    });
  });
}
