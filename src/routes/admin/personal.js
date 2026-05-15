import { Router } from 'express'
import { supabase } from '../../lib/supabase.js'
import { requireAuth } from '../../middlewares/auth.js'
import { requireAdmin } from '../../middlewares/requireAdmin.js'

const router = Router()
router.use(requireAuth, requireAdmin)

const SELECT_COMPLETO = '*, club:clubes(id, nombre)'
const ROLES = ['mate', 'profesor']

function validar({ club_id, nombre, apellido, cedula, rol }) {
  if (!club_id) return 'El club es requerido.'
  if (!nombre || !nombre.trim()) return 'El nombre es requerido.'
  if (!apellido || !apellido.trim()) return 'El apellido es requerido.'
  if (!cedula || !cedula.trim()) return 'La cédula es requerida.'
  if (!ROLES.includes(rol)) return 'Rol inválido.'
  return null
}

router.get('/', async (req, res) => {
  let query = supabase.from('personal').select(SELECT_COMPLETO).order('apellido')
  if (req.query.club_id) query = query.eq('club_id', req.query.club_id)
  const { data, error } = await query

  if (error) return res.status(500).json({ error: error.message })
  res.json({ personal: data })
})

router.post('/', async (req, res) => {
  const error = validar(req.body)
  if (error) return res.status(400).json({ error })

  const { club_id, nombre, apellido, cedula, rol } = req.body
  const { data, error: errDb } = await supabase
    .from('personal')
    .insert({
      club_id,
      nombre: nombre.trim(),
      apellido: apellido.trim(),
      cedula: cedula.trim(),
      rol,
    })
    .select(SELECT_COMPLETO)
    .single()

  if (errDb) {
    if (errDb.code === '23505') {
      return res.status(400).json({ error: 'Ya existe personal con esa cédula en este club.' })
    }
    return res.status(400).json({ error: errDb.message })
  }
  res.json({ personal: data })
})

router.put('/:id', async (req, res) => {
  const error = validar(req.body)
  if (error) return res.status(400).json({ error })

  const { id } = req.params
  const { club_id, nombre, apellido, cedula, rol } = req.body
  const { data, error: errDb } = await supabase
    .from('personal')
    .update({
      club_id,
      nombre: nombre.trim(),
      apellido: apellido.trim(),
      cedula: cedula.trim(),
      rol,
    })
    .eq('id', id)
    .select(SELECT_COMPLETO)
    .single()

  if (errDb) {
    if (errDb.code === '23505') {
      return res.status(400).json({ error: 'Ya existe personal con esa cédula en este club.' })
    }
    return res.status(400).json({ error: errDb.message })
  }
  res.json({ personal: data })
})

router.delete('/:id', async (req, res) => {
  const { id } = req.params

  const { count } = await supabase
    .from('slots')
    .select('id', { count: 'exact', head: true })
    .eq('personal_id', id)

  if ((count ?? 0) > 0) {
    return res.status(400).json({
      error: `No se puede eliminar: está asignado(a) a ${count} slot(s).`,
    })
  }

  const { error } = await supabase.from('personal').delete().eq('id', id)
  if (error) return res.status(400).json({ error: error.message })
  res.json({ ok: true })
})

export default router
