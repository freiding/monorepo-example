import express from 'express'
import cors from 'cors'
import path from 'path'
import { authRouter } from './routes/auth'
import { tasksRouter } from './routes/tasks'
import { profileRouter } from './routes/profile'
import { webhookRouter } from './routes/webhook'

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())

// Webhooks must be mounted BEFORE express.json() so the route can read the raw
// request body needed to verify the HMAC signature.
app.use('/api/webhooks', webhookRouter)

app.use(express.json())
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')))

app.use('/api/auth', authRouter)
app.use('/api/tasks', tasksRouter)
app.use('/api/profile', profileRouter)

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
