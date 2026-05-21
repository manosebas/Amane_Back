import { Router } from 'express'
import { supabase } from '../../lib/supabase.js'
import { requireAuth } from '../../middlewares/auth.js'
import { requireAdmin } from '../../middlewares/requireAdmin.js'

const router = Router()
router.use(requireAuth, requireAdmin)

// Tarjetas numéricas del panel de inicio.
router.get('/stats', async (_req, res) => {
  const [clubes, actividades, semanasActivas, ninos, inscripciones] = await Promise.all([
    supabase.from('clubes').select('id', { count: 'exact', head: true }),
    supabase.from('actividades').select('id', { count: 'exact', head: true }),
    supabase.from('semanas').select('id', { count: 'exact', head: true }).eq('estado', 'activa'),
    supabase.from('ninos').select('id', { count: 'exact', head: true }),
    supabase.from('inscripciones').select('id', { count: 'exact', head: true }),
  ])
  res.json({
    clubes: clubes.count ?? 0,
    actividades: actividades.count ?? 0,
    semanas_activas: semanasActivas.count ?? 0,
    ninos: ninos.count ?? 0,
    inscripciones: inscripciones.count ?? 0,
  })
})

// Ocupación por actividad (con sus grupos) para una semana específica.
// Devuelve [{ actividad, grupos: [{grupo, cupo, inscritos, disponibles}], total }]
router.get('/ocupacion', async (req, res) => {
  const semanaId = req.query.semana_id
  if (!semanaId) return res.status(400).json({ error: 'semana_id es requerido.' })

  const { data: clases, error } = await supabase
    .from('clases')
    .select(`
      id,
      actividad:actividades(id, nombre, categoria:categorias_actividad(id, nombre)),
      grupos:clase_grupos(id, cupo, grupo:grupos(id, nombre))
    `)
    .eq('semana_id', semanaId)

  if (error) return res.status(500).json({ error: error.message })

  const cgIds = []
  for (const c of clases ?? []) {
    for (const g of c.grupos ?? []) cgIds.push(g.id)
  }

  const ocupacion = new Map()
  if (cgIds.length > 0) {
    const { data: inscritos } = await supabase
      .from('inscripciones')
      .select('clase_grupo_id')
      .in('clase_grupo_id', cgIds)
    for (const i of inscritos ?? []) {
      ocupacion.set(i.clase_grupo_id, (ocupacion.get(i.clase_grupo_id) ?? 0) + 1)
    }
  }

  const actividades = (clases ?? []).map(c => {
    const grupos = (c.grupos ?? [])
      .map(g => {
        const ins = ocupacion.get(g.id) ?? 0
        return {
          clase_grupo_id: g.id,
          grupo: g.grupo,
          cupo: g.cupo,
          inscritos: ins,
          disponibles: Math.max(0, g.cupo - ins),
        }
      })
      .sort((a, b) =>
        (a.grupo?.nombre ?? '').localeCompare(b.grupo?.nombre ?? '', 'es', { sensitivity: 'base' })
      )
    const totalCupo = grupos.reduce((a, g) => a + g.cupo, 0)
    const totalIns = grupos.reduce((a, g) => a + g.inscritos, 0)
    return {
      clase_id: c.id,
      actividad: c.actividad,
      grupos,
      total: { cupo: totalCupo, inscritos: totalIns, disponibles: Math.max(0, totalCupo - totalIns) },
    }
  })
  actividades.sort((a, b) => {
    const catA = a.actividad?.categoria?.nombre ?? ''
    const catB = b.actividad?.categoria?.nombre ?? ''
    if (catA !== catB) return catA.localeCompare(catB, 'es', { sensitivity: 'base' })
    return (a.actividad?.nombre ?? '').localeCompare(b.actividad?.nombre ?? '', 'es', { sensitivity: 'base' })
  })

  res.json({ actividades })
})

export default router
