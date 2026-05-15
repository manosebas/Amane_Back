import { Router } from 'express'
import { supabase } from '../lib/supabase.js'
import { requireAuth } from '../middlewares/auth.js'

const router = Router()
router.use(requireAuth)

function calcularEdad(fechaNacimiento) {
  const fn = new Date(fechaNacimiento)
  if (Number.isNaN(fn.getTime())) return null
  const hoy = new Date()
  let edad = hoy.getFullYear() - fn.getFullYear()
  const m = hoy.getMonth() - fn.getMonth()
  if (m < 0 || (m === 0 && hoy.getDate() < fn.getDate())) edad--
  return edad
}

async function determinarGrupo(padreId, fechaNacimiento) {
  const { data: padre } = await supabase
    .from('perfiles')
    .select('club_id')
    .eq('id', padreId)
    .maybeSingle()
  if (!padre) return { error: 'Perfil de padre no encontrado.' }

  const edad = calcularEdad(fechaNacimiento)
  if (edad === null || edad < 0) return { error: 'Fecha de nacimiento inválida.' }

  const { data: grupos } = await supabase
    .from('club_grupos')
    .select('grupo:grupos(id, edad_min, edad_max)')
    .eq('club_id', padre.club_id)

  const grupo = (grupos ?? [])
    .map(g => g.grupo)
    .find(g => g && edad >= g.edad_min && edad <= g.edad_max)

  if (!grupo) return { error: `No hay grupo para edad ${edad} en este club.` }
  return { grupoId: grupo.id, edad }
}

router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('ninos')
    .select('*, grupo:grupos(id, nombre, edad_min, edad_max)')
    .eq('padre_id', req.user.id)
    .order('created_at')
  if (error) return res.status(500).json({ error: error.message })
  res.json({ ninos: data })
})

router.post('/', async (req, res) => {
  const { nombre, apellido, fecha_nacimiento } = req.body
  if (!nombre?.trim() || !apellido?.trim() || !fecha_nacimiento) {
    return res.status(400).json({ error: 'Nombre, apellido y fecha de nacimiento son requeridos.' })
  }

  const r = await determinarGrupo(req.user.id, fecha_nacimiento)
  if (r.error) return res.status(400).json({ error: r.error })

  const { data, error } = await supabase
    .from('ninos')
    .insert({
      padre_id: req.user.id,
      nombre: nombre.trim(),
      apellido: apellido.trim(),
      fecha_nacimiento,
      grupo_id: r.grupoId,
    })
    .select('*, grupo:grupos(id, nombre, edad_min, edad_max)')
    .single()

  if (error) return res.status(400).json({ error: error.message })
  res.json({ nino: data })
})

router.patch('/:id', async (req, res) => {
  const { id } = req.params

  const { data: existente } = await supabase
    .from('ninos')
    .select('padre_id')
    .eq('id', id)
    .maybeSingle()
  if (!existente || existente.padre_id !== req.user.id) {
    return res.status(404).json({ error: 'Niño no encontrado.' })
  }

  const { nombre, apellido, fecha_nacimiento } = req.body
  const updates = {}
  if (nombre !== undefined) updates.nombre = nombre.trim()
  if (apellido !== undefined) updates.apellido = apellido.trim()
  if (fecha_nacimiento !== undefined) {
    updates.fecha_nacimiento = fecha_nacimiento
    const r = await determinarGrupo(req.user.id, fecha_nacimiento)
    if (r.error) return res.status(400).json({ error: r.error })
    updates.grupo_id = r.grupoId
  }

  const { data, error } = await supabase
    .from('ninos')
    .update(updates)
    .eq('id', id)
    .select('*, grupo:grupos(id, nombre, edad_min, edad_max)')
    .single()

  if (error) return res.status(400).json({ error: error.message })
  res.json({ nino: data })
})

router.delete('/:id', async (req, res) => {
  const { id } = req.params

  const { data: existente } = await supabase
    .from('ninos')
    .select('padre_id')
    .eq('id', id)
    .maybeSingle()
  if (!existente || existente.padre_id !== req.user.id) {
    return res.status(404).json({ error: 'Niño no encontrado.' })
  }

  const { error } = await supabase.from('ninos').delete().eq('id', id)
  if (error) return res.status(400).json({ error: error.message })
  res.json({ ok: true })
})

export default router
