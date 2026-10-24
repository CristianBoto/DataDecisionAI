import type {
  AnalysisProposal,
  ColumnProfile,
  Dataset,
  DatasetProfile,
  Feasibility,
  ProposedChart,
  ProposedIndicator,
} from '@/types/domain'
import { isMeasurable } from '@/lib/profileMetrics'

/**
 * ⚠️ SIMULACIÓN DEMO DEL ASISTENTE DE REQUISITOS (IA 1) ⚠️
 *
 * No hay inteligencia artificial acá: es un guion determinista basado en
 * palabras clave y en el perfil del dataset. Sirve para recorrer la interfaz
 * hasta que el backend llame a la API de OpenAI. Nunca inventa columnas: solo
 * usa las que figuran en el perfil recibido.
 */

export type DemoIntent = 'restock' | 'sales' | 'general'

export type DemoStage =
  | 'awaiting_objective'
  | 'awaiting_clarification'
  | 'proposal_ready'
  | 'plan_approved'

export interface DemoConversationState {
  stage: DemoStage
  intent: DemoIntent
  objectiveText: string
  proposalVersion: number
  requestedChanges: string[]
}

export function createInitialState(): DemoConversationState {
  return {
    stage: 'awaiting_objective',
    intent: 'general',
    objectiveText: '',
    proposalVersion: 0,
    requestedChanges: [],
  }
}

/** Normaliza texto para comparar palabras clave sin tildes ni mayúsculas. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

export function detectIntent(text: string): DemoIntent {
  const value = normalize(text)
  if (/(compr|mercader|stock|repon|reponer|inventario|abastec|pedido)/.test(value)) return 'restock'
  if (/(vent|vend|ingres|factur|producto|cliente)/.test(value)) return 'sales'
  return 'general'
}

const STOCK_PATTERN = /(stock|inventario|existencia)/

export function findStockColumn(profile: DatasetProfile): ColumnProfile | undefined {
  return profile.columns.find((c) => STOCK_PATTERN.test(normalize(c.name)))
}

/**
 * Clasifica las columnas del perfil para adaptar la propuesta. Si el backend
 * informó el tipo semántico, se respeta: un código o un año no se suma.
 */
export function classifyColumns(profile: DatasetProfile) {
  const rowCount = profile.rowCount ?? 0
  const numeric = profile.columns.filter(isMeasurable)
  const dates = profile.columns.filter((c) => c.inferredType === 'date' || c.semanticType === 'temporal')
  const categorical = profile.columns.filter((c) =>
    c.semanticType
      ? c.semanticType === 'categorical'
      : c.inferredType === 'text' &&
        c.uniqueCount !== null &&
        c.uniqueCount >= 2 &&
        c.uniqueCount <= Math.max(30, Math.round(rowCount * 0.3)),
  )
  return { numeric, dates, categorical }
}

const quote = (name: string) => `«${name}»`

/** Aclaración para archivos propios: el guion no conoce el rubro de los datos. */
export const UPLOADED_DATA_DISCLAIMER =
  'Soy un asistente DEMO con respuestas guiadas: uso solo los nombres y tipos de tus columnas, ' +
  'sin interpretar el rubro ni sacar conclusiones sobre el contenido.'

// ---------------------------------------------------------------------------
// Mensajes del guion
// ---------------------------------------------------------------------------

export function buildGreeting(dataset: Dataset, profile: DatasetProfile): { content: string; suggestions: string[] } {
  if (dataset.source === 'demo') {
    return {
      content:
        `¡Hola! Soy el asistente de requisitos. Revisé el perfil de «${dataset.name}»: ` +
        `${profile.columnCount} columnas y ${profile.rowCount ?? '—'} filas de ventas ficticias. ` +
        'Contame con tus palabras qué necesitás decidir o entender; no hace falta saber de datos.',
      suggestions: [
        'Quiero saber si debería comprar más mercadería',
        '¿Cómo evolucionaron las ventas este año?',
        'Quiero un resumen general del negocio',
      ],
    }
  }

  if (profile.columnCount === 0) {
    return {
      content:
        `¡Hola! Recibí «${dataset.fileName}», pero en modo DEMO no puedo leer su estructura ` +
        '(la lectura de Excel se habilitará al conectar el backend). Igual podés contarme tu objetivo ' +
        'y te voy a indicar qué haría falta.',
      suggestions: ['Quiero un resumen general de mis datos'],
    }
  }

  const rows =
    profile.rowCount === null
      ? ''
      : ` y ${profile.rowCountIsEstimate ? 'al menos ' : ''}${profile.rowCount} filas`
  const source = profile.origin === 'backend' ? 'el perfil calculado con Pandas' : 'la vista previa'
  return {
    content:
      `¡Hola! Revisé ${source} de «${dataset.fileName}»: ${profile.columnCount} columnas${rows}. ` +
      `${UPLOADED_DATA_DISCLAIMER} Contame qué necesitás analizar o decidir con estos datos.`,
    suggestions: [
      'Quiero un resumen general de mis datos',
      'Quiero comparar grupos o categorías',
      'Quiero ver la evolución en el tiempo',
    ],
  }
}

export interface ScriptedReply {
  content: string
  kind: 'text' | 'question' | 'proposal' | 'notice'
  suggestions?: string[]
  /** true cuando la respuesta trae una propuesta nueva o actualizada. */
  producesProposal: boolean
}

export function replyToObjective(
  text: string,
  dataset: Dataset,
  profile: DatasetProfile,
): { reply: ScriptedReply; intent: DemoIntent } {
  const intent = detectIntent(text)
  const { numeric, dates, categorical } = classifyColumns(profile)

  if (intent === 'restock' && !findStockColumn(profile) && dataset.source !== 'demo' && profile.columnCount > 0) {
    return {
      intent,
      reply: {
        kind: 'question',
        producesProposal: false,
        content:
          'Tu pedido menciona compras, reposición o stock. No encontré una columna de stock o inventario en ' +
          'el archivo, así que no podría recomendar cantidades. ¿Querés continuar con un análisis descriptivo ' +
          'de las columnas disponibles o agregar esa información más adelante?',
        suggestions: ['Continuar con las columnas disponibles', 'Quiero agregar información de stock'],
      },
    }
  }

  if (intent === 'restock' && !findStockColumn(profile) && dataset.source === 'demo') {
    return {
      intent,
      reply: {
        kind: 'question',
        producesProposal: false,
        content:
          'Entiendo que querés analizar las ventas para decidir qué productos reponer. ' +
          'Para recomendar cantidades también necesitaríamos conocer tu stock actual, y el dataset ' +
          'no tiene una columna de stock. ¿Querés continuar con un análisis de ventas o agregar esa información?',
        suggestions: ['Continuar con el análisis de ventas', 'Quiero agregar información de stock'],
      },
    }
  }

  if (dataset.source === 'demo') {
    return {
      intent,
      reply: {
        kind: 'question',
        producesProposal: false,
        content:
          intent === 'sales'
            ? 'Entiendo que querés conocer cómo vienen las ventas. Puedo mostrarte la evolución mensual de «ingreso» y compararla por «categoria», «region» y «canal». ¿Te sirve ese enfoque o preferís concentrarte en alguna de esas dimensiones?'
            : 'Entiendo que buscás una visión general del negocio. Propongo ver ingresos, unidades, evolución mensual y comparaciones por categoría, región y canal. ¿Te parece bien o querés priorizar algo en particular?',
        suggestions: ['Sí, ese enfoque me sirve', 'Prefiero concentrarme en las categorías'],
      },
    }
  }

  if (profile.columnCount === 0) {
    return {
      intent,
      reply: {
        kind: 'notice',
        producesProposal: true,
        content:
          'Anoté tu objetivo. Sin el backend no puedo leer las columnas del Excel, así que la propuesta ' +
          'queda como «insuficiente» hasta que el archivo pueda procesarse. Podés probar con un CSV o con el dataset de ejemplo.',
      },
    }
  }

  const dims: string[] = []
  if (dates.length > 0) dims.push(`la evolución en el tiempo según ${quote(dates[0].name)}`)
  if (categorical.length > 0) {
    dims.push(`comparaciones por ${categorical.slice(0, 3).map((c) => quote(c.name)).join(', ')}`)
  }
  const measures =
    numeric.length > 0
      ? `Las columnas numéricas que encontré son ${numeric.slice(0, 4).map((c) => quote(c.name)).join(', ')}.`
      : 'No encontré columnas numéricas, así que el análisis se limitaría a conteos.'

  return {
    intent,
    reply: {
      kind: 'question',
      producesProposal: false,
      content:
        `Entiendo tu objetivo. ${measures} ` +
        (dims.length > 0
          ? `Puedo incluir ${dims.join(' y ')}. ¿Te sirve ese enfoque?`
          : '¿Hay alguna columna que te interese especialmente?'),
      suggestions: ['Sí, ese enfoque me sirve', 'Quiero priorizar otra columna'],
    },
  }
}

export function replyToClarification(text: string, intent: DemoIntent, isDemoDataset = true): ScriptedReply {
  const wantsToAddStock = intent === 'restock' && /(agreg|sum|stock|inventario)/.test(normalize(text)) && !/continu/.test(normalize(text))
  if (wantsToAddStock) {
    return {
      kind: 'proposal',
      producesProposal: true,
      content:
        'Perfecto. En esta versión DEMO todavía no se pueden sumar archivos a un proyecto; cuando el backend ' +
        'esté conectado vas a poder cargar tu inventario. Por ahora preparé la propuesta con ' +
        (isDemoDataset ? 'las ventas' : 'las columnas disponibles') +
        ' y dejé el stock como información faltante. Revisala y aprobala si estás de acuerdo.',
    }
  }
  return {
    kind: 'proposal',
    producesProposal: true,
    content:
      'Listo. Preparé una propuesta de análisis con lo que hablamos. Revisala: si estás de acuerdo, ' +
      'aprobala para continuar; si no, contame qué cambiarías.',
  }
}

export function replyToModification(text: string, version: number): ScriptedReply {
  return {
    kind: 'proposal',
    producesProposal: true,
    content:
      `Registré tu pedido: «${text.trim()}». Generé la versión ${version} de la propuesta con ese ajuste ` +
      'marcado como pendiente. En modo DEMO no puedo reinterpretarlo automáticamente; la IA real lo ' +
      'incorporará al plan cuando se conecte el backend.',
  }
}

export function replyAfterApproval(dataset: Dataset): ScriptedReply {
  return {
    kind: 'notice',
    producesProposal: false,
    content:
      dataset.source === 'demo'
        ? 'Respuesta simulada: en la versión conectada, el analista (IA 2) responderá preguntas sobre los resultados calculando con Pandas. Por ahora podés revisar los hallazgos del panel, que también son ficticios.'
        : 'Respuesta simulada: el plan ya está aprobado. Las preguntas sobre resultados de tu archivo se responderán cuando el backend ejecute el análisis.',
  }
}

// ---------------------------------------------------------------------------
// Construcción de la propuesta
// ---------------------------------------------------------------------------

interface ProposalInput {
  projectId: string
  dataset: Dataset
  profile: DatasetProfile
  intent: DemoIntent
  objectiveText: string
  version: number
  requestedChanges: string[]
  proposalId: string
}

function demoDatasetProposal(intent: DemoIntent) {
  const indicators: ProposedIndicator[] = [
    { id: 'kpi_ingresos_totales', label: 'Ingresos totales', description: 'Suma de ingresos del período y variación entre semestres.', columns: ['ingreso'] },
    { id: 'kpi_unidades', label: 'Unidades vendidas', description: 'Suma de unidades vendidas.', columns: ['unidades'] },
    { id: 'kpi_ticket_promedio', label: 'Ingreso promedio por venta', description: 'Promedio de ingreso por registro.', columns: ['ingreso'] },
    { id: 'kpi_participacion_online', label: 'Participación online', description: 'Porcentaje de unidades vendidas por canal online.', columns: ['canal', 'unidades'] },
  ]
  const charts: ProposedChart[] = [
    { id: 'chart_ingresos_mensuales', type: 'line', title: 'Ingresos mensuales', description: 'Tendencia a lo largo del año.', columns: ['fecha', 'ingreso'] },
    { id: 'chart_ingresos_categoria', type: 'bar', title: 'Ingresos por categoría', description: 'Qué categorías venden más.', columns: ['categoria', 'ingreso'] },
    { id: 'chart_unidades_canal', type: 'area', title: 'Unidades por canal', description: 'Comparación local vs. online por mes.', columns: ['fecha', 'canal', 'unidades'] },
    { id: 'chart_distribucion_ticket', type: 'histogram', title: 'Distribución del ingreso por venta', description: 'Cómo se reparten los montos de cada venta.', columns: ['ingreso'] },
    { id: 'chart_ingresos_region', type: 'bar', title: 'Ingresos por región', description: 'Comparación entre regiones.', columns: ['region', 'ingreso'] },
  ]

  if (intent === 'restock') {
    return {
      objective: 'Identificar qué productos y categorías conviene reponer según la evolución de las ventas.',
      summary:
        'Analizaremos la demanda mensual y por categoría para detectar qué se vende más y cuándo. ' +
        'Sin datos de stock, la recomendación indicará prioridades de reposición, no cantidades.',
      indicators: indicators.slice(0, 3),
      charts: charts.slice(0, 4),
      requiredData: ['fecha', 'producto', 'categoria', 'unidades', 'ingreso'],
      missingInformation: ['Stock actual por producto', 'Tiempos de reposición de proveedores'],
      limitations: ['Sin stock no es posible recomendar cantidades exactas de compra.', 'Un solo año de datos: la estacionalidad no puede confirmarse.'],
      feasibility: 'partial' as Feasibility,
      feasibilityReason: 'Los datos permiten analizar la demanda, pero falta el stock para recomendar cantidades.',
    }
  }

  return {
    objective:
      intent === 'sales'
        ? 'Entender cómo evolucionaron las ventas y qué categorías, regiones y canales las explican.'
        : 'Obtener una visión general del desempeño comercial del negocio.',
    summary:
      'Calcularemos los indicadores principales de ventas, su evolución mensual y comparaciones por ' +
      'categoría, región y canal, señalando qué tan sólida es la evidencia de cada conclusión.',
    indicators,
    charts,
    requiredData: ['fecha', 'categoria', 'region', 'canal', 'unidades', 'ingreso'],
    missingInformation: [],
    limitations: ['Un solo año de datos: la estacionalidad no puede confirmarse.', 'No hay costos: no se pueden calcular márgenes.'],
    feasibility: 'viable' as Feasibility,
    feasibilityReason: 'El dataset tiene fechas, montos y dimensiones suficientes para el objetivo.',
  }
}

function uploadedDatasetProposal(profile: DatasetProfile, intent: DemoIntent) {
  if (profile.columnCount === 0) {
    return {
      objective: 'Objetivo registrado; pendiente de leer la estructura del archivo.',
      summary: 'No es posible proponer indicadores ni gráficos sin conocer las columnas del archivo.',
      indicators: [],
      charts: [],
      requiredData: ['Estructura de columnas del archivo (requiere backend)'],
      missingInformation: ['Columnas y tipos de datos del Excel'],
      limitations: ['La lectura de archivos Excel se habilitará al conectar el backend con Pandas.'],
      feasibility: 'insufficient' as Feasibility,
      feasibilityReason: 'Todavía no se conoce el contenido del archivo.',
    }
  }

  const { numeric, dates, categorical } = classifyColumns(profile)
  const indicators: ProposedIndicator[] = [
    { id: 'kpi_registros', label: 'Cantidad de registros', description: 'Total de filas válidas del dataset.', columns: [] },
    ...numeric.slice(0, 3).map((c) => ({
      id: `kpi_${c.name}`,
      label: `Total y promedio de ${quote(c.name)}`,
      description: `Suma, promedio y rango de ${quote(c.name)}.`,
      columns: [c.name],
    })),
  ]

  const charts: ProposedChart[] = []
  const mainMeasure = numeric[0]
  if (dates[0] && mainMeasure) {
    charts.push({ id: 'chart_evolucion', type: 'line', title: `Evolución de ${quote(mainMeasure.name)}`, description: `Agrupado por ${quote(dates[0].name)}.`, columns: [dates[0].name, mainMeasure.name] })
  }
  categorical.slice(0, 2).forEach((cat) => {
    charts.push(
      mainMeasure
        ? { id: `chart_${cat.name}`, type: 'bar', title: `${quote(mainMeasure.name)} por ${quote(cat.name)}`, description: 'Comparación entre grupos.', columns: [cat.name, mainMeasure.name] }
        : { id: `chart_${cat.name}`, type: 'bar', title: `Registros por ${quote(cat.name)}`, description: 'Conteo de filas por grupo.', columns: [cat.name] },
    )
  })
  if (mainMeasure) {
    charts.push({ id: 'chart_distribucion', type: 'histogram', title: `Distribución de ${quote(mainMeasure.name)}`, description: 'Frecuencia de valores por rangos.', columns: [mainMeasure.name] })
  }

  const missingInformation: string[] = []
  const limitations: string[] = [
    'En modo DEMO no se ejecutan cálculos sobre tu archivo: los resultados reales requieren el backend con Pandas.',
    'Propuesta genérica: el asistente DEMO no interpreta el rubro ni el significado de tus columnas.',
  ]
  if (profile.rowCountIsEstimate) limitations.push('La vista previa se calculó sobre una muestra del archivo.')
  if (dates.length === 0) limitations.push('No se detectaron columnas de fecha: no se podrán analizar tendencias temporales.')
  if (intent === 'restock' && !findStockColumn(profile)) {
    missingInformation.push('Stock o inventario actual (necesario para decidir compras o reposición)')
    limitations.push('Sin stock no es posible recomendar cantidades de compra.')
  }

  let feasibility: Feasibility
  let feasibilityReason: string
  if (numeric.length === 0 && categorical.length === 0) {
    feasibility = 'insufficient'
    feasibilityReason = 'No se detectaron columnas numéricas ni categóricas útiles para el análisis.'
  } else if (numeric.length === 0 || missingInformation.length > 0 || (dates.length === 0 && categorical.length === 0)) {
    feasibility = 'partial'
    feasibilityReason =
      missingInformation.length > 0
        ? 'Falta información necesaria para responder el objetivo completo.'
        : 'Los datos permiten un análisis descriptivo limitado.'
  } else {
    feasibility = 'viable'
    feasibilityReason = 'El dataset tiene medidas numéricas y dimensiones para compararlas.'
  }

  return {
    objective: 'Responder el objetivo planteado con las columnas disponibles en el archivo.',
    summary: `Usaremos ${profile.columnCount} columnas detectadas en ${profile.origin === 'backend' ? 'el perfil de Pandas' : 'la vista previa'} para calcular indicadores descriptivos y comparaciones.`,
    indicators,
    charts,
    requiredData: [...new Set(charts.flatMap((c) => c.columns).concat(indicators.flatMap((i) => i.columns)))],
    missingInformation,
    limitations,
    feasibility,
    feasibilityReason,
  }
}

export function buildProposal(input: ProposalInput): AnalysisProposal {
  const base =
    input.dataset.source === 'demo'
      ? demoDatasetProposal(input.intent)
      : uploadedDatasetProposal(input.profile, input.intent)

  return {
    id: input.proposalId,
    projectId: input.projectId,
    version: input.version,
    ...base,
    objective: input.objectiveText
      ? `${base.objective} (Pedido original: «${input.objectiveText.trim()}»)`
      : base.objective,
    requestedChanges: [...input.requestedChanges],
    createdAt: new Date().toISOString(),
    isDemo: true,
  }
}
