import { useState, useEffect } from 'react'
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  Bot,
  LogOut,
  Cat,
  Menu,
  Settings,
} from 'lucide-react'
import { cn } from '@/utils/cn.util'
import { useAdminAuth } from '@/contexts/AdminAuthContext'
import { ROUTES } from '@/constants/routes.constants'

// Map navigation items directly to route paths instead of search params
const NAV_ITEMS = [
  { path: ROUTES.ADMIN.DASHBOARD, label: 'Overview', icon: LayoutDashboard },
  { path: ROUTES.ADMIN.USERS, label: 'Users', icon: Users },
  { path: ROUTES.ADMIN.BOTS, label: 'Bot Sessions', icon: Bot },
  { path: ROUTES.ADMIN.SETTINGS, label: 'Settings', icon: Settings },
] as const

// Extracted component so the identical nav tree doesn't need to be duplicated
// between the desktop sidebar and the mobile slide-in drawer.
function SidebarNav({
  activePath,
  user,
  onNavClick,
  onLogout,
}: {
  activePath: string
  user: { name?: string | null; email?: string | null } | null
  onNavClick?: () => void
  onLogout: () => void
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Brand — links back to the overview tab so the logo acts as a home button */}
      <div className="px-6 py-5 border-b border-outline-variant">
        <Link
          to={ROUTES.ADMIN.DASHBOARD}
          onClick={onNavClick}
          className="flex items-center gap-2 text-title-lg font-semibold text-primary hover:opacity-80 transition-opacity duration-fast"
        >
          <Cat className="h-[1.3em] w-[1.3em]" />
          Cat-Bot Admin
        </Link>
      </div>

      {/* Primary navigation */}
      <nav
        className="flex-1 px-3 py-4 flex flex-col gap-1"
        aria-label="Admin navigation"
      >
        {NAV_ITEMS.map(({ path, label, icon: Icon }) => {
          // Exact match preferred to prevent child route overlap if we nest deeper later
          const isActive = activePath === path
          return (
            <Link
              key={path}
              to={path}
              onClick={onNavClick}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-label-lg font-medium',
                'transition-colors duration-fast',
                isActive
                  ? 'bg-primary/[var(--state-hover-opacity)] text-primary'
                  : 'text-on-surface-variant hover:bg-on-surface/[var(--state-hover-opacity)] hover:text-on-surface',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* User identity + logout anchored to the bottom of the sidebar */}
      <div className="px-3 py-4 border-t border-outline-variant flex flex-col gap-1">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-surface-container-low">
          <div className="min-w-0">
            <p className="text-label-md font-medium text-on-surface truncate">
              {user?.name ?? 'Admin'}
            </p>
            <p className="text-label-sm text-on-surface-variant truncate">
              {user?.email ?? ''}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onLogout}
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl',
            'text-label-lg font-medium text-left text-error',
            'transition-colors duration-fast',
            'hover:bg-error/[var(--state-hover-opacity)]',
          )}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Log out
        </button>
      </div>
    </div>
  )
}

/**
 * AdminSidebarLayout
 *
 * Persistent shell for all authenticated admin pages. Renders a fixed-width
 * sidebar on md+ and a slide-in drawer on mobile.
 *
 * Placed between AdminProtectedRoute and the dashboard pages in the route tree
 * so the sidebar only renders for authenticated admin sessions.
 */
export default function AdminSidebarLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAdminAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const activePath = location.pathname

  const [prevPath, setPrevPath] = useState(activePath)
  if (activePath !== prevPath) {
    setPrevPath(activePath)
    setMobileOpen(false)
  }

  // Keyboard accessibility — Escape dismisses the mobile drawer
  useEffect(() => {
    if (!mobileOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [mobileOpen])

  // Invalidate server session before navigating to prevent cookie replay
  const handleLogout = () => {
    logout()
      .catch(() => {})
      .finally(() => {
        navigate(ROUTES.ADMIN.ROOT)
      })
  }

  const currentLabel =
    NAV_ITEMS.find((i) => i.path === activePath)?.label ?? 'Admin'

  return (
    <div className="min-h-screen flex bg-surface-container-high">
      {/* ── Desktop sidebar (md+) ── */}
      {/* sticky top-0 h-screen: pins the sidebar to the viewport top and caps it at exactly one
          viewport height so it never stretches with the main content column. overflow-y-auto
          lets the sidebar scroll internally if nav items ever exceed the viewport height. */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col bg-surface border-r border-outline-variant sticky top-0 h-screen overflow-y-auto">
        <SidebarNav
          activePath={activePath}
          user={user}
          onLogout={handleLogout}
        />
      </aside>

      {/* ── Mobile: dim backdrop ── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-drawer bg-scrim/40 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Mobile: slide-in drawer (<md) ── */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-modal w-64 flex flex-col bg-surface border-r border-outline-variant md:hidden',
          'transition-transform duration-normal',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Mobile admin navigation"
      >
        <SidebarNav
          activePath={activePath}
          user={user}
          onNavClick={() => setMobileOpen(false)}
          onLogout={handleLogout}
        />
      </aside>

      {/* ── Main content column ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile topbar — visible only below md; shows current section name */}
        <header className="md:hidden sticky top-0 z-sticky bg-surface border-b border-outline-variant px-4 h-14 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation menu"
            className="p-2 rounded-lg text-on-surface hover:bg-on-surface/[var(--state-hover-opacity)] transition-colors duration-fast"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-title-md font-semibold text-on-surface">
            {currentLabel}
          </span>
        </header>

        {/* Routed section content */}
        <main className="flex-1 p-6 max-w-7xl w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
