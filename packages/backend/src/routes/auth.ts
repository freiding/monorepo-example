import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'

export const authRouter = Router()

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().optional(),
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
  const { email, password, name } = result.data
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    res.status(400).json({ error: 'Email already in use' })
    return
  }
  const hashed = await bcrypt.hash(password, 10)
  const user = await prisma.user.create({ data: { email, password: hashed, name } })
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '7d' })
  res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name } })
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
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } })
})

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { id: true, email: true, name: true, createdAt: true },
  })
  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }
  res.json(user)
})

const ssoExchangeSchema = z.object({
  code: z.string(),
  codeVerifier: z.string(),
  redirectUri: z.string().url(),
})

authRouter.post('/sso/exchange', async (req, res) => {
  const ssoIssuer = process.env.SSO_ISSUER
  const clientId = process.env.SSO_CLIENT_ID
  const clientSecret = process.env.SSO_CLIENT_SECRET

  if (!ssoIssuer || !clientId || !clientSecret) {
    res.status(501).json({ error: 'SSO is not configured on this server' })
    return
  }

  const result = ssoExchangeSchema.safeParse(req.body)
  if (!result.success) {
    res.status(400).json({ error: result.error.errors[0].message })
    return
  }
  const { code, codeVerifier, redirectUri } = result.data

  let tokenData: { access_token: string }
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
      res.status(400).json({ error: 'SSO token exchange failed', detail: body })
      return
    }
    tokenData = await tokenRes.json() as { access_token: string }
  } catch {
    res.status(502).json({ error: 'Could not reach SSO server' })
    return
  }

  let userinfo: { sub: string; email: string; name?: string }
  try {
    const userinfoRes = await fetch(`${ssoIssuer}/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    if (!userinfoRes.ok) {
      res.status(400).json({ error: 'Failed to get user info from SSO' })
      return
    }
    userinfo = await userinfoRes.json() as { sub: string; email: string; name?: string }
  } catch {
    res.status(502).json({ error: 'Could not reach SSO server' })
    return
  }

  if (!userinfo.email) {
    res.status(400).json({ error: 'SSO did not return an email address' })
    return
  }

  let user = await prisma.user.findUnique({ where: { email: userinfo.email } })
  if (!user) {
    user = await prisma.user.create({
      data: { email: userinfo.email, name: userinfo.name ?? null, password: null },
    })
  }

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '7d' })
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } })
})
