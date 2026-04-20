import React, { createContext, useContext } from 'react'
import { cn } from '@/utils/cn.util'
import Pagination, {
  type PaginationProps,
} from '@/components/ui/navigation/Pagination'

// ============================================================================
// Types
// ============================================================================

// Added 'filled' variant to fix TS2367 type overlap compilation error
type TableVariant =
  | 'default'
  | 'bordered'
  | 'striped'
  | 'ghost'
  | 'soft'
  | 'filled'
  | 'glass'
type TableSize = 'sm' | 'md' | 'lg'
type TableAlign = 'left' | 'center' | 'right'
type TableColorScheme =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'success'
  | 'warning'
  | 'error'

interface TableContextValue {
  variant: TableVariant
  size: TableSize
  hoverable: boolean
  colorScheme: TableColorScheme
}

// ============================================================================
// Context
// ============================================================================

const TableContext = createContext<TableContextValue | undefined>(undefined)

const useTableContext = () => {
  const context = useContext(TableContext)
  if (!context) {
    throw new Error('Table compound components must be used within Table.Root')
  }
  return context
}

// ============================================================================
// Style Configurations
// ============================================================================

const sizeClasses: Record<TableSize, { cell: string; head: string }> = {
  sm: {
    cell: 'px-3 py-2 text-sm',
    head: 'px-3 py-2 text-xs',
  },
  md: {
    cell: 'px-4 py-3 text-sm',
    head: 'px-4 py-3 text-xs',
  },
  lg: {
    cell: 'px-6 py-4 text-base',
    head: 'px-6 py-4 text-sm',
  },
}

const alignClasses: Record<TableAlign, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
}

// Ghost: transparent surfaces — clean, content-first for dense dashboards
// Soft: colorScheme-tinted surfaces — subtle hierarchy without visual aggression
// Filled: solid colorScheme header — maximum contrast anchor for data-heavy interfaces
// Glass: frosted translucent surfaces — 2026 glassmorphism aesthetic (needs a layered bg behind it)
const variantRootClasses: Record<TableVariant, string> = {
  default: '',
  bordered: '',
  striped: '',
  ghost: 'bg-transparent',
  soft: 'bg-surface-container-low/50',
  filled: '',
  glass: 'bg-surface/20 backdrop-blur-md border border-outline-variant/30',
}

// Soft variant header tint — low opacity keeps header text readable on the surface token
const softHeaderClasses: Record<TableColorScheme, string> = {
  primary: 'bg-primary/10',
  secondary: 'bg-secondary/10',
  tertiary: 'bg-tertiary/10',
  success: 'bg-success/10',
  warning: 'bg-warning/10',
  error: 'bg-error/10',
}

// Filled variant header — full-opacity color provides a sharp visual anchor row
const filledHeaderClasses: Record<TableColorScheme, string> = {
  primary: 'bg-primary text-on-primary',
  secondary: 'bg-secondary text-on-secondary',
  tertiary: 'bg-tertiary text-on-tertiary',
  success: 'bg-success text-on-success',
  warning: 'bg-warning text-on-warning',
  error: 'bg-error text-on-error',
}

// Soft even-row stripe — static strings required so Tailwind's class scanner includes them at build time
const softStripeClasses: Record<TableColorScheme, string> = {
  primary: '[&_tr:nth-child(even)]:bg-primary/5',
  secondary: '[&_tr:nth-child(even)]:bg-secondary/5',
  tertiary: '[&_tr:nth-child(even)]:bg-tertiary/5',
  success: '[&_tr:nth-child(even)]:bg-success/5',
  warning: '[&_tr:nth-child(even)]:bg-warning/5',
  error: '[&_tr:nth-child(even)]:bg-error/5',
}

// Soft row hover — static strings required for Tailwind's class scanner
const softRowHoverClasses: Record<TableColorScheme, string> = {
  primary: 'hover:bg-primary/10',
  secondary: 'hover:bg-secondary/10',
  tertiary: 'hover:bg-tertiary/10',
  success: 'hover:bg-success/10',
  warning: 'hover:bg-warning/10',
  error: 'hover:bg-error/10',
}

// Centralized header bg resolver — keeps sub-components thin and the logic co-located with the maps
function getHeaderBgClass(
  variant: TableVariant,
  colorScheme: TableColorScheme,
): string {
  if (variant === 'soft') return softHeaderClasses[colorScheme]
  if (variant === 'filled') return filledHeaderClasses[colorScheme]
  if (variant === 'ghost') return 'bg-transparent'
  if (variant === 'glass') return 'bg-surface/30 backdrop-blur-sm'
  return 'bg-surface-container-low'
}

// Centralized row hover resolver — avoids duplicating colorScheme branching across TableRow and TableBody
function getRowHoverClass(
  variant: TableVariant,
  colorScheme: TableColorScheme,
): string {
  if (variant === 'soft') return softRowHoverClasses[colorScheme]
  if (variant === 'ghost') return 'hover:bg-surface-container/40'
  if (variant === 'glass') return 'hover:bg-surface/30'
  if (variant === 'filled') return 'hover:bg-surface-container-high'
  return 'hover:bg-surface-container-low'
}

// ============================================================================
// ScrollArea Component
// ============================================================================

export interface TableScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Maximum height before vertical scrolling */
  maxHeight?: string
  /** Maximum width before horizontal scrolling */
  maxWidth?: string
  /** Control horizontal overflow behavior */
  overflowX?: 'auto' | 'scroll' | 'hidden'
  /** Control vertical overflow behavior */
  overflowY?: 'auto' | 'scroll' | 'hidden'
}

const TableScrollArea = React.forwardRef<HTMLDivElement, TableScrollAreaProps>(
  (
    {
      maxHeight,
      maxWidth,
      overflowX = 'auto',
      overflowY = 'auto',
      className,
      children,
      style,
      ...props
    },
    ref,
  ) => {
    const scrollStyles: React.CSSProperties = {
      maxHeight,
      maxWidth,
      overflowX,
      overflowY,
      ...style,
    }

    return (
      <div
        ref={ref}
        className={cn(
          'w-full rounded-lg border border-outline-variant',
          className,
        )}
        style={scrollStyles}
        {...props}
      >
        {children}
      </div>
    )
  },
)
TableScrollArea.displayName = 'Table.ScrollArea'

// ============================================================================
// Root Component
// ============================================================================

export interface TableRootProps extends React.TableHTMLAttributes<HTMLTableElement> {
  /** Visual style variant */
  variant?: TableVariant
  /** Size affecting padding and font size */
  size?: TableSize
  /** Enable row hover effect */
  hoverable?: boolean
  /** Make header sticky when scrolling */
  stickyHeader?: boolean
  /** Table takes full width of container */
  fullWidth?: boolean
  /** Color scheme for soft and filled variants — selects which design-system token to tint */
  colorScheme?: TableColorScheme
}

const TableRoot = React.forwardRef<HTMLTableElement, TableRootProps>(
  (
    {
      variant = 'default',
      size = 'md',
      hoverable = true,
      stickyHeader = false,
      fullWidth = true,
      colorScheme = 'primary',
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const contextValue: TableContextValue = {
      variant,
      size,
      hoverable,
      colorScheme,
    }

    return (
      <TableContext.Provider value={contextValue}>
        <table
          ref={ref}
          className={cn(
            'border-collapse',
            variantRootClasses[variant],
            fullWidth && 'w-full',
            // bordered adds outer border on top of variantRootClasses; glass already has it
            variant === 'bordered' && 'border border-outline-variant',
            stickyHeader && '[&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10',
            className,
          )}
          {...props}
        >
          {children}
        </table>
      </TableContext.Provider>
    )
  },
)
TableRoot.displayName = 'Table.Root'

// ============================================================================
// Header Component
// ============================================================================

export type TableHeaderProps = React.HTMLAttributes<HTMLTableSectionElement>

const TableHeader = React.forwardRef<HTMLTableSectionElement, TableHeaderProps>(
  ({ className, children, ...props }, ref) => {
    const { variant, colorScheme } = useTableContext()
    return (
      <thead
        ref={ref}
        className={cn(getHeaderBgClass(variant, colorScheme), className)}
        {...props}
      >
        {children}
      </thead>
    )
  },
)
TableHeader.displayName = 'Table.Header'

// ============================================================================
// Body Component
// ============================================================================

export type TableBodyProps = React.HTMLAttributes<HTMLTableSectionElement>

const TableBody = React.forwardRef<HTMLTableSectionElement, TableBodyProps>(
  ({ className, children, ...props }, ref) => {
    const { variant, colorScheme } = useTableContext()
    return (
      <tbody
        ref={ref}
        className={cn(
          '[&_tr:last-child]:border-0',
          variant === 'striped' &&
            '[&_tr:nth-child(even)]:bg-surface-container-low',
          // Soft: colorScheme-tinted stripes provide visual rhythm without heavy borders
          variant === 'soft' && softStripeClasses[colorScheme],
          // Filled: alternate between two surface levels for density-friendly readability
          variant === 'filled' &&
            '[&_tr:nth-child(even)]:bg-surface-container-low',
          className,
        )}
        {...props}
      >
        {children}
      </tbody>
    )
  },
)
TableBody.displayName = 'Table.Body'

// ============================================================================
// Footer Component
// ============================================================================

export type TableFooterProps = React.HTMLAttributes<HTMLTableSectionElement>

const TableFooter = React.forwardRef<HTMLTableSectionElement, TableFooterProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <tfoot
        ref={ref}
        className={cn(
          'bg-surface-1 border-t border-border font-medium',
          className,
        )}
        {...props}
      >
        {children}
      </tfoot>
    )
  },
)
TableFooter.displayName = 'Table.Footer'

// ============================================================================
// Row Component
// ============================================================================

export interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  /** Mark row as selected */
  selected?: boolean
  /** Disable hover effect for this row */
  disableHover?: boolean
}

const TableRow = React.forwardRef<HTMLTableRowElement, TableRowProps>(
  (
    { selected = false, disableHover = false, className, children, ...props },
    ref,
  ) => {
    const { hoverable, variant, colorScheme } = useTableContext()
    return (
      <tr
        ref={ref}
        className={cn(
          'border-b transition-colors',
          // Glass and ghost use faint separators to preserve visual lightness
          variant === 'glass' || variant === 'ghost'
            ? 'border-outline-variant/30'
            : 'border-outline-variant',
          hoverable && !disableHover && getRowHoverClass(variant, colorScheme),
          selected && 'bg-primary/10 hover:bg-primary/15',
          variant === 'bordered' && 'border-outline-variant',
          className,
        )}
        data-selected={selected || undefined}
        {...props}
      >
        {children}
      </tr>
    )
  },
)
TableRow.displayName = 'Table.Row'

// ============================================================================
// Head Cell Component
// ============================================================================

export interface TableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  /** Text alignment */
  align?: TableAlign
  /** Enable sortable styling */
  sortable?: boolean
  /** Current sort direction */
  sortDirection?: 'asc' | 'desc' | null
  /** Make column sticky horizontally */
  sticky?: boolean
}

const TableHead = React.forwardRef<HTMLTableCellElement, TableHeadProps>(
  (
    {
      align = 'left',
      sortable = false,
      sortDirection = null,
      sticky = false,
      className,
      children,
      onClick,
      ...props
    },
    ref,
  ) => {
    const { size, variant } = useTableContext()
    const config = sizeClasses[size]
    return (
      <th
        ref={ref}
        className={cn(
          config.head,
          alignClasses[align],
          'font-semibold text-headline uppercase tracking-wider whitespace-nowrap',
          // Glass uses a hairline transparent border; all other variants use a bold 2px bottom border
          variant === 'glass'
            ? 'border-b border-outline-variant/30 bg-transparent'
            : 'border-b-2 border-outline-variant bg-surface-container-low',
          sortable &&
            'cursor-pointer select-none hover:bg-surface-container transition-colors',
          // Glass sticky: bg-transparent lets the root table's backdrop-blur show through
          sticky &&
            (variant === 'glass'
              ? 'sticky left-0 z-20 bg-transparent'
              : 'sticky left-0 z-20 bg-surface-container-low'),
          className,
        )}
        onClick={sortable ? onClick : undefined}
        aria-sort={
          sortDirection === 'asc'
            ? 'ascending'
            : sortDirection === 'desc'
              ? 'descending'
              : undefined
        }
        {...props}
      >
        <div
          className={cn(
            'flex items-center gap-2',
            align === 'right' && 'justify-end',
            align === 'center' && 'justify-center',
          )}
        >
          {children}
          {sortable && (
            <span className="inline-flex flex-col">
              <svg
                className={cn(
                  'h-2 w-2 -mb-0.5',
                  sortDirection === 'asc' ? 'text-primary' : 'text-muted/40',
                )}
                viewBox="0 0 8 4"
                fill="currentColor"
              >
                <path d="M4 0L8 4H0L4 0Z" />
              </svg>
              <svg
                className={cn(
                  'h-2 w-2',
                  sortDirection === 'desc' ? 'text-primary' : 'text-muted/40',
                )}
                viewBox="0 0 8 4"
                fill="currentColor"
              >
                <path d="M4 4L0 0H8L4 4Z" />
              </svg>
            </span>
          )}
        </div>
      </th>
    )
  },
)
TableHead.displayName = 'Table.Head'

// ============================================================================
// Cell Component
// ============================================================================

export interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  /** Text alignment */
  align?: TableAlign
  /** Make cell sticky horizontally */
  sticky?: boolean
  /** Truncate text with ellipsis */
  truncate?: boolean
  /** Maximum width for truncation */
  maxWidth?: string
}

const TableCell = React.forwardRef<HTMLTableCellElement, TableCellProps>(
  (
    {
      align = 'left',
      sticky = false,
      truncate = false,
      maxWidth,
      className,
      style,
      children,
      ...props
    },
    ref,
  ) => {
    const { size, variant } = useTableContext()
    const config = sizeClasses[size]
    return (
      <td
        ref={ref}
        className={cn(
          config.cell,
          alignClasses[align],
          'text-on-surface',
          variant === 'bordered' && 'border border-outline-variant',
          // Glass needs bg-transparent (not bg-inherit) so backdrop-blur stays visible behind sticky columns
          sticky &&
            (variant === 'glass'
              ? 'sticky left-0 z-10 bg-transparent'
              : 'sticky left-0 z-10 bg-inherit'),
          truncate && 'truncate',
          className,
        )}
        style={{ maxWidth, ...style }}
        {...props}
      >
        {children}
      </td>
    )
  },
)
TableCell.displayName = 'Table.Cell'

// ============================================================================
// Caption Component
// ============================================================================

export interface TableCaptionProps extends React.HTMLAttributes<HTMLTableCaptionElement> {
  /** Position of caption */
  position?: 'top' | 'bottom'
}

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  TableCaptionProps
>(({ position = 'bottom', className, children, ...props }, ref) => {
  return (
    <caption
      ref={ref}
      className={cn(
        'px-4 py-3 text-sm text-muted',
        position === 'top' ? 'caption-top' : 'caption-bottom',
        className,
      )}
      {...props}
    >
      {children}
    </caption>
  )
})
TableCaption.displayName = 'Table.Caption'

// ============================================================================
// Empty State Component
// ============================================================================

export interface TableEmptyProps extends React.HTMLAttributes<HTMLTableRowElement> {
  /** Number of columns to span */
  colSpan: number
  /** Icon to display */
  icon?: React.ReactNode
  /** Main message */
  message?: string
  /** Secondary description */
  description?: string
}

const TableEmpty = React.forwardRef<HTMLTableRowElement, TableEmptyProps>(
  (
    {
      colSpan,
      icon,
      message = 'No data available',
      description,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    return (
      <tr ref={ref} className={className} {...props}>
        <td colSpan={colSpan} className="py-12 text-center">
          <div className="flex flex-col items-center gap-3">
            {icon && <div className="text-muted/50">{icon}</div>}
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted">{message}</p>
              {description && (
                <p className="text-xs text-muted/70">{description}</p>
              )}
            </div>
            {children}
          </div>
        </td>
      </tr>
    )
  },
)
TableEmpty.displayName = 'Table.Empty'

// ============================================================================
// Loading Component
// ============================================================================

export interface TableLoadingProps extends React.HTMLAttributes<HTMLTableRowElement> {
  /** Number of columns to span */
  colSpan: number
  /** Number of skeleton rows to show */
  rows?: number
}

const TableLoading = React.forwardRef<HTMLTableRowElement, TableLoadingProps>(
  ({ colSpan, rows = 5, className, ...props }, ref) => {
    const { size } = useTableContext()
    const config = sizeClasses[size]
    return (
      <>
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <tr
            key={rowIndex}
            ref={rowIndex === 0 ? ref : undefined}
            className={cn('animate-pulse', className)}
            {...(rowIndex === 0 ? props : {})}
          >
            {Array.from({ length: colSpan }).map((_, cellIndex) => (
              <td key={cellIndex} className={config.cell}>
                <div className="h-4 bg-surface-hover-1 rounded w-full" />
              </td>
            ))}
          </tr>
        ))}
      </>
    )
  },
)
TableLoading.displayName = 'Table.Loading'

// ============================================================================
// Pagination Component (Table-integrated)
// ============================================================================

export interface TablePaginationProps extends PaginationProps {
  /** Add border-top and margin for visual separation from table */
  withBorder?: boolean
}

/**
 * Table.Pagination - Integrated pagination for Table component
 *
 * Wraps the Pagination component with table-specific styling.
 * Automatically inherits size from Table.Root when used inside it.
 * Can be used both inside and outside Table.Root.
 *
 * @example
 * ```tsx
 * // Basic usage (outside Table.Root - common pattern)
 * <Table.ScrollArea>
 *   <Table.Root>
 *     <Table.Header>...</Table.Header>
 *     <Table.Body>...</Table.Body>
 *   </Table.Root>
 * </Table.ScrollArea>
 * <Table.Pagination
 *   currentPage={currentPage}
 *   totalItems={100}
 *   itemsPerPage={10}
 *   onPageChange={setCurrentPage}
 * />
 *
 * // With custom options
 * <Table.Pagination
 *   currentPage={page}
 *   totalItems={products.length}
 *   itemsPerPage={20}
 *   onPageChange={setPage}
 *   showInfo
 *   itemLabel="products"
 *   size="lg"
 *   withBorder={false}
 * />
 *
 * // Minimal without info text
 * <Table.Pagination
 *   currentPage={page}
 *   totalItems={data.length}
 *   itemsPerPage={25}
 *   onPageChange={setPage}
 *   showInfo={false}
 * />
 * ```
 */
const TablePagination: React.FC<TablePaginationProps> = ({
  withBorder = true,
  size,
  className,
  ...paginationProps
}) => {
  // Use React.useContext directly to get optional context
  // Returns undefined when outside Table.Root - that's expected and fine
  const tableContext = useContext(TableContext)

  // Priority: explicit size prop > table context size > default 'md'
  const effectiveSize = size ?? tableContext?.size ?? 'md'

  return (
    <div
      className={cn(
        'pt-4',
        withBorder && 'mt-4 border-t border-divider',
        className,
      )}
    >
      <Pagination size={effectiveSize} {...paginationProps} />
    </div>
  )
}

TablePagination.displayName = 'Table.Pagination'

// ============================================================================
// Compound Component Export
// ============================================================================

const Table = {
  Root: TableRoot,
  ScrollArea: TableScrollArea,
  Header: TableHeader,
  Body: TableBody,
  Footer: TableFooter,
  Row: TableRow,
  Head: TableHead,
  Cell: TableCell,
  Caption: TableCaption,
  Empty: TableEmpty,
  Loading: TableLoading,
  Pagination: TablePagination,
}

export default Table
