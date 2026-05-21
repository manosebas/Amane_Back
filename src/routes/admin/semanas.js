import { Router } from 'express'
import { supabase } from '../../lib/supabase.js'
import { requireAuth } from '../../middlewares/auth.js'
import { requireAdmin } from '../../middlewares/requireAdmin.js'

const router = Router()
router.use(requireAuth, requireAdmin)

const ESTADOS = ['borrador', 'activa']

router.get('/', async (req, res) => {
  let query = supabase
    .from('semanas')
    .select('*')
    .order('fecha_inicio', { ascending: true })
  if (req.query.club_id) query = query.eq('club_id', req.query.club_id)
  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  res.json({ semanas: data })
})

router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('semanas')
    .select('*, club:clubes(id, nombre)')
    .eq('id', req.params.id)
    .maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  if (!data) return res.status(404).json({ error: 'Semana no encontrada.' })
  res.json({ semana: data })
})

function validar({ club_id, fecha_inicio, fecha_fin, estado }) {
  if (!club_id) return 'El club es requerido.'
  if (!fecha_inicio || !fecha_fin) return 'Fechas requeridas.'
  if (fecha_fin < fecha_inicio) return 'La fecha fin debe ser ≥ la fecha inicio.'
  if (estado && !ESTADOS.includes(estado)) return 'Estado inválido.'
  return null
}

router.post('/', async (req, res) => {
  const error = validar(req.body)
  if (error) return res.status(400).json({ error })

  const { club_id, nombre, fecha_inicio, fecha_fin, estado } = req.body
  const { data, error: errDb } = await supabase
    .from('semanas')
    .insert({
      club_id,
      nombre: nombre?.trim() || null,
      fecha_inicio,
      fecha_fin,
      estado: estado ?? 'borrador',
    })
    .select()
    .single()

  if (errDb) return res.status(400).json({ error: errDb.message })
  res.json({ semana: data })
})

router.patch('/:id', async (req, res) => {
  const { id } = req.params
  const { nombre, fecha_inicio, fecha_fin, estado } = req.body

  const updates = {}
  if (nombre !== undefined) updates.nombre = nombre?.trim() || null
  if (fecha_inicio !== undefined) updates.fecha_inicio = fecha_inicio
  if (fecha_fin !== undefined) updates.fecha_fin = fecha_fin
  if (estado !== undefined) {
    if (!ESTADOS.includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido.' })
    }
    updates.estado = estado
  }

  if (updates.fecha_inicio && updates.fecha_fin && updates.fecha_fin < updates.fecha_inicio) {
    return res.status(400).json({ error: 'La fecha fin debe ser ≥ la fecha inicio.' })
  }

  let warning = null

  // Al activar: validar que el club tenga mínimos configurados y avisar si
  // la semana no tiene suficientes clases por categoría para cumplirlos.
  if (updates.estado === 'activa') {
    const { data: semana } = await supabase
      .from('semanas')
      .select('id, club_id')
      .eq('id', id)
      .maybeSingle()

    if (!semana) return res.status(404).json({ error: 'Semana no encontrada.' })

    const { data: minimos } = await supabase
      .from('club_minimos_categoria')
      .select('categoria_id, cantidad, categoria:categorias_actividad(nombre)')
      .eq('club_id', semana.club_id)
      .gt('cantidad', 0)

    if (!minimos || minimos.length === 0) {
      return res.status(400).json({
        error: 'No puedes activar esta semana: el club no tiene configuradas actividades obligatorias semanales por niño. Edita el club y completa la sección "Actividades obligatorias semanales por niño".',
      })
    }

    const { data: clases } = await supabase
      .from('clases')
      .select('actividad:actividades(categoria_id)')
      .eq('semana_id', id)

    const porCategoria = new Map()
    for (const c of clases ?? []) {
      const cid = c.actividad?.categoria_id
      if (!cid) continue
      porCategoria.set(cid, (porCategoria.get(cid) ?? 0) + 1)
    }

    const faltantes = minimos
      .filter(m => (porCategoria.get(m.categoria_id) ?? 0) < m.cantidad)
      .map(m => `${m.categoria?.nombre ?? 'Categoría'} (hay ${porCategoria.get(m.categoria_id) ?? 0}, se requieren ${m.cantidad})`)

    if (faltantes.length > 0) {
      warning = `Faltan clases para cumplir los mínimos: ${faltantes.join('; ')}. Los padres no podrán completar su inscripción.`
    }
  }

  const { data, error } = await supabase
    .from('semanas')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return res.status(400).json({ error: error.message })
  res.json({ semana: data, warning })
})

router.delete('/:id', async (req, res) => {
  const { id } = req.params

  // No permitir borrar semanas con inscripciones
  const { count } = await supabase
    .from('inscripciones')
    .select('id, clase_grupo:clase_grupos!inner(clase:clases!inner(semana_id))', {
      count: 'exact',
      head: true,
    })
    .eq('clase_grupo.clase.semana_id', id)

  if ((count ?? 0) > 0) {
    return res.status(400).json({
      error: `No se puede eliminar: hay ${count} inscripción(es). Cancela las inscripciones o elimina las clases primero.`,
    })
  }

  const { error } = await supabase.from('semanas').delete().eq('id', id)
  if (error) return res.status(400).json({ error: error.message })
  res.json({ ok: true })
})

// Clonar: crea una nueva semana copiando las clases y sus cupos
// (sin inscripciones).
router.post('/:id/clonar', async (req, res) => {
  const { id } = req.params
  const { fecha_inicio, fecha_fin, nombre } = req.body

  if (!fecha_inicio || !fecha_fin) {
    return res.status(400).json({ error: 'Fechas de la nueva semana requeridas.' })
  }

  const { data: origen, error: errOrigen } = await supabase
    .from('semanas')
    .select('club_id')
    .eq('id', id)
    .maybeSingle()

  if (errOrigen || !origen) return res.status(404).json({ error: 'Semana origen no encontrada.' })

  const { data: nueva, error: errNueva } = await supabase
    .from('semanas')
    .insert({
      club_id: origen.club_id,
      nombre: nombre?.trim() || null,
      fecha_inicio,
      fecha_fin,
      estado: 'borrador',
    })
    .select()
    .single()

  if (errNueva) return res.status(400).json({ error: errNueva.message })

  const { data: clasesOrigen } = await supabase
    .from('clases')
    .select('id, actividad_id, cupos:clase_grupos(grupo_id, cupo)')
    .eq('semana_id', id)

  for (const clase of clasesOrigen ?? []) {
    const { data: nuevaClase } = await supabase
      .from('clases')
      .insert({ semana_id: nueva.id, actividad_id: clase.actividad_id })
      .select('id')
      .single()
    if (!nuevaClase) continue

    const filas = (clase.cupos ?? []).map(cg => ({
      clase_id: nuevaClase.id,
      grupo_id: cg.grupo_id,
      cupo: cg.cupo,
    }))
    if (filas.length > 0) {
      await supabase.from('clase_grupos').insert(filas)
    }
  }

  res.json({ semana: nueva })
})

export default router
