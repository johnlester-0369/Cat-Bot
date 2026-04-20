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

/**
 * Public shell rendered on marketing and auth routes (/, /login, /signup).
 *
 * Kept separate from DashboardLayout so authenticated operators see only
 * the dashboard chrome — no public nav leaks through via nesting.
 *
 * Responsive strategy:
 *  - md+: logo left | theme toggle + auth buttons right (horizontal)
 *  - <md: logo left | theme toggle + hamburger right → animated drawer below header
 *
 * The mobile drawer is part of the sticky header element so it scrolls with
 * the page's sticky region rather than appearing as a floating overlay.
 */
export default function Layout() {
  const { theme, setTheme } = useTheme()
  const location = useLocation()
  const { isAuthenticated } = useUserAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [prevPath, setPrevPath] = useState(location.pathname)

  const isLogin = location.pathname === '/login'
  const isSignup = location.pathname === '/signup'

  // Collapse the mobile drawer on route change. Done during render
  // to avoid cascading state updates from effects.
  if (location.pathname !== prevPath) {
    setPrevPath(location.pathname)
    setMobileOpen(false)
  }

  // Keyboard accessibility — Escape dismisses the menu per ARIA modal pattern.
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
        {/* Main nav bar — fixed 64px height, logo left / controls right */}
        <nav
          className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between"
          aria-label="Main navigation"
        >
          {/* Brand */}
          <UILink
            as={Link}
            to="/"
            variant="unstyled"
            className="flex items-center gap-2 text-title-lg font-semibold text-primary hover:opacity-80 transition-opacity duration-fast outline-none focus-visible:ring-2 focus-visible:ring-primary/20 rounded-sm"
          >
            {/* Mirrors the DashboardLayout brand — both shells share the same visual identity */}
            <Cat className="h-[1.3em] w-[1.3em]" />
            Cat-Bot
          </UILink>

          {/* ── Desktop right-side controls (md+) ── */}
          <div className="hidden md:flex items-center gap-3">
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

            {isAuthenticated ? (
              // Streamline UX: Users with active sessions skip the login flow
              <Button
                as={Link}
                to={ROUTES.DASHBOARD.ROOT}
                variant="filled"
                color="primary"
                size="sm"
              >
                Go to Dashboard
              </Button>
            ) : (
              <>
                {/* Outline variant on the active auth link signals "current page" */}
                <Button
                  as={Link}
                  to="/login"
                  variant={isLogin ? 'tonal' : 'outline'}
                  color="primary"
                  size="sm"
                >
                  Log in
                </Button>

                {/* Filled CTA for maximum visual weight on the primary acquisition action */}
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
          </div>

          {/* ── Mobile controls: theme toggle + hamburger (<md) ── */}
          {/* Theme toggle stays visible on mobile so the primary UX preference is never hidden */}
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

        {/* ── Mobile dropdown drawer ── */}
        {/* Rendered inside <header> so it participates in the sticky region
            and doesn't overlap page content when scrolled. */}
        {mobileOpen && (
          <div
            role="navigation"
            aria-label="Mobile navigation"
            className={cn(
              'md:hidden border-t border-outline-variant bg-surface/95 backdrop-blur',
              '[animation:fade-in-down_150ms_var(--easing-standard-decelerate)_both]',
            )}
          >
            <div className="max-w-6xl mx-auto px-6 py-4 flex flex-col gap-3">
              {/* Full-width buttons give generous touch targets on narrow viewports */}
              {isAuthenticated ? (
                // Direct navigation to dashboard for authenticated mobile users
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
            </div>
          </div>
        )}
      </header>

      {/* ── Page content ── */}
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
