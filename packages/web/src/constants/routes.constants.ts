/**
 * Route Constants
 *
 * Single source of truth for all application route paths.
 * Centralizing here means a route rename is a one-file change —
 * no hunting for string literals scattered across pages and layouts.
 */

/**
 * Absolute paths — used in Link `to` props and programmatic navigation
 * (e.g. navigate(ROUTES.HOME), <Link to={ROUTES.LOGIN}>).
 */
export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  SIGNUP: '/signup',
  DASHBOARD: {
    ROOT: '/dashboard',
    SETTINGS: '/dashboard/settings',
    CREATE_NEW_BOT: '/dashboard/create-new-bot',
    BOT: '/dashboard/bot',
    BOT_COMMANDS: '/dashboard/bot/commands',
    BOT_EVENTS: '/dashboard/bot/events',
    BOT_SETTINGS: '/dashboard/bot/settings',
  },
  ADMIN: {
    ROOT: '/admin',
    DASHBOARD: '/admin/dashboard',
    USERS: '/admin/dashboard/users',
    BOTS: '/admin/dashboard/bots',
    SETTINGS: '/admin/dashboard/settings',
  },
} as const

/**
 * Relative path segments — used exclusively in createBrowserRouter path
 * definitions. React Router requires segment-only values (no leading slash)
 * for nested route children.
 */
export const ROUTE_SEGMENTS = {
  LOGIN: 'login',
  SIGNUP: 'signup',
  DASHBOARD: 'dashboard',
  BOTS: 'bots',
  COMMANDS: 'commands',
  EVENTS: 'events',
  SETTINGS: 'settings',
  CREATE_NEW_BOT: 'create-new-bot',
  BOT: 'bot',
  ADMIN: 'admin',
  ADMIN_LOGIN: 'login',
  ADMIN_DASHBOARD: 'dashboard',
  ADMIN_USERS: 'users',
  ADMIN_BOTS: 'bots',
  ADMIN_SETTINGS: 'settings',
} as const
