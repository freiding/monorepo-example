import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { api } from '../api/client'
import { isFedcmSupported, silentFedcmLogin } from '../lib/fedcm'

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
    let cancelled = false

    async function init() {
      // 1. SSO-конфиг нужен и для FedCM, и для обычного SSO — грузим всегда.
      let cfg: SsoConfig = { enabled: false }
      try {
        cfg = (await api.get<SsoConfig>('/api/auth/sso/config')).data
        if (!cancelled) setSsoConfig(cfg)
      } catch { /* SSO недоступен — не критично */ }

      // 2. Есть локальный токен — проверяем его и, если валиден, входим.
      const token = localStorage.getItem('token')
      if (token) {
        try {
          const res = await api.get('/api/auth/me')
          if (!cancelled) { setUser(res.data); setLoading(false) }
          return
        } catch {
          localStorage.removeItem('token')
        }
      }

      // 3. Локальной сессии нет → пробуем silent-вход через FedCM. Если у
      // пользователя есть активная SSO-сессия и он уже давал согласие этому
      // приложению, браузер молча вернёт id_token и мы войдём без единого клика.
      // Иначе — тихо остаёмся на странице логина.
      if (!cancelled && cfg.enabled && cfg.issuer && cfg.clientId && isFedcmSupported()) {
        const result = await silentFedcmLogin({ issuer: cfg.issuer, clientId: cfg.clientId })
        if (result && !cancelled) {
          localStorage.setItem('token', result.token)
          localStorage.setItem('sso_session', '1')
          setUser(result.user)
        }
      }

      if (!cancelled) setLoading(false)
    }

    init()
    return () => { cancelled = true }
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

    // Запрещаем браузеру молча авто-логинить обратно через FedCM до следующего
    // явного входа — иначе silent-попытка на /login тут же вернёт пользователя.
    navigator.credentials?.preventSilentAccess?.()

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