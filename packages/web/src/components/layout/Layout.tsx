import { useState, useEffect } from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'
import { Cat, Moon, Sun, Menu, X } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { toggleTheme } from '@/utils/theme.util'
import Button from '@/components/ui/buttons/Button'
import IconButton from '@/components/ui/buttons/IconButton'
import UILink from '@/components/ui/typography/Link'
import { cn } from '@/utils/cn.util'
import { useUserAuth } from '@/contexts/UserAuthContext'
import { ROUTES } from '@/constants/routes.constants'
import {
  H_HEIGHT,
  H_PX,
  H_LOGO_ICON,
  H_BRAND_TEXT,
  H_NAV_ITEM_MOBILE,
} from '@/constants/header.constants'

/**
 * Public shell — marketing and auth routes (/, /login, /signup, etc.)
 *
 * Header structure (H_HEIGHT = h-12 / 48px — unified with DashboardLayout
 * and AdminSidebarLayout):
 *   Left:   Cat icon logo → home
 *   Centre: "Cat-Bot" brand text, absolutely centred
 *   Right:  Auth CTAs + theme toggle (desktop) | hamburger → drawer (mobile)
 */
export default function Layout() {
  const { theme, setTheme } = useTheme()
  const location = useLocation()
  const { isAuthenticated } = useUserAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [prevPath, setPrevPath] = useState(location.pathname)

  const isLogin = location.pathname === '/login'
  const isSignup = location.pathname === '/signup'

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

  return (
    <div className="min-h-screen flex flex-col bg-surface text-on-surface">
      {/* ── Header ── */}
      <header className="sticky top-0 z-fixed bg-surface/80 backdrop-blur border-b border-outline-variant">
        <nav
          className={cn(
            'relative max-w-6xl mx-auto flex items-center',
            H_HEIGHT,
            H_PX,
          )}
          aria-label="Main navigation"
        >
          {/* Left: logo */}
          <UILink
            as={Link}
            to="/"
            variant="unstyled"
            aria-label="Cat-Bot home"
            className="flex items-center gap-2 text-title-lg font-semibold text-primary hover:opacity-80 transition-opacity duration-fast outline-none focus-visible:ring-2 focus-visible:ring-primary/20 rounded-sm"
          >
            <Cat className={H_LOGO_ICON} />
          </UILink>

          {/* Desktop: brand text — left-aligned, immediately after the logo */}
          <Link
            to="/"
            className={cn(
              'hidden md:inline-flex ml-2 text-primary hover:opacity-80 transition-opacity duration-fast outline-none focus-visible:ring-2 focus-visible:ring-primary/20 rounded-sm',
              H_BRAND_TEXT,
            )}
          >
            Cat-Bot
          </Link>

          {/* Mobile: brand — absolutely centred (desktop link above takes over at md+) */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none md:hidden">
            <Link
              to="/"
              className={cn(
                'pointer-events-auto text-primary hover:opacity-80 transition-opacity duration-fast outline-none focus-visible:ring-2 focus-visible:ring-primary/20 rounded-sm',
                H_BRAND_TEXT,
              )}
            >
              Cat-Bot
            </Link>
          </div>

          {/* Right: desktop */}
          <div className="hidden md:flex items-center gap-3 ml-auto">
            {isAuthenticated ? (
              <Button
                as={Link}
                to={ROUTES.DASHBOARD.ROOT}
                variant="filled"
                color="primary"
                size="md"
              >
                Go to Dashboard
              </Button>
            ) : (
              <>
                <Button
                  as={Link}
                  to="/login"
                  variant={isLogin ? 'tonal' : 'outline'}
                  color="primary"
                  size="sm"
                >
                  Log in
                </Button>
                <Button
                  as={Link}
                  to="/signup"
                  variant={isSignup ? 'tonal' : 'filled'}
                  color="primary"
                  size="sm"
                >
                  Sign up
                </Button>
              </>
            )}

            <IconButton
              icon={theme === 'dark' ? <Sun /> : <Moon />}
              aria-label={
                theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
              }
              variant="text"
              size="md"
              onClick={() => setTheme(toggleTheme(theme))}
            />
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
              'md:hidden border-t border-outline-variant bg-surface/95 backdrop-blur',
              '[animation:fade-in-down_150ms_var(--easing-standard-decelerate)_both]',
            )}
          >
            <div className="max-w-6xl mx-auto px-6 py-4 flex flex-col gap-2">
              {isAuthenticated ? (
                <Button
                  as={Link}
                  to={ROUTES.DASHBOARD.ROOT}
                  variant="filled"
                  color="primary"
                  size="md"
                  className="w-full justify-center"
                >
                  Go to Dashboard
                </Button>
              ) : (
                <>
                  <Button
                    as={Link}
                    to="/login"
                    variant={isLogin ? 'tonal' : 'outline'}
                    color="primary"
                    size="md"
                    className="w-full justify-center"
                  >
                    Log in
                  </Button>
                  <Button
                    as={Link}
                    to="/signup"
                    variant={isSignup ? 'tonal' : 'filled'}
                    color="primary"
                    size="md"
                    className="w-full justify-center"
                  >
                    Sign up
                  </Button>
                </>
              )}

              <div className="border-t border-outline-variant my-1" />

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
                {theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              </button>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
