import { Router } from 'express'
import { parseUnits, Interface } from 'ethers'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'

export const walletRouter = Router()
walletRouter.use(requireAuth)

const ERC20_TRANSFER_ABI = ['function transfer(address to, uint256 amount) returns (bool)']
const ERC20_IFACE = new Interface(ERC20_TRANSFER_ABI)

const TOKENS = {
  USDT: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
  USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
} as const

async function ssoFetch(userId: string, path: string, init: RequestInit = {}): Promise<Response> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { ssoAccessToken: true } })
  if (!user?.ssoAccessToken) {
    throw Object.assign(new Error('No SSO access token — please log in via SSO'), { status: 401 })
  }
  const ssoIssuer = process.env.SSO_ISSUER
  if (!ssoIssuer) throw Object.assign(new Error('SSO_ISSUER is not configured'), { status: 501 })

  return fetch(`${ssoIssuer}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${user.ssoAccessToken}`,
    },
  })
}

async function proxyToSso(userId: string, path: string, init: RequestInit = {}) {
  const resp = await ssoFetch(userId, path, init)
  const body = await resp.json().catch(() => ({ error: 'SSO returned non-JSON response' }))
  return { status: resp.status, body }
}

// POST /api/wallet — get or create wallet
walletRouter.post('/', async (req, res) => {
  try {
    const { status, body } = await proxyToSso(req.userId!, '/privy/wallet', { method: 'POST' })
    res.status(status).json(body)
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string }
    res.status(e.status ?? 502).json({ error: e.message ?? 'Failed to reach SSO' })
  }
})

// GET /api/wallet — wallet info + ETH balance
walletRouter.get('/', async (req, res) => {
  try {
    const { status, body } = await proxyToSso(req.userId!, '/privy/wallet')
    res.status(status).json(body)
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string }
    res.status(e.status ?? 502).json({ error: e.message ?? 'Failed to reach SSO' })
  }
})

// GET /api/wallet/balances — ETH + ERC-20 balances
walletRouter.get('/balances', async (req, res) => {
  try {
    const { status, body } = await proxyToSso(req.userId!, '/privy/wallet/balances')
    res.status(status).json(body)
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string }
    res.status(e.status ?? 502).json({ error: e.message ?? 'Failed to reach SSO' })
  }
})

// POST /api/wallet/sign — sign message (EIP-191)
const signSchema = z.object({ message: z.string().min(1).max(10000) })

walletRouter.post('/sign', async (req, res) => {
  const parsed = signSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return }

  try {
    const { status, body } = await proxyToSso(req.userId!, '/privy/wallet/sign', {
      method: 'POST',
      body: JSON.stringify({ message: parsed.data.message }),
    })
    res.status(status).json(body)
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string }
    res.status(e.status ?? 502).json({ error: e.message ?? 'Failed to reach SSO' })
  }
})

// POST /api/wallet/send — send ETH
const sendEthSchema = z.object({
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
  value: z.string().regex(/^\d+(\.\d+)?$/, 'Invalid amount'),
  caip2: z.string().regex(/^eip155:\d+$/).optional(),
})

walletRouter.post('/send', async (req, res) => {
  const parsed = sendEthSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return }

  try {
    const { status, body } = await proxyToSso(req.userId!, '/privy/wallet/send', {
      method: 'POST',
      body: JSON.stringify(parsed.data),
    })
    res.status(status).json(body)
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string }
    res.status(e.status ?? 502).json({ error: e.message ?? 'Failed to reach SSO' })
  }
})

// POST /api/wallet/send/token — send ERC-20 token (USDT or USDC)
// Encodes the transfer calldata here and calls the generic SSO send endpoint.
const sendTokenSchema = z.object({
  token: z.enum(['USDT', 'USDC']),
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
  amount: z.string().regex(/^\d+(\.\d+)?$/, 'Invalid amount'),
  caip2: z.string().regex(/^eip155:\d+$/).optional(),
})

walletRouter.post('/send/token', async (req, res) => {
  const parsed = sendTokenSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return }

  const { token, to, amount, caip2 = 'eip155:1' } = parsed.data
  const tokenInfo = TOKENS[token]
  const data = ERC20_IFACE.encodeFunctionData('transfer', [to, parseUnits(amount, tokenInfo.decimals)])

  try {
    const { status, body } = await proxyToSso(req.userId!, '/privy/wallet/send', {
      method: 'POST',
      body: JSON.stringify({ to: tokenInfo.address, value: '0', data, caip2 }),
    })
    res.status(status).json(body)
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string }
    res.status(e.status ?? 502).json({ error: e.message ?? 'Failed to reach SSO' })
  }
})
