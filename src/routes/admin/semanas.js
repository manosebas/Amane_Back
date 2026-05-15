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
    .order('fecha_inicio', { ascending: false })
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

  const { data, error } = await supabase
    .from('semanas')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return res.status(400).json({ error: error.message })
  res.json({ semana: data })
})

router.delete('/:id', async (req, res) => {
  const { id } = req.params

  // No permitir borrar semanas activas con inscripciones
  const { count } = await supabase
    .from('inscripciones')
    .select('id, slot:slots!inner(semana_id)', { count: 'exact', head: true })
    .eq('slot.semana_id', id)

  if ((count ?? 0) > 0) {
    return res.status(400).json({
      error: `No se puede eliminar: hay ${count} inscripción(es). Eliminar slots o cancelar inscripciones primero.`,
    })
  }

  const { error } = await supabase.from('semanas').delete().eq('id', id)
  if (error) return res.status(400).json({ error: error.message })
  res.json({ ok: true })
})

// Clonar: crea una nueva semana copiando los slots (sin inscripciones)
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

  const { data: slotsOrigen } = await supabase
    .from('slots')
    .select('grupo_id, actividad_id, dia, hora_inicio, hora_fin, cupo, personal_id')
    .eq('semana_id', id)

  if (slotsOrigen && slotsOrigen.length > 0) {
    const filas = slotsOrigen.map(s => ({ ...s, semana_id: nueva.id }))
    await supabase.from('slots').insert(filas)
  }

  res.json({ semana: nueva })
})

export default router
