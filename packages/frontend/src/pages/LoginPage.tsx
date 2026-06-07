import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { generateCodeVerifier, generateCodeChallenge } from '../lib/pkce'
import { SsoMigrationModal } from '../components/SsoMigrationModal'

const SSO_ISSUER = import.meta.env.VITE_SSO_ISSUER as string | undefined
const SSO_CLIENT_ID = import.meta.env.VITE_SSO_CLIENT_ID as string | undefined
const ssoEnabled = !!(SSO_ISSUER && SSO_CLIENT_ID)

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showMigrationModal, setShowMigrationModal] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data } = await api.post('/api/auth/login', { email, password })
      login(data.token, data.user)
      if (ssoEnabled) {
        setShowMigrationModal(true)
      } else {
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
    if (!SSO_ISSUER || !SSO_CLIENT_ID) return
    const verifier = generateCodeVerifier()
    const challenge = await generateCodeChallenge(verifier)
    const state = crypto.randomUUID()

    sessionStorage.setItem('pkce_verifier', verifier)
    sessionStorage.setItem('oauth_state', state)
    sessionStorage.setItem('pkce_intent', 'login')

    const redirectUri = `${window.location.origin}/auth/callback`
    const params = new URLSearchParams({
      client_id: SSO_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid profile email',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    })
    window.location.href = `${SSO_ISSUER}/oauth/authorize?${params}`
  }

  async function handleMigrate() {
    if (!SSO_ISSUER || !SSO_CLIENT_ID) return
    const verifier = generateCodeVerifier()
    const challenge = await generateCodeChallenge(verifier)
    const state = crypto.randomUUID()

    sessionStorage.setItem('pkce_verifier', verifier)
    sessionStorage.setItem('oauth_state', state)
    sessionStorage.setItem('pkce_intent', 'migrate')

    const redirectUri = `${window.location.origin}/auth/callback`
    const params = new URLSearchParams({
      client_id: SSO_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid profile email',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    })
    window.location.href = `${SSO_ISSUER}/oauth/authorize?${params}`
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
        <h1 className="text-2xl font-semibold mb-1">Sign in</h1>
        <p className="text-sm text-gray-400 mb-6">Welcome back</p>

        {ssoEnabled && (
          <>
            <button
              type="button"
              onClick={handleSsoLogin}
              className="w-full flex items-center justify-center gap-2 border border-gray-200 rounded-lg py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <SsoIcon />
              Continue with SSO
            </button>
            <div className="flex items-center gap-3 my-5">
              <div className="flex-1 h-px bg-gray-100" />
              <span className="text-xs text-gray-400">or</span>
              <div className="flex-1 h-px bg-gray-100" />
            </div>
          </>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus={!ssoEnabled}
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

      {showMigrationModal && (
        <SsoMigrationModal
          onMigrate={handleMigrate}
          onSkip={() => navigate('/tasks')}
        />
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