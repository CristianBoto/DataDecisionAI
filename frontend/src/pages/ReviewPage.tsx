import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, ClipboardList } from 'lucide-react'
import { AIContextReview } from '@/components/ai/AIContextReview'
import { ColumnInterpretationReview } from '@/components/review/ColumnInterpretationReview'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button, LinkButton } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/Feedback'
import { PageHeader } from '@/components/ui/PageHeader'
import type { AnalysisReviewState } from '@/context/sessionContext'
import { useAnalysisSession } from '@/hooks/useAnalysisSession'
import { useAIGateway, useService } from '@/hooks/useService'
import { buildAIContext, defaultReview } from '@/lib/aiContext'
import { buildDatasetCatalog } from '@/lib/datasetCatalog'
import { getErrorMessage } from '@/services'

/**
 * Paso 2 (obligatorio): revisar datos y privacidad antes de conversar.
 * Se aceptan las sugerencias por defecto y se corrige solo lo necesario.
 * Las decisiones quedan en la sesión del análisis; los datos no se modifican.
 */
export function ReviewPage() {
  const navigate = useNavigate()
  const service = useService()
  const aiGateway = useAIGateway()
  const session = useAnalysisSession()
  const { sources } = session
  const catalog = useMemo(() => buildDatasetCatalog(sources), [sources])

  const review: AnalysisReviewState = session.review ?? { objective: '', sources: defaultReview(catalog) }
  const [projectName, setProjectName] = useState(
    session.projectName || (session.dataset ? `Análisis de ${session.dataset.name}` : ''),
  )
  const [attempted, setAttempted] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (sources.length === 0) {
    return (
      <EmptyState
        icon={<ClipboardList className="size-6" />}
        title="Primero cargá tus datos"
        description="La revisión necesita al menos una fuente perfilada."
        action={
          <Link to="/analisis/cargar">
            <Button>Ir a cargar datos</Button>
          </Link>
        }
      />
    )
  }

  const save = (changes: Partial<AnalysisReviewState>) => session.setReview({ ...review, ...changes })
  const payload = buildAIContext(catalog, review.objective, review.sources)
  const columnDecisions = review.sources.flatMap((s) => Object.values(s.columns))
  const corrections = columnDecisions.filter((d) => d.format || d.semanticType).length
  const pendingMarkers = columnDecisions.filter((d) => d.markers === 'pending').length
  const sharedColumns = payload.sources.reduce((sum, s) => sum + s.columns.length, 0)

  const problems: string[] = []
  if (review.objective.trim().length < 3) problems.push('Escribí qué necesitás analizar.')
  if (projectName.trim().length < 3) problems.push('El nombre del proyecto debe tener al menos 3 caracteres.')

  // Sin cambios desde la última confirmación: se vuelve a la misma conversación.
  const alreadyConfirmed = session.reviewConfirmed && session.projectId !== null

  async function handleConfirm() {
    setAttempted(true)
    if (problems.length > 0 || !session.dataset) return
    if (alreadyConfirmed) {
      navigate('/analisis/asistente')
      return
    }
    setConfirming(true)
    setError(null)
    try {
      session.setReview(review)
      session.confirmReview()
      session.setProjectName(projectName.trim())
      const project = await service.createProject({
        name: projectName.trim(),
        datasetId: session.dataset.id,
        datasetIds: sources.map((s) => s.dataset.id),
      })
      session.setProjectId(project.id)
      navigate('/analisis/asistente', { state: { fromReview: true } })
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={<Badge tone="blue">Paso 2 de 4</Badge>}
        title="Revisá tus datos y la privacidad"
        description="Confirmá cómo se interpretan tus columnas y qué información mínima se compartiría con la IA. Por defecto se aceptan las sugerencias: corregí solo lo que haga falta."
        actions={
          <LinkButton to="/analisis/cargar" icon={<ArrowLeft className="size-4" />}>
            Volver a cargar datos
          </LinkButton>
        }
      />

      {alreadyConfirmed && (
        <Alert tone="warning" title="Esta revisión ya está confirmada">
          Podés volver al asistente sin cambios. Si modificás algo, tendrás que confirmar la revisión otra vez y la
          conversación empezará de nuevo con las decisiones actualizadas.
        </Alert>
      )}

      <Alert tone="info" title="Nada se modifica ni se envía en este paso">
        Las correcciones y decisiones se guardan para el análisis; tus archivos originales quedan intactos y los
        marcadores como «NA» no se eliminan. No hay ninguna transmisión automática a OpenAI.
      </Alert>

      {sources.map((source, index) => (
        <ColumnInterpretationReview
          key={source.dataset.id}
          alias={catalog.sources[index].alias}
          source={source}
          review={review.sources[index]}
          onChange={(updated) => save({ sources: review.sources.map((s, i) => (i === index ? updated : s)) })}
        />
      ))}

      <AIContextReview
        embedded
        sources={sources}
        gateway={aiGateway}
        objective={review.objective}
        onObjectiveChange={(objective) => save({ objective })}
        review={review.sources}
        onReviewChange={(updated) => save({ sources: updated })}
        objectiveLabel="¿Qué necesitás analizar?"
      />

      <Card className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <label htmlFor="project-name" className="text-sm font-semibold text-slate-900">
              Nombre del proyecto
            </label>
            <input
              id="project-name"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              maxLength={100}
              className="mt-1.5 block h-10 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100 focus:outline-none"
            />
          </div>
          <Button onClick={() => void handleConfirm()} loading={confirming} iconRight={<ArrowRight className="size-4" />}>
            {alreadyConfirmed ? 'Continuar con el asistente' : 'Confirmar revisión y continuar'}
          </Button>
        </div>
        <p className="text-xs text-slate-500" data-testid="review-summary">
          {sources.length} {sources.length === 1 ? 'fuente' : 'fuentes'} · {corrections}{' '}
          {corrections === 1 ? 'columna corregida' : 'columnas corregidas'} · {sharedColumns} columnas para la IA ·{' '}
          {pendingMarkers} {pendingMarkers === 1 ? 'columna' : 'columnas'} con marcadores por decidir
        </p>
        {sharedColumns === 0 && (
          <Alert tone="warning">No elegiste columnas para la IA: el asistente solo conocerá tu objetivo.</Alert>
        )}
        {attempted && problems.length > 0 && (
          <Alert tone="error" title="Falta completar la revisión">
            {problems.join(' ')}
          </Alert>
        )}
        {error && <Alert tone="error">{error}</Alert>}
        <p className="text-xs text-slate-400">
          Confirmar no autoriza ningún envío: en la conversación, cada mensaje para la IA real requerirá su propia
          autorización. Con la IA deshabilitada continuás con el asistente DEMO, sin transmisión a OpenAI.
        </p>
      </Card>
    </div>
  )
}
