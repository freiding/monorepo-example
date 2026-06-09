import { Router } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import path from 'path'
import multer from 'multer'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'

export const profileRouter = Router()
profileRouter.use(requireAuth)

const storage = multer.diskStorage({
  destination: path.join(process.cwd(), 'uploads/avatars'),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname)
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
  },
})
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('Only image files are allowed'))
  },
})

const updateProfileSchema = z.object({
  username: z.string().min(2).max(32).optional(),
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
  const { username, email, currentPassword, newPassword } = result.data
  const user = await prisma.user.findUnique({ where: { id: req.userId } })
  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  const data: Record<string, string | null> = {}
  if (username !== undefined) {
    const taken = await prisma.user.findFirst({ where: { username, NOT: { id: req.userId } } })
    if (taken) {
      res.status(400).json({ error: 'Username already taken' })
      return
    }
    data.username = username
  }
  if (email && email !== user.email) {
    const taken = await prisma.user.findUnique({ where: { email } })
    if (taken) {
      res.status(400).json({ error: 'Email already in use' })
      return
    }
    data.email = email
  }
  if (newPassword) {
    if (user.password) {
      if (!currentPassword) {
        res.status(400).json({ error: 'Current password required' })
        return
      }
      const valid = await bcrypt.compare(currentPassword, user.password)
      if (!valid) {
        res.status(400).json({ error: 'Current password is incorrect' })
        return
      }
    }
    data.password = await bcrypt.hash(newPassword, 10)
  }

  const updated = await prisma.user.update({
    where: { id: req.userId },
    data,
    select: { id: true, email: true, username: true, avatar: true },
  })
  res.json(updated)
})

profileRouter.post('/avatar', upload.single('avatar'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' })
    return
  }
  const avatarUrl = `/uploads/avatars/${req.file.filename}`
  const updated = await prisma.user.update({
    where: { id: req.userId },
    data: { avatar: avatarUrl },
    select: { id: true, email: true, username: true, avatar: true },
  })
  res.json(updated)
})