/**
 * Tipos de dominio compartidos por toda la aplicación.
 *
 * Reflejan el contrato documentado en docs/API_CONTRACT.md. Cuando el backend
 * FastAPI esté disponible, sus esquemas Pydantic deberían producir exactamente
 * estas estructuras (en camelCase).
 */

// ---------------------------------------------------------------------------
// Datasets
// ---------------------------------------------------------------------------

export type DatasetFormat = 'csv' | 'xlsx'

/** De dónde proviene el dataset: archivo del usuario o ejemplo ficticio. */
export type DatasetSource = 'upload' | 'demo'

export type DatasetStatus = 'uploaded' | 'profiling' | 'ready' | 'error'

export interface Dataset {
  id: string
  /** Nombre legible del dataset. */
  name: string
  fileName: string
  format: DatasetFormat
  sizeBytes: number
  uploadedAt: string
  source: DatasetSource
  status: DatasetStatus
}

/** Formato de los valores (tipo técnico). No indica qué significa la columna. */
export type ColumnType = 'numeric' | 'text' | 'date' | 'boolean' | 'unknown'

/** Rol estadístico estimado de la columna. Es una inferencia, nunca una certeza. */
export type SemanticType = 'quantitative' | 'categorical' | 'identifier' | 'temporal' | 'text' | 'unknown'
export type SemanticConfidence = 'high' | 'medium' | 'low'

export interface ColumnProfile {
  name: string
  inferredType: ColumnType
  nonNullCount: number
  /** Celdas realmente vacías (o solo con espacios). */
  nullCount: number
  /**
   * Valores como "NA", "null" o "-" que podrían indicar ausencia. NO se suman
   * a nullCount porque pueden ser valores válidos (por ejemplo, "NA" = Namibia).
   */
  suspectedMissingCount?: number
  /** Solo lo informa el backend, calculado sobre todos los valores de la columna. */
  semanticType?: SemanticType
  semanticConfidence?: SemanticConfidence
  /** Motivo legible de la clasificación. */
  semanticReason?: string
  /** Cantidad de valores distintos (puede ser null si no se calculó). */
  uniqueCount: number | null
  sampleValues: string[]
}

export type IssueSeverity = 'info' | 'warning' | 'error'

export interface DataQualityIssue {
  severity: IssueSeverity
  /** Columna afectada; vacío si el problema es del dataset completo. */
  column?: string
  message: string
}

/**
 * Origen del perfil:
 * - `local-preview`: calculado en el navegador sobre una muestra (preliminar).
 * - `backend`: calculado por FastAPI + Pandas (definitivo).
 * - `demo`: perfil del dataset ficticio de demostración.
 */
export type ProfileOrigin = 'local-preview' | 'backend' | 'demo'

export interface DatasetProfile {
  datasetId: string
  origin: ProfileOrigin
  /** false cuando el perfil es parcial (por ejemplo, Excel sin backend). */
  isComplete: boolean
  /** null cuando todavía no se pudo calcular. */
  rowCount: number | null
  /** true si rowCount se calculó sobre una muestra del archivo. */
  rowCountIsEstimate: boolean
  columnCount: number
  /** Filas idénticas; undefined o null cuando no se calculó (vista previa local). */
  duplicateRowCount?: number | null
  /** Celdas no vacías / total de celdas, informado por el backend sobre el archivo completo. */
  completeness?: number | null
  /** Total de celdas con marcadores sospechosos de ausencia (no incluidas en los faltantes). */
  suspectedMissingCellCount?: number
  columns: ColumnProfile[]
  /** Primeras filas, indexadas por nombre de columna. */
  previewRows: Record<string, string>[]
  issues: DataQualityIssue[]
  /** Aclaración visible para el usuario sobre el alcance del perfil. */
  note?: string
}

// ---------------------------------------------------------------------------
// Proyectos / workspace
// ---------------------------------------------------------------------------

export type ProjectStatus =
  | 'draft'
  | 'awaiting_approval'
  | 'approved'
  | 'running'
  | 'completed'
  | 'failed'

export interface Project {
  id: string
  name: string
  /** Fuente principal (compatibilidad con proyectos de una sola fuente). */
  datasetId: string
  dataset: Dataset
  /** Todas las fuentes del análisis, en orden; la primera es la principal. Máximo 3. */
  datasetIds?: string[]
  datasets?: Dataset[]
  status: ProjectStatus
  createdAt: string
  updatedAt: string
  /** Plan aprobado (solo existe después de la aprobación). */
  approvedPlan: ApprovedAnalysisPlan | null
}

export interface CreateProjectInput {
  name: string
  /** Fuente principal. */
  datasetId: string
  /** Opcional: todas las fuentes (incluida la principal). Las fuentes no se unen ni se transforman. */
  datasetIds?: string[]
}

// ---------------------------------------------------------------------------
// Conversación con el asistente (IA 1)
// ---------------------------------------------------------------------------

export type MessageRole = 'user' | 'assistant' | 'system'

/** Tipo de mensaje del asistente, útil para renderizarlo distinto. */
export type MessageKind = 'text' | 'question' | 'proposal' | 'notice'

export interface AssistantMessage {
  id: string
  role: MessageRole
  kind: MessageKind
  content: string
  createdAt: string
  /** Respuestas rápidas sugeridas al usuario. */
  suggestions?: string[]
  /** Si kind === 'proposal', referencia a la propuesta asociada. */
  proposalId?: string
  /** true si el mensaje fue generado por la simulación DEMO. */
  isDemo?: boolean
}

export interface SendMessageInput {
  content: string
}

export interface ChatReply {
  /** Mensajes nuevos (incluye el eco del usuario y la respuesta). */
  messages: AssistantMessage[]
  /** Propuesta vigente, si el asistente generó o actualizó una. */
  proposal: AnalysisProposal | null
}

// ---------------------------------------------------------------------------
// Propuesta y plan de análisis
// ---------------------------------------------------------------------------

/** Evaluación de si los datos alcanzan para responder el objetivo. */
export type Feasibility = 'viable' | 'partial' | 'insufficient'

export type IndicatorFormat = 'number' | 'currency' | 'percent'

export interface ProposedIndicator {
  id: string
  label: string
  description: string
  /** Columnas que se usarían para calcularlo. */
  columns: string[]
}

export type ChartType = 'bar' | 'line' | 'area' | 'histogram' | 'pie'

export interface ProposedChart {
  id: string
  type: ChartType
  title: string
  description: string
  columns: string[]
}

export interface AnalysisProposal {
  id: string
  projectId: string
  version: number
  objective: string
  summary: string
  indicators: ProposedIndicator[]
  charts: ProposedChart[]
  requiredData: string[]
  limitations: string[]
  missingInformation: string[]
  /** Modificaciones pedidas por el usuario sobre versiones anteriores. */
  requestedChanges: string[]
  feasibility: Feasibility
  feasibilityReason: string
  createdAt: string
  isDemo?: boolean
}

export interface ApprovedAnalysisPlan {
  id: string
  projectId: string
  proposalId: string
  proposalVersion: number
  approvedAt: string
  objective: string
  indicators: ProposedIndicator[]
  charts: ProposedChart[]
  limitations: string[]
}

// ---------------------------------------------------------------------------
// Ejecución y resultados (IA 2 + Pandas)
// ---------------------------------------------------------------------------

export type AnalysisRunStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface AnalysisRun {
  id: string
  projectId: string
  status: AnalysisRunStatus
  startedAt: string
  finishedAt: string | null
  error: string | null
}

export interface Indicator {
  id: string
  label: string
  value: number
  format: IndicatorFormat
  /** Variación respecto del período de referencia (0.12 = +12 %). */
  change?: number
  changeLabel?: string
  description: string
}

/** Fila genérica de datos de un gráfico: el frontend no asume columnas fijas. */
export type ChartDatum = Record<string, string | number | null>

export interface ChartSeries {
  key: string
  label: string
  format?: IndicatorFormat
  /** Unidad indicada por el usuario (por ejemplo, "ARS"); se muestra en tooltips y tablas. */
  unit?: string
}

export interface Chart {
  id: string
  type: ChartType
  title: string
  description: string
  /** Clave del eje X (categoría o fecha). */
  xKey: string
  xLabel?: string
  /** Título del eje Y (por ejemplo, la unidad). */
  yLabel?: string
  /** false: se dibuja completo de inmediato (resultados reales; también para imprimir o exportar). */
  animated?: boolean
  series: ChartSeries[]
  data: ChartDatum[]
}

/** Grado en que la evidencia respalda una conclusión. */
export type EvidenceLevel = 'strong' | 'moderate' | 'weak'

export interface Finding {
  id: string
  title: string
  detail: string
  evidence: EvidenceLevel
  relatedChartId?: string
  recommendation?: string
}

/**
 * Estado de los resultados:
 * - `available`: hay resultados.
 * - `pending_backend`: el cálculo real requiere el backend (modo DEMO + archivo propio).
 * - `not_started`: todavía no se ejecutó el análisis.
 */
export type ResultsStatus = 'available' | 'pending_backend' | 'not_started'

export interface AnalysisResults {
  projectId: string
  status: ResultsStatus
  generatedAt: string | null
  isDemo: boolean
  /** Texto que explica de dónde salen los números. */
  sourceNote: string
  indicators: Indicator[]
  charts: Chart[]
  findings: Finding[]
  limitations: string[]
}

// ---------------------------------------------------------------------------
// Informes y exportación
// ---------------------------------------------------------------------------

/**
 * Formatos de exportación:
 * - `pdf`: informe completo con gráficos, conclusiones y fuentes.
 * - `xlsx`: datos procesados, indicadores y tablas de resultados.
 * - `docx`: informe editable con gráficos y análisis.
 * - `canva`: archivo compatible con Canva (PDF o PPTX) para personalizar el diseño.
 */
export type ExportFormat = 'pdf' | 'xlsx' | 'docx' | 'canva'

/** Archivo que se genera para importar en Canva. */
export type CanvaFileType = 'pdf' | 'pptx'

export interface ReportSections {
  objectives: boolean
  indicators: boolean
  charts: boolean
  analysis: boolean
  limitations: boolean
}

export interface ExportRequest {
  format: ExportFormat
  /** Solo se usa cuando format === 'canva'. */
  canvaFileType?: CanvaFileType
  title: string
  author: string
  organization: string
  /** Fecha en formato ISO (YYYY-MM-DD). */
  date: string
  objectives: string
  sections: ReportSections
}

export interface ExportFile {
  fileName: string
  blob: Blob
}

// ---------------------------------------------------------------------------
// Salud del backend
// ---------------------------------------------------------------------------

export interface HealthStatus {
  status: 'ok' | 'error'
  service: string
  version: string
  environment: string
}
