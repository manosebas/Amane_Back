import { Router } from 'express'
import { supabase } from '../../lib/supabase.js'
import { requireAuth } from '../../middlewares/auth.js'
import { requireAdmin } from '../../middlewares/requireAdmin.js'

const router = Router()
router.use(requireAuth, requireAdmin)

router.get('/', async (_req, res) => {
  const { data, error } = await supabase
    .from('grupos')
    .select('*')
    .order('edad_min')

  if (error) return res.status(500).json({ error: error.message })
  res.json({ grupos: data })
})

function validar({ nombre, edad_min, edad_max }) {
  if (!nombre || !nombre.trim()) return 'El nombre del grupo es requerido.'
  const min = Number(edad_min)
  const max = Number(edad_max)
  if (!Number.isInteger(min) || min < 0) return 'Edad mínima inválida.'
  if (!Number.isInteger(max) || max < min) return 'Edad máxima debe ser ≥ mínima.'
  return null
}

router.post('/', async (req, res) => {
  const error = validar(req.body)
  if (error) return res.status(400).json({ error })

  const { nombre, edad_min, edad_max } = req.body
  const { data, error: errDb } = await supabase
    .from('grupos')
    .insert({
      nombre: nombre.trim(),
      edad_min: Number(edad_min),
      edad_max: Number(edad_max),
    })
    .select()
    .single()

  if (errDb) return res.status(400).json({ error: errDb.message })
  res.json({ grupo: data })
})

router.put('/:id', async (req, res) => {
  const error = validar(req.body)
  if (error) return res.status(400).json({ error })

  const { id } = req.params
  const { nombre, edad_min, edad_max } = req.body
  const { data, error: errDb } = await supabase
    .from('grupos')
    .update({
      nombre: nombre.trim(),
      edad_min: Number(edad_min),
      edad_max: Number(edad_max),
    })
    .eq('id', id)
    .select()
    .single()

  if (errDb) return res.status(400).json({ error: errDb.message })
  res.json({ grupo: data })
})

router.delete('/:id', async (req, res) => {
  const { id } = req.params

  const { count } = await supabase
    .from('ninos')
    .select('id', { count: 'exact', head: true })
    .eq('grupo_id', id)

  if ((count ?? 0) > 0) {
    return res.status(400).json({
      error: `No se puede eliminar: ${count} niño(s) asignado(s) a este grupo.`,
    })
  }

  const { error } = await supabase.from('grupos').delete().eq('id', id)
  if (error) return res.status(400).json({ error: error.message })
  res.json({ ok: true })
})

export default router
