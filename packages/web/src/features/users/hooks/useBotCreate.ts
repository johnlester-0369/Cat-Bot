import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { botService } from '@/features/users/services/bot.service'
import type { CreateBotRequestDto } from '@/features/users/dtos/bot.dto'
import { ROUTES } from '@/constants/routes.constants'

interface UseBotCreateReturn {
  isLoading: boolean
  error: string | null
  createBot: (dto: CreateBotRequestDto) => Promise<void>
}

export function useBotCreate(): UseBotCreateReturn {
  const navigate = useNavigate()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createBot = async (dto: CreateBotRequestDto): Promise<void> => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await botService.createBot(dto)
      // Use the server-assigned sessionId as the bot identifier — it's the composite PK
      // segment that makes each bot instance unique across platforms and users.
      navigate(`${ROUTES.DASHBOARD.BOT}?id=${result.sessionId}`)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to create bot'
      setError(message)
    } finally {
      // Always restore the submit button regardless of success or failure so the
      // user can retry without a page refresh.
      setIsLoading(false)
    }
  }

  return { isLoading, error, createBot }
}
