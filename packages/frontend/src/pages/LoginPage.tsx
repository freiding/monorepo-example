import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth, User } from '../context/AuthContext'
import { generateCodeVerifier, generateCodeChallenge } from '../lib/pkce'
import { fedcmLogin, isFedcmSupported } from '../lib/fedcm'
import { SsoMigrationModal } from '../components/SsoMigrationModal'
import { SetupProfileModal } from '../components/SetupProfileModal'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [walletLoading, setWalletLoading] = useState(false)
  const [walletError, setWalletError] = useState('')
  const [fedcmLoading, setFedcmLoading] = useState(false)
  const [fedcmError, setFedcmError] = useState('')
  // Держим токен/юзера локально пока показывается модалка —
  // login() в контекст НЕ вызываем, иначе PublicRoute сразу редиректит
  const [pendingAuth, setPendingAuth] = useState<{ token: string; user: User } | null>(null)
  const [pendingSetup, setPendingSetup] = useState<{ token: string } | null>(null)
  const { login, ssoConfig, fedcmChecking } = useAuth()
  const navigate = useNavigate()

  async function buildSsoUrl(intent: 'login' | 'migrate'): Promise<string> {
    const verifier = generateCodeVerifier()
    const challenge = await generateCodeChallenge(verifier)
    const state = crypto.randomUUID()
    localStorage.setItem('pkce_verifier', verifier)
    localStorage.setItem('oauth_state', state)
    localStorage.setItem('pkce_intent', intent)
    const redirectUri = `${window.location.origin}/auth/callback`
    const params = new URLSearchParams({
      client_id: ssoConfig.clientId!,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid profile email wallet',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    })
    return `${ssoConfig.issuer}/oauth/authorize?${params}`
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data } = await api.post('/api/auth/login', { email, password })
      if (ssoConfig.enabled) {
        // Сохраняем без login() — контекст не обновляем, PublicRoute не сработает
        setPendingAuth({ token: data.token, user: data.user })
      } else {
        login(data.token, data.user)
        navigate('/tasks')
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error
      setError(msg || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleSsoLogin() {
    if (!ssoConfig.enabled) return
    window.location.href = await buildSsoUrl('login')
  }

  // Интерактивный FedCM-вход (mediation: 'optional') — показывает диалог выбора
  // аккаунта. Нужен для первого согласия; после него автоматический silent-вход
  // в AuthContext будет входить молча.
  async function handleFedcmLogin() {
    if (!ssoConfig.enabled || !ssoConfig.issuer || !ssoConfig.clientId) return
    setFedcmError('')
    setFedcmLoading(true)
    try {
      const result = await fedcmLogin({
        issuer: ssoConfig.issuer,
        clientId: ssoConfig.clientId,
        mediation: 'optional',
        // Button Mode: вызов по клику, не подчиняется cooldown'у после закрытия
        // диалога — поэтому повторное нажатие всегда открывает выбор аккаунта.
        mode: 'active',
      })
      if (!result) {
        setFedcmError('No account available for silent sign-in')
        return
      }
      localStorage.setItem('sso_session', '1')
      if (!result.user.username) {
        localStorage.setItem('token', result.token)
        setPendingSetup({ token: result.token })
      } else {
        login(result.token, result.user)
        navigate('/tasks')
      }
    } catch (err: unknown) {
      // NotAllowedError — пользователь закрыл диалог; остальное — сеть/конфиг.
      const name = (err as { name?: string }).name
      if (name !== 'NotAllowedError' && name !== 'AbortError') {
        const msg = (err as { response?: { data?: { error?: string } }; message?: string })
          .response?.data?.error
        setFedcmError(msg || 'FedCM sign-in failed')
      }
    } finally {
      setFedcmLoading(false)
    }
  }

  async function handleMigrate() {
    if (!pendingAuth || !ssoConfig.enabled) return
    // Кладём токен в localStorage ДО редиректа — callback нужен для /sso/migrate
    localStorage.setItem('token', pendingAuth.token)
    window.location.href = await buildSsoUrl('migrate')
  }

  function handleSkipMigration() {
    if (pendingAuth) login(pendingAuth.token, pendingAuth.user)
    navigate('/tasks')
  }

  async function handleWalletLogin() {
    if (!window.ethereum) {
      setWalletError('No Web3 wallet detected. Please install MetaMask or another wallet extension.')
      return
    }
    setWalletLoading(true)
    setWalletError('')
    try {
      const accounts = await window.ethereum.request<string[]>({ method: 'eth_requestAccounts' })
      const address = (accounts as string[])[0]

      const { data: challengeData } = await api.post<{ message: string }>('/api/auth/wallet/challenge', { address })

      const signature = await window.ethereum.request<string>({
        method: 'personal_sign',
        params: [challengeData.message, address],
      })

      const { data } = await api.post('/api/auth/wallet/verify', { address, signature })

      if (!data.user.username) {
        localStorage.setItem('token', data.token)
        setPendingSetup({ token: data.token })
      } else {
        login(data.token, data.user)
        navigate('/tasks')
      }
    } catch (err: unknown) {
      const e = err as { code?: number; message?: string; response?: { data?: { error?: string } } }
      if (e.code === 4001) {
        setWalletError('Request rejected')
      } else {
        setWalletError(e.response?.data?.error || e.message || 'Wallet login failed')
      }
    } finally {
      setWalletLoading(false)
    }
  }

  function handleSetupComplete(user: User) {
    login(pendingSetup!.token, user)
    navigate('/tasks')
  }

  const hasExtraLogin = ssoConfig.enabled || typeof window !== 'undefined'

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
        <h1 className="text-2xl font-semibold mb-1">Sign in</h1>
        <p className="text-sm text-gray-400 mb-6">Welcome back</p>

        {ssoConfig.enabled && (
          <button
            type="button"
            onClick={handleSsoLogin}
            className="w-full flex items-center justify-center gap-2 border border-gray-200 rounded-lg py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors mb-2"
          >
            <SsoIcon />
            Continue with SSO
          </button>
        )}

        {/* Основной путь — фоновая passive-проверка FedCM (запускается в
            AuthContext на загрузке). Пока она идёт, показываем ненавязчивый
            индикатор вместо кнопки: браузер сам покажет свой account-chooser. */}
        {ssoConfig.enabled && isFedcmSupported() && fedcmChecking && (
          <div className="w-full flex items-center justify-center gap-2 py-2.5 text-sm text-gray-400 mb-2">
            <Spinner />
            Checking single sign-on…
          </div>
        )}

        {/* Резерв: если авто-вход не сработал (нет сессии/согласия, диалог закрыт
            или сработал embargo) — явная кнопка в active-режиме, обходящем cooldown. */}
        {ssoConfig.enabled && isFedcmSupported() && !fedcmChecking && (
          <button
            type="button"
            onClick={handleFedcmLogin}
            disabled={fedcmLoading}
            className="w-full flex items-center justify-center gap-2 text-sm text-gray-500 hover:text-gray-700 underline underline-offset-2 py-2 transition-colors disabled:opacity-50 mb-2"
          >
            {fedcmLoading ? 'Signing in…' : "Didn't sign in automatically? Continue with FedCM"}
          </button>
        )}
        {fedcmError && <p className="text-sm text-red-500 mb-2">{fedcmError}</p>}

        <button
          type="button"
          onClick={handleWalletLogin}
          disabled={walletLoading}
          className="w-full flex items-center justify-center gap-2 border border-gray-200 rounded-lg py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          <WalletIcon />
          {walletLoading ? 'Connecting...' : 'Continue with Wallet'}
        </button>
        {walletError && <p className="text-sm text-red-500 mt-2">{walletError}</p>}

        {hasExtraLogin && (
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-gray-100" />
            <span className="text-xs text-gray-400">or</span>
            <div className="flex-1 h-px bg-gray-100" />
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus={!ssoConfig.enabled}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="mt-5 text-sm text-center text-gray-400">
          No account?{' '}
          <Link to="/register" className="text-blue-600 hover:underline font-medium">
            Register
          </Link>
        </p>
      </div>

      {pendingAuth && (
        <SsoMigrationModal
          onMigrate={handleMigrate}
          onSkip={handleSkipMigration}
        />
      )}

      {pendingSetup && (
        <SetupProfileModal onComplete={handleSetupComplete} />
      )}
    </div>
  )
}

function SsoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}

function WalletIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 7v13a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
    </svg>
  )
}
