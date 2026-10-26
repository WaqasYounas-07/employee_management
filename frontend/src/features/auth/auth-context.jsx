import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, tokens } from '@/lib/api'
import { STAFF_ROLES, HR_ROLES } from '@/lib/constants'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async () => {
    if (!tokens.access) {
      setUser(null)
      setLoading(false)
      return null
    }
    try {
      const { data } = await api.get('/auth/me/')
      setUser(data)
      return data
    } catch {
      tokens.clear()
      setUser(null)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadProfile()
  }, [loadProfile])

  /* The api client fires this when a refresh fails, so an expired session
     clears the UI wherever the user happens to be. */
  useEffect(() => {
    const onSignedOut = () => setUser(null)
    window.addEventListener('ems:signed-out', onSignedOut)
    return () => window.removeEventListener('ems:signed-out', onSignedOut)
  }, [])

  const login = useCallback(
    async (email, password) => {
      const { data } = await api.post('/auth/login/', { email, password })
      tokens.set({ access: data.access, refresh: data.refresh })
      return loadProfile()
    },
    [loadProfile],
  )

  const logout = useCallback(() => {
    tokens.clear()
    setUser(null)
  }, [])

  const value = useMemo(() => {
    /* What this role may do, as the backend reports it. The API enforces the
       same set independently -- this only decides what the UI offers. */
    const permissions = new Set(user?.permissions ?? [])
    const can = (permission) => permissions.has(permission)

    return {
      user,
      loading,
      login,
      logout,
      refresh: loadProfile,
      isAuthenticated: Boolean(user),
      isStaff: STAFF_ROLES.includes(user?.role),
      isHR: HR_ROLES.includes(user?.role),
      isAdmin: user?.role === 'admin',
      permissions,
      can,
    }
  }, [user, loading, login, logout, loadProfile])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside an AuthProvider.')
  return context
}
