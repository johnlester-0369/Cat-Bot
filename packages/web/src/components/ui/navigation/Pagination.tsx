import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'
import Button from '@/components/ui/buttons/Button'
import { cn } from '@/utils/cn.util'
import {
  forwardRefWithAs,
  type PolymorphicComponentPropsWithRef,
} from '@/utils/polymorphic.util'

// ============================================================================
// Types
// ============================================================================

type PaginationSize = 'sm' | 'md' | 'lg'

/**
 * Base props for Pagination component (excluding HTML attributes)
 */
export type PaginationOwnProps = {
  /** Current active page (1-indexed) */
  currentPage: number
  /** Total number of items */
  totalItems: number
  /** Number of items per page */
  itemsPerPage: number
  /** Callback when page changes */
  onPageChange: (page: number) => void
  /** Size variant */
  size?: PaginationSize
  /** Show info text (Showing X to Y of Z) */
  showInfo?: boolean
  /** Custom info text template. Use {from}, {to}, {total} as placeholders */
  infoTemplate?: string
  /** Maximum number of page buttons to show before truncating */
  maxVisiblePages?: number
  /** Show Previous/Next buttons */
  showPrevNext?: boolean
  /** Custom Previous button text */
  previousLabel?: string
  /** Custom Next button text */
  nextLabel?: string
  /** Label for items (e.g., "products", "users") */
  itemLabel?: string
  /** Hide component when only one page exists */
  hideOnSinglePage?: boolean
}

/**
 * Polymorphic Pagination props - supports `as` prop for rendering as different elements
 * @example
 * ```tsx
 * <Pagination as="div" {...props} />
 * <Pagination as="footer" {...props} />
 * ```
 */
export type PaginationProps<T extends React.ElementType = 'nav'> =
  PolymorphicComponentPropsWithRef<T, PaginationOwnProps>

// ============================================================================
// Style Configurations
// ============================================================================

const sizeClasses: Record<
  PaginationSize,
  { button: string; text: string; icon: string }
> = {
  sm: {
    button: 'h-7 w-7 text-xs',
    text: 'text-xs',
    icon: 'h-3 w-3',
  },
  md: {
    button: 'h-8 w-8 text-sm',
    text: 'text-sm',
    icon: 'h-4 w-4',
  },
  lg: {
    button: 'h-10 w-10 text-base',
    text: 'text-base',
    icon: 'h-5 w-5',
  },
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate an array of page numbers with ellipsis placeholders
 * for pagination display with smart truncation
 */
function generatePageNumbers(
  currentPage: number,
  totalPages: number,
  maxVisiblePages: number,
): (number | 'ellipsis-start' | 'ellipsis-end')[] {
  const pages: (number | 'ellipsis-start' | 'ellipsis-end')[] = []

  if (totalPages <= maxVisiblePages) {
    // Show all pages if within limit
    for (let i = 1; i <= totalPages; i++) {
      pages.push(i)
    }
    return pages
  }

  // Always show first page
  pages.push(1)

  // Calculate the range around current page
  const sidePages = Math.floor((maxVisiblePages - 3) / 2)
  let startPage = Math.max(2, currentPage - sidePages)
  let endPage = Math.min(totalPages - 1, currentPage + sidePages)

  // Adjust range if at the beginning
  if (currentPage <= sidePages + 2) {
    endPage = Math.min(totalPages - 1, maxVisiblePages - 2)
    startPage = 2
  }

  // Adjust range if at the end
  if (currentPage >= totalPages - sidePages - 1) {
    startPage = Math.max(2, totalPages - maxVisiblePages + 3)
    endPage = totalPages - 1
  }

  // Add start ellipsis if needed
  if (startPage > 2) {
    pages.push('ellipsis-start')
  }

  // Add middle pages
  for (let i = startPage; i <= endPage; i++) {
    pages.push(i)
  }

  // Add end ellipsis if needed
  if (endPage < totalPages - 1) {
    pages.push('ellipsis-end')
  }

  // Always show last page
  pages.push(totalPages)

  return pages
}

// ============================================================================
// Pagination Component
// ============================================================================

/**
 * Pagination Component
 *
 * A reusable pagination component with support for:
 * - Page numbers with smart ellipsis truncation
 * - Previous/Next navigation buttons
 * - Info text showing current range
 * - Multiple size variants (sm, md, lg)
 * - Fully accessible with ARIA attributes
 * - Responsive layout
 *
 * @example
 * ```tsx
 * // Basic usage
 * <Pagination
 *   currentPage={currentPage}
 *   totalItems={100}
 *   itemsPerPage={10}
 *   onPageChange={setCurrentPage}
 * />
 *
 * // With custom options
 * <Pagination
 *   currentPage={currentPage}
 *   totalItems={products.length}
 *   itemsPerPage={20}
 *   onPageChange={setCurrentPage}
 *   size="lg"
 *   showInfo
 *   itemLabel="products"
 *   maxVisiblePages={5}
 * />
 *
 * // Minimal without info text
 * <Pagination
 *   currentPage={page}
 *   totalItems={data.length}
 *   itemsPerPage={25}
 *   onPageChange={setPage}
 *   showInfo={false}
 *   showPrevNext={false}
 * />
 *
 * // Custom info template
 * <Pagination
 *   currentPage={currentPage}
 *   totalItems={users.length}
 *   itemsPerPage={10}
 *   onPageChange={setCurrentPage}
 *   infoTemplate="Displaying {from}-{to} of {total} users"
 * />
 *
 * // Polymorphic usage
 * <Pagination as="div" {...props} />
 * <Pagination as="footer" {...props} />
 * ```
 */
const Pagination = forwardRefWithAs<'nav', PaginationOwnProps>((props, ref) => {
  const {
    as,
    currentPage,
    totalItems,
    itemsPerPage,
    onPageChange,
    size = 'md',
    showInfo = true,
    infoTemplate,
    maxVisiblePages = 7,
    showPrevNext = true,
    previousLabel = 'Previous',
    nextLabel = 'Next',
    itemLabel = 'items',
    hideOnSinglePage = true,
    className,
    ...rest
  } = props

  const Component = as || 'nav'
  // Calculate total pages
  const totalPages = Math.ceil(totalItems / itemsPerPage)

  // Get size configuration
  const config = sizeClasses[size]

  // Don't render if there's only one page (or less) and hideOnSinglePage is true
  if (totalPages <= 1 && hideOnSinglePage) {
    return null
  }

  // Don't render if no items
  if (totalItems === 0) {
    return null
  }

  // Calculate range for info text
  const from = totalItems === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1
  const to = Math.min(currentPage * itemsPerPage, totalItems)

  // Generate info text
  const getInfoText = (): string => {
    if (infoTemplate) {
      return infoTemplate
        .replace('{from}', String(from))
        .replace('{to}', String(to))
        .replace('{total}', String(totalItems))
    }
    return `Showing ${from} to ${to} of ${totalItems} ${itemLabel}`
  }

  // Handle page change with bounds checking
  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages && page !== currentPage) {
      onPageChange(page)
    }
  }

  // Handle previous page
  const handlePrevious = () => {
    handlePageChange(currentPage - 1)
  }

  // Handle next page
  const handleNext = () => {
    handlePageChange(currentPage + 1)
  }

  // Generate page numbers with ellipsis
  const pageNumbers = generatePageNumbers(
    currentPage,
    totalPages,
    maxVisiblePages,
  )

  // Check if buttons should be disabled
  const isPreviousDisabled = currentPage === 1
  const isNextDisabled = currentPage === totalPages

  return (
    <Component
      ref={ref}
      role="navigation"
      aria-label="Pagination"
      className={cn(
        'flex flex-col sm:flex-row items-center justify-between gap-4',
        className,
      )}
      {...rest}
    >
      {/* Info Text */}
      {showInfo && (
        <p className={cn('text-muted', config.text)}>{getInfoText()}</p>
      )}

      {/* Navigation Controls */}
      <div className="flex items-center gap-2">
        {/* Previous Button */}
        {showPrevNext && (
          <Button
            variant="text"
            size={size}
            leftIcon={<ChevronLeft className={config.icon} />}
            onClick={handlePrevious}
            disabled={isPreviousDisabled}
            aria-label="Go to previous page"
          >
            {previousLabel}
          </Button>
        )}

        {/* Page Numbers */}
        <div className="flex items-center gap-1">
          {pageNumbers.map((page) => {
            // Handle ellipsis
            if (page === 'ellipsis-start' || page === 'ellipsis-end') {
              return (
                <span
                  key={page}
                  className={cn(
                    'flex items-center justify-center text-muted',
                    config.button,
                  )}
                  aria-hidden="true"
                >
                  <MoreHorizontal className={config.icon} />
                </span>
              )
            }

            // Handle page number button
            const isCurrentPage = page === currentPage

            return (
              <button
                key={page}
                type="button"
                onClick={() => handlePageChange(page)}
                className={cn(
                  'rounded-lg font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
                  config.button,
                  isCurrentPage
                    ? 'bg-primary text-on-primary'
                    : 'text-on-surface hover:bg-surface-container-high',
                )}
                aria-label={`Go to page ${page}`}
                aria-current={isCurrentPage ? 'page' : undefined}
              >
                {page}
              </button>
            )
          })}
        </div>

        {/* Next Button */}
        {showPrevNext && (
          <Button
            variant="text"
            size={size}
            rightIcon={<ChevronRight className={config.icon} />}
            onClick={handleNext}
            disabled={isNextDisabled}
            aria-label="Go to next page"
          >
            {nextLabel}
          </Button>
        )}
      </div>
    </Component>
  )
})

Pagination.displayName = 'Pagination'

export default Pagination
