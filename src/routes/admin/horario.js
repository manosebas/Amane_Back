import { Router } from 'express'
import { supabase } from '../../lib/supabase.js'
import { requireAuth } from '../../middlewares/auth.js'
import { requireAdmin } from '../../middlewares/requireAdmin.js'

const router = Router()
router.use(requireAuth, requireAdmin)

const SIN_GRUPO = '__sin_grupo__'

// Datos del horario de una semana: por grupo de edad, las actividades con su
// bloque asignado, el conteo de inscritos y los pares de actividades que
// comparten niños (para resaltar cruces en vivo en el frontend).
router.get('/', async (req, res) => {
  const semanaId = req.query.semana_id
  if (!semanaId) return res.status(400).json({ error: 'semana_id es requerido.' })

  const { data: semana } = await supabase
    .from('semanas')
    .select('id, club_id, num_bloques')
    .eq('id', semanaId)
    .maybeSingle()
  if (!semana) return res.status(404).json({ error: 'Semana no encontrada.' })

  const { data: minimos } = await supabase
    .from('club_minimos_categoria')
    .select('cantidad')
    .eq('club_id', semana.club_id)
  const numBloquesDefault =
    (minimos ?? []).reduce((acc, m) => acc + (m.cantidad || 0), 0) || 5
  const numBloques = semana.num_bloques ?? numBloquesDefault

  const { data: clases } = await supabase
    .from('clases')
    .select(`
      id,
      actividad:actividades(id, nombre, categoria:categorias_actividad(id, nombre)),
      grupos:clase_grupos(id, bloque, grupo:grupos(id, nombre, edad_min, edad_max))
    `)
    .eq('semana_id', semanaId)

  const cgInfo = new Map()
  const cgIds = []
  for (const c of clases ?? []) {
    for (const g of c.grupos ?? []) {
      cgIds.push(g.id)
      cgInfo.set(g.id, {
        clase_grupo_id: g.id,
        actividad: c.actividad,
        grupo: g.grupo,
        bloque: g.bloque ?? null,
      })
    }
  }

  let inscripciones = []
  if (cgIds.length > 0) {
    const { data } = await supabase
      .from('inscripciones')
      .select('nino_id, clase_grupo_id')
      .in('clase_grupo_id', cgIds)
    inscripciones = data ?? []
  }

  const inscritos = new Map()
  const ninoCgs = new Map()
  for (const ins of inscripciones) {
    inscritos.set(ins.clase_grupo_id, (inscritos.get(ins.clase_grupo_id) ?? 0) + 1)
    if (!ninoCgs.has(ins.nino_id)) ninoCgs.set(ins.nino_id, new Set())
    ninoCgs.get(ins.nino_id).add(ins.clase_grupo_id)
  }

  // Pares de clase_grupos que comparten al menos un niño (cruce potencial).
  const pairCount = new Map()
  for (const set of ninoCgs.values()) {
    const arr = [...set].sort()
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const key = `${arr[i]}|${arr[j]}`
        pairCount.set(key, (pairCount.get(key) ?? 0) + 1)
      }
    }
  }

  const gruposMap = new Map()
  for (const info of cgInfo.values()) {
    const gid = info.grupo?.id ?? SIN_GRUPO
    if (!gruposMap.has(gid)) {
      gruposMap.set(gid, { grupo: info.grupo, actividades: [], conflictos: [] })
    }
    gruposMap.get(gid).actividades.push({
      clase_grupo_id: info.clase_grupo_id,
      actividad: info.actividad,
      bloque: info.bloque,
      inscritos: inscritos.get(info.clase_grupo_id) ?? 0,
    })
  }

  for (const [key, ninos] of pairCount.entries()) {
    const [a, b] = key.split('|')
    const gid = cgInfo.get(a)?.grupo?.id ?? SIN_GRUPO
    const g = gruposMap.get(gid)
    if (g) g.conflictos.push({ a, b, ninos })
  }

  const grupos = [...gruposMap.values()]
  for (const g of grupos) {
    g.actividades.sort((x, y) => {
      const cx = x.actividad?.categoria?.nombre ?? ''
      const cy = y.actividad?.categoria?.nombre ?? ''
      if (cx !== cy) return cx.localeCompare(cy, 'es', { sensitivity: 'base' })
      return (x.actividad?.nombre ?? '').localeCompare(y.actividad?.nombre ?? '', 'es', { sensitivity: 'base' })
    })
  }
  grupos.sort((a, b) => {
    const ea = a.grupo?.edad_min ?? 999
    const eb = b.grupo?.edad_min ?? 999
    if (ea !== eb) return ea - eb
    return (a.grupo?.nombre ?? '').localeCompare(b.grupo?.nombre ?? '', 'es', { sensitivity: 'base' })
  })

  res.json({ num_bloques: numBloques, num_bloques_default: numBloquesDefault, grupos })
})

// Guarda el nº de bloques de la semana y la asignación de bloque por actividad.
router.put('/', async (req, res) => {
  const { semana_id, num_bloques, asignaciones } = req.body
  if (!semana_id || !Array.isArray(asignaciones)) {
    return res.status(400).json({ error: 'semana_id y asignaciones son requeridos.' })
  }

  if (num_bloques != null) {
    const { error } = await supabase
      .from('semanas')
      .update({ num_bloques })
      .eq('id', semana_id)
    if (error) return res.status(400).json({ error: error.message })
  }

  const results = await Promise.all(
    asignaciones.map(a =>
      supabase
        .from('clase_grupos')
        .update({ bloque: a.bloque ?? null })
        .eq('id', a.clase_grupo_id)
    )
  )
  const fallo = results.find(r => r.error)
  if (fallo) return res.status(400).json({ error: fallo.error.message })

  res.json({ ok: true })
})

export default router
