import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'

export const tasksRouter = Router()
tasksRouter.use(requireAuth)

const taskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE']).optional(),
})

tasksRouter.get('/', async (req, res) => {
  const tasks = await prisma.task.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: 'desc' },
  })
  res.json(tasks)
})

tasksRouter.post('/', async (req, res) => {
  const result = taskSchema.safeParse(req.body)
  if (!result.success) {
    res.status(400).json({ error: result.error.errors[0].message })
    return
  }
  const task = await prisma.task.create({ data: { ...result.data, userId: req.userId! } })
  res.status(201).json(task)
})

tasksRouter.put('/:id', async (req, res) => {
  const existing = await prisma.task.findFirst({ where: { id: req.params.id, userId: req.userId } })
  if (!existing) {
    res.status(404).json({ error: 'Task not found' })
    return
  }
  const result = taskSchema.partial().safeParse(req.body)
  if (!result.success) {
    res.status(400).json({ error: result.error.errors[0].message })
    return
  }
  const task = await prisma.task.update({ where: { id: req.params.id }, data: result.data })
  res.json(task)
})

tasksRouter.delete('/:id', async (req, res) => {
  const existing = await prisma.task.findFirst({ where: { id: req.params.id, userId: req.userId } })
  if (!existing) {
    res.status(404).json({ error: 'Task not found' })
    return
  }
  await prisma.task.delete({ where: { id: req.params.id } })
  res.status(204).send()
})
