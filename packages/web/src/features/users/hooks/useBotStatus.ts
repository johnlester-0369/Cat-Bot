/**
 * useBotStatus — Real-Time Bot Online/Offline Hook
 *
 * Maintains a Map<sessionId, boolean> reflecting live active state.
 *
 * Protocol (Socket.IO events):
 *   → emit  'bot:status:request'  { sessionIds }     on connect / ids change
 *   ← on    'bot:status:response' { statuses }        initial snapshot
 *   ← on    'bot:status:change'   { key, active }     push on every state flip
 *
 * The server key format is `${userId}:${platform}:${sessionId}`.
 * sessionId is a UUID (no `:`), so `.split(':').pop()` reliably extracts it.
 */

import { useEffect, useState } from 'react'
import { getSocket } from '@/lib/socket.lib'

export interface BotStatusState {
  active: boolean
  startedAt: number | null
}

export function useBotStatus(
  sessionIds: string[],
): Record<string, BotStatusState> {
  const [statuses, setStatuses] = useState<Record<string, BotStatusState>>({})
  // Stringify for a stable effect dependency — the caller's array reference changes
  // every render (e.g. .map() in a component), but the actual IDs may be unchanged.
  const idsKey = sessionIds.slice().sort().join(',')

  useEffect(() => {
    if (sessionIds.length === 0) return

    const socket = getSocket()
    if (!socket.connected) socket.connect()

    const requestStatuses = () => {
      socket.emit('bot:status:request', { sessionIds })
    }

    const onResponse = (data: { statuses: Record<string, BotStatusState> }) => {
      setStatuses(data.statuses)
    }

    const onChange = (data: {
      key: string
      active: boolean
      startedAt?: number
    }) => {
      // Extract the sessionId segment from the full `userId:platform:sessionId` key
      const sid = data.key.split(':').pop()
      if (sid !== undefined && sessionIds.includes(sid)) {
        setStatuses((prev) => ({
          ...prev,
          [sid]: { active: data.active, startedAt: data.startedAt ?? null },
        }))
      }
    }

    socket.on('connect', requestStatuses)
    socket.on('bot:status:response', onResponse)
    socket.on('bot:status:change', onChange)

    // Request immediately if already connected; the 'connect' listener covers reconnects
    if (socket.connected) requestStatuses()

    return () => {
      socket.off('connect', requestStatuses)
      socket.off('bot:status:response', onResponse)
      socket.off('bot:status:change', onChange)
    }
  }, [idsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return statuses
}
