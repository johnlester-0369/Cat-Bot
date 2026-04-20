import { useState, useEffect, useCallback } from 'react'
import { botService } from '@/features/users/services/bot.service'
import type { BotEventItemDto } from '@/features/users/dtos/bot.dto'

interface UseBotEventsReturn {
  events: BotEventItemDto[]
  isLoading: boolean
  error: string | null
  toggleEvent: (name: string, isEnable: boolean) => Promise<void>
}

export function useBotEvents(sessionId: string): UseBotEventsReturn {
  const [events, setEvents] = useState<BotEventItemDto[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) {
      setIsLoading(false)
      return
    }
    let cancelled = false

    const fetchEvents = async (): Promise<void> => {
      setIsLoading(true)
      setError(null)
      try {
        const result = await botService.getEvents(sessionId)
        if (!cancelled) setEvents(result.events)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load events')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void fetchEvents()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  const toggleEvent = useCallback(
    async (name: string, isEnable: boolean): Promise<void> => {
      setEvents((prev) =>
        prev.map((evt) =>
          evt.eventName === name ? { ...evt, isEnable } : evt,
        ),
      )
      try {
        await botService.toggleEvent(sessionId, name, isEnable)
      } catch (err) {
        setEvents((prev) =>
          prev.map((evt) =>
            evt.eventName === name ? { ...evt, isEnable: !isEnable } : evt,
          ),
        )
        setError(err instanceof Error ? err.message : 'Failed to toggle event')
      }
    },
    [sessionId],
  )

  return { events, isLoading, error, toggleEvent }
}
