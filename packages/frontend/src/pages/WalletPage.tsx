import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'

interface WalletInfo {
  address: string
  privyWalletId: string
  balance: string | null
  status?: 'created' | 'exists'
}

interface Balances {
  eth: string | null
  usdt: string | null
  san: string | null
  note?: string
}

export function WalletPage() {
  const [wallet, setWallet] = useState<WalletInfo | null>(null)
  const [walletLoading, setWalletLoading] = useState(true)
  const [walletError, setWalletError] = useState('')

  const fetchWallet = useCallback(async () => {
    try {
      const { data } = await api.get<WalletInfo>('/api/wallet')
      setWallet(data)
      setWalletError('')
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { error?: string } } }
      if (e.response?.status !== 404) {
        setWalletError(e.response?.data?.error ?? 'Failed to load wallet')
      }
    } finally {
      setWalletLoading(false)
    }
  }, [])

  useEffect(() => { fetchWallet() }, [fetchWallet])

  async function createWallet() {
    setWalletLoading(true)
    setWalletError('')
    try {
      const { data } = await api.post<WalletInfo>('/api/wallet')
      setWallet(data)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error
      setWalletError(msg || 'Failed to create wallet')
    } finally {
      setWalletLoading(false)
    }
  }

  if (walletLoading) {
    return <div className="text-center py-20 text-gray-300 text-sm">Loading...</div>
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold">Wallet</h1>

      <WalletCard
        wallet={wallet}
        error={walletError}
        onCreate={createWallet}
      />

      {wallet && (
        <>
          <BalancesCard address={wallet.address} />
          <SignMessageCard walletId={wallet.privyWalletId} />
          <SendCard />
          <StakeDepositCard />
        </>
      )}
    </div>
  )
}

function WalletCard({
  wallet,
  error,
  onCreate,
}: {
  wallet: WalletInfo | null
  error: string
  onCreate: () => void
}) {
  function copyAddress() {
    if (wallet?.address) navigator.clipboard.writeText(wallet.address)
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-6">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Embedded Wallet</h2>
      {wallet ? (
        <div className="space-y-3">
          <div>
            <p className="text-xs text-gray-400 mb-1">Address</p>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-100 flex-1 truncate">
                {wallet.address}
              </span>
              <button
                onClick={copyAddress}
                className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1.5 rounded hover:bg-blue-50 transition-colors shrink-0"
              >
                Copy
              </button>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">ETH Balance</p>
            <p className="font-mono text-sm">
              {wallet.balance !== null ? `${Number(wallet.balance).toFixed(6)} ETH` : 'N/A (ETH_RPC_URL not set)'}
            </p>
          </div>
        </div>
      ) : (
        <div className="text-center py-6">
          <p className="text-sm text-gray-400 mb-4">No embedded wallet yet. Create one to get started.</p>
          <button
            onClick={onCreate}
            className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            Create Wallet
          </button>
        </div>
      )}
      {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
    </div>
  )
}

function BalancesCard({ address }: { address: string }) {
  const [balances, setBalances] = useState<Balances | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function fetchBalances() {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get<Balances>('/api/wallet/balances')
      setBalances(data)
    } catch {
      setError('Failed to fetch balances')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchBalances() }, [address])

  const tokens = [
    { label: 'ETH', value: balances?.eth, symbol: 'ETH' },
    { label: 'USDT', value: balances?.usdt, symbol: 'USDT' },
    { label: 'SAN', value: balances?.san, symbol: 'SAN' },
  ]

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Token Balances</h2>
        <button
          onClick={fetchBalances}
          disabled={loading}
          className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-40 transition-colors"
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
      {balances?.note && (
        <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg mb-4">{balances.note}</p>
      )}
      <div className="grid grid-cols-3 gap-3">
        {tokens.map(({ label, value, symbol }) => (
          <div key={label} className="bg-gray-50 rounded-xl p-4 text-center">
            <p className="text-xs text-gray-400 mb-1">{label}</p>
            <p className="font-mono text-sm font-medium">
              {value !== null && value !== undefined
                ? `${Number(value).toLocaleString('en', { maximumFractionDigits: 4 })} ${symbol}`
                : '—'}
            </p>
          </div>
        ))}
      </div>
      {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
    </div>
  )
}

function SignMessageCard({ walletId }: { walletId: string }) {
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
      const { data } = await api.post<{ signature: string }>('/api/wallet/sign', { message })
      setSignature(data.signature)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error
      setError(msg || 'Failed to sign message')
    } finally {
      setLoading(false)
    }
  }

  void walletId

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-6">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Sign Message</h2>
      <form onSubmit={handleSign} className="space-y-3">
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="Enter a message to sign..."
          rows={3}
          required
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
        />
        <button
          type="submit"
          disabled={loading || !message}
          className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
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

type SendMode = 'eth' | 'usdt' | 'san'

const SEND_LABELS: Record<SendMode, string> = {
  eth: 'ETH',
  usdt: 'USDT',
  san: 'SAN',
}

function SendCard() {
  const [mode, setMode] = useState<SendMode>('eth')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [chain, setChain] = useState('1')
  const [txHash, setTxHash] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setTxHash('')
    setLoading(true)
    const caip2 = `eip155:${chain}`
    try {
      let data: { transactionHash: string; caip2: string }
      if (mode === 'eth') {
        const res = await api.post('/api/wallet/send', { to, value: amount, caip2 })
        data = res.data
      } else {
        const res = await api.post('/api/wallet/send/token', {
          token: mode.toUpperCase(),
          to,
          amount,
          caip2,
        })
        data = res.data
      }
      setTxHash(data.transactionHash)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error
      setError(msg || 'Transaction failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-6">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Send Tokens</h2>
      <div className="flex gap-1 mb-5 bg-gray-50 p-1 rounded-lg w-fit">
        {(['eth', 'usdt', 'san'] as SendMode[]).map(m => (
          <button
            key={m}
            onClick={() => { setMode(m); setTxHash(''); setError('') }}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              mode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {SEND_LABELS[m]}
          </button>
        ))}
      </div>

      <form onSubmit={handleSend} className="space-y-3">
        <div>
          <label className="block text-sm font-medium mb-1.5">Recipient Address</label>
          <input
            value={to}
            onChange={e => setTo(e.target.value)}
            placeholder="0x..."
            pattern="^0x[a-fA-F0-9]{40}$"
            required
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1.5">Amount ({SEND_LABELS[mode]})</label>
            <input
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.001"
              pattern="^\d+(\.\d+)?$"
              required
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Chain ID</label>
            <select
              value={chain}
              onChange={e => setChain(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="1">Ethereum Mainnet (1)</option>
              <option value="11155111">Sepolia Testnet (11155111)</option>
              <option value="137">Polygon (137)</option>
              <option value="8453">Base (8453)</option>
            </select>
          </div>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Sending...' : `Send ${SEND_LABELS[mode]}`}
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

const ARENA_STAKING_ADDRESS = '0xE20eD42dfb2957614b524B368FF74464a091C062'

function StakeDepositCard() {
  const [provider, setProvider] = useState('')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ approveTxHash: string; depositTxHash: string } | null>(null)

  async function handleDeposit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setResult(null)
    setLoading(true)
    try {
      const { data } = await api.post<{ approveTxHash: string; depositTxHash: string }>(
        '/api/wallet/stake/deposit',
        { provider, amount },
      )
      setResult(data)
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } }
      setError(e.response?.data?.error ?? 'Deposit failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-6">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-1">Arena Staking — Deposit SAN</h2>
      <p className="text-xs text-gray-400 mb-4">
        Contract: <span className="font-mono">{ARENA_STAKING_ADDRESS.slice(0, 10)}…{ARENA_STAKING_ADDRESS.slice(-8)}</span>
        {' · '}Two transactions: approve + deposit
      </p>
      <form onSubmit={handleDeposit} className="space-y-3">
        <div>
          <label className="block text-sm font-medium mb-1.5">Provider Address</label>
          <input
            value={provider}
            onChange={e => setProvider(e.target.value)}
            placeholder="0x..."
            pattern="^0x[a-fA-F0-9]{40}$"
            required
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">Amount (SAN)</label>
          <input
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="100"
            pattern="^\d+(\.\d+)?$"
            required
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Depositing...' : 'Approve & Deposit'}
        </button>
      </form>

      {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
      {result && (
        <div className="mt-4 space-y-2">
          {[
            { label: 'Approve Tx', hash: result.approveTxHash },
            { label: 'Deposit Tx', hash: result.depositTxHash },
          ].map(({ label, hash }) => (
            <div key={label}>
              <p className="text-xs text-gray-400 mb-1">{label}</p>
              <div className="bg-green-50 border border-green-100 rounded-lg px-3 py-2 font-mono text-xs break-all text-green-800 flex items-center justify-between gap-2">
                <span className="truncate">{hash}</span>
                <button
                  onClick={() => navigator.clipboard.writeText(hash)}
                  className="text-blue-600 hover:underline shrink-0"
                >
                  Copy
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
