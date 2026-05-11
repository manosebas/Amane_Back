import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import routes from './routes/index.js'
import authRoutes from './routes/auth.js'
import adminClubesRoutes from './routes/admin/clubes.js'
import adminCategoriasRoutes from './routes/admin/categorias.js'
import adminActividadesRoutes from './routes/admin/actividades.js'

const app = express()
const PORT = process.env.PORT || 3000

const corsOptions = {
  origin: process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',') : '*',
  optionsSuccessStatus: 200,
}

app.use(cors(corsOptions))
app.use(express.json({ limit: '2mb' }))

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api', routes)
app.use('/api/auth', authRoutes)
app.use('/api/admin/clubes', adminClubesRoutes)
app.use('/api/admin/categorias', adminCategoriasRoutes)
app.use('/api/admin/actividades', adminActividadesRoutes)

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`)
})
