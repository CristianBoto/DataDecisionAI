import type { AnalysisReviewState } from '@/context/sessionContext'
import type { SessionAIPlan } from '@/lib/aiPlans'
import { effectiveMeasure, sharedName } from '@/lib/aiContext'
import { buildDatasetCatalog, type AnalysisSource } from '@/lib/datasetCatalog'
import type { ColumnMapping, ExecutionRequest } from '@/services/analysisEngine'

type Alias = 'A' | 'B' | 'C'

export interface PreparedExecution {
  request: ExecutionRequest
  files: Partial<Record<Alias, File>>
  /** Motivo por el que no se puede ejecutar todavía (por ejemplo, falta un archivo). */
  problem: string | null
}

/** Clave de la unidad de una columna (por ejemplo, "A:ventas"). */
export const unitKey = (alias: string, column: string) => `${alias}:${column}`

/**
 * Arma el pedido para el motor de análisis a partir de la revisión confirmada:
 * para cada fuente usada por los planes aprobados, la correspondencia entre el
 * nombre que vio la IA y la columna real, con la interpretación y la decisión
 * sobre faltantes que tomó el usuario, y la unidad, aditividad y dependencia de cada
 * medida decididas en la revisión. Mismas reglas que `buildAIContext`.
 */
export function buildExecution(
  sources: AnalysisSource[],
  review: AnalysisReviewState,
  plans: SessionAIPlan[],
  /** Clase positiva por columna de etiquetas (clave `unitKey`), elegida por el usuario para la curva ROC. */
  positives: Record<string, string> = {},
): PreparedExecution {
  const catalog = buildDatasetCatalog(sources)
  const used = new Set(plans.map((p) => p.plan.source_alias))
  const files: Partial<Record<Alias, File>> = {}
  const missingFiles: string[] = []

  const requestSources = catalog.sources
    .filter((source) => used.has(source.alias as Alias))
    .map((source) => {
      const alias = source.alias as Alias
      const original = sources.find((s) => s.dataset.id === source.datasetId)
      if (original?.file) files[alias] = original.file
      else missingFiles.push(`${alias} (${source.fileName})`)
      const decisions = review.sources.find((r) => r.alias === alias)
      const columns: ColumnMapping[] = source.columns
        .filter((c) => decisions?.columns[c.name]?.include)
        .map((c) => {
          const decision = decisions?.columns[c.name]
          const name = sharedName(decisions, c.name)
          const measure = effectiveMeasure(c, decisions)
          return {
            name,
            original: c.name,
            semantic_type: decision?.semanticType ?? c.semanticType ?? null,
            missing_markers: decision?.markers ?? null,
            unit: measure?.unit ?? null,
            additivity: measure?.additivity ?? null,
            split_by: (measure?.splitBy ?? []).map((original) => sharedName(decisions, original)),
            missing_values: (decision?.missingValues ?? []).map((v) => v.trim()).filter(Boolean).slice(0, 20),
            positive_label: positives[unitKey(alias, name)] || null,
          }
        })
      return { alias, columns }
    })

  return {
    request: { plan_ids: plans.map((p) => p.planId), sources: requestSources },
    files,
    problem: missingFiles.length
      ? `Falta el archivo original de la fuente ${missingFiles.join(', ')}. El navegador lo guarda solo en memoria: volvé a cargarlo en «Cargar datos».`
      : null,
  }
}

/**
 * Columnas de etiquetas de las curvas ROC de los planes, con sus clases conocidas en el
 * navegador (valores de ejemplo del perfil). La clase positiva la elige el usuario: es un
 * valor del dataset y por eso nunca se envía a la IA, solo al backend al ejecutar.
 */
export function rocLabelColumns(
  prepared: PreparedExecution,
  plans: SessionAIPlan[],
  sources: AnalysisSource[],
): { alias: string; name: string; classes: string[] }[] {
  const catalog = buildDatasetCatalog(sources)
  const result: { alias: string; name: string; classes: string[] }[] = []
  for (const p of plans) {
    for (const op of p.plan.operations) {
      if (op.operation !== 'roc_curve' || op.columns.length !== 2) continue
      const alias = p.plan.source_alias
      const name = op.columns[0]
      if (result.some((r) => r.alias === alias && r.name === name)) continue
      const mapping = prepared.request.sources.find((s) => s.alias === alias)?.columns.find((c) => c.name === name)
      const datasetId = catalog.sources.find((s) => s.alias === alias)?.datasetId
      const profile = sources.find((s) => s.dataset.id === datasetId)?.profile
      const values = profile?.columns.find((c) => c.name === mapping?.original)?.sampleValues ?? []
      result.push({ alias, name, classes: [...new Set(values.map((v) => v.trim()).filter(Boolean))].sort() })
    }
  }
  return result
}
