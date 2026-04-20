import { useState, useEffect } from 'react'
import { botService } from '@/features/users/services/bot.service'
import type { GetBotListItemDto } from '@/features/users/dtos/bot.dto'

interface UseBotListReturn {
  bots: GetBotListItemDto[]
  isLoading: boolean
  error: string | null
}

export function useBotList(): UseBotListReturn {
  const [bots, setBots] = useState<GetBotListItemDto[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // The cancelled flag prevents stale state updates when the component unmounts
    // before the request resolves — avoids the React StrictMode double-invoke warning.
    let cancelled = false

    const fetchBots = async (): Promise<void> => {
      setIsLoading(true)
      setError(null)

      try {
        const result = await botService.listBots()
        if (!cancelled) {
          setBots(result.bots)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load bots')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void fetchBots()

    return () => {
      cancelled = true
    }
  }, [])

  return { bots, isLoading, error }
}
