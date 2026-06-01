import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { api } from '../api/client'

export interface User {
  id: string
  email: string
  name?: string | null
}

interface AuthContextValue {
  user: User | null
  login: (token: string, user: User) => void
  logout: () => void
  updateUser: (user: User) => void
  loading: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) {
      setLoading(false)
      return
    }
    api.get('/api/auth/me')
      .then(res => setUser(res.data))
      .catch(() => localStorage.removeItem('token'))
      .finally(() => setLoading(false))
  }, [])

  function login(token: string, newUser: User) {
    localStorage.setItem('token', token)
    setUser(newUser)
  }

  function logout() {
    localStorage.removeItem('token')
    setUser(null)
  }

  function updateUser(newUser: User) {
    setUser(newUser)
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, updateUser, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
