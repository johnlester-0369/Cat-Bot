/**
 * useBotLogs — Real-Time Bot Log Stream Hook
 *
 * History is fetched once via HTTP (GET /api/v1/bots/:id/logs) on mount — this
 * avoids the global broadcast problem where every authenticated socket received
 * all server process logs regardless of which bot the tab was viewing.
 *
 * Real-time entries arrive exclusively via the per-session Socket.IO room
 * ('bot:log:keyed') keyed by `userId:platformId:sessionId`. No global 'bot:log'
 * event is emitted by the server; this hook never listens for one.
 *
 * Capped at MAX_ENTRIES to prevent unbounded memory growth during long sessions.
 */

import { useCallback, useEffect, useState } from 'react'
import { getSocket } from '@/lib/socket.lib'
import { botService } from '@/features/users/services/bot.service'

const MAX_ENTRIES = 200

interface UseBotLogsReturn {
  logs: string[]
  clearLogs: () => void
}

export function useBotLogs(sessionKey?: string): UseBotLogsReturn {
  const [logs, setLogs] = useState<string[]>([])

  // Extract the UUID sessionId from sessionKey for HTTP history fetching.
  // sessionKey format is `userId:platformId:sessionId` — UUID never contains ':',
  // platformId is an integer, userId is a cuid2 — all safe to split by ':'.
  const sessionId = sessionKey?.split(':').pop()

  // Fetch buffered history once via HTTP on mount. Using a dedicated REST call
  // instead of socket history delivery means only the requesting user sees this
  // session's logs — no broadcast to other authenticated sockets.
  useEffect(() => {
    if (!sessionId) return
    let cancelled = false

    botService
      .getLogs(sessionId)
      .then((result) => {
        if (!cancelled) {
          setLogs(result.entries.slice(-MAX_ENTRIES))
        }
      })
      .catch(() => {
        // fail-open — console starts blank; real-time entries still arrive via socket
      })

    return () => {
      cancelled = true
    }
  }, [sessionId])

  // Subscribe to the per-session socket room for real-time entries only.
  // 'bot:log:subscribe' joins the room and increments logRelay's subscriber count
  // so server-side emitKeyed begins broadcasting for this session key.
  useEffect(() => {
    if (!sessionKey) return

    let cancelled = false

    const socket = getSocket()
    if (!socket.connected) socket.connect()

    const onLog = (data: { key: string; entry: string }) => {
      if (cancelled) return
      // Reject entries emitted by other sessions sharing this singleton socket.
      // The server emits to a room, but the client listener fires for every
      // 'bot:log:keyed' received across all joined rooms simultaneously.
      if (data.key !== sessionKey) return
      setLogs((prev) => {
        const next = [...prev, data.entry]
        return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next
      })
    }

    socket.on('bot:log:keyed', onLog)
    socket.emit('bot:log:subscribe', sessionKey)

    return () => {
      socket.off('bot:log:keyed', onLog)
      // Decrement subscriber count so emitKeyed stops broadcasting when the
      // console tab closes or unmounts — prevents bandwidth waste on idle sessions.
      socket.emit('bot:log:unsubscribe', sessionKey)
      cancelled = true
    }
  }, [sessionKey])

  // Clears local log state then tells the server to purge the per-session history buffer.
  // Server purge runs first so a near-simultaneous incoming log doesn't land in
  // a blank history and then get wiped by a lagging client-side setLogs([]).
  const clearLogs = useCallback(() => {
    if (sessionKey) {
      const socket = getSocket()
      socket.emit('bot:log:clear', sessionKey)
    }
    setLogs([])
  }, [sessionKey])

  return { logs, clearLogs }
}