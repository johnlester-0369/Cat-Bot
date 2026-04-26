/* eslint-disable react-refresh/only-export-components */
import React, { lazy, Suspense } from 'react'
import { createBrowserRouter, Outlet } from 'react-router-dom'
import { ROUTES, ROUTE_SEGMENTS } from '@/constants/routes.constants'

// Layout shells are NOT lazy — they must render immediately so the nav
// chrome appears before any page bundle resolves.
import Layout from '@/components/layout/Layout'
import DashboardLayout from '@/features/users/components/DashboardLayout'
import UserProtectedRoute from '@/guards/UserProtectedRoute'
import PublicRoute from '@/guards/PublicRoute'
import AdminProtectedRoute from '@/guards/AdminProtectedRoute'
import AdminPublicRoute from '@/guards/AdminPublicRoute'
import AdminSidebarLayout from '@/features/admin/components/AdminSidebarLayout'
import { AdminAuthProvider } from '@/contexts/AdminAuthContext'

// Page bundles split per-route so the initial JS payload stays small.
const HomePage = lazy(() => import('@/pages/Home'))
const LoginPage = lazy(() => import('@/pages/Login'))
const SignupPage = lazy(() => import('@/pages/Signup'))
const ForgotPasswordPage = lazy(() => import('@/pages/ForgotPassword'))
const ResetPasswordPage = lazy(() => import('@/pages/ResetPassword'))
const AccountVerificationPage = lazy(
  () => import('@/pages/AccountVerification'),
)
const SettingsPage = lazy(() => import('@/pages/dashboard/settings'))
const BotManagerPage = lazy(() => import('@/pages/dashboard'))
const NewBotPage = lazy(() => import('@/pages/dashboard/create-new-bot'))
const BotLayout = lazy(
  () => import('@/features/users/components/DashboardBotLayout'),
)
const BotConsolePage = lazy(() => import('@/pages/dashboard/bot/index'))
const BotCommandsPage = lazy(() => import('@/pages/dashboard/bot/commands'))
const BotEventsPage = lazy(() => import('@/pages/dashboard/bot/events'))
const BotSettingsPage = lazy(() => import('@/pages/dashboard/bot/settings'))
const AdminLoginPage = lazy(() => import('@/pages/admin'))
const AdminForgotPasswordPage = lazy(
  () => import('@/pages/admin/ForgotPassword'),
)
const AdminResetPasswordPage = lazy(() => import('@/pages/admin/ResetPassword'))
const AdminDashboardPage = lazy(() => import('@/pages/admin/dashboard'))
const AdminUsersPage = lazy(() => import('@/pages/admin/dashboard/users'))
const AdminBotsPage = lazy(() => import('@/pages/admin/dashboard/bots'))
const AdminSettingsPage = lazy(() => import('@/pages/admin/dashboard/settings'))

// Inline 404 — too lightweight to deserve its own chunk.
function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-on-surface">
      <h1 className="text-display-sm font-medium">404</h1>
      <p className="text-body-lg text-on-surface-variant">Page not found.</p>
    </div>
  )
}

/**
 * AdminLayout — scopes AdminAuthProvider to the admin route subtree.
 * Isolates admin session state from UserAuthContext; App.tsx needs no changes
 * because the provider lives entirely within this route branch.
 */
function AdminLayout() {
  return (
    <AdminAuthProvider>
      <Outlet />
    </AdminAuthProvider>
  )
}

/**
 * Wraps lazy pages in a Suspense boundary with a blank surface fallback.
 * The blank div matches the body background so there's no flash of white.
 */
const withSuspense = (node: React.ReactElement) => (
  <Suspense
    fallback={<div className="min-h-screen bg-surface-container-lowest" />}
  >
    {node}
  </Suspense>
)

/**
 * Route tree uses two sibling top-level routes so each shell renders
 * independently. Previously /dashboard was nested under Layout, which
 * caused both the public navbar and the dashboard navbar to render on
 * every dashboard route.
 */
export const router = createBrowserRouter([
  // ── Public shell (marketing + auth pages) ──────────────────────────────
  {
    path: ROUTES.HOME,
    element: <Layout />,
    children: [
      { index: true, element: withSuspense(<HomePage />) },
      // PublicRoute bounces already-authenticated users to /dashboard so
      // login and signup are unreachable mid-session without a manual sign-out.
      {
        element: <PublicRoute />,
        children: [
          { path: ROUTE_SEGMENTS.LOGIN, element: withSuspense(<LoginPage />) },
          {
            path: ROUTE_SEGMENTS.SIGNUP,
            element: withSuspense(<SignupPage />),
          },
        ],
      },
      // WHY: Extracted from PublicRoute to prevent authenticated users from being redirected to the dashboard when visiting password recovery links.
      {
        path: ROUTE_SEGMENTS.FORGOT_PASSWORD,
        element: withSuspense(<ForgotPasswordPage />),
      },
      {
        path: ROUTE_SEGMENTS.ACCOUNT_VERIFICATION,
        element: withSuspense(<AccountVerificationPage />),
      },
      {
        path: ROUTE_SEGMENTS.RESET_PASSWORD,
        element: withSuspense(<ResetPasswordPage />),
      },
      { path: '*', element: withSuspense(<NotFound />) },
    ],
  },

  // ── Dashboard shell (operator tool) ────────────────────────────────────
  // UserProtectedRoute is a pathless layout route that owns the /dashboard
  // subtree — unauthenticated visitors are redirected to /login with `from`
  // state so the login page can bounce them back after a successful sign-in.
  // DashboardLayout is nested one level below so it never renders at all
  // for unauthenticated requests (no flash of shell before redirect).
  {
    element: <UserProtectedRoute />,
    children: [
      {
        path: ROUTES.DASHBOARD.ROOT,
        element: <DashboardLayout />,
        children: [
          { index: true, element: withSuspense(<BotManagerPage />) },
          {
            path: ROUTE_SEGMENTS.SETTINGS,
            element: withSuspense(<SettingsPage />),
          },
          {
            path: ROUTE_SEGMENTS.CREATE_NEW_BOT,
            element: withSuspense(<NewBotPage />),
          },
          {
            path: ROUTE_SEGMENTS.BOT,
            element: withSuspense(<BotLayout />),
            children: [
              { index: true, element: withSuspense(<BotConsolePage />) },
              {
                path: ROUTE_SEGMENTS.COMMANDS,
                element: withSuspense(<BotCommandsPage />),
              },
              {
                path: ROUTE_SEGMENTS.EVENTS,
                element: withSuspense(<BotEventsPage />),
              },
              {
                path: ROUTE_SEGMENTS.SETTINGS,
                element: withSuspense(<BotSettingsPage />),
              },
            ],
          },
        ],
      },
    ],
  },

  // ── Admin shell — AdminAuthProvider scoped to this subtree only ─────────────
  // AdminLayout provides the AdminAuthContext so useAdminAuth() is available to
  // AdminProtectedRoute, AdminLoginPage, and AdminDashboardPage without touching App.tsx.
  // The ba-admin.session_token cookie powering this context never overlaps with the
  // user portal's better-auth.session_token.
  {
    element: <AdminLayout />,
    children: [
      {
        element: <AdminPublicRoute />,
        children: [
          {
            path: ROUTES.ADMIN.ROOT,
            element: withSuspense(<AdminLoginPage />),
          },
        ],
      },
      // WHY: Extracted from AdminPublicRoute so active admin sessions don't redirect password recovery URLs to the dashboard.
      {
        path: ROUTES.ADMIN.FORGOT_PASSWORD,
        element: withSuspense(<AdminForgotPasswordPage />),
      },
      {
        path: ROUTES.ADMIN.RESET_PASSWORD,
        element: withSuspense(<AdminResetPasswordPage />),
      },
      {
        element: <AdminProtectedRoute />,
        children: [
          {
            // AdminSidebarLayout provides the persistent sidebar for all protected admin pages
            element: <AdminSidebarLayout />,
            children: [
              {
                path: ROUTES.ADMIN.DASHBOARD,
                element: withSuspense(<AdminDashboardPage />),
              },
              {
                path: ROUTES.ADMIN.USERS,
                element: withSuspense(<AdminUsersPage />),
              },
              {
                path: ROUTES.ADMIN.BOTS,
                element: withSuspense(<AdminBotsPage />),
              },
              {
                path: ROUTES.ADMIN.SETTINGS,
                element: withSuspense(<AdminSettingsPage />),
              },
            ],
          },
        ],
      },
    ],
  },
])
