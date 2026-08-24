import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { api } from '../api/client'
import { isFedcmSupported, silentFedcmLogin, passiveFedcmLogin } from '../lib/fedcm'

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
  // true, пока на /login идёт фоновая passive-проверка FedCM (основной путь входа).
  // LoginPage по нему показывает индикатор и держит кнопку-резерв скрытой.
  fedcmChecking: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [ssoConfig, setSsoConfig] = useState<SsoConfig>({ enabled: false })
  const [loading, setLoading] = useState(true)
  const [fedcmChecking, setFedcmChecking] = useState(false)

  useEffect(() => {
    let cancelled = false

    // Применяет успешный FedCM-результат к состоянию/хранилищу.
    function applyFedcmResult(result: { token: string; user: User }) {
      localStorage.setItem('token', result.token)
      localStorage.setItem('sso_session', '1')
      setUser(result.user)
    }

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

      const fedcmReady = cfg.enabled && !!cfg.issuer && !!cfg.clientId && isFedcmSupported()

      // 3. ОСНОВНОЙ путь — фоновый FedCM. Сначала бесшумный auto-reauthn (без UI):
      // вернувшийся пользователь с активной SSO-сессией и ранее данным согласием
      // входит seamless, без мигания страницы логина.
      if (!cancelled && fedcmReady) {
        const result = await silentFedcmLogin({ issuer: cfg.issuer!, clientId: cfg.clientId! })
        if (result && !cancelled) {
          applyFedcmResult(result)
          setLoading(false)
          return
        }
      }

      // Бесшумно войти не удалось — показываем приложение (страницу логина) и
      // параллельно запускаем passive-попытку: браузер сам покажет свой нативный
      // account-chooser поверх страницы. Не блокируем рендер ожиданием промпта.
      if (!cancelled) setLoading(false)

      if (!cancelled && fedcmReady) {
        setFedcmChecking(true)
        passiveFedcmLogin({ issuer: cfg.issuer!, clientId: cfg.clientId! })
          .then(result => {
            if (cancelled) return
            if (result) applyFedcmResult(result)
          })
          .finally(() => { if (!cancelled) setFedcmChecking(false) })
      }
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
    <AuthContext.Provider value={{ user, ssoConfig, login, logout, updateUser, loading, fedcmChecking }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}