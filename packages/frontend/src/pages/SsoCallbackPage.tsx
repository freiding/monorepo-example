import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'

type Intent = 'login' | 'migrate'

export function SsoCallbackPage() {
  const { login, updateUser } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [migrated, setMigrated] = useState(false)
  const called = useRef(false)

  useEffect(() => {
    if (called.current) return
    called.current = true

    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')
    const errorParam = params.get('error')
    const errorDescription = params.get('error_description')

    if (errorParam) {
      setError(errorDescription || errorParam)
      return
    }

    if (!code || !state) {
      setError('Invalid callback: missing code or state')
      return
    }

    const savedState = sessionStorage.getItem('oauth_state')
    const verifier = sessionStorage.getItem('pkce_verifier')
    const intent = (sessionStorage.getItem('pkce_intent') || 'login') as Intent
    sessionStorage.removeItem('oauth_state')
    sessionStorage.removeItem('pkce_verifier')
    sessionStorage.removeItem('pkce_intent')

    if (state !== savedState) {
      setError('State mismatch — possible CSRF. Please try again.')
      return
    }

    if (!verifier) {
      setError('PKCE verifier missing. Please try again.')
      return
    }

    const redirectUri = `${window.location.origin}/auth/callback`

    if (intent === 'migrate') {
      api.post('/api/auth/sso/migrate', { code, codeVerifier: verifier, redirectUri })
        .then(({ data }) => {
          // Токен уже лежит в localStorage (положен перед редиректом на SSO)
          const token = localStorage.getItem('token')!
          login(token, data.user)
          setMigrated(true)
          setTimeout(() => navigate('/tasks', { replace: true }), 2000)
        })
        .catch(err => {
          const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error
          setError(msg || 'Migration failed')
        })
    } else {
      api.post('/api/auth/sso/exchange', { code, codeVerifier: verifier, redirectUri })
        .then(({ data }) => {
          login(data.token, data.user)
          navigate('/tasks', { replace: true })
        })
        .catch(err => {
          const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error
          setError(msg || 'SSO login failed')
        })
    }
  }, [login, updateUser, navigate])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
          <p className="text-sm text-red-500 mb-4">{error}</p>
          <a href="/login" className="text-sm text-blue-600 hover:underline">
            Back to login
          </a>
        </div>
      </div>
    )
  }

  if (migrated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
          <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center mx-auto mb-4">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 className="text-base font-semibold mb-1">Migration successful</h2>
          <p className="text-sm text-gray-400">Your account is now linked to SSO. Redirecting...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-sm text-gray-400">Completing sign in...</div>
    </div>
  )
}
