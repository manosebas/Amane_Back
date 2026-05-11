import { Router } from 'express'
import { requireAuth } from '../middlewares/auth.js'
import { supabase } from '../lib/supabase.js'

const router = Router()

function esAdmin(email) {
  if (!email) return false
  const lista = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)
  return lista.includes(email.toLowerCase())
}

router.get('/me', requireAuth, async (req, res) => {
  const admin = esAdmin(req.user.email)

  let perfil = null
  if (!admin) {
    const { data } = await supabase
      .from('perfiles')
      .select('*, club:clubes(id, nombre)')
      .eq('id', req.user.id)
      .maybeSingle()
    perfil = data
  }

  res.json({
    id: req.user.id,
    email: req.user.email,
    rol: admin ? 'admin' : (perfil?.rol ?? 'padre'),
    perfil,
  })
})

export default router
