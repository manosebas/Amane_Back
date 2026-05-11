import { Router } from 'express'
import { supabase } from '../../lib/supabase.js'
import { requireAuth } from '../../middlewares/auth.js'
import { requireAdmin } from '../../middlewares/requireAdmin.js'

const router = Router()
router.use(requireAuth, requireAdmin)

const SELECT_COMPLETO = '*, categoria:categorias_actividad(id, nombre)'

router.get('/', async (_req, res) => {
  const { data, error } = await supabase
    .from('actividades')
    .select(SELECT_COMPLETO)
    .order('nombre')

  if (error) return res.status(500).json({ error: error.message })
  res.json({ actividades: data })
})

router.post('/', async (req, res) => {
  const { nombre, descripcion, categoria_id } = req.body

  if (!nombre || !nombre.trim() || !categoria_id) {
    return res.status(400).json({ error: 'Nombre y categoría son requeridos.' })
  }

  const { data: categoria } = await supabase
    .from('categorias_actividad')
    .select('id')
    .eq('id', categoria_id)
    .maybeSingle()

  if (!categoria) {
    return res.status(400).json({ error: 'La categoría no es válida.' })
  }

  const { data, error } = await supabase
    .from('actividades')
    .insert({
      nombre: nombre.trim(),
      descripcion: descripcion?.trim() || null,
      categoria_id,
    })
    .select(SELECT_COMPLETO)
    .single()

  if (error) return res.status(400).json({ error: error.message })
  res.json({ actividad: data })
})

router.put('/:id', async (req, res) => {
  const { id } = req.params
  const { nombre, descripcion, categoria_id } = req.body

  const updates = {}
  if (nombre !== undefined) updates.nombre = nombre.trim()
  if (descripcion !== undefined) updates.descripcion = descripcion?.trim() || null
  if (categoria_id !== undefined) updates.categoria_id = categoria_id

  const { data, error } = await supabase
    .from('actividades')
    .update(updates)
    .eq('id', id)
    .select(SELECT_COMPLETO)
    .single()

  if (error) return res.status(400).json({ error: error.message })
  res.json({ actividad: data })
})

router.delete('/:id', async (req, res) => {
  const { id } = req.params
  const { error } = await supabase.from('actividades').delete().eq('id', id)
  if (error) return res.status(400).json({ error: error.message })
  res.json({ ok: true })
})

export default router
