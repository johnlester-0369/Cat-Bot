import { useState, useEffect } from 'react'
import {
  webhookService,
  type FbWebhookInfoDto,
} from '@/features/users/services/webhook.service'

interface UseFbWebhookReturn {
  data: FbWebhookInfoDto | null
  isLoading: boolean
  error: string | null
}

export function useFbWebhook(): UseFbWebhookReturn {
  const [data, setData] = useState<FbWebhookInfoDto | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const fetchInfo = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const result = await webhookService.getFacebookWebhookInfo()
        if (!cancelled) {
          setData(result)
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to load webhook details',
          )
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void fetchInfo()

    return () => {
      cancelled = true
    }
  }, [])

  return { data, isLoading, error }
}
