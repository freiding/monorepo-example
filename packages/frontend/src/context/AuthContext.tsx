import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { api } from '../api/client'

export interface User {
  id: string
  email: string | null
  walletAddress?: string | null
  username?: string | null
  avatar?: string | null
}

export interface SsoConfig {
  enabled: boolean
  issuer?: string
  clientId?: string
}

interface AuthContextValue {
  user: User | null
  ssoConfig: SsoConfig
  login: (token: string, user: User) => void
  logout: () => void
  updateUser: (user: User) => void
  loading: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [ssoConfig, setSsoConfig] = useState<SsoConfig>({ enabled: false })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('token')

    const userPromise = token
      ? api.get('/api/auth/me').then(res => setUser(res.data)).catch(() => localStorage.removeItem('token'))
      : Promise.resolve()

    const ssoPromise = api.get<SsoConfig>('/api/auth/sso/config')
      .then(res => setSsoConfig(res.data))
      .catch(() => {})

    Promise.all([userPromise, ssoPromise]).finally(() => setLoading(false))
  }, [])

  function login(token: string, newUser: User) {
    localStorage.setItem('token', token)
    setUser(newUser)
  }

  function logout() {
    const wasSsoLogin = localStorage.getItem('sso_session') === '1'
    localStorage.removeItem('token')
    localStorage.removeItem('sso_session')
    setUser(null)

    // RP-Initiated Logout (OIDC): if the user signed in via SSO, also end the SSO
    // session so a silent re-login (prompt=none / FedCM) doesn't log them straight
    // back in. This is a full-page redirect; SSO clears its cookie and redirects
    // back to post_logout_redirect_uri (which must be registered for this client).
    if (wasSsoLogin && ssoConfig.enabled && ssoConfig.issuer && ssoConfig.clientId) {
      const params = new URLSearchParams({
        client_id: ssoConfig.clientId,
        post_logout_redirect_uri: `${window.location.origin}/login`,
        state: crypto.randomUUID(),
      })
      window.location.href = `${ssoConfig.issuer}/oauth/logout?${params}`
    }
  }

  function updateUser(newUser: User) {
    setUser(newUser)
  }

  return (
    <AuthContext.Provider value={{ user, ssoConfig, login, logout, updateUser, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}