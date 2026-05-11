import { supabase } from '../lib/supabase.js'

export async function requireAdmin(req, res, next) {
  const { data: perfil } = await supabase
    .from('perfiles')
    .select('rol')
    .eq('id', req.user.id)
    .maybeSingle()

  if (perfil?.rol !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado.' })
  }
  next()
}
