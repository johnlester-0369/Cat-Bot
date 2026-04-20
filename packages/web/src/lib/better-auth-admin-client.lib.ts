/**
 * Admin Authentication Client
 *
 * Points exclusively to the adminAuth betterAuth instance mounted at /api/admin-auth.
 * The server sets cookiePrefix 'ba-admin', so the browser stores the admin session as
 * 'ba-admin.session_token' — completely isolated from the user auth cookie
 * ('better-auth.session_token'). Both cookies coexist with zero interference:
 * signing out of the user portal never clears the admin session and vice-versa.
 *
 * basePath must match the basePath set in adminAuth inside better-auth.lib.ts.
 *
 * Vite proxy note: ensure your vite.config.ts proxy rule covers /api (or /api/admin-auth
 * specifically) so requests reach the Express server in development. The default rule
 * `proxy: { '/api': 'http://localhost:3000' }` covers both /api/auth and /api/admin-auth.
 */
import { createAuthClient } from 'better-auth/react'
import { adminClient } from 'better-auth/client/plugins'

export const authAdminClient = createAuthClient({
  // Route all admin auth API calls to the dedicated admin-auth handler.
  basePath: '/api/admin-auth',
  // adminClient() adds authAdminClient.admin.* methods (listUsers, setRole, banUser, etc.)
  // which map to the admin plugin endpoints on the adminAuth server instance.
  plugins: [adminClient()],
  fetchOptions: {
    // Include cookies on every request so 'ba-admin.session_token' travels with auth calls.
    credentials: 'include',
    onError(context: { error: Error; response?: Response }) {
      console.error('[admin-auth] Request failed:', context.error)
      if (context.response?.status === 401) {
        console.log('[admin-auth] Session expired or not authenticated')
      }
    },
  },
})
