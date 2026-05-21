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
    .order('fecha_inicio', { ascending: true })

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

  // Clases de la semana con cupo para el grupo del niño, incluyendo
  // categoría de la actividad para agrupar en el frontend.
  const { data: clases } = await supabase
    .from('clases')
    .select(`
      id,
      actividad:actividades(id, nombre, categoria:categorias_actividad(id, nombre)),
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

  const [{ data: inscritosRaw }, { data: misInsc }, { data: minimos }] = await Promise.all([
    cgIds.length > 0
      ? supabase.from('inscripciones').select('clase_grupo_id').in('clase_grupo_id', cgIds)
      : Promise.resolve({ data: [] }),
    supabase.from('inscripciones')
      .select('id, clase_grupo_id')
      .eq('nino_id', nino.id),
    supabase.from('club_minimos_categoria')
      .select('categoria_id, cantidad, categoria:categorias_actividad(id, nombre)')
      .eq('club_id', padre.club_id)
      .gt('cantidad', 0),
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

  const minimosOut = (minimos ?? []).map(m => ({
    categoria_id: m.categoria_id,
    categoria_nombre: m.categoria?.nombre ?? '',
    cantidad: m.cantidad,
  }))

  res.json({ actividades, minimos: minimosOut })
})

// Resumen de inscripciones de un niño agrupadas por semana y categoría.
// Devuelve [{ semana, categorias: [{ id, nombre, actividades: [{nombre}] }] }]
// ordenado por fecha_inicio DESC.
router.get('/resumen/:ninoId', async (req, res) => {
  const { data: nino } = await supabase
    .from('ninos')
    .select('id, padre_id')
    .eq('id', req.params.ninoId)
    .maybeSingle()
  if (!nino || nino.padre_id !== req.user.id) {
    return res.status(404).json({ error: 'Niño no encontrado.' })
  }

  const { data, error } = await supabase
    .from('inscripciones')
    .select(`
      id,
      clase_grupo:clase_grupos(
        clase:clases(
          semana:semanas(id, nombre, fecha_inicio, fecha_fin, estado),
          actividad:actividades(id, nombre, categoria:categorias_actividad(id, nombre))
        )
      )
    `)
    .eq('nino_id', nino.id)

  if (error) return res.status(500).json({ error: error.message })

  const SIN_CAT = '__sin_categoria__'
  const semanasMap = new Map()
  for (const ins of data ?? []) {
    const clase = ins.clase_grupo?.clase
    const semana = clase?.semana
    const actividad = clase?.actividad
    if (!semana || !actividad) continue

    let entry = semanasMap.get(semana.id)
    if (!entry) {
      entry = { semana, categorias: new Map() }
      semanasMap.set(semana.id, entry)
    }

    const catId = actividad.categoria?.id ?? SIN_CAT
    const catNombre = actividad.categoria?.nombre ?? 'Sin categoría'
    let cat = entry.categorias.get(catId)
    if (!cat) {
      cat = { id: catId, nombre: catNombre, actividades: [] }
      entry.categorias.set(catId, cat)
    }
    cat.actividades.push({ id: actividad.id, nombre: actividad.nombre })
  }

  const semanas = Array.from(semanasMap.values())
    .map(e => ({
      semana: e.semana,
      categorias: Array.from(e.categorias.values())
        .map(c => ({
          ...c,
          actividades: c.actividades.sort((a, b) =>
            (a.nombre ?? '').localeCompare(b.nombre ?? '', 'es', { sensitivity: 'base' })
          ),
        }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })),
    }))
    .sort((a, b) => (a.semana.fecha_inicio ?? '').localeCompare(b.semana.fecha_inicio ?? ''))

  res.json({ semanas })
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

// Inscripción por lote (todo o nada): aplica el diff entre lo que el niño
// tiene inscrito en esa semana y lo deseado. Si algún cupo se llenó, no
// hace nada y devuelve los clase_grupo_ids llenos para que el frontend
// los muestre y el padre los reemplace.
router.post('/batch', async (req, res) => {
  const { nino_id, semana_id, clase_grupo_ids } = req.body
  if (!nino_id || !semana_id || !Array.isArray(clase_grupo_ids)) {
    return res.status(400).json({ error: 'nino_id, semana_id y clase_grupo_ids son requeridos.' })
  }

  const { data: nino } = await supabase
    .from('ninos')
    .select('padre_id')
    .eq('id', nino_id)
    .maybeSingle()
  if (!nino || nino.padre_id !== req.user.id) {
    return res.status(404).json({ error: 'Niño no encontrado.' })
  }

  const { data, error } = await supabase.rpc('inscribir_nino_batch', {
    p_nino_id: nino_id,
    p_semana_id: semana_id,
    p_clase_grupo_ids: clase_grupo_ids,
  })

  if (error) return res.status(500).json({ error: error.message })
  const resultado = Array.isArray(data) ? data[0] : data
  if (!resultado?.ok) {
    return res.status(409).json({
      error: resultado?.error ?? 'No se pudo inscribir.',
      llenas: resultado?.llenas ?? [],
    })
  }
  res.json({ ok: true })
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
