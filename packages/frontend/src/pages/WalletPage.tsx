import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import {
  signMessageViaPopup,
  sendTransactionViaPopup,
  encodeERC20Transfer,
  encodeERC20Approve,
  parseUnits,
} from '../api/wallet-popup'

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
  const { user } = useAuth()
  const [wallet, setWallet] = useState<WalletInfo | null>(null)
  const [walletLoading, setWalletLoading] = useState(true)
  const [walletError, setWalletError] = useState('')

  const [externalAccount, setExternalAccount] = useState<string | null>(null)

  // Only enforce a specific address for external wallets — Privy embedded wallets
  // cannot be connected as MetaMask, so we don't require a particular address for them.
  const requiredAddress = user?.walletType === 'external' ? (user?.walletAddress ?? null) : null
  const isCorrectWallet = !externalAccount || !requiredAddress || externalAccount.toLowerCase() === requiredAddress.toLowerCase()

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

      {/* Privy embedded wallet */}
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

      {/* External wallet section */}
      <div className="flex items-center gap-3 pt-2">
        <div className="flex-1 h-px bg-gray-100" />
        <span className="text-xs text-gray-400 font-medium uppercase tracking-wide">External Wallet</span>
        <div className="flex-1 h-px bg-gray-100" />
      </div>

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
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Embedded Wallet (Privy)</h2>
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
  const { ssoConfig } = useAuth()
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
      const sig = await signMessageViaPopup(ssoConfig.issuer!, message)
      setSignature(sig)
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to sign message')
    } finally {
      setLoading(false)
    }
  }

  void walletId

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-6">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Sign Message (Privy)</h2>
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

const TOKENS = {
  USDT: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
  SAN: { address: '0x7c5a0ce9267ed19b22f8cae653f198e3e8daf098', decimals: 18 },
}

function SendCard() {
  const { ssoConfig } = useAuth()
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
    const chainId = Number(chain)
    try {
      let hash: string
      if (mode === 'eth') {
        const valueWei = parseUnits(amount, 18)
        hash = await sendTransactionViaPopup(ssoConfig.issuer!, {
          to,
          value: '0x' + valueWei.toString(16),
          chainId,
        })
      } else {
        const tokenInfo = TOKENS[mode.toUpperCase() as keyof typeof TOKENS]
        const amountWei = parseUnits(amount, tokenInfo.decimals)
        hash = await sendTransactionViaPopup(ssoConfig.issuer!, {
          to: tokenInfo.address,
          value: '0x0',
          data: encodeERC20Transfer(to, amountWei),
          chainId,
        })
      }
      setTxHash(hash)
    } catch (err: unknown) {
      setError((err as Error).message || 'Transaction failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-6">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Send Tokens (Privy)</h2>
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

interface StakeTxParams {
  to: string
  value: string
  data: string
  chainId: number
}

function StakeDepositCard() {
  const { ssoConfig } = useAuth()
  const [provider, setProvider] = useState('')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [stage, setStage] = useState<'idle' | 'approving' | 'waiting' | 'depositing'>('idle')
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ approveTxHash: string; depositTxHash: string } | null>(null)

  async function handleDeposit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setResult(null)
    setLoading(true)
    try {
      const { data: prepared } = await api.post<{ approveTx: StakeTxParams; depositTx: StakeTxParams }>(
        '/api/wallet/stake/prepare',
        { provider, amount },
      )

      setStage('approving')
      const approveTxHash = await sendTransactionViaPopup(ssoConfig.issuer!, prepared.approveTx)

      setStage('waiting')
      await api.get(`/api/wallet/receipt?tx=${approveTxHash}`, { timeout: 120_000 })

      setStage('depositing')
      const depositTxHash = await sendTransactionViaPopup(ssoConfig.issuer!, prepared.depositTx)

      setResult({ approveTxHash, depositTxHash })
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string }
      setError(e.response?.data?.error ?? e.message ?? 'Deposit failed')
    } finally {
      setLoading(false)
      setStage('idle')
    }
  }

  const stageLabel: Record<typeof stage, string> = {
    idle: 'Approve & Deposit',
    approving: 'Sending approve…',
    waiting: 'Waiting for approve confirmation…',
    depositing: 'Sending deposit…',
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-6">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-1">Arena Staking — Deposit SAN (Privy)</h2>
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
          {stageLabel[stage]}
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

  const requiredAddress = user?.walletType === 'external' ? (user?.walletAddress ?? null) : null
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
