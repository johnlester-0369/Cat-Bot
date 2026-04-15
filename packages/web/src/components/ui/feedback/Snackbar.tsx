import React, { useEffect, useState, useCallback } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/utils/cn.util'

// ============================================================================
// Types
// ============================================================================

/**
 * Snackbar visual style variants
 * Following Material Design patterns with library's variant naming convention:
 * - standard: Inverse surface colors (classic Material Design)
 * - tonal: Soft container background
 * - filled: Solid semantic color background
 */
export type SnackbarVariant = 'standard' | 'tonal' | 'filled'

/**
 * Snackbar color options for tonal/filled variants
 * Standard variant uses inverse surface colors
 */
export type SnackbarColor =
  | 'neutral'
  | 'primary'
  | 'secondary'
  | 'success'
  | 'error'
  | 'warning'
  | 'info'

/**
 * Snackbar position on screen
 * Material Design recommends bottom-center as default
 */
export type SnackbarPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

export interface SnackbarAction {
  label: string
  onClick: () => void
}

export interface SnackbarProps {
  /** Unique identifier */
  id: string
  /** Visual variant style */
  variant?: SnackbarVariant
  /** Color scheme (for tonal/filled variants) */
  color?: SnackbarColor
  /** Brief message to display */
  message: string
  /** Optional icon element displayed on the left side — inherits snackbar text color via currentColor */
  icon?: React.ReactNode
  /** Optional single action button */
  action?: SnackbarAction
  /** Show close/dismiss button */
  showClose?: boolean
  /** Duration in milliseconds before auto-dismiss (0 = no auto-dismiss) */
  duration?: number
  /** Callback when snackbar is dismissed */
  onDismiss?: (id: string) => void
  /** Additional CSS classes */
  className?: string
}

// ============================================================================
// Style Mappings
// ============================================================================

/**
 * Standard variant - Material Design inverse surface colors
 * Uses inverse-surface for background, inverse-on-surface for text
 * This ensures proper contrast in both light and dark modes
 */
const standardStyles = 'bg-inverse-surface text-inverse-on-surface'

/**
 * Tonal variant styles by color
 */
const tonalStyles: Record<SnackbarColor, string> = {
  neutral: 'bg-surface-container-highest text-on-surface',
  primary: 'bg-primary-container text-on-primary-container',
  secondary: 'bg-secondary-container text-on-secondary-container',
  success: 'bg-success-container text-on-success-container',
  error: 'bg-error-container text-on-error-container',
  warning: 'bg-warning-container text-on-warning-container',
  info: 'bg-info-container text-on-info-container',
}

/**
 * Filled variant styles by color
 * Neutral uses inverse surface for overlay-style appearance
 */
const filledStyles: Record<SnackbarColor, string> = {
  neutral: 'bg-inverse-surface text-inverse-on-surface',
  primary: 'bg-primary text-on-primary',
  secondary: 'bg-secondary text-on-secondary',
  success: 'bg-success text-on-success',
  error: 'bg-error text-on-error',
  warning: 'bg-warning text-on-warning',
  info: 'bg-info text-on-info',
}

/**
 * Action button styles by variant and color
 * Standard and filled-neutral use inverse-primary for proper contrast
 */
const getActionButtonStyles = (
  variant: SnackbarVariant,
  color: SnackbarColor,
): string => {
  const base =
    'px-3 py-1 rounded-md text-label-lg font-medium transition-all duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1'

  if (variant === 'standard') {
    // Inverse primary for standard snackbar (inverse surface background)
    return cn(
      base,
      'text-inverse-primary hover:bg-inverse-on-surface/10 focus-visible:ring-inverse-on-surface',
    )
  }

  if (variant === 'filled') {
    if (color === 'neutral') {
      // Filled neutral also uses inverse surface, so use inverse-primary
      return cn(
        base,
        'text-inverse-primary hover:bg-inverse-on-surface/10 focus-visible:ring-inverse-on-surface',
      )
    }
    // Other filled colors use surface/20 for contrast
    return cn(
      base,
      'text-inherit hover:bg-surface/20 focus-visible:ring-surface',
    )
  }

  // Tonal variant - use primary action color matching the theme
  const tonalActionColors: Record<SnackbarColor, string> = {
    neutral: 'text-primary hover:bg-primary/10 focus-visible:ring-primary',
    primary: 'text-primary hover:bg-primary/10 focus-visible:ring-primary',
    secondary:
      'text-secondary hover:bg-secondary/10 focus-visible:ring-secondary',
    success: 'text-success hover:bg-success/10 focus-visible:ring-success',
    error: 'text-error hover:bg-error/10 focus-visible:ring-error',
    warning: 'text-warning hover:bg-warning/10 focus-visible:ring-warning',
    info: 'text-info hover:bg-info/10 focus-visible:ring-info',
  }

  return cn(base, tonalActionColors[color])
}

/**
 * Get variant styles based on variant and color
 */
const getVariantStyles = (
  variant: SnackbarVariant,
  color: SnackbarColor,
): string => {
  switch (variant) {
    case 'standard':
      return standardStyles
    case 'tonal':
      return tonalStyles[color]
    case 'filled':
      return filledStyles[color]
    default:
      return standardStyles
  }
}

// ============================================================================
// Snackbar Component
// ============================================================================

/**
 * Snackbar component - Brief messages about app processes
 *
 * Based on Material Design 3 Snackbar specifications:
 * - Brief, non-critical messages
 * - Temporary display with auto-dismiss
 * - Optional single action
 * - Fixed position (typically bottom-center)
 * - One snackbar at a time (recommended)
 * - Uses inverse surface colors for proper contrast
 *
 * @example
 * ```tsx
 * // Basic usage
 * <Snackbar
 *   id="1"
 *   message="Changes saved"
 *   onDismiss={handleDismiss}
 * />
 *
 * // With action
 * <Snackbar
 *   id="2"
 *   message="Item deleted"
 *   action={{ label: 'Undo', onClick: handleUndo }}
 *   onDismiss={handleDismiss}
 * />
 *
 * // Tonal variant with color
 * <Snackbar
 *   id="3"
 *   variant="tonal"
 *   color="success"
 *   message="Upload complete"
 *   onDismiss={handleDismiss}
 * />
 * ```
 */
const Snackbar: React.FC<SnackbarProps> = ({
  id,
  variant = 'standard',
  color = 'neutral',
  message,
  icon,
  action,
  showClose = false,
  duration = 4000,
  onDismiss,
  className,
}) => {
  const [isExiting, setIsExiting] = useState(false)
  const [isVisible, setIsVisible] = useState(false)

  // Handle dismiss with exit animation
  const handleDismiss = useCallback(() => {
    setIsExiting(true)
    setTimeout(() => {
      onDismiss?.(id)
    }, 200) // Match exit animation duration
  }, [id, onDismiss])

  // Entrance animation
  useEffect(() => {
    // Small delay for entrance animation
    const showTimer = setTimeout(() => setIsVisible(true), 10)
    return () => clearTimeout(showTimer)
  }, [])

  // Auto-dismiss timer
  useEffect(() => {
    if (duration <= 0) return

    const timer = setTimeout(() => {
      handleDismiss()
    }, duration)

    return () => clearTimeout(timer)
  }, [duration, handleDismiss])

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleDismiss()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [handleDismiss])

  const variantStyles = getVariantStyles(variant, color)

  return (
    <div
      className={cn(
        // Base styles
        // w-full on mobile spans the container, reverts to fixed min/max widths on tablet+
        'flex items-center gap-3 px-4 py-3 rounded-lg shadow-elevation-3 w-full sm:w-auto sm:min-w-[288px] max-w-full sm:max-w-[568px]',
        // Typography
        'text-body-md',
        // Variant styles
        variantStyles,
        // Animations
        'transition-all duration-normal ease-standard',
        isVisible && !isExiting && 'translate-y-0 opacity-100',
        !isVisible && 'translate-y-4 opacity-0',
        isExiting && 'translate-y-4 opacity-0 scale-95',
        className,
      )}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {/* Icon slot — renders before message; shrink-0 prevents compression on long messages */}
      {icon && <span className="flex items-center shrink-0">{icon}</span>}
      {/* Message */}
      <p className="flex-1 leading-relaxed">{message}</p>

      {/* Action button */}
      {action && (
        <button
          onClick={() => {
            action.onClick()
            handleDismiss()
          }}
          className={getActionButtonStyles(variant, color)}
        >
          {action.label}
        </button>
      )}

      {/* Close button */}
      {showClose && (
        <button
          onClick={handleDismiss}
          className={cn(
            'p-1 rounded-md hover:opacity-70 transition-opacity duration-fast',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-1',
          )}
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

export default Snackbar

// ============================================================================
// Snackbar Container Component
// ============================================================================

export interface SnackbarContainerProps {
  /** Position of snackbar container */
  position?: SnackbarPosition
  /** Current snackbar to display (one at a time per Material Design) */
  snackbar: SnackbarProps | null
  /** Callback when snackbar is dismissed */
  onDismiss: (id: string) => void
  /** Additional CSS classes */
  className?: string
}

/**
 * Position to Tailwind class mapping
 */
const positionClasses: Record<SnackbarPosition, string> = {
  // Mobile uses left-4 right-4 to span full width, sm+ reverts to corner or centered positioning
  'top-left': 'top-4 left-4 right-4 sm:right-auto items-center sm:items-start',
  'top-center': 'top-4 left-4 right-4 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 items-center',
  'top-right': 'top-4 left-4 right-4 sm:left-auto items-center sm:items-end',
  'bottom-left': 'bottom-4 left-4 right-4 sm:right-auto items-center sm:items-start',
  'bottom-center': 'bottom-4 left-4 right-4 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 items-center',
  'bottom-right': 'bottom-4 left-4 right-4 sm:left-auto items-center sm:items-end',
}

/**
 * SnackbarContainer - Container for positioning snackbar
 *
 * Material Design recommends showing only one snackbar at a time.
 *
 * @example
 * ```tsx
 * <SnackbarContainer
 *   position="bottom-center"
 *   snackbar={currentSnackbar}
 *   onDismiss={handleDismiss}
 * />
 * ```
 */
export const SnackbarContainer: React.FC<SnackbarContainerProps> = ({
  position = 'bottom-center',
  snackbar,
  onDismiss,
  className,
}) => {
  if (!snackbar) return null

  return (
    <div
      className={cn(
        'fixed z-notification flex flex-col pointer-events-none',
        positionClasses[position],
        className,
      )}
      aria-label="Notification"
    >
      {/* Ensure inner container takes full width on mobile so the Snackbar component can stretch */}
      <div className="pointer-events-auto w-full sm:w-auto">
        <Snackbar {...snackbar} onDismiss={onDismiss} />
      </div>
    </div>
  )
}
