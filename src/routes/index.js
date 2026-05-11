import { Router } from 'express'
import { requireAuth } from '../middlewares/auth.js'
import { supabase } from '../lib/supabase.js'

const router = Router()

router.get('/me', requireAuth, async (req, res) => {
  const { data: perfil } = await supabase
    .from('perfiles')
    .select('*, club:clubes(id, nombre)')
    .eq('id', req.user.id)
    .maybeSingle()

  res.json({
    id: req.user.id,
    email: req.user.email,
    rol: perfil?.rol ?? 'padre',
    perfil,
  })
})

export default router
