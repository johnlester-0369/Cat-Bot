import React, { createContext, useContext } from 'react'
import { authAdminClient } from '@/lib/better-auth-admin-client.lib'

// Type definitions — mirrors UserAuthContext structure but scoped to admin auth.
interface AdminUser {
  id: string
  name: string
  email: string
  image?: string
  // role is always 'admin' for sessions that pass the adminAuth before-hook, but typed
  // as string | null to stay compatible with better-auth's generated session shape.
  role: string | null
  createdAt: Date
  updatedAt: Date
}

interface AdminSession {
  session: {
    userId: string
    expiresAt: Date
    token: string
    [key: string]: unknown
  }
  user: AdminUser
}

interface AdminAuthContextType {
  session: AdminSession | null
  user: AdminUser | null
  error: Error | null
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshSession: () => void
  isAuthenticated: boolean
  isLoading: boolean
}

const AdminAuthContext = createContext<AdminAuthContextType | undefined>(
  undefined,
)

// eslint-disable-next-line react-refresh/only-export-components
export const useAdminAuth = () => {
  const context = useContext(AdminAuthContext)
  if (!context) {
    throw new Error('useAdminAuth must be used within an AdminAuthProvider')
  }
  return context
}

export const AdminAuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const {
    data: session,
    isPending,
    error,
    refetch,
  } = authAdminClient.useSession()

  const login = async (email: string, password: string) => {
    // authAdminClient targets /api/admin-auth — the response sets 'ba-admin.session_token'
    // independently of the user portal's 'better-auth.session_token'.
    const result = await authAdminClient.signIn.email(
      { email, password },
      {
        onSuccess: () => {
          console.log('✅ Admin login successful')
        },
        onError: (ctx) => {
          console.error('❌ Admin login failed:', ctx.error)
          throw new Error(ctx.error.message || 'Login failed')
        },
      },
    )

    if (result.error) {
      throw new Error(result.error.message || 'Login failed')
    }

    await refetch()
  }

  const logout = async () => {
    try {
      const result = await authAdminClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            console.log('✅ Admin logout successful')
          },
          onError: (ctx) => {
            console.error('❌ Admin logout failed:', ctx.error)
          },
        },
      })

      if (result.error) {
        throw new Error(result.error.message || 'Logout failed')
      }

      // Refreshes session state so AdminProtectedRoute immediately redirects.
      // Only the ba-admin cookie is cleared — the user portal session is untouched.
      await refetch()
    } catch (error) {
      console.error('Admin logout failed:', error)
      throw error
    }
  }

  const value: AdminAuthContextType = {
    session: session as AdminSession | null,
    user: (session as AdminSession | null)?.user ?? null,
    error,
    isAuthenticated: !!session,
    isLoading: isPending,
    login,
    logout,
    refreshSession: refetch,
  }

  return (
    <AdminAuthContext.Provider value={value}>
      {children}
    </AdminAuthContext.Provider>
  )
}

export type { AdminUser, AdminSession, AdminAuthContextType }
