import { useState, useEffect, useCallback } from 'react'
import { botService } from '@/features/users/services/bot.service'
import type { BotEventItemDto } from '@/features/users/dtos/bot.dto'
import type { GetBotEventsResponseDto } from '@/features/users/dtos/bot.dto'

interface UseBotEventsReturn {
  events: BotEventItemDto[]
  total: number
  totalPages: number
  isLoading: boolean
  error: string | null
  toggleEvent: (name: string, isEnable: boolean) => Promise<void>
}

export function useBotEvents(sessionId: string, page = 1, limit = 12, search = ''): UseBotEventsReturn {
  const [data, setData] = useState<GetBotEventsResponseDto | null>(null)
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
        const result = await botService.getEvents(sessionId, page, limit, search)
        if (!cancelled) setData(result)
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
  }, [sessionId, page, limit, search])

  const toggleEvent = useCallback(
    async (name: string, isEnable: boolean): Promise<void> => {
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          events: prev.events.map((evt) =>
            evt.eventName === name ? { ...evt, isEnable } : evt,
          ),
        }
      })
      
      try {
        await botService.toggleEvent(sessionId, name, isEnable)
      } catch (err) {
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            events: prev.events.map((evt) =>
              evt.eventName === name ? { ...evt, isEnable: !isEnable } : evt,
            ),
          }
        })
        setError(err instanceof Error ? err.message : 'Failed to toggle event')
      }
    },
    [sessionId],
  )

  return { 
    events: data?.events ?? [], 
    total: data?.total ?? 0, 
    totalPages: data?.totalPages ?? 0, 
    isLoading, 
    error, 
    toggleEvent 
  }
}
