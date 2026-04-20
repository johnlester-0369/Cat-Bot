import { useState } from 'react'
import { botService } from '@/features/users/services/bot.service'
import type {
  UpdateBotRequestDto,
  GetBotDetailResponseDto,
} from '@/features/users/dtos/bot.dto'

interface UseBotUpdateReturn {
  isLoading: boolean
  error: string | null
  updateBot: (
    id: string,
    dto: UpdateBotRequestDto,
  ) => Promise<GetBotDetailResponseDto>
}

export function useBotUpdate(): UseBotUpdateReturn {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const updateBot = async (
    id: string,
    dto: UpdateBotRequestDto,
  ): Promise<GetBotDetailResponseDto> => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await botService.updateBot(id, dto)
      return result
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Failed to update bot configuration'
      setError(message)
      throw err // Rethrow to allow local form error handling
    } finally {
      setIsLoading(false)
    }
  }

  return { isLoading, error, updateBot }
}
