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
import {
  H_HEIGHT,
  H_PX,
  H_LOGO_ICON,
  H_BRAND_TEXT,
  H_NAV_ITEM,
  H_NAV_ITEM_MOBILE,
  H_MENU_TRIGGER,
  H_CHEVRON,
  H_DROPDOWN_ITEM,
  H_DROPDOWN_ICON,
} from '@/constants/header.constants'

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
        H_NAV_ITEM,
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
// MobileNavLink
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
        H_NAV_ITEM_MOBILE,
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
// UserMenu — desktop dropdown
// ============================================================================

function UserMenu() {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { user, logout } = useUserAuth()

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
      await logout()
    } catch (err) {
      console.error('Logout failed:', err)
    }
    navigate(ROUTES.HOME)
  }

  const displayName = user?.name ?? 'User'

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          H_MENU_TRIGGER,
          'text-on-surface transition-colors duration-fast',
          'hover:bg-on-surface/[var(--state-hover-opacity)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          open && 'bg-on-surface/[var(--state-hover-opacity)]',
        )}
      >
        <span>{displayName}</span>
        <ChevronDown
          className={cn(
            H_CHEVRON,
            'text-on-surface-variant transition-transform duration-fast',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="User menu"
          className={cn(
            'absolute right-0 top-full mt-1 z-dropdown min-w-[172px]',
            'rounded-xl border border-outline-variant bg-surface',
            'shadow-elevation-2 py-1',
            '[animation:fade-in-down_150ms_var(--easing-standard-decelerate)_both]',
          )}
        >
          {/* User info header */}
          <div className="flex items-center gap-3 px-4 py-2.5.5 border-b border-outline-variant">
            <User className={cn(H_DROPDOWN_ICON, 'text-on-surface-variant')} />
            <p className="text-label-md font-medium text-on-surface truncate">
              {displayName}
            </p>
          </div>

          {/* Logout */}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void handleLogout()
            }}
            className={cn(
              H_DROPDOWN_ITEM,
              'text-error hover:bg-error/[var(--state-hover-opacity)]',
            )}
          >
            <LogOut className={H_DROPDOWN_ICON} />
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
 * Dashboard shell with a compact top navbar.
 *
 * Header structure (H_HEIGHT = h-12 / 48px — unified across all shells):
 *   Left:   Cat icon + desktop nav links
 *   Centre: "Cat-Bot" brand text, absolutely centred
 *   Right:  Theme toggle + UserMenu (desktop) | hamburger → drawer (mobile)
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

  const displayName = user?.name ?? 'User'

  if (location.pathname !== prevPath) {
    setPrevPath(location.pathname)
    setMobileOpen(false)
  }

  useEffect(() => {
    if (!mobileOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [mobileOpen])

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
        icon: <WifiOff className="w-4 h-4" />,
      })
    }

    const handleConnect = () => {
      if (!isDisconnectedRef.current) return
      isDisconnectedRef.current = false
      setPosition('bottom-right')
      snackbar({
        message: 'Your internet connection was restored.',
        duration: 4000,
        icon: <Wifi className="w-4 h-4" />,
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
        <nav
          className={cn(
            'relative max-w-7xl mx-auto flex items-center',
            H_HEIGHT,
            H_PX,
          )}
          aria-label="Dashboard navigation"
        >
          {/* Left: logo + desktop brand + nav links */}
          <div className="flex items-center gap-2 shrink-0">
            <UILink
              as={Link}
              to={ROUTES.DASHBOARD.ROOT}
              variant="unstyled"
              aria-label="Cat-Bot dashboard"
              className="flex items-center gap-2 text-title-lg font-semibold text-primary hover:opacity-80 transition-opacity duration-fast shrink-0"
            >
              <Cat className={H_LOGO_ICON} />
            </UILink>

            {/* Desktop: brand text — left-aligned next to the logo */}
            <Link
              to={ROUTES.DASHBOARD.ROOT}
              className={cn(
                'hidden md:inline-flex text-primary hover:opacity-80 transition-opacity duration-fast outline-none focus-visible:ring-2 focus-visible:ring-primary/20 rounded-sm',
                H_BRAND_TEXT,
              )}
            >
              Cat-Bot
            </Link>

            <div className="hidden md:flex items-center gap-0.5 ml-2">
              {navItems.map((item) => (
                <NavLink key={item.href} item={item} />
              ))}
            </div>
          </div>

          {/* Mobile: brand — absolutely centred (desktop link above takes over at md+) */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none md:hidden">
            <Link
              to={ROUTES.DASHBOARD.ROOT}
              className={cn(
                'pointer-events-auto text-primary hover:opacity-80 transition-opacity duration-fast outline-none focus-visible:ring-2 focus-visible:ring-primary/20 rounded-sm',
                H_BRAND_TEXT,
              )}
            >
              Cat-Bot
            </Link>
          </div>

          {/* Right: desktop */}
          <div className="hidden md:flex items-center gap-2 ml-auto">
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

          {/* Right: mobile hamburger */}
          <div className="flex md:hidden items-center ml-auto">
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

        {/* Mobile drawer */}
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
              {navItems.map((item) => (
                <MobileNavLink
                  key={item.href}
                  item={item}
                  onClick={() => setMobileOpen(false)}
                />
              ))}

              <div className="my-2 mx-4 border-t border-outline-variant" />

              {/* User identity */}
              <div className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
                  <User className="h-4 w-4 text-on-surface-variant" />
                </div>
                <p className="text-label-md font-medium text-on-surface truncate">
                  {displayName}
                </p>
              </div>

              {/* Logout */}
              <button
                type="button"
                onClick={() => {
                  void handleMobileLogout()
                }}
                className={cn(
                  H_NAV_ITEM_MOBILE,
                  'text-error hover:bg-error/[var(--state-hover-opacity)] mb-0.5',
                )}
              >
                <LogOut className="h-4 w-4 shrink-0" />
                Log out
              </button>

              <div className="my-2 mx-4 border-t border-outline-variant" />

              {/* Theme toggle */}
              <button
                type="button"
                onClick={() => {
                  setTheme(toggleTheme(theme))
                  setMobileOpen(false)
                }}
                className={cn(
                  H_NAV_ITEM_MOBILE,
                  'text-on-surface hover:bg-on-surface/[var(--state-hover-opacity)]',
                )}
              >
                {theme === 'dark' ? (
                  <Sun className="h-4 w-4 shrink-0 text-on-surface-variant" />
                ) : (
                  <Moon className="h-4 w-4 shrink-0 text-on-surface-variant" />
                )}
                {theme === 'dark'
                  ? 'Switch to light mode'
                  : 'Switch to dark mode'}
              </button>
            </div>
          </div>
        )}
      </header>
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto">
        <Outlet />
      </main>
    </div>
  )
}
