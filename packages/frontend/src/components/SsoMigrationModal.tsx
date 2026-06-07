interface Props {
  onMigrate: () => void
  onSkip: () => void
}

export function SsoMigrationModal({ onMigrate, onSkip }: Props) {
  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center mb-4">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold mb-2">Migrate to SSO</h2>
        <p className="text-sm text-gray-500 mb-1">
          You're using email & password to sign in. You can migrate your account to SSO for a more
          secure and seamless experience.
        </p>
        <p className="text-sm text-gray-400 mb-6">
          After migration, your password will be removed and you'll sign in via SSO only.
        </p>
        <div className="space-y-2">
          <button
            onClick={onMigrate}
            className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            Migrate to SSO
          </button>
          <button
            onClick={onSkip}
            className="w-full text-gray-400 hover:text-gray-600 py-2 text-sm transition-colors"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}
