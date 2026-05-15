import { Router } from 'express'
import { supabase } from '../lib/supabase.js'

const router = Router()

router.post('/registro', async (req, res) => {
  try {
    const {
      nombre, apellido, email, cedula, telefono, password,
      club_id, respuestas,
    } = req.body

    if (!nombre || !apellido || !email || !cedula || !telefono || !password || !club_id) {
      return res.status(400).json({ error: 'Todos los campos son requeridos.' })
    }

    const { data: club } = await supabase
      .from('clubes')
      .select('id')
      .eq('id', club_id)
      .eq('activo', true)
      .maybeSingle()

    if (!club) {
      return res.status(400).json({ error: 'El club seleccionado no es válido.' })
    }

    const { data: checkboxesClub } = await supabase
      .from('club_checkboxes')
      .select('id, etiqueta, requerido')
      .eq('club_id', club_id)

    const respuestasMap = new Map(
      Array.isArray(respuestas) ? respuestas.map(r => [r.checkbox_id, !!r.valor]) : []
    )

    for (const cb of (checkboxesClub ?? []).filter(c => c.requerido)) {
      if (respuestasMap.get(cb.id) !== true) {
        return res.status(400).json({ error: `Debes aceptar: "${cb.etiqueta}".` })
      }
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
      email_confirm: true,
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
        club_id,
      })

    if (perfilError) {
      await supabase.auth.admin.deleteUser(authData.user.id)
      return res.status(500).json({ error: 'Error al guardar el perfil. Intenta nuevamente.' })
    }

    if (checkboxesClub && checkboxesClub.length > 0) {
      const filas = checkboxesClub.map(cb => ({
        perfil_id: authData.user.id,
        checkbox_id: cb.id,
        valor: respuestasMap.get(cb.id) ?? false,
      }))
      await supabase.from('perfil_respuestas').insert(filas)
    }

    res.json({ mensaje: 'Cuenta creada exitosamente.' })
  } catch (err) {
    console.error('Error en /registro:', err)
    res.status(500).json({ error: 'Error interno del servidor.' })
  }
})

export default router
