import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

export function WalletPage() {
  const { user } = useAuth()
  const [externalAccount, setExternalAccount] = useState<string | null>(null)

  const requiredAddress = user?.walletAddress ?? null
  const isCorrectWallet = !externalAccount || !requiredAddress || externalAccount.toLowerCase() === requiredAddress.toLowerCase()

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold">Wallet</h1>

      <ExternalWalletCard account={externalAccount} onConnect={setExternalAccount} />

      {externalAccount && isCorrectWallet && (
        <>
          <ExternalSignCard account={externalAccount} />
          <ExternalSendCard account={externalAccount} />
        </>
      )}
    </div>
  )
}

// --- External Wallet (MetaMask / EIP-1193) ---

function parseEther(amount: string): bigint {
  const [int, frac = ''] = amount.split('.')
  const fracPadded = (frac + '0'.repeat(18)).slice(0, 18)
  return BigInt(int || '0') * BigInt('1000000000000000000') + BigInt(fracPadded || '0')
}

function ExternalWalletCard({
  account,
  onConnect,
}: {
  account: string | null
  onConnect: (account: string | null) => void
}) {
  const { user } = useAuth()
  const [connecting, setConnecting] = useState(false)
  const [balance, setBalance] = useState<string | null>(null)
  const [error, setError] = useState('')

  const requiredAddress = user?.walletAddress ?? null
  const isWrongWallet = !!(account && requiredAddress && account.toLowerCase() !== requiredAddress.toLowerCase())

  async function fetchBalance(address: string) {
    if (!window.ethereum) return
    try {
      const hex = await window.ethereum.request<string>({
        method: 'eth_getBalance',
        params: [address, 'latest'],
      })
      const wei = BigInt(hex as string)
      setBalance((Number(wei) / 1e18).toFixed(6))
    } catch {
      setBalance(null)
    }
  }

  async function connectWallet() {
    if (!window.ethereum) {
      setError('No Web3 wallet detected. Install MetaMask or another browser extension.')
      return
    }
    setConnecting(true)
    setError('')
    try {
      const accounts = await window.ethereum.request<string[]>({ method: 'eth_requestAccounts' })
      const address = (accounts as string[])[0]
      onConnect(address)
      await fetchBalance(address)
    } catch (err: unknown) {
      const e = err as { code?: number; message?: string }
      setError(e.code === 4001 ? 'Connection rejected' : (e.message || 'Failed to connect'))
    } finally {
      setConnecting(false)
    }
  }

  function disconnect() {
    onConnect(null)
    setBalance(null)
    setError('')
  }

  return (
    <div className={`bg-white border rounded-2xl p-6 ${isWrongWallet ? 'border-red-200' : 'border-gray-100'}`}>
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">External Wallet (MetaMask / EIP-1193)</h2>

      {/* Wrong wallet stub */}
      {isWrongWallet && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-5 text-center">
          <p className="text-sm font-medium text-red-700 mb-2">Wrong wallet connected</p>
          <p className="text-xs text-red-500 mb-1">Connected:</p>
          <p className="font-mono text-xs text-red-600 bg-red-100 rounded-lg px-3 py-1.5 mb-4 break-all">{account}</p>
          <p className="text-xs text-gray-500 mb-1">Please connect:</p>
          <p className="font-mono text-xs text-gray-700 bg-gray-100 rounded-lg px-3 py-1.5 mb-4 break-all">{requiredAddress}</p>
          <button
            onClick={disconnect}
            className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-600 transition-colors"
          >
            Disconnect and try again
          </button>
        </div>
      )}

      {/* Not connected */}
      {!account && (
        <div className="text-center py-4">
          {requiredAddress && (
            <div className="mb-4">
              <p className="text-xs text-gray-400 mb-1">Required address</p>
              <p className="font-mono text-xs text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-3 py-1.5 break-all">{requiredAddress}</p>
            </div>
          )}
          {!requiredAddress && (
            <p className="text-sm text-gray-400 mb-4">Connect MetaMask or any EIP-1193 browser wallet.</p>
          )}
          <button
            onClick={connectWallet}
            disabled={connecting}
            className="bg-orange-500 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-orange-600 disabled:opacity-50 transition-colors"
          >
            {connecting ? 'Connecting...' : 'Connect Wallet'}
          </button>
          {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
        </div>
      )}

      {/* Connected and correct */}
      {account && !isWrongWallet && (
        <div className="space-y-3">
          <div>
            <p className="text-xs text-gray-400 mb-1">Address</p>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-100 flex-1 truncate">
                {account}
              </span>
              <button
                onClick={() => navigator.clipboard.writeText(account)}
                className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1.5 rounded hover:bg-blue-50 transition-colors shrink-0"
              >
                Copy
              </button>
              <button
                onClick={disconnect}
                className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5 rounded hover:bg-gray-50 transition-colors shrink-0"
              >
                Disconnect
              </button>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">ETH Balance</p>
            <p className="font-mono text-sm">{balance !== null ? `${balance} ETH` : '—'}</p>
          </div>
        </div>
      )}
    </div>
  )
}

function ExternalSignCard({ account }: { account: string }) {
  const [message, setMessage] = useState('')
  const [signature, setSignature] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSign(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSignature('')
    setLoading(true)
    try {
      if (!window.ethereum) throw new Error('No wallet connected')
      const sig = await window.ethereum.request<string>({
        method: 'personal_sign',
        params: [message, account],
      })
      setSignature(sig as string)
    } catch (err: unknown) {
      const e = err as { code?: number; message?: string }
      setError(e.code === 4001 ? 'Signing rejected' : (e.message || 'Failed to sign'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-6">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Sign Message (External Wallet)</h2>
      <form onSubmit={handleSign} className="space-y-3">
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="Enter a message to sign..."
          rows={3}
          required
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent resize-none"
        />
        <button
          type="submit"
          disabled={loading || !message}
          className="bg-orange-500 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-orange-600 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Signing...' : 'Sign Message'}
        </button>
      </form>
      {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
      {signature && (
        <div className="mt-4">
          <p className="text-xs text-gray-400 mb-1.5">Signature (EIP-191)</p>
          <div className="bg-gray-50 border border-gray-100 rounded-lg px-3 py-2.5 font-mono text-xs break-all text-gray-700">
            {signature}
          </div>
          <button
            onClick={() => navigator.clipboard.writeText(signature)}
            className="text-xs text-blue-600 hover:underline mt-1.5"
          >
            Copy signature
          </button>
        </div>
      )}
    </div>
  )
}

function ExternalSendCard({ account }: { account: string }) {
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [txHash, setTxHash] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setTxHash('')
    setLoading(true)
    try {
      if (!window.ethereum) throw new Error('No wallet connected')
      const valueHex = '0x' + parseEther(amount).toString(16)
      const hash = await window.ethereum.request<string>({
        method: 'eth_sendTransaction',
        params: [{ from: account, to, value: valueHex }],
      })
      setTxHash(hash as string)
    } catch (err: unknown) {
      const e = err as { code?: number; message?: string }
      setError(e.code === 4001 ? 'Transaction rejected' : (e.message || 'Transaction failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-6">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Send ETH (External Wallet)</h2>
      <form onSubmit={handleSend} className="space-y-3">
        <div>
          <label className="block text-sm font-medium mb-1.5">Recipient Address</label>
          <input
            value={to}
            onChange={e => setTo(e.target.value)}
            placeholder="0x..."
            pattern="^0x[a-fA-F0-9]{40}$"
            required
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">Amount (ETH)</label>
          <input
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0.001"
            pattern="^\d+(\.\d+)?$"
            required
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="bg-orange-500 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-orange-600 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Sending...' : 'Send ETH'}
        </button>
      </form>
      {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
      {txHash && (
        <div className="mt-4">
          <p className="text-xs text-gray-400 mb-1.5">Transaction Hash</p>
          <div className="bg-green-50 border border-green-100 rounded-lg px-3 py-2.5 font-mono text-xs break-all text-green-800">
            {txHash}
          </div>
          <button
            onClick={() => navigator.clipboard.writeText(txHash)}
            className="text-xs text-blue-600 hover:underline mt-1.5"
          >
            Copy hash
          </button>
        </div>
      )}
    </div>
  )
}