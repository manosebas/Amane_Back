import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import routes from './routes/index.js'
import authRoutes from './routes/auth.js'

const app = express()
const PORT = process.env.PORT || 3000

const corsOptions = {
  origin: process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',') : '*',
  optionsSuccessStatus: 200,
}

app.use(cors(corsOptions))
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api', routes)
app.use('/api/auth', authRoutes)

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`)
})
