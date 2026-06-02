import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'

export function SsoCallbackPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
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
    sessionStorage.removeItem('oauth_state')
    sessionStorage.removeItem('pkce_verifier')

    if (state !== savedState) {
      setError('State mismatch — possible CSRF. Please try again.')
      return
    }

    if (!verifier) {
      setError('PKCE verifier missing. Please try again.')
      return
    }

    const redirectUri = `${window.location.origin}/auth/callback`

    api.post('/api/auth/sso/exchange', { code, codeVerifier: verifier, redirectUri })
      .then(({ data }) => {
        login(data.token, data.user)
        navigate('/tasks', { replace: true })
      })
      .catch(err => {
        const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error
        setError(msg || 'SSO login failed')
      })
  }, [login, navigate])

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

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-sm text-gray-400">Completing sign in...</div>
    </div>
  )
}
