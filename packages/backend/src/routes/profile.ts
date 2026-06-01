import { Router } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'

export const profileRouter = Router()
profileRouter.use(requireAuth)

const updateProfileSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(6).optional(),
})

profileRouter.put('/', async (req, res) => {
  const result = updateProfileSchema.safeParse(req.body)
  if (!result.success) {
    res.status(400).json({ error: result.error.errors[0].message })
    return
  }
  const { name, email, currentPassword, newPassword } = result.data
  const user = await prisma.user.findUnique({ where: { id: req.userId } })
  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  const data: Record<string, string> = {}
  if (name !== undefined) data.name = name
  if (email && email !== user.email) {
    const taken = await prisma.user.findUnique({ where: { email } })
    if (taken) {
      res.status(400).json({ error: 'Email already in use' })
      return
    }
    data.email = email
  }
  if (newPassword) {
    if (!currentPassword) {
      res.status(400).json({ error: 'Current password required' })
      return
    }
    const valid = await bcrypt.compare(currentPassword, user.password)
    if (!valid) {
      res.status(400).json({ error: 'Current password is incorrect' })
      return
    }
    data.password = await bcrypt.hash(newPassword, 10)
  }

  const updated = await prisma.user.update({
    where: { id: req.userId },
    data,
    select: { id: true, email: true, name: true },
  })
  res.json(updated)
})
