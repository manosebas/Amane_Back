import { Router } from 'express'
import { supabase } from '../lib/supabase.js'
import { requireAuth } from '../middlewares/auth.js'

const router = Router()
router.use(requireAuth)

async function getPadre(req) {
  const { data } = await supabase
    .from('perfiles')
    .select('id, club_id')
    .eq('id', req.user.id)
    .maybeSingle()
  return data
}

// Todas las semanas activas del club del padre, ordenadas por fecha
router.get('/semanas-activas', async (req, res) => {
  const padre = await getPadre(req)
  if (!padre) return res.status(404).json({ error: 'Perfil no encontrado.' })

  const { data } = await supabase
    .from('semanas')
    .select('*')
    .eq('club_id', padre.club_id)
    .eq('estado', 'activa')
    .order('fecha_inicio', { ascending: false })

  res.json({ semanas: data ?? [] })
})

// Actividades disponibles para un niño en una semana específica.
// Devuelve una lista plana de { clase_grupo_id, actividad, cupo, inscritos, inscripcion_id }
router.get('/actividades-disponibles/:ninoId', async (req, res) => {
  const padre = await getPadre(req)
  if (!padre) return res.status(404).json({ error: 'Perfil no encontrado.' })

  const { data: nino } = await supabase
    .from('ninos')
    .select('id, grupo_id, padre_id')
    .eq('id', req.params.ninoId)
    .maybeSingle()
  if (!nino || nino.padre_id !== req.user.id) {
    return res.status(404).json({ error: 'Niño no encontrado.' })
  }

  const semanaId = req.query.semana_id
  if (!semanaId) {
    return res.status(400).json({ error: 'semana_id es requerido.' })
  }

  const { data: semana } = await supabase
    .from('semanas')
    .select('id, club_id, estado')
    .eq('id', semanaId)
    .maybeSingle()
  if (!semana || semana.club_id !== padre.club_id || semana.estado !== 'activa') {
    return res.status(400).json({ error: 'Semana inválida.' })
  }

  if (!nino.grupo_id) return res.json({ actividades: [] })

  // Clases de la semana con cupo para el grupo del niño
  const { data: clases } = await supabase
    .from('clases')
    .select(`
      id,
      actividad:actividades(id, nombre),
      cupos:clase_grupos!inner(id, grupo_id, cupo)
    `)
    .eq('semana_id', semana.id)
    .eq('cupos.grupo_id', nino.grupo_id)
    .order('created_at')

  const items = []
  const cgIds = []
  for (const c of clases ?? []) {
    const cg = (c.cupos ?? [])[0]
    if (!cg) continue
    cgIds.push(cg.id)
    items.push({
      clase_id: c.id,
      clase_grupo_id: cg.id,
      actividad: c.actividad,
      cupo: cg.cupo,
    })
  }

  const [{ data: inscritosRaw }, { data: misInsc }] = await Promise.all([
    cgIds.length > 0
      ? supabase.from('inscripciones').select('clase_grupo_id').in('clase_grupo_id', cgIds)
      : Promise.resolve({ data: [] }),
    supabase.from('inscripciones')
      .select('id, clase_grupo_id')
      .eq('nino_id', nino.id),
  ])

  const ocupados = new Map()
  for (const r of inscritosRaw ?? []) {
    ocupados.set(r.clase_grupo_id, (ocupados.get(r.clase_grupo_id) ?? 0) + 1)
  }
  const mis = new Map((misInsc ?? []).map(i => [i.clase_grupo_id, i.id]))

  const actividades = items.map(it => ({
    ...it,
    inscritos: ocupados.get(it.clase_grupo_id) ?? 0,
    inscripcion_id: mis.get(it.clase_grupo_id) ?? null,
  }))

  res.json({ actividades })
})

router.post('/', async (req, res) => {
  const { nino_id, clase_grupo_id } = req.body
  if (!nino_id || !clase_grupo_id) {
    return res.status(400).json({ error: 'nino_id y clase_grupo_id son requeridos.' })
  }

  const { data: nino } = await supabase
    .from('ninos')
    .select('padre_id')
    .eq('id', nino_id)
    .maybeSingle()
  if (!nino || nino.padre_id !== req.user.id) {
    return res.status(404).json({ error: 'Niño no encontrado.' })
  }

  const { data, error } = await supabase.rpc('inscribir_nino', {
    p_nino_id: nino_id,
    p_clase_grupo_id: clase_grupo_id,
  })

  if (error) return res.status(500).json({ error: error.message })
  const resultado = Array.isArray(data) ? data[0] : data
  if (!resultado?.ok) {
    return res.status(400).json({ error: resultado?.error ?? 'No se pudo inscribir.' })
  }

  res.json({ inscripcion_id: resultado.inscripcion_id })
})

router.delete('/:id', async (req, res) => {
  const { id } = req.params

  const { data: insc } = await supabase
    .from('inscripciones')
    .select('id, nino:ninos(padre_id)')
    .eq('id', id)
    .maybeSingle()
  if (!insc || insc.nino?.padre_id !== req.user.id) {
    return res.status(404).json({ error: 'Inscripción no encontrada.' })
  }

  const { error } = await supabase.from('inscripciones').delete().eq('id', id)
  if (error) return res.status(400).json({ error: error.message })
  res.json({ ok: true })
})

export default router
