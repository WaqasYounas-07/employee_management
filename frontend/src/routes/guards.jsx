import { Navigate, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/features/auth/auth-context'

function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
}

/** Blocks a route until the session is known, then redirects if signed out. */
export function RequireAuth({ children }) {
  const { isAuthenticated, loading } = useAuth()
  const location = useLocation()

  if (loading) return <FullPageSpinner />
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return children
}

/**
 * Hides a route the role has no permission for. The backend checks the same
 * permission on every request; this only keeps the UI honest about what it
 * offers, so a user is not dropped onto a page that would only 403.
 */
export function RequirePermission({ permission, children }) {
  const { can, loading } = useAuth()

  if (loading) return <FullPageSpinner />
  if (!can(permission)) return <Navigate to="/" replace />
  return children
}

/**
 * Hides a route from roles that may not use it. Kept for anything pinned to
 * a role rather than a permission.
 */
export function RequireRole({ roles, children }) {
  const { user, loading } = useAuth()

  if (loading) return <FullPageSpinner />
  if (!roles.includes(user?.role)) return <Navigate to="/" replace />
  return children
}
