import express from 'express'
import cors from 'cors'
import path from 'path'
import { authRouter } from './routes/auth'
import { tasksRouter } from './routes/tasks'
import { profileRouter } from './routes/profile'

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')))

app.use('/api/auth', authRouter)
app.use('/api/tasks', tasksRouter)
app.use('/api/profile', profileRouter)

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
