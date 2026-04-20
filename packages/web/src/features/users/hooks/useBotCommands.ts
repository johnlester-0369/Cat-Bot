import { useState, useEffect, useCallback } from 'react'
import { botService } from '@/features/users/services/bot.service'
import type { BotCommandItemDto } from '@/features/users/dtos/bot.dto'

interface UseBotCommandsReturn {
  commands: BotCommandItemDto[]
  isLoading: boolean
  error: string | null
  // Optimistic update: toggles the local state immediately, calls API in background
  toggleCommand: (name: string, isEnable: boolean) => Promise<void>
}

export function useBotCommands(sessionId: string): UseBotCommandsReturn {
  const [commands, setCommands] = useState<BotCommandItemDto[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) {
      setIsLoading(false)
      return
    }
    let cancelled = false

    const fetchCommands = async (): Promise<void> => {
      setIsLoading(true)
      setError(null)
      try {
        const result = await botService.getCommands(sessionId)
        if (!cancelled) setCommands(result.commands)
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load commands',
          )
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void fetchCommands()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  const toggleCommand = useCallback(
    async (name: string, isEnable: boolean): Promise<void> => {
      // Optimistic update so the toggle feels instant — revert on API error
      setCommands((prev) =>
        prev.map((cmd) =>
          cmd.commandName === name ? { ...cmd, isEnable } : cmd,
        ),
      )
      try {
        await botService.toggleCommand(sessionId, name, isEnable)
      } catch (err) {
        // Revert the optimistic change if the API call failed
        setCommands((prev) =>
          prev.map((cmd) =>
            cmd.commandName === name ? { ...cmd, isEnable: !isEnable } : cmd,
          ),
        )
        setError(
          err instanceof Error ? err.message : 'Failed to toggle command',
        )
      }
    },
    [sessionId],
  )

  return { commands, isLoading, error, toggleCommand }
}
