import { Router } from 'express'
import { supabase } from '../lib/supabase.js'

const router = Router()

router.post('/registro', async (req, res) => {
  try {
    const { nombre, apellido, email, cedula, telefono, password, club_id, es_socio } = req.body

    if (!nombre || !apellido || !email || !cedula || !telefono || !password || !club_id) {
      return res.status(400).json({ error: 'Todos los campos son requeridos.' })
    }

    const { data: clubExiste } = await supabase
      .from('clubes')
      .select('id')
      .eq('id', club_id)
      .eq('activo', true)
      .maybeSingle()

    if (!clubExiste) {
      return res.status(400).json({ error: 'El club seleccionado no es válido.' })
    }

    const { data: cedulaExiste } = await supabase
      .from('perfiles')
      .select('id')
      .eq('cedula', cedula)
      .maybeSingle()

    if (cedulaExiste) {
      return res.status(400).json({ error: 'Ya existe un usuario registrado con esa cédula.' })
    }

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
    })

    if (authError) {
      const mensajes = {
        'User already registered': 'Ya existe una cuenta con ese correo electrónico.',
      }
      return res.status(400).json({ error: mensajes[authError.message] ?? authError.message })
    }

    const { error: perfilError } = await supabase
      .from('perfiles')
      .insert({
        id: authData.user.id,
        nombre,
        apellido,
        cedula,
        telefono,
        es_socio: es_socio ?? false,
        club_id,
        acepto_terminos_at: new Date().toISOString(),
      })

    if (perfilError) {
      await supabase.auth.admin.deleteUser(authData.user.id)
      return res.status(500).json({ error: 'Error al guardar el perfil. Intenta nuevamente.' })
    }

    res.json({ mensaje: 'Cuenta creada. Revisa tu correo para confirmar tu cuenta.' })
  } catch (err) {
    console.error('Error en /registro:', err)
    res.status(500).json({ error: 'Error interno del servidor.' })
  }
})

export default router
