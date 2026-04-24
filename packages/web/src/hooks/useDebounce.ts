import { useState, useEffect } from 'react'

/**
 * useDebounce
 * 
 * Delays the update of a value until the specified delay has passed without any new updates.
 * Used primarily to prevent rapid-fire API calls while a user is typing a search query.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}