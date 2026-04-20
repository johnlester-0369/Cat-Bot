import { useState, useEffect } from 'react'
import { botService } from '@/features/users/services/bot.service'
import type { GetBotDetailResponseDto } from '@/features/users/dtos/bot.dto'

interface UseBotDetailReturn {
  bot: GetBotDetailResponseDto | null
  setBot: React.Dispatch<React.SetStateAction<GetBotDetailResponseDto | null>>
  isLoading: boolean
  error: string | null
}

export function useBotDetail(id: string): UseBotDetailReturn {
  const [bot, setBot] = useState<GetBotDetailResponseDto | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false

    const fetchBot = async (): Promise<void> => {
      setIsLoading(true)
      setError(null)

      try {
        const result = await botService.getBot(id)
        if (!cancelled) {
          setBot(result)
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load bot details',
          )
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void fetchBot()

    return () => {
      cancelled = true
    }
  }, [id])

  return { bot, setBot, isLoading, error }
}
