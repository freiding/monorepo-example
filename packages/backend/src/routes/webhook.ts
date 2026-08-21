import { Router, raw } from 'express'
import crypto from 'crypto'
import { prisma } from '../lib/prisma'

// Receives real-time user-change events pushed by the SSO service and keeps the
// local copy of the user in sync. See santiment-sso-backend/docs/WEBHOOKS.md.
//
// Delivery is best-effort (no retries), so this is a sync-optimization, not a
// source of truth — userinfo remains authoritative.
export const webhookRouter = Router()

type WebhookEvent =
  | 'user.profile_updated'
  | 'user.wallet_linked'
  | 'user.wallet_unlinked'

interface WebhookPayload {
  event: WebhookEvent
  sub: string
  timestamp: number
  data: {
    username?: string | null
    avatarUrl?: string | null
    walletAddress?: string | null
  }
}

// Reject deliveries whose timestamp drifts more than this from our clock — limits
// replay of captured requests (WEBHOOKS.md → "Reject stale events").
const MAX_AGE_SECONDS = 5 * 60

function verifySignature(rawBody: Buffer, header: string, secret: string): boolean {
  const received = header.replace(/^sha256=/, '')
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(received, 'hex')
  // timingSafeEqual requires equal length; length mismatch → reject.
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// The webhook body MUST be verified against the exact raw bytes, so this route
// uses its own `raw` parser and must be mounted before the global express.json().
webhookRouter.post('/sso', raw({ type: 'application/json' }), async (req, res) => {
  const secret = process.env.SSO_WEBHOOK_SECRET
  if (!secret) {
    res.status(501).json({ error: 'Webhook receiver not configured' })
    return
  }

  const rawBody = req.body as unknown
  if (!Buffer.isBuffer(rawBody)) {
    res.status(400).json({ error: 'Expected raw body' })
    return
  }

  const signature = req.header('X-SSO-Signature') ?? ''
  if (!verifySignature(rawBody, signature, secret)) {
    res.status(401).json({ error: 'Invalid signature' })
    return
  }

  let payload: WebhookPayload
  try {
    payload = JSON.parse(rawBody.toString('utf8')) as WebhookPayload
  } catch {
    res.status(400).json({ error: 'Invalid JSON' })
    return
  }

  const now = Math.floor(Date.now() / 1000)
  if (typeof payload.timestamp !== 'number' || Math.abs(now - payload.timestamp) > MAX_AGE_SECONDS) {
    res.status(400).json({ error: 'Stale or invalid timestamp' })
    return
  }

  // Acknowledge immediately (SSO aborts after 5s), then process asynchronously.
  res.status(200).end()

  try {
    await handleEvent(payload)
  } catch (err) {
    console.error('[sso webhook] failed to apply event', payload.event, err)
  }
})

async function handleEvent(payload: WebhookPayload): Promise<void> {
  // `sub` is the OIDC subject — our local users store it as ssoId.
  const user = await prisma.user.findUnique({ where: { ssoId: payload.sub } })
  if (!user) return // event for a user we don't have locally — ignore

  const data: Record<string, string | null> = {}

  switch (payload.event) {
    case 'user.profile_updated': {
      // Avatar is intentionally not synced: this app serves avatars from its own
      // /uploads path, whereas SSO sends an absolute URL on its own domain.
      if (payload.data.username !== undefined) {
        const username = payload.data.username
        if (username) {
          const taken = await prisma.user.findFirst({
            where: { username, NOT: { id: user.id } },
          })
          if (!taken) data.username = username
        } else {
          data.username = null
        }
      }
      break
    }
    case 'user.wallet_linked': {
      const walletAddress = payload.data.walletAddress?.toLowerCase()
      if (walletAddress) {
        const taken = await prisma.user.findFirst({
          where: { walletAddress, NOT: { id: user.id } },
        })
        if (!taken) data.walletAddress = walletAddress
      }
      break
    }
    case 'user.wallet_unlinked': {
      data.walletAddress = null
      break
    }
  }

  if (Object.keys(data).length > 0) {
    await prisma.user.update({ where: { id: user.id }, data })
  }
}