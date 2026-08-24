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
      // 1. SSO-конфиг грузим в фоне — он НЕ должен задерживать первый рендер.
      // Кнопки SSO/FedCM появятся, как только конфиг приедет; FedCM стартует
      // по готовности этого промиса (см. ниже).
      const cfgPromise = api.get<SsoConfig>('/api/auth/sso/config')
        .then(res => { if (!cancelled) setSsoConfig(res.data); return res.data })
        .catch(() => ({ enabled: false } as SsoConfig))

      // 2. loading гейтит ТОЛЬКО валидация сохранённого токена — это единственное,
      // что определяет начальное состояние (показать приложение или страницу входа).
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
      // Нет валидного токена → сразу рисуем страницу входа, не дожидаясь FedCM.
      if (!cancelled) setLoading(false)

      // 3. Весь FedCM — в фоне, поверх уже отрисованной страницы.
      const cfg = await cfgPromise
      if (cancelled) return
      const fedcmReady = cfg.enabled && !!cfg.issuer && !!cfg.clientId && isFedcmSupported()
      if (!fedcmReady) return

      // 3a. Бесшумный auto-reauthn (без UI, не вызывает embargo) — seamless-вход
      // вернувшегося пользователя.
      const silent = await silentFedcmLogin({ issuer: cfg.issuer!, clientId: cfg.clientId! })
      if (cancelled) return
      if (silent) { applyFedcmResult(silent); return }

      // 3b. Passive-промпт (браузер сам покажет account-chooser) — но НЕ чаще одного
      // раза за вкладку/сессию. Иначе повторные авто-показы, которые пользователь не
      // подтверждает, Chrome трактует как отказы и эскалирует embargo. Дальше в дело
      // вступает кнопка-резерв в active-режиме.
      if (sessionStorage.getItem('fedcm_passive_tried')) return
      sessionStorage.setItem('fedcm_passive_tried', '1')

      setFedcmChecking(true)
      passiveFedcmLogin({ issuer: cfg.issuer!, clientId: cfg.clientId! })
        .then(result => {
          if (cancelled) return
          if (result) applyFedcmResult(result)
        })
        .finally(() => { if (!cancelled) setFedcmChecking(false) })
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