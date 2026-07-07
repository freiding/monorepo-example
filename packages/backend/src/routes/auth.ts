import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { verifyMessage } from 'ethers'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'

export const authRouter = Router()

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

authRouter.post('/register', async (req, res) => {
  const result = registerSchema.safeParse(req.body)
  if (!result.success) {
    res.status(400).json({ error: result.error.errors[0].message })
    return
  }
  const { email, password } = result.data
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    res.status(400).json({ error: 'Email already in use' })
    return
  }
  const hashed = await bcrypt.hash(password, 10)
  const user = await prisma.user.create({ data: { email, password: hashed } })
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '7d' })
  res.status(201).json({ token, user: { id: user.id, email: user.email, walletAddress: user.walletAddress, walletType: user.walletType, username: user.username, avatar: user.avatar } })
})

authRouter.post('/login', async (req, res) => {
  const result = loginSchema.safeParse(req.body)
  if (!result.success) {
    res.status(400).json({ error: result.error.errors[0].message })
    return
  }
  const { email, password } = result.data
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    res.status(400).json({ error: 'Invalid credentials' })
    return
  }
  if (!user.password) {
    res.status(400).json({ error: 'This account uses SSO login' })
    return
  }
  if (!(await bcrypt.compare(password, user.password))) {
    res.status(400).json({ error: 'Invalid credentials' })
    return
  }
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '7d' })
  res.json({ token, user: { id: user.id, email: user.email, walletAddress: user.walletAddress, walletType: user.walletType, username: user.username, avatar: user.avatar } })
})

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { id: true, email: true, walletAddress: true, walletType: true, username: true, avatar: true, createdAt: true },
  })
  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }
  res.json(user)
})

authRouter.get('/sso/config', (_req, res) => {
  const issuer = process.env.SSO_ISSUER
  const clientId = process.env.SSO_CLIENT_ID
  const enabled = !!(issuer && clientId && process.env.SSO_CLIENT_SECRET)
  res.json(enabled ? { enabled: true, issuer, clientId } : { enabled: false })
})

// --- SSO helpers ---

interface SsoUserinfo {
  sub: string
  email?: string
  name?: string
  username?: string
  wallet_address?: string                // present when user has any wallet (privy or external)
  wallet_type?: 'privy' | 'external'    // present alongside wallet_address
}

async function exchangeCodeForUserinfo(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<{ userinfo: SsoUserinfo; accessToken: string; refreshToken: string | null } | { error: string; status: number }> {
  const ssoIssuer = process.env.SSO_ISSUER
  const clientId = process.env.SSO_CLIENT_ID
  const clientSecret = process.env.SSO_CLIENT_SECRET

  if (!ssoIssuer || !clientId || !clientSecret) {
    return { error: 'SSO is not configured on this server', status: 501 }
  }

  let accessToken: string
  let refreshToken: string | null
  try {
    const tokenRes = await fetch(`${ssoIssuer}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    })
    if (!tokenRes.ok) {
      const body = await tokenRes.text()
      return { error: `SSO token exchange failed: ${body}`, status: 400 }
    }
    const data = await tokenRes.json() as { access_token: string; refresh_token?: string }
    accessToken = data.access_token
    refreshToken = data.refresh_token ?? null
  } catch {
    return { error: 'Could not reach SSO server', status: 502 }
  }

  try {
    const userinfoRes = await fetch(`${ssoIssuer}/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!userinfoRes.ok) {
      return { error: 'Failed to get user info from SSO', status: 400 }
    }
    const userinfo = await userinfoRes.json() as SsoUserinfo
    console.log('[SSO userinfo]', JSON.stringify(userinfo))
    return { userinfo, accessToken, refreshToken }
  } catch {
    return { error: 'Could not reach SSO server', status: 502 }
  }
}

function resolveSsoUsername(raw: string | null): string | null {
  if (!raw) return null
  const sanitized = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32)
  return sanitized.length >= 2 ? sanitized : null
}

// --- SSO routes ---

const ssoSchema = z.object({
  code: z.string(),
  codeVerifier: z.string(),
  redirectUri: z.string().url(),
})

authRouter.post('/sso/exchange', async (req, res) => {
  const result = ssoSchema.safeParse(req.body)
  if (!result.success) {
    res.status(400).json({ error: result.error.errors[0].message })
    return
  }
  const { code, codeVerifier, redirectUri } = result.data

  const outcome = await exchangeCodeForUserinfo(code, codeVerifier, redirectUri)
  if ('error' in outcome) {
    res.status(outcome.status).json({ error: outcome.error })
    return
  }
  const { userinfo, accessToken: ssoAccessToken, refreshToken: ssoRefreshToken } = outcome

  // Look up by ssoId first, then by email only if email is present
  let user = await prisma.user.findUnique({ where: { ssoId: userinfo.sub } })
  if (!user && userinfo.email) {
    user = await prisma.user.findUnique({ where: { email: userinfo.email } })
  }

  const ssoUsername = resolveSsoUsername(userinfo.username ?? null)
  const ssoWalletAddress = userinfo.wallet_address?.toLowerCase() ?? null
  const ssoWalletType = userinfo.wallet_type ?? null

  if (!user) {
    const usernameAvailable = ssoUsername
      ? !(await prisma.user.findUnique({ where: { username: ssoUsername } }))
      : false
    user = await prisma.user.create({
      data: {
        email: userinfo.email ?? null,
        walletAddress: ssoWalletAddress,
        walletType: ssoWalletType,
        ssoId: userinfo.sub,
        password: null,
        username: usernameAvailable ? ssoUsername : null,
        ssoAccessToken,
        ssoRefreshToken,
      },
    })
  } else {
    const updates: Record<string, string | null> = { ssoAccessToken, ssoRefreshToken }
    if (!user.ssoId) updates.ssoId = userinfo.sub
    if (!user.email && userinfo.email) updates.email = userinfo.email
    if (!user.walletAddress && ssoWalletAddress) {
      updates.walletAddress = ssoWalletAddress
      updates.walletType = ssoWalletType
    } else if (user.walletAddress && ssoWalletType && user.walletType !== ssoWalletType) {
      // wallet migrated (e.g. privy → external after key export)
      updates.walletType = ssoWalletType
    }
    if (!user.username && ssoUsername) {
      const usernameAvailable = !(await prisma.user.findUnique({ where: { username: ssoUsername } }))
      if (usernameAvailable) updates.username = ssoUsername
    }
    user = await prisma.user.update({ where: { id: user.id }, data: updates })
  }

  const token = jwt.sign({ userId: user!.id }, process.env.JWT_SECRET!, { expiresIn: '7d' })
  res.json({ token, user: { id: user!.id, email: user!.email, walletAddress: user!.walletAddress, walletType: user!.walletType, username: user!.username, avatar: user!.avatar } })
})

authRouter.post('/sso/migrate', requireAuth, async (req, res) => {
  const result = ssoSchema.safeParse(req.body)
  if (!result.success) {
    res.status(400).json({ error: result.error.errors[0].message })
    return
  }
  const { code, codeVerifier, redirectUri } = result.data

  const outcome = await exchangeCodeForUserinfo(code, codeVerifier, redirectUri)
  if ('error' in outcome) {
    res.status(outcome.status).json({ error: outcome.error })
    return
  }

  const user = await prisma.user.findUnique({ where: { id: req.userId } })
  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { password: null, ssoId: outcome.userinfo.sub },
    select: { id: true, email: true, username: true, avatar: true },
  })

  res.json({ success: true, user: updated })
})

// --- Wallet authentication ---

const walletNonces = new Map<string, { message: string; expiresAt: number }>()

setInterval(() => {
  const now = Date.now()
  for (const [addr, data] of walletNonces) {
    if (data.expiresAt < now) walletNonces.delete(addr)
  }
}, 60_000)

const walletChallengeSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/i, 'Invalid Ethereum address'),
})

authRouter.post('/wallet/challenge', async (req, res) => {
  const result = walletChallengeSchema.safeParse(req.body)
  if (!result.success) {
    res.status(400).json({ error: result.error.errors[0].message })
    return
  }
  const address = result.data.address.toLowerCase()
  const nonce = crypto.randomUUID()
  const message = `Sign this message to authenticate.\n\nNonce: ${nonce}`
  walletNonces.set(address, { message, expiresAt: Date.now() + 5 * 60 * 1000 })
  res.json({ message })
})

const walletVerifySchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/i, 'Invalid Ethereum address'),
  signature: z.string(),
})

authRouter.post('/wallet/verify', async (req, res) => {
  const result = walletVerifySchema.safeParse(req.body)
  if (!result.success) {
    res.status(400).json({ error: result.error.errors[0].message })
    return
  }
  const { address, signature } = result.data
  const key = address.toLowerCase()
  const challenge = walletNonces.get(key)
  if (!challenge || challenge.expiresAt < Date.now()) {
    res.status(400).json({ error: 'Challenge expired or not found. Please try again.' })
    return
  }
  walletNonces.delete(key)

  let recovered: string
  try {
    recovered = verifyMessage(challenge.message, signature).toLowerCase()
  } catch {
    res.status(400).json({ error: 'Invalid signature' })
    return
  }

  if (recovered !== key) {
    res.status(401).json({ error: 'Signature does not match address' })
    return
  }

  let user = await prisma.user.findUnique({ where: { walletAddress: key } })
  if (!user) {
    user = await prisma.user.create({ data: { walletAddress: key, walletType: 'external' } })
  }

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '7d' })
  res.json({ token, user: { id: user.id, email: user.email, walletAddress: user.walletAddress, walletType: user.walletType, username: user.username, avatar: user.avatar } })
})
