import { Router } from 'express'
import { supabase } from '../../lib/supabase.js'
import { requireAuth } from '../../middlewares/auth.js'
import { requireAdmin } from '../../middlewares/requireAdmin.js'

const router = Router()
router.use(requireAuth, requireAdmin)

const SELECT_COMPLETO = `
  id, semana_id, actividad_id, created_at,
  actividad:actividades(id, nombre, categoria:categorias_actividad(id, nombre)),
  cupos:clase_grupos(id, grupo_id, cupo, grupo:grupos(id, nombre, edad_min, edad_max))
`

// Conteo de inscritos por clase_grupo
async function conteoInscritos(claseGrupoIds) {
  if (claseGrupoIds.length === 0) return new Map()
  const { data } = await supabase
    .from('inscripciones')
    .select('clase_grupo_id')
    .in('clase_grupo_id', claseGrupoIds)
  const map = new Map()
  for (const r of data ?? []) {
    map.set(r.clase_grupo_id, (map.get(r.clase_grupo_id) ?? 0) + 1)
  }
  return map
}

function adjuntarInscritos(clases, conteos) {
  return clases.map(c => ({
    ...c,
    cupos: (c.cupos ?? []).map(cg => ({
      ...cg,
      inscritos: conteos.get(cg.id) ?? 0,
    })),
  }))
}

async function validarSemanaActividad({ semana_id, actividad_id }) {
  const { data: semana } = await supabase
    .from('semanas')
    .select('club_id')
    .eq('id', semana_id)
    .maybeSingle()
  if (!semana) return 'Semana no encontrada.'

  const { data: ok } = await supabase
    .from('club_actividades')
    .select('actividad_id')
    .eq('club_id', semana.club_id)
    .eq('actividad_id', actividad_id)
    .maybeSingle()
  if (!ok) return 'Esa actividad no está ofrecida por el club.'

  return null
}

async function validarGrupos(semanaId, grupoIds) {
  if (grupoIds.length === 0) return 'Debes seleccionar al menos un grupo.'

  const { data: semana } = await supabase
    .from('semanas')
    .select('club_id')
    .eq('id', semanaId)
    .maybeSingle()
  if (!semana) return 'Semana no encontrada.'

  const { data: asignados } = await supabase
    .from('club_grupos')
    .select('grupo_id')
    .eq('club_id', semana.club_id)
    .in('grupo_id', grupoIds)

  if ((asignados?.length ?? 0) !== grupoIds.length) {
    return 'Algún grupo no pertenece al club.'
  }
  return null
}

router.get('/', async (req, res) => {
  if (!req.query.semana_id) {
    return res.status(400).json({ error: 'semana_id es requerido.' })
  }
  const { data, error } = await supabase
    .from('clases')
    .select(SELECT_COMPLETO)
    .eq('semana_id', req.query.semana_id)
    .order('created_at')
  if (error) return res.status(500).json({ error: error.message })

  const cgIds = (data ?? []).flatMap(c => (c.cupos ?? []).map(cg => cg.id))
  const conteos = await conteoInscritos(cgIds)
  res.json({ clases: adjuntarInscritos(data ?? [], conteos) })
})

router.post('/', async (req, res) => {
  const { semana_id, actividad_id, cupos } = req.body
  if (!semana_id || !actividad_id) {
    return res.status(400).json({ error: 'semana_id y actividad_id son requeridos.' })
  }
  if (!Array.isArray(cupos) || cupos.length === 0) {
    return res.status(400).json({ error: 'Debes definir cupos para al menos un grupo.' })
  }
  for (const c of cupos) {
    if (!c.grupo_id) return res.status(400).json({ error: 'Falta grupo_id en cupos.' })
    if (!Number.isInteger(Number(c.cupo)) || Number(c.cupo) <= 0) {
      return res.status(400).json({ error: 'Los cupos deben ser enteros positivos.' })
    }
  }

  const errA = await validarSemanaActividad({ semana_id, actividad_id })
  if (errA) return res.status(400).json({ error: errA })
  const errG = await validarGrupos(semana_id, cupos.map(c => c.grupo_id))
  if (errG) return res.status(400).json({ error: errG })

  const { data: clase, error } = await supabase
    .from('clases')
    .insert({ semana_id, actividad_id })
    .select('id')
    .single()
  if (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Esa actividad ya está creada en esta semana.' })
    }
    return res.status(400).json({ error: error.message })
  }

  const filas = cupos.map(c => ({ clase_id: clase.id, grupo_id: c.grupo_id, cupo: Number(c.cupo) }))
  await supabase.from('clase_grupos').insert(filas)

  const { data: completa } = await supabase
    .from('clases')
    .select(SELECT_COMPLETO)
    .eq('id', clase.id)
    .single()
  res.json({ clase: completa })
})

// Editar cupos de una clase: reemplaza la lista completa.
// - Si se intenta eliminar un grupo con inscripciones → error
// - Si se intenta bajar cupo por debajo de inscritos → error
router.put('/:id', async (req, res) => {
  const { id } = req.params
  const { cupos } = req.body

  if (!Array.isArray(cupos) || cupos.length === 0) {
    return res.status(400).json({ error: 'Debes mantener cupos para al menos un grupo.' })
  }

  const { data: clase } = await supabase
    .from('clases')
    .select('id, semana_id')
    .eq('id', id)
    .maybeSingle()
  if (!clase) return res.status(404).json({ error: 'Clase no encontrada.' })

  const errG = await validarGrupos(clase.semana_id, cupos.map(c => c.grupo_id))
  if (errG) return res.status(400).json({ error: errG })

  const { data: existentes } = await supabase
    .from('clase_grupos')
    .select('id, grupo_id, cupo')
    .eq('clase_id', id)
  const existentesPorGrupo = new Map((existentes ?? []).map(e => [e.grupo_id, e]))

  const grupoIdsNuevos = new Set(cupos.map(c => c.grupo_id))

  // Verificar grupos que se quieren eliminar
  for (const ex of existentes ?? []) {
    if (grupoIdsNuevos.has(ex.grupo_id)) continue
    const { count } = await supabase
      .from('inscripciones')
      .select('id', { count: 'exact', head: true })
      .eq('clase_grupo_id', ex.id)
    if ((count ?? 0) > 0) {
      return res.status(400).json({
        error: `No puedes quitar el grupo: tiene ${count} inscripción(es).`,
      })
    }
  }

  // Verificar bajadas de cupo
  for (const c of cupos) {
    const existente = existentesPorGrupo.get(c.grupo_id)
    if (!existente) continue
    if (Number(c.cupo) >= existente.cupo) continue
    const { count } = await supabase
      .from('inscripciones')
      .select('id', { count: 'exact', head: true })
      .eq('clase_grupo_id', existente.id)
    if ((count ?? 0) > Number(c.cupo)) {
      return res.status(400).json({
        error: `No puedes bajar el cupo por debajo de ${count} ya inscritos.`,
      })
    }
  }

  // Borrar grupos eliminados
  const aEliminar = (existentes ?? [])
    .filter(e => !grupoIdsNuevos.has(e.grupo_id))
    .map(e => e.id)
  if (aEliminar.length > 0) {
    await supabase.from('clase_grupos').delete().in('id', aEliminar)
  }

  // Insertar nuevos / actualizar cupo de los existentes
  for (const c of cupos) {
    const existente = existentesPorGrupo.get(c.grupo_id)
    if (existente) {
      if (Number(c.cupo) !== existente.cupo) {
        await supabase.from('clase_grupos').update({ cupo: Number(c.cupo) }).eq('id', existente.id)
      }
    } else {
      await supabase.from('clase_grupos').insert({ clase_id: id, grupo_id: c.grupo_id, cupo: Number(c.cupo) })
    }
  }

  const { data: completa } = await supabase
    .from('clases')
    .select(SELECT_COMPLETO)
    .eq('id', id)
    .single()
  const conteos = await conteoInscritos((completa?.cupos ?? []).map(cg => cg.id))
  res.json({ clase: adjuntarInscritos([completa], conteos)[0] })
})

router.delete('/:id', async (req, res) => {
  const { id } = req.params

  const { count } = await supabase
    .from('inscripciones')
    .select('id, clase_grupo:clase_grupos!inner(clase_id)', { count: 'exact', head: true })
    .eq('clase_grupo.clase_id', id)
  if ((count ?? 0) > 0) {
    return res.status(400).json({
      error: `No se puede eliminar: la clase tiene ${count} inscripción(es).`,
    })
  }

  const { error } = await supabase.from('clases').delete().eq('id', id)
  if (error) return res.status(400).json({ error: error.message })
  res.json({ ok: true })
})

export default router
