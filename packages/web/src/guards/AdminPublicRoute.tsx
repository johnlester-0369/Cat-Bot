import React from 'react'
import { Navigate, useLocation, Outlet } from 'react-router-dom'
import { useAdminAuth } from '@/contexts/AdminAuthContext'
import Progress from '@/components/ui/feedback/Progress'
import { ROUTES } from '@/constants/routes.constants'

/**
 * AdminPublicRoute guard component
 *
 * Mirrors PublicRoute for the user portal but targets the admin auth context.
 * Redirects authenticated admins away from /admin (login page) to the dashboard
 * so revisiting the login URL mid-session doesn't flash the form.
 *
 * The role check is a defence-in-depth measure — the adminAuth server hook already
 * enforces admin-only sessions, but we double-check client-side so no non-admin
 * session can accidentally bypass to the dashboard.
 *
 * The user portal's better-auth.session_token is never inspected here;
 * both session systems are fully independent.
 */
const AdminPublicRoute: React.FC = () => {
  const { isAuthenticated, isLoading, user } = useAdminAuth()
  const location = useLocation()

  // Wait for the session probe to resolve before deciding — avoids a redirect flash
  // on cold load when the cookie is present but the session hasn't hydrated yet.
  if (isLoading) {
    return <Progress.Circular fullScreen message="Checking admin access..." />
  }

  // Authenticated admins go straight to the dashboard; they don't need the login form.
  if (isAuthenticated && user?.role === 'admin') {
    return (
      <Navigate
        to={ROUTES.ADMIN.DASHBOARD}
        state={{ from: location }}
        replace
      />
    )
  }

  return <Outlet />
}

export default AdminPublicRoute
