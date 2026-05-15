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

// Semana activa del club del padre (si existe alguna)
router.get('/semana-activa', async (req, res) => {
  const padre = await getPadre(req)
  if (!padre) return res.status(404).json({ error: 'Perfil no encontrado.' })

  const { data } = await supabase
    .from('semanas')
    .select('*')
    .eq('club_id', padre.club_id)
    .eq('estado', 'activa')
    .order('fecha_inicio', { ascending: false })
    .limit(1)
    .maybeSingle()

  res.json({ semana: data })
})

// Slots disponibles para un niño en la semana activa, con conteo de inscritos
router.get('/slots-disponibles/:ninoId', async (req, res) => {
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

  const { data: semana } = await supabase
    .from('semanas')
    .select('id')
    .eq('club_id', padre.club_id)
    .eq('estado', 'activa')
    .order('fecha_inicio', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!semana) return res.json({ semana_id: null, slots: [] })

  const { data: slots } = await supabase
    .from('slots')
    .select(`
      id, dia, hora_inicio, hora_fin, cupo, grupo_id,
      actividad:actividades(id, nombre),
      personal:personal(id, nombre, apellido)
    `)
    .eq('semana_id', semana.id)
    .eq('grupo_id', nino.grupo_id)
    .order('dia')
    .order('hora_inicio')

  const slotIds = (slots ?? []).map(s => s.id)

  const [{ data: counts }, { data: misInscripciones }] = await Promise.all([
    slotIds.length > 0
      ? supabase.from('inscripciones').select('slot_id').in('slot_id', slotIds)
      : Promise.resolve({ data: [] }),
    supabase.from('inscripciones')
      .select('id, slot_id')
      .eq('nino_id', nino.id),
  ])

  const ocupados = new Map()
  for (const r of counts ?? []) {
    ocupados.set(r.slot_id, (ocupados.get(r.slot_id) ?? 0) + 1)
  }
  const inscritos = new Map((misInscripciones ?? []).map(i => [i.slot_id, i.id]))

  const enriquecidos = (slots ?? []).map(s => ({
    ...s,
    inscritos: ocupados.get(s.id) ?? 0,
    inscripcion_id: inscritos.get(s.id) ?? null,
  }))

  res.json({ semana_id: semana.id, slots: enriquecidos })
})

router.post('/', async (req, res) => {
  const { nino_id, slot_id } = req.body
  if (!nino_id || !slot_id) {
    return res.status(400).json({ error: 'nino_id y slot_id son requeridos.' })
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
    p_slot_id: slot_id,
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
