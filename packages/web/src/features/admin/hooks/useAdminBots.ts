import { useState, useEffect } from 'react'
import { adminService } from '@/features/admin/services/admin.service'
import type { AdminBotItemDto } from '@/features/admin/services/admin.service'

interface UseAdminBotsReturn {
  bots: AdminBotItemDto[]
  isLoading: boolean
  error: string | null
}

export function useAdminBots(): UseAdminBotsReturn {
  const [bots, setBots] = useState<AdminBotItemDto[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const fetchBots = async (): Promise<void> => {
      setIsLoading(true)
      setError(null)
      try {
        const result = await adminService.getAdminBots()
        if (!cancelled) setBots(result.bots)
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load bot sessions',
          )
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void fetchBots()
    return () => {
      cancelled = true
    }
  }, [])

  return { bots, isLoading, error }
}
