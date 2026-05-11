import { Router } from 'express'
import multer from 'multer'
import { supabase } from '../../lib/supabase.js'
import { requireAuth } from '../../middlewares/auth.js'
import { requireAdmin } from '../../middlewares/requireAdmin.js'
import { subirArchivo, extensionDesdeMime } from '../../lib/storage.js'

const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === 'logo' && !file.mimetype.startsWith('image/')) {
      return cb(new Error('El logo debe ser una imagen.'))
    }
    if (file.fieldname === 'terminos_pdf' && file.mimetype !== 'application/pdf') {
      return cb(new Error('Los términos deben ser un PDF.'))
    }
    cb(null, true)
  },
})

const camposArchivos = upload.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'terminos_pdf', maxCount: 1 },
])

function parseDatos(req) {
  try {
    return JSON.parse(req.body.data ?? '{}')
  } catch {
    return {}
  }
}

async function sincronizarCheckboxes(clubId, checkboxes) {
  if (!Array.isArray(checkboxes)) return

  await supabase.from('club_checkboxes').delete().eq('club_id', clubId)

  if (checkboxes.length === 0) return

  const filas = checkboxes
    .filter(cb => (cb.etiqueta ?? '').trim().length > 0)
    .map((cb, i) => ({
      club_id: clubId,
      etiqueta: cb.etiqueta.trim(),
      requerido: !!cb.requerido,
      orden: i,
    }))

  if (filas.length === 0) return

  await supabase.from('club_checkboxes').insert(filas)
}

router.use(requireAuth, requireAdmin)

router.get('/', async (_req, res) => {
  const { data, error } = await supabase
    .from('clubes')
    .select('*, checkboxes:club_checkboxes(id, etiqueta, requerido, orden)')
    .order('created_at')

  if (error) return res.status(500).json({ error: error.message })
  res.json({ clubes: data })
})

router.post('/', camposArchivos, async (req, res) => {
  try {
    const datos = parseDatos(req)
    const {
      nombre, descripcion, activo,
      mostrar_es_socio, es_socio_requerido,
      mostrar_terminos, terminos_requerido,
      checkboxes,
    } = datos

    if (!nombre || nombre.trim().length === 0) {
      return res.status(400).json({ error: 'El nombre del club es requerido.' })
    }

    const { data: nuevo, error } = await supabase
      .from('clubes')
      .insert({
        nombre: nombre.trim(),
        descripcion: descripcion?.trim() || null,
        activo: activo ?? true,
        mostrar_es_socio: mostrar_es_socio ?? true,
        es_socio_requerido: es_socio_requerido ?? false,
        mostrar_terminos: mostrar_terminos ?? true,
        terminos_requerido: terminos_requerido ?? true,
      })
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })

    const updates = {}
    const logo = req.files?.logo?.[0]
    const pdf = req.files?.terminos_pdf?.[0]

    if (logo) {
      const ext = extensionDesdeMime(logo.mimetype)
      const url = await subirArchivo('clubes-logos', `${nuevo.id}/logo.${ext}`, logo)
      updates.logo_url = url
    }
    if (pdf) {
      const url = await subirArchivo('clubes-terminos', `${nuevo.id}/terminos.pdf`, pdf)
      updates.terminos_pdf_url = url
    }

    if (Object.keys(updates).length > 0) {
      await supabase.from('clubes').update(updates).eq('id', nuevo.id)
      Object.assign(nuevo, updates)
    }

    await sincronizarCheckboxes(nuevo.id, checkboxes)

    res.json({ club: nuevo })
  } catch (err) {
    console.error('POST /api/admin/clubes:', err)
    res.status(500).json({ error: err.message ?? 'Error al crear el club.' })
  }
})

router.put('/:id', camposArchivos, async (req, res) => {
  try {
    const { id } = req.params
    const datos = parseDatos(req)
    const {
      nombre, descripcion, activo,
      mostrar_es_socio, es_socio_requerido,
      mostrar_terminos, terminos_requerido,
      checkboxes,
    } = datos

    const updates = {}
    if (nombre !== undefined) updates.nombre = nombre.trim()
    if (descripcion !== undefined) updates.descripcion = descripcion?.trim() || null
    if (activo !== undefined) updates.activo = !!activo
    if (mostrar_es_socio !== undefined) updates.mostrar_es_socio = !!mostrar_es_socio
    if (es_socio_requerido !== undefined) updates.es_socio_requerido = !!es_socio_requerido
    if (mostrar_terminos !== undefined) updates.mostrar_terminos = !!mostrar_terminos
    if (terminos_requerido !== undefined) updates.terminos_requerido = !!terminos_requerido

    const logo = req.files?.logo?.[0]
    const pdf = req.files?.terminos_pdf?.[0]

    if (logo) {
      const ext = extensionDesdeMime(logo.mimetype)
      updates.logo_url = await subirArchivo('clubes-logos', `${id}/logo.${ext}`, logo)
    }
    if (pdf) {
      updates.terminos_pdf_url = await subirArchivo('clubes-terminos', `${id}/terminos.pdf`, pdf)
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await supabase.from('clubes').update(updates).eq('id', id)
      if (error) return res.status(400).json({ error: error.message })
    }

    if (checkboxes !== undefined) {
      await sincronizarCheckboxes(id, checkboxes)
    }

    const { data: actualizado } = await supabase
      .from('clubes')
      .select('*, checkboxes:club_checkboxes(id, etiqueta, requerido, orden)')
      .eq('id', id)
      .single()

    res.json({ club: actualizado })
  } catch (err) {
    console.error('PUT /api/admin/clubes/:id:', err)
    res.status(500).json({ error: err.message ?? 'Error al actualizar el club.' })
  }
})

router.delete('/:id', async (req, res) => {
  const { id } = req.params

  const { count } = await supabase
    .from('perfiles')
    .select('id', { count: 'exact', head: true })
    .eq('club_id', id)

  if ((count ?? 0) > 0) {
    return res.status(400).json({
      error: `No se puede eliminar: hay ${count} usuario(s) registrado(s) en este club. Marca el club como inactivo en su lugar.`,
    })
  }

  const { error } = await supabase.from('clubes').delete().eq('id', id)
  if (error) return res.status(400).json({ error: error.message })

  res.json({ ok: true })
})

router.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message ?? 'Error procesando la solicitud.' })
})

export default router
