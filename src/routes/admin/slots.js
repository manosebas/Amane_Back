import { Router } from 'express'
import { supabase } from '../../lib/supabase.js'
import { requireAuth } from '../../middlewares/auth.js'
import { requireAdmin } from '../../middlewares/requireAdmin.js'

const router = Router()
router.use(requireAuth, requireAdmin)

const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']

const SELECT_COMPLETO = `
  *,
  grupo:grupos(id, nombre, edad_min, edad_max),
  actividad:actividades(id, nombre, categoria:categorias_actividad(id, nombre)),
  personal:personal(id, nombre, apellido, rol)
`

function validar({ semana_id, grupo_id, actividad_id, dia, hora_inicio, hora_fin, cupo }) {
  if (!semana_id) return 'La semana es requerida.'
  if (!grupo_id) return 'El grupo es requerido.'
  if (!actividad_id) return 'La actividad es requerida.'
  if (!DIAS.includes(dia)) return 'Día inválido.'
  if (!hora_inicio || !hora_fin) return 'Horas requeridas.'
  if (hora_fin <= hora_inicio) return 'La hora fin debe ser mayor que la inicio.'
  const c = Number(cupo)
  if (!Number.isInteger(c) || c <= 0) return 'Cupo debe ser un entero positivo.'
  return null
}

async function verificarCoherencia({ semana_id, grupo_id, actividad_id, personal_id }) {
  const { data: semana } = await supabase
    .from('semanas')
    .select('club_id')
    .eq('id', semana_id)
    .maybeSingle()
  if (!semana) return 'Semana no encontrada.'

  const clubId = semana.club_id

  const { data: grupoOk } = await supabase
    .from('club_grupos')
    .select('grupo_id')
    .eq('club_id', clubId)
    .eq('grupo_id', grupo_id)
    .maybeSingle()
  if (!grupoOk) return 'El grupo no está asignado a este club.'

  const { data: actOk } = await supabase
    .from('club_actividades')
    .select('actividad_id')
    .eq('club_id', clubId)
    .eq('actividad_id', actividad_id)
    .maybeSingle()
  if (!actOk) return 'La actividad no está ofrecida por este club.'

  if (personal_id) {
    const { data: per } = await supabase
      .from('personal')
      .select('club_id, rol')
      .eq('id', personal_id)
      .maybeSingle()
    if (!per || per.club_id !== clubId) return 'El personal no pertenece a este club.'
  }

  return null
}

router.get('/', async (req, res) => {
  if (!req.query.semana_id) {
    return res.status(400).json({ error: 'semana_id es requerido.' })
  }
  const { data, error } = await supabase
    .from('slots')
    .select(SELECT_COMPLETO)
    .eq('semana_id', req.query.semana_id)
    .order('dia')
    .order('hora_inicio')
  if (error) return res.status(500).json({ error: error.message })
  res.json({ slots: data })
})

router.post('/', async (req, res) => {
  const errV = validar(req.body)
  if (errV) return res.status(400).json({ error: errV })

  const errC = await verificarCoherencia(req.body)
  if (errC) return res.status(400).json({ error: errC })

  const { semana_id, grupo_id, actividad_id, dia, hora_inicio, hora_fin, cupo, personal_id } = req.body
  const { data, error } = await supabase
    .from('slots')
    .insert({
      semana_id,
      grupo_id,
      actividad_id,
      dia,
      hora_inicio,
      hora_fin,
      cupo: Number(cupo),
      personal_id: personal_id || null,
    })
    .select(SELECT_COMPLETO)
    .single()

  if (error) return res.status(400).json({ error: error.message })
  res.json({ slot: data })
})

router.patch('/:id', async (req, res) => {
  const { id } = req.params
  const { data: existente } = await supabase
    .from('slots')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (!existente) return res.status(404).json({ error: 'Slot no encontrado.' })

  const fusion = { ...existente, ...req.body }
  const errV = validar(fusion)
  if (errV) return res.status(400).json({ error: errV })

  const errC = await verificarCoherencia(fusion)
  if (errC) return res.status(400).json({ error: errC })

  // Verificar que el cupo no quede por debajo de las inscripciones existentes
  const { count } = await supabase
    .from('inscripciones')
    .select('id', { count: 'exact', head: true })
    .eq('slot_id', id)
  if ((count ?? 0) > Number(fusion.cupo)) {
    return res.status(400).json({
      error: `No puedes bajar el cupo: ya hay ${count} inscripción(es).`,
    })
  }

  const updates = { ...req.body }
  if (updates.cupo !== undefined) updates.cupo = Number(updates.cupo)
  if (updates.personal_id === '') updates.personal_id = null

  const { data, error } = await supabase
    .from('slots')
    .update(updates)
    .eq('id', id)
    .select(SELECT_COMPLETO)
    .single()

  if (error) return res.status(400).json({ error: error.message })
  res.json({ slot: data })
})

router.delete('/:id', async (req, res) => {
  const { id } = req.params

  const { count } = await supabase
    .from('inscripciones')
    .select('id', { count: 'exact', head: true })
    .eq('slot_id', id)
  if ((count ?? 0) > 0) {
    return res.status(400).json({
      error: `No se puede eliminar: ${count} niño(s) inscrito(s) en este slot.`,
    })
  }

  const { error } = await supabase.from('slots').delete().eq('id', id)
  if (error) return res.status(400).json({ error: error.message })
  res.json({ ok: true })
})

export default router
