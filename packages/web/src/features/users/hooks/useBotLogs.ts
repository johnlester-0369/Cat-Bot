/**
 * useBotLogs — Real-Time Bot Log Stream Hook
 *
 * Subscribes to 'bot:log' events broadcast by bot-monitor.socket.ts, which
 * forwards every Winston log line as a raw ANSI string — identical to what
 * the server terminal prints. ansi-to-react in the UI renders the colours.
 *
 * Capped at MAX_ENTRIES to prevent unbounded memory growth during long sessions.
 */

import { useCallback, useEffect, useState } from 'react'
import { getSocket } from '@/lib/socket.lib'

const MAX_ENTRIES = 200

interface UseBotLogsReturn {
  logs: string[]
  clearLogs: () => void
}

export function useBotLogs(sessionKey?: string): UseBotLogsReturn {
  const [logs, setLogs] = useState<string[]>([])

  useEffect(() => {
    // Defer subscription until the session key is known — bot DTO loads async and
    // subscribing to an empty room would result in a permanently blank console.
    if (!sessionKey) return

    // Track unmounts to prevent state updates on unmounted components and fix ReferenceError
    let cancelled = false

    const socket = getSocket()
    if (!socket.connected) socket.connect()

    const onHistory = (entries: string[]) => {
      if (cancelled) return
      // Hydrate with the server's per-session sliding window on subscribe
      setLogs(entries.slice(-MAX_ENTRIES))
    }

    const onLog = (entry: string) => {
      if (cancelled) return
      setLogs((prev) => {
        const next = [...prev, entry]
        return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next
      })
    }

    socket.on('bot:log:history', onHistory)
    socket.on('bot:log:keyed', onLog)

    // Join the session-specific room — server responds immediately with buffered history
    socket.emit('bot:log:subscribe', sessionKey)

    return () => {
      socket.off('bot:log:history', onHistory)
      socket.off('bot:log:keyed', onLog)
      cancelled = true
    }
  }, [sessionKey])

  // Clears local log state then tells the server to purge the per-session history buffer.
  // Order matters: server purge first so a near-simultaneous incoming log doesn't land in
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
