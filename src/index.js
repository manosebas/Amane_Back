import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import routes from './routes/index.js'
import authRoutes from './routes/auth.js'
import adminClubesRoutes from './routes/admin/clubes.js'
import adminCategoriasRoutes from './routes/admin/categorias.js'
import adminActividadesRoutes from './routes/admin/actividades.js'
import adminGruposRoutes from './routes/admin/grupos.js'
import adminPersonalRoutes from './routes/admin/personal.js'
import adminClubActividadesRoutes from './routes/admin/clubActividades.js'
import adminSemanasRoutes from './routes/admin/semanas.js'
import adminClasesRoutes from './routes/admin/clases.js'
import adminDashboardRoutes from './routes/admin/dashboard.js'
import adminHorarioRoutes from './routes/admin/horario.js'
import ninosRoutes from './routes/ninos.js'
import inscripcionesRoutes from './routes/inscripciones.js'

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
app.use('/api/admin/grupos', adminGruposRoutes)
app.use('/api/admin/personal', adminPersonalRoutes)
app.use('/api/admin/club-actividades', adminClubActividadesRoutes)
app.use('/api/admin/semanas', adminSemanasRoutes)
app.use('/api/admin/clases', adminClasesRoutes)
app.use('/api/admin/dashboard', adminDashboardRoutes)
app.use('/api/admin/horario', adminHorarioRoutes)
app.use('/api/ninos', ninosRoutes)
app.use('/api/inscripciones', inscripcionesRoutes)

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`)
})
