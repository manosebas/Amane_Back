import { Router } from 'express'
import { supabase } from '../../lib/supabase.js'
import { requireAuth } from '../../middlewares/auth.js'
import { requireAdmin } from '../../middlewares/requireAdmin.js'

const router = Router()
router.use(requireAuth, requireAdmin)

router.get('/', async (_req, res) => {
  const { data, error } = await supabase
    .from('categorias_actividad')
    .select('*')
    .order('nombre')

  if (error) return res.status(500).json({ error: error.message })
  res.json({ categorias: data })
})

router.post('/', async (req, res) => {
  const { nombre, descripcion } = req.body
  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: 'El nombre es requerido.' })
  }

  const { data, error } = await supabase
    .from('categorias_actividad')
    .insert({
      nombre: nombre.trim(),
      descripcion: descripcion?.trim() || null,
    })
    .select()
    .single()

  if (error) return res.status(400).json({ error: error.message })
  res.json({ categoria: data })
})

router.put('/:id', async (req, res) => {
  const { id } = req.params
  const { nombre, descripcion } = req.body

  const updates = {}
  if (nombre !== undefined) updates.nombre = nombre.trim()
  if (descripcion !== undefined) updates.descripcion = descripcion?.trim() || null

  const { data, error } = await supabase
    .from('categorias_actividad')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return res.status(400).json({ error: error.message })
  res.json({ categoria: data })
})

router.delete('/:id', async (req, res) => {
  const { id } = req.params

  const { count } = await supabase
    .from('actividades')
    .select('id', { count: 'exact', head: true })
    .eq('categoria_id', id)

  if ((count ?? 0) > 0) {
    return res.status(400).json({
      error: `No se puede eliminar: la categoría tiene ${count} actividad(es). Elimina o reasigna las actividades primero.`,
    })
  }

  const { error } = await supabase.from('categorias_actividad').delete().eq('id', id)
  if (error) return res.status(400).json({ error: error.message })

  res.json({ ok: true })
})

export default router
