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
    if (file.fieldname.startsWith('checkbox_pdf_') && file.mimetype !== 'application/pdf') {
      return cb(new Error('Los archivos adjuntos a checkboxes deben ser PDF.'))
    }
    cb(null, true)
  },
})

// Aceptamos logo + cualquier campo "checkbox_pdf_<idx>"
const recibirArchivos = upload.any()

function parseDatos(req) {
  try {
    return JSON.parse(req.body.data ?? '{}')
  } catch {
    return {}
  }
}

function archivosPorCampo(files) {
  const map = {}
  for (const f of files ?? []) {
    map[f.fieldname] = f
  }
  return map
}

async function sincronizarCheckboxes(clubId, checkboxes, archivos) {
  if (!Array.isArray(checkboxes)) return

  await supabase.from('club_checkboxes').delete().eq('club_id', clubId)

  const validos = checkboxes.filter(cb => (cb.etiqueta ?? '').trim().length > 0)
  if (validos.length === 0) return

  // Insertar primero para obtener ids; el PDF se sube después con un path determinístico.
  const filas = validos.map((cb, i) => ({
    club_id: clubId,
    etiqueta: cb.etiqueta.trim(),
    requerido: !!cb.requerido,
    orden: i,
    // Si el cliente envió pdf_url existente (sin reemplazo) lo conservamos
    pdf_url: cb.pdf_url ?? null,
  }))

  const { data: insertados, error: errIns } = await supabase
    .from('club_checkboxes')
    .insert(filas)
    .select('id, orden')

  if (errIns) throw errIns

  // Subir PDFs nuevos (uno por checkbox) usando el fieldname "checkbox_pdf_<orden>"
  for (const cb of insertados ?? []) {
    const archivo = archivos[`checkbox_pdf_${cb.orden}`]
    if (!archivo) continue
    const url = await subirArchivo(
      'checkboxes-pdfs',
      `${clubId}/${cb.id}.pdf`,
      archivo,
    )
    await supabase.from('club_checkboxes').update({ pdf_url: url }).eq('id', cb.id)
  }
}

router.use(requireAuth, requireAdmin)

const SELECT_COMPLETO =
  '*, checkboxes:club_checkboxes(id, etiqueta, requerido, orden, pdf_url), grupos:club_grupos(grupo_id)'

router.get('/', async (_req, res) => {
  const { data, error } = await supabase
    .from('clubes')
    .select(SELECT_COMPLETO)
    .order('created_at')

  if (error) return res.status(500).json({ error: error.message })
  const clubes = (data ?? []).map(c => ({
    ...c,
    grupo_ids: (c.grupos ?? []).map(g => g.grupo_id),
    grupos: undefined,
  }))
  res.json({ clubes })
})

async function sincronizarGrupos(clubId, grupoIds) {
  if (!Array.isArray(grupoIds)) return
  await supabase.from('club_grupos').delete().eq('club_id', clubId)
  if (grupoIds.length === 0) return
  const filas = grupoIds.map(grupo_id => ({ club_id: clubId, grupo_id }))
  await supabase.from('club_grupos').insert(filas)
}

router.post('/', recibirArchivos, async (req, res) => {
  try {
    const datos = parseDatos(req)
    const { nombre, descripcion, activo, checkboxes, grupo_ids } = datos

    if (!nombre || nombre.trim().length === 0) {
      return res.status(400).json({ error: 'El nombre del club es requerido.' })
    }

    const { data: nuevo, error } = await supabase
      .from('clubes')
      .insert({
        nombre: nombre.trim(),
        descripcion: descripcion?.trim() || null,
        activo: activo ?? true,
      })
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })

    const archivos = archivosPorCampo(req.files)
    const logo = archivos.logo

    if (logo) {
      const ext = extensionDesdeMime(logo.mimetype)
      const url = await subirArchivo('clubes-logos', `${nuevo.id}/logo.${ext}`, logo)
      await supabase.from('clubes').update({ logo_url: url }).eq('id', nuevo.id)
      nuevo.logo_url = url
    }

    await sincronizarCheckboxes(nuevo.id, checkboxes, archivos)
    await sincronizarGrupos(nuevo.id, grupo_ids)

    res.json({ club: nuevo })
  } catch (err) {
    console.error('POST /api/admin/clubes:', err)
    res.status(500).json({ error: err.message ?? 'Error al crear el club.' })
  }
})

router.put('/:id', recibirArchivos, async (req, res) => {
  try {
    const { id } = req.params
    const datos = parseDatos(req)
    const { nombre, descripcion, activo, checkboxes, grupo_ids } = datos

    const updates = {}
    if (nombre !== undefined) updates.nombre = nombre.trim()
    if (descripcion !== undefined) updates.descripcion = descripcion?.trim() || null
    if (activo !== undefined) updates.activo = !!activo

    const archivos = archivosPorCampo(req.files)
    const logo = archivos.logo

    if (logo) {
      const ext = extensionDesdeMime(logo.mimetype)
      updates.logo_url = await subirArchivo('clubes-logos', `${id}/logo.${ext}`, logo)
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await supabase.from('clubes').update(updates).eq('id', id)
      if (error) return res.status(400).json({ error: error.message })
    }

    if (checkboxes !== undefined) {
      await sincronizarCheckboxes(id, checkboxes, archivos)
    }
    if (grupo_ids !== undefined) {
      await sincronizarGrupos(id, grupo_ids)
    }

    const { data: actualizado } = await supabase
      .from('clubes')
      .select(SELECT_COMPLETO)
      .eq('id', id)
      .single()

    const club = actualizado ? {
      ...actualizado,
      grupo_ids: (actualizado.grupos ?? []).map(g => g.grupo_id),
      grupos: undefined,
    } : null

    res.json({ club })
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
