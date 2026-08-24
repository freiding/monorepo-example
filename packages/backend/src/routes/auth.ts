import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { verifyMessage } from 'ethers'
import { createRemoteJWKSet, jwtVerify } from 'jose'
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
  res.status(201).json({ token, user: { id: user.id, email: user.email, username: user.username, avatar: user.avatar } })
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
  res.json({ token, user: { id: user.id, email: user.email, username: user.username, avatar: user.avatar } })
})

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { id: true, email: true, walletAddress: true, username: true, avatar: true, createdAt: true },
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
  picture?: string // avatar URL (OIDC `picture` claim; requires the `profile` scope)
  wallet_address?: string // wallet address bound to the SSO account (requires the `wallet` scope)
}

async function exchangeCodeForUserinfo(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<{ userinfo: SsoUserinfo } | { error: string; status: number }> {
  const ssoIssuer = process.env.SSO_ISSUER
  const clientId = process.env.SSO_CLIENT_ID
  const clientSecret = process.env.SSO_CLIENT_SECRET

  if (!ssoIssuer || !clientId || !clientSecret) {
    return { error: 'SSO is not configured on this server', status: 501 }
  }

  let accessToken: string
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
    const data = await tokenRes.json() as { access_token: string }
    accessToken = data.access_token
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
    return { userinfo }
  } catch {
    return { error: 'Could not reach SSO server', status: 502 }
  }
}

function resolveSsoUsername(raw: string | null): string | null {
  if (!raw) return null
  const sanitized = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32)
  return sanitized.length >= 2 ? sanitized : null
}

// Create/link a local user from SSO claims. Shared by the code-exchange flow
// (/sso/exchange) and the FedCM flow (/sso/fedcm) so both stay in sync.
async function syncSsoUser(userinfo: SsoUserinfo) {
  const ssoUsername = resolveSsoUsername(userinfo.username ?? null)
  const ssoWalletAddress = userinfo.wallet_address?.toLowerCase() ?? null
  const ssoAvatar = userinfo.picture ?? null

  // Look up by ssoId first, then by email, then by walletAddress. Each of these
  // is unique, so an existing account holding any of them must be linked instead
  // of creating a new row (otherwise the unique constraint fails, e.g. P2002 on
  // walletAddress).
  let user = await prisma.user.findUnique({ where: { ssoId: userinfo.sub } })
  if (!user && userinfo.email) {
    user = await prisma.user.findUnique({ where: { email: userinfo.email } })
  }
  if (!user && ssoWalletAddress) {
    user = await prisma.user.findUnique({ where: { walletAddress: ssoWalletAddress } })
  }

  if (!user) {
    const usernameAvailable = ssoUsername
      ? !(await prisma.user.findUnique({ where: { username: ssoUsername } }))
      : false
    // walletAddress is unique; guard against a value already taken by another
    // account (the lookup above only linked it when it belonged to *this* user).
    const walletAvailable = ssoWalletAddress
      ? !(await prisma.user.findUnique({ where: { walletAddress: ssoWalletAddress } }))
      : false
    user = await prisma.user.create({
      data: {
        email: userinfo.email ?? null,
        walletAddress: walletAvailable ? ssoWalletAddress : null,
        ssoId: userinfo.sub,
        password: null,
        username: usernameAvailable ? ssoUsername : null,
        avatar: ssoAvatar,
      },
    })
  } else {
    const updates: Record<string, string | null> = {}
    if (!user.ssoId) updates.ssoId = userinfo.sub
    if (!user.email && userinfo.email) updates.email = userinfo.email
    if (!user.walletAddress && ssoWalletAddress) {
      const walletAvailable = !(await prisma.user.findUnique({ where: { walletAddress: ssoWalletAddress } }))
      if (walletAvailable) updates.walletAddress = ssoWalletAddress
    }
    if (!user.username && ssoUsername) {
      const usernameAvailable = !(await prisma.user.findUnique({ where: { username: ssoUsername } }))
      if (usernameAvailable) updates.username = ssoUsername
    }
    if (!user.avatar && ssoAvatar) updates.avatar = ssoAvatar
    user = await prisma.user.update({ where: { id: user.id }, data: updates })
  }
  return user
}

// FedCM hands the browser a signed OIDC id_token directly (no code, no PKCE, no
// client_secret). We verify that token against the SSO server's published JWKS
// instead of doing a server-to-server code exchange. The key set is fetched lazily
// and cached (jose refreshes it on unknown `kid`).
let ssoJwks: ReturnType<typeof createRemoteJWKSet> | null = null
function getSsoJwks() {
  if (!ssoJwks) {
    ssoJwks = createRemoteJWKSet(new URL(`${process.env.SSO_ISSUER}/.well-known/jwks.json`))
  }
  return ssoJwks
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
  const { userinfo } = outcome
  const user = await syncSsoUser(userinfo)

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '7d' })
  res.json({ token, user: { id: user.id, email: user.email, walletAddress: user.walletAddress, username: user.username, avatar: user.avatar } })
})

// --- FedCM silent auth ---

const fedcmSchema = z.object({
  token: z.string(),
  nonce: z.string(),
})

// Silent / passive login via FedCM. Instead of an OAuth redirect, the browser's
// FedCM API gives the SPA a signed id_token (navigator.credentials.get) which it
// POSTs here. We verify the token's signature and claims, then run the same
// user-sync as /sso/exchange and issue our own app JWT.
authRouter.post('/sso/fedcm', async (req, res) => {
  const result = fedcmSchema.safeParse(req.body)
  if (!result.success) {
    res.status(400).json({ error: result.error.errors[0].message })
    return
  }
  const { token: idToken, nonce } = result.data

  const issuer = process.env.SSO_ISSUER
  const clientId = process.env.SSO_CLIENT_ID
  if (!issuer || !clientId) {
    res.status(501).json({ error: 'SSO is not configured on this server' })
    return
  }

  // Verify RS256 signature against the IdP's JWKS, and that iss/aud/exp are valid.
  let payload: Record<string, unknown>
  try {
    const verified = await jwtVerify(idToken, getSsoJwks(), {
      issuer,
      audience: clientId,
    })
    payload = verified.payload
  } catch {
    res.status(401).json({ error: 'Invalid FedCM identity token' })
    return
  }

  // Bind the token to the nonce this client generated for the get() call —
  // prevents replay of a token minted for a different request/RP.
  if (payload.nonce !== nonce) {
    res.status(401).json({ error: 'Nonce mismatch' })
    return
  }
  if (typeof payload.sub !== 'string') {
    res.status(401).json({ error: 'Token has no subject' })
    return
  }

  // Diagnostic: which claims the FedCM id_token actually carries. If preferred_username
  // is absent here, the SSO account has no username yet (or the client isn't granted the
  // `profile` scope), which is why the client would fall back to the profile-setup form.
  console.log('[SSO fedcm claims]', JSON.stringify(payload))

  const userinfo: SsoUserinfo = {
    sub: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    username: typeof payload.preferred_username === 'string' ? payload.preferred_username : undefined,
    picture: typeof payload.picture === 'string' ? payload.picture : undefined,
    wallet_address: typeof payload.wallet_address === 'string' ? payload.wallet_address : undefined,
  }

  const user = await syncSsoUser(userinfo)
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '7d' })
  res.json({ token, user: { id: user.id, email: user.email, walletAddress: user.walletAddress, username: user.username, avatar: user.avatar } })
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
    user = await prisma.user.create({ data: { walletAddress: key } })
  }

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '7d' })
  res.json({ token, user: { id: user.id, email: user.email, walletAddress: user.walletAddress, username: user.username, avatar: user.avatar } })
})
