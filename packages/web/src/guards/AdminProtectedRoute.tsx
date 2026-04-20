import React from 'react'
import { Navigate, useLocation, Outlet } from 'react-router-dom'
import { useAdminAuth } from '@/contexts/AdminAuthContext'
import Progress from '@/components/ui/feedback/Progress'
import { ROUTES } from '@/constants/routes.constants'

/**
 * AdminProtectedRoute guard component
 *
 * Protects routes that require an active admin session (e.g., /admin/dashboard).
 * Two independent checks are performed:
 *   1. isAuthenticated — ba-admin.session_token cookie must be valid
 *   2. user.role === 'admin' — defence-in-depth against a user who somehow obtained
 *      an admin-scoped session (shouldn't be possible given the adminAuth before-hook,
 *      but checked here so the client never renders admin UI for non-admin roles).
 *
 * Redirects to /admin/login with { from } state so the login page can bounce back
 * after a successful sign-in. The user portal session is never inspected here —
 * the two session systems are fully independent.
 */
const AdminProtectedRoute: React.FC = () => {
  const { isAuthenticated, isLoading, user } = useAdminAuth()
  const location = useLocation()

  if (isLoading) {
    return <Progress.Circular fullScreen message="Checking admin access..." />
  }

  // Redirect if no admin session or if the session belongs to a non-admin role.
  if (!isAuthenticated || user?.role !== 'admin') {
    return (
      <Navigate to={ROUTES.ADMIN.ROOT} state={{ from: location }} replace />
    )
  }

  return <Outlet />
}

export default AdminProtectedRoute
