import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  function handleLogout() {
    logout()
    navigate('/login')
  }

  const linkClass = (path: string) =>
    `text-sm font-medium transition-colors ${
      location.pathname === path ? 'text-gray-900' : 'text-gray-500 hover:text-gray-900'
    }`

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <span className="font-semibold text-gray-900">TaskApp</span>
            <Link to="/tasks" className={linkClass('/tasks')}>Tasks</Link>
            <Link to="/profile" className={linkClass('/profile')}>Profile</Link>
          </div>
          <div className="flex items-center gap-4">
            {user?.avatar && (
              <img
                src={`http://localhost:3000${user.avatar}`}
                alt="Avatar"
                className="w-7 h-7 rounded-full object-cover"
              />
            )}
            <span className="text-sm text-gray-400">{user?.username || user?.email}</span>
            <button
              onClick={handleLogout}
              className="text-sm text-red-400 hover:text-red-600 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </nav>
      <main className="max-w-3xl mx-auto px-4 py-8">{children}</main>
    </div>
  )
}
