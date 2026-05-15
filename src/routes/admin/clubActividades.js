import { Router } from 'express'
import { supabase } from '../../lib/supabase.js'
import { requireAuth } from '../../middlewares/auth.js'
import { requireAdmin } from '../../middlewares/requireAdmin.js'

const router = Router()
router.use(requireAuth, requireAdmin)

// Devuelve las actividades ofrecidas por un club concreto
router.get('/:clubId', async (req, res) => {
  const { clubId } = req.params
  const { data, error } = await supabase
    .from('club_actividades')
    .select('actividad_id')
    .eq('club_id', clubId)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ actividad_ids: (data ?? []).map(r => r.actividad_id) })
})

// Reemplaza el set de actividades del club por la lista enviada
router.put('/:clubId', async (req, res) => {
  const { clubId } = req.params
  const { actividad_ids } = req.body

  if (!Array.isArray(actividad_ids)) {
    return res.status(400).json({ error: 'actividad_ids debe ser un arreglo.' })
  }

  const { data: club } = await supabase
    .from('clubes')
    .select('id')
    .eq('id', clubId)
    .maybeSingle()

  if (!club) return res.status(404).json({ error: 'Club no encontrado.' })

  await supabase.from('club_actividades').delete().eq('club_id', clubId)

  if (actividad_ids.length > 0) {
    const filas = actividad_ids.map(actividad_id => ({ club_id: clubId, actividad_id }))
    const { error } = await supabase.from('club_actividades').insert(filas)
    if (error) return res.status(400).json({ error: error.message })
  }

  res.json({ ok: true })
})

export default router
