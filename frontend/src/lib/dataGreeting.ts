import { sharedName, type SourceReview } from '@/lib/aiContext'
import type { AnalysisSource, DatasetCatalog } from '@/lib/datasetCatalog'
import { formatNumber } from '@/lib/format'

/**
 * Primer mensaje del asistente (Fase 5), armado EN EL NAVEGADOR con la estructura real de los datos
 * revisados: qué columnas hay de cada tipo y qué problemas de calidad conviene tener en cuenta.
 * No consulta a la IA ni envía nada: es el punto de partida para que la persona cuente qué quiere decidir.
 */

const KINDS: { type: string; label: string }[] = [
  { type: 'temporal', label: 'fechas o períodos' },
  { type: 'quantitative', label: 'medidas' },
  { type: 'categorical', label: 'categorías' },
]

const FORMAT_FALLBACK: Record<string, string> = { date: 'temporal', numeric: 'quantitative', text: 'categorical' }

function joinList(items: string[]): string {
  return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
}

export function dataGreeting(catalog: DatasetCatalog, review: SourceReview[], sources: AnalysisSource[]): string {
  const parts = catalog.sources.map((source) => {
    const decisions = review.find((r) => r.alias === source.alias)
    const shared = source.columns.filter((c) => decisions?.columns[c.name]?.include)
    const groups = KINDS.map(({ type, label }) => {
      const names = shared
        // Sin interpretación semántica (perfil local preliminar), se usa el formato detectado.
        .filter((c) => (c.semanticType ?? FORMAT_FALLBACK[c.format]) === type)
        .slice(0, 4)
        .map((c) => {
          const name = sharedName(decisions, c.name)
          return type === 'quantitative' && c.unitSuggestion ? `${name} en ${c.unitSuggestion}` : name
        })
      return names.length ? `${label} (${names.join(', ')})` : null
    }).filter((g): g is string => g !== null)
    const rows = source.rowCount === null ? '' : `${formatNumber(source.rowCount)} filas`
    const content = groups.length ? `${rows ? `${rows} con ` : ''}${joinList(groups)}` : rows || 'las columnas que elegiste compartir'
    return catalog.sources.length > 1 ? `la fuente ${source.alias} tiene ${content}` : `contiene ${content}`
  })
  const serious = sources.flatMap((s) => s.profile.qualityFindings ?? []).filter((f) => f.severity !== 'baja').length
  const quality = serious
    ? ` Antes de decidir, tené en cuenta ${serious === 1 ? 'un problema' : `${serious} problemas`} de calidad que señalé al explorar los datos.`
    : ''
  const intro = catalog.sources.length > 1 ? `Revisé tus ${catalog.sources.length} archivos: ${joinList(parts)}.` : `Revisé tu archivo: ${parts[0] ?? 'sin columnas compartidas'}.`
  return `${intro}${quality} ¿Qué decisión te gustaría tomar con esta información? Podés contármelo con tus palabras.`
}
