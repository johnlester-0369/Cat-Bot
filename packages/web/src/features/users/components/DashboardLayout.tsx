import { useState, useEffect, useRef } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import {
  Cat,
  Sun,
  Moon,
  ChevronDown,
  LogOut,
  User,
  WifiOff,
  Wifi,
  Menu,
  X,
} from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { useUserAuth } from '@/contexts/UserAuthContext'
import { useSnackbar } from '@/contexts/SnackbarContext'
import { toggleTheme } from '@/utils/theme.util'
import { cn } from '@/utils/cn.util'
import IconButton from '@/components/ui/buttons/IconButton'
import UILink from '@/components/ui/typography/Link'
import { ROUTES } from '@/constants/routes.constants'
import { getSocket } from '@/lib/socket.lib'

// ============================================================================
// Constants
// ============================================================================

interface NavItem {
  label: string
  href: string
}

const navItems: NavItem[] = [
  { label: 'Bot Manager', href: ROUTES.DASHBOARD.ROOT },
  { label: 'Settings', href: ROUTES.DASHBOARD.SETTINGS },
]

// ============================================================================
// NavLink — desktop horizontal nav item
// ============================================================================

function NavLink({ item }: { item: NavItem }) {
  const location = useLocation()

  // Distinguish root dashboard route from specific subsections (like Settings)
  // to prevent multiple nav items from being highlighted simultaneously.
  const isRootRoute = item.href === ROUTES.DASHBOARD.ROOT
  const isSettingsRoute = location.pathname.startsWith(
    ROUTES.DASHBOARD.SETTINGS,
  )

  const isActive = isRootRoute
    ? location.pathname === item.href ||
      (location.pathname.startsWith(`${item.href}/`) && !isSettingsRoute)
    : location.pathname === item.href ||
      location.pathname.startsWith(`${item.href}/`)

  return (
    <UILink
      as={Link}
      to={item.href}
      aria-current={isActive ? 'page' : undefined}
      variant="unstyled"
      className={cn(
        'inline-flex items-center gap-2 px-3 py-2 rounded-lg text-label-lg font-medium',
        'transition-colors duration-fast',
        isActive
          ? 'text-primary'
          : 'text-on-surface-variant hover:text-on-surface',
      )}
    >
      {item.label}
    </UILink>
  )
}

// ============================================================================
// MobileNavLink — full-width touch-friendly nav item for the mobile drawer
// ============================================================================

function MobileNavLink({
  item,
  onClick,
}: {
  item: NavItem
  onClick: () => void
}) {
  const location = useLocation()

  const isRootRoute = item.href === ROUTES.DASHBOARD.ROOT
  const isSettingsRoute = location.pathname.startsWith(
    ROUTES.DASHBOARD.SETTINGS,
  )

  const isActive = isRootRoute
    ? location.pathname === item.href ||
      (location.pathname.startsWith(`${item.href}/`) && !isSettingsRoute)
    : location.pathname === item.href ||
      location.pathname.startsWith(`${item.href}/`)

  return (
    <UILink
      as={Link}
      to={item.href}
      onClick={onClick}
      aria-current={isActive ? 'page' : undefined}
      variant="unstyled"
      className={cn(
        // Generous padding for thumb-reachable touch targets (min 44px height)
        'flex items-center gap-3 w-full px-4 py-3 rounded-xl text-body-md font-medium',
        'transition-colors duration-fast',
        isActive
          ? 'bg-primary/[var(--state-hover-opacity)] text-primary'
          : 'text-on-surface hover:bg-on-surface/[var(--state-hover-opacity)]',
      )}
    >
      {item.label}
    </UILink>
  )
}

// ============================================================================
// UserMenu — desktop dropdown with name + logout
// ============================================================================

function UserMenu() {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  // Pulls the authenticated user's name from the live better-auth session
  const { user, logout } = useUserAuth()

  // Close the dropdown when the user clicks anywhere outside it.
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on Escape for keyboard accessibility.
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  const handleLogout = async () => {
    setOpen(false)
    try {
      // Invalidates the server-side session token before navigating away — prevents
      // the old cookie from being replayed if the user navigates back.
      await logout()
    } catch (err) {
      console.error('Logout failed:', err)
    }
    navigate(ROUTES.HOME)
  }

  const displayName = user?.name ?? 'User'

  return (
    <div ref={menuRef} className="relative">
      {/* Trigger button — shows name + chevron */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'inline-flex items-center gap-2 rounded-lg px-3 py-2',
          'text-label-lg font-medium text-on-surface',
          'transition-colors duration-fast',
          'hover:bg-on-surface/[var(--state-hover-opacity)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          open && 'bg-on-surface/[var(--state-hover-opacity)]',
        )}
      >
        <span>{displayName}</span>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-on-surface-variant transition-transform duration-fast',
            open && 'rotate-180',
          )}
        />
      </button>

      {/* Dropdown menu */}
      {open && (
        <div
          role="menu"
          aria-label="User menu"
          className={cn(
            'absolute right-0 top-full mt-1 z-dropdown min-w-[180px]',
            'rounded-xl border border-outline-variant bg-surface',
            'shadow-elevation-2 py-1',
            '[animation:fade-in-down_150ms_var(--easing-standard-decelerate)_both]',
          )}
        >
          {/* User info row — non-interactive header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-outline-variant">
            <User className="h-4 w-4 shrink-0 text-on-surface-variant" />
            <div className="min-w-0">
              <p className="text-label-lg font-medium text-on-surface truncate">
                {displayName}
              </p>
            </div>
          </div>

          {/* Logout action */}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void handleLogout()
            }}
            className={cn(
              'w-full flex items-center gap-3 px-4 py-2.5',
              'text-label-lg text-left text-error',
              'transition-colors duration-fast',
              'hover:bg-error/[var(--state-hover-opacity)]',
            )}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Log out
          </button>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// DashboardLayout
// ============================================================================

/**
 * Dashboard shell with a top navbar.
 *
 * Intentionally lightweight — only Bot Manager and Settings are exposed.
 * The navbar uses a sibling-route architecture (see router.tsx) so the
 * public Layout navbar never co-renders on dashboard routes.
 *
 * Responsive strategy:
 *  - md+: logo | divider | nav links | spacer | theme toggle | user menu (horizontal)
 *  - <md: logo | spacer | theme toggle | hamburger → animated drawer below header
 *
 * The mobile drawer inlines user info and logout directly rather than nesting
 * the UserMenu dropdown — avoids layered modal complexity on small screens.
 */
export default function DashboardLayout() {
  const { theme, setTheme } = useTheme()
  const { snackbar, setPosition } = useSnackbar()
  const { user, logout } = useUserAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const isDisconnectedRef = useRef(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [prevPath, setPrevPath] = useState(location.pathname)

  // Define display name for mobile drawer and resolve unused 'user' variable
  const displayName = user?.name ?? 'User'

  // Collapse the mobile drawer whenever the active route changes.
  // Done during render to avoid cascading updates from effects.
  if (location.pathname !== prevPath) {
    setPrevPath(location.pathname)
    setMobileOpen(false)
  }

  // Keyboard accessibility — Escape closes the mobile drawer.
  useEffect(() => {
    if (!mobileOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [mobileOpen, setMobileOpen])

  // Socket connectivity — ensure the transport is alive while in the dashboard
  // and surface connection loss as a persistent snackbar (duration: 0).
  useEffect(() => {
    const socket = getSocket()
    if (!socket.connected) socket.connect()

    const handleDisconnect = () => {
      if (isDisconnectedRef.current) return
      isDisconnectedRef.current = true
      setPosition('bottom-right')
      snackbar({
        message: 'You are currently offline.',
        duration: 0,
        icon: <WifiOff className="w-5 h-5" />,
      })
    }

    const handleConnect = () => {
      if (!isDisconnectedRef.current) return
      isDisconnectedRef.current = false
      setPosition('bottom-right')
      snackbar({
        message: 'Your internet connection was restored.',
        duration: 4000,
        icon: <Wifi className="w-5 h-5" />,
      })
    }

    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleDisconnect)
    socket.on('connect', handleConnect)

    return () => {
      socket.off('disconnect', handleDisconnect)
      socket.off('connect_error', handleDisconnect)
      socket.off('connect', handleConnect)
    }
  }, [snackbar, setPosition])

  // Logout handler for the mobile drawer — mirrors UserMenu's logout but runs
  // at DashboardLayout level where we already have user/logout in scope.
  const handleMobileLogout = async () => {
    setMobileOpen(false)
    try {
      await logout()
    } catch (err) {
      console.error('Logout failed:', err)
    }
    navigate(ROUTES.HOME)
  }

  return (
    <div className="min-h-screen flex flex-col bg-surface-container-high text-on-surface">
      {/* ── Header ── */}
      <header className="sticky top-0 z-sticky bg-surface border-b border-outline-variant backdrop-blur">
        {/* Main nav bar */}
        <nav
          className="max-w-7xl mx-auto px-6 h-16 flex items-center gap-10"
          aria-label="Dashboard navigation"
        >
          {/* Brand */}
          <UILink
            as={Link}
            to={ROUTES.DASHBOARD.ROOT}
            variant="unstyled"
            className="flex items-center gap-2 text-title-lg font-semibold text-primary hover:opacity-80 transition-opacity duration-fast shrink-0"
          >
            {/* em-relative sizing keeps the icon optically matched to the text cap-height */}
            <Cat className="h-[1.3em] w-[1.3em]" />
            Cat-Bot
          </UILink>

          {/* ── Desktop: vertical divider + nav links (md+) ── */}
          {/* Wrapped together so the gap-6 on the nav flex container only adds
              space when this group is rendered — no phantom gap on mobile. */}
          <div className="hidden md:flex items-center gap-6">
            <div className="flex items-center gap-1">
              {navItems.map((item) => (
                <NavLink key={item.href} item={item} />
              ))}
            </div>
          </div>

          {/* Push right-side controls to the trailing edge */}
          <div className="flex-1" />

          {/* ── Desktop: theme toggle + user dropdown (md+) ── */}
          <div className="hidden md:flex items-center gap-2">
            <IconButton
              icon={theme === 'dark' ? <Sun /> : <Moon />}
              aria-label={
                theme === 'dark'
                  ? 'Switch to light mode'
                  : 'Switch to dark mode'
              }
              variant="text"
              size="md"
              onClick={() => setTheme(toggleTheme(theme))}
            />
            <UserMenu />
          </div>

          {/* ── Mobile: theme toggle + hamburger (<md) ── */}
          {/* Theme toggle stays visible at all breakpoints — it's a primary UX pref */}
          <div className="flex md:hidden items-center gap-1">
            <IconButton
              icon={theme === 'dark' ? <Sun /> : <Moon />}
              aria-label={
                theme === 'dark'
                  ? 'Switch to light mode'
                  : 'Switch to dark mode'
              }
              variant="text"
              size="md"
              onClick={() => setTheme(toggleTheme(theme))}
            />
            <IconButton
              icon={mobileOpen ? <X /> : <Menu />}
              aria-label={
                mobileOpen ? 'Close navigation menu' : 'Open navigation menu'
              }
              variant="text"
              size="md"
              onClick={() => setMobileOpen((prev) => !prev)}
              aria-expanded={mobileOpen}
            />
          </div>
        </nav>

        {/* ── Mobile drawer ── */}
        {/* Part of the sticky header element so it scrolls with the sticky region
            and doesn't cover page content as a floating overlay. */}
        {mobileOpen && (
          <div
            role="navigation"
            aria-label="Mobile navigation"
            className={cn(
              'md:hidden border-t border-outline-variant bg-surface',
              '[animation:fade-in-down_150ms_var(--easing-standard-decelerate)_both]',
            )}
          >
            <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col">
              {/* Nav links — full-width with large touch targets */}
              {navItems.map((item) => (
                <MobileNavLink
                  key={item.href}
                  item={item}
                  onClick={() => setMobileOpen(false)}
                />
              ))}

              {/* Separator before user section */}
              <div className="my-2 mx-4 border-t border-outline-variant" />

              {/* User identity row — display only; provides context before logout */}
              <div className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
                  <User className="h-4 w-4 text-on-surface-variant" />
                </div>
                <p className="text-label-lg font-medium text-on-surface truncate">
                  {displayName}
                </p>
              </div>

              {/* Logout — destructive action gets error color so intent is clear */}
              <button
                type="button"
                onClick={() => {
                  void handleMobileLogout()
                }}
                className={cn(
                  'flex items-center gap-3 w-full px-4 py-3 rounded-xl mb-1',
                  'text-body-md font-medium text-left text-error',
                  'transition-colors duration-fast',
                  'hover:bg-error/[var(--state-hover-opacity)]',
                )}
              >
                <LogOut className="h-4 w-4 shrink-0" />
                Log out
              </button>
            </div>
          </div>
        )}
      </header>

      {/* ── Page content rendered by child routes ── */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto">
        <Outlet />
      </main>
    </div>
  )
}
