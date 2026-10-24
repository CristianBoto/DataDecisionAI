import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, CheckCircle2, FileSpreadsheet, FlaskConical, Loader2, RefreshCw, XCircle } from 'lucide-react'
import type { Dataset } from '@/types/domain'
import { Dropzone } from '@/components/upload/Dropzone'
import { DatasetPreview } from '@/components/upload/DatasetPreview'
import { QualityPanel } from '@/components/upload/QualityPanel'
import { Alert } from '@/components/ui/Alert'
import { Badge, DemoBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { useAnalysisSession } from '@/hooks/useAnalysisSession'
import { useService } from '@/hooks/useService'
import { appConfig } from '@/lib/config'
import { validateDatasetFile } from '@/lib/fileValidation'
import { formatBytes } from '@/lib/format'
import { getErrorMessage } from '@/services'

type UploadStatus = 'idle' | 'uploading' | 'profiling' | 'ready' | 'error'

interface SelectedFile {
  name: string
  size: number
}

const STATUS_TEXT: Record<Exclude<UploadStatus, 'idle'>, string> = {
  uploading: 'Cargando archivo…',
  profiling: 'Analizando estructura y calidad…',
  ready: 'Listo para continuar',
  error: 'No se pudo cargar',
}

function validateProjectName(name: string): string | null {
  const value = name.trim()
  if (value.length < 3) return 'El nombre debe tener al menos 3 caracteres.'
  if (value.length > 80) return 'El nombre no puede superar los 80 caracteres.'
  return null
}

export function UploadPage() {
  const navigate = useNavigate()
  const service = useService()
  const session = useAnalysisSession()

  const [status, setStatus] = useState<UploadStatus>(session.dataset ? 'ready' : 'idle')
  const [selected, setSelected] = useState<SelectedFile | null>(
    session.dataset ? { name: session.dataset.fileName, size: session.dataset.sizeBytes } : null,
  )
  const [error, setError] = useState<string | null>(null)
  const [projectName, setProjectName] = useState(session.dataset ? `Análisis de ${session.dataset.name}` : '')
  const [nameTouched, setNameTouched] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const busy = status === 'uploading' || status === 'profiling' || creating
  const nameError = validateProjectName(projectName)

  async function ingest(load: () => Promise<Dataset>, file: SelectedFile | null) {
    setError(null)
    setCreateError(null)
    setSelected(file)
    setStatus('uploading')
    try {
      const dataset = await load()
      setSelected({ name: dataset.fileName, size: dataset.sizeBytes })
      setStatus('profiling')
      const profile = await service.getDatasetProfile(dataset.id)
      session.setDataset(dataset, profile)
      setProjectName(`Análisis de ${dataset.name}`)
      setNameTouched(false)
      setStatus('ready')
    } catch (err) {
      setError(getErrorMessage(err))
      setStatus('error')
    }
  }

  function handleFile(file: File) {
    const validation = validateDatasetFile(file, appConfig.maxUploadMb)
    if (!validation.ok) {
      setSelected({ name: file.name, size: file.size })
      setError(validation.error)
      setStatus('error')
      return
    }
    void ingest(() => service.uploadDataset(file), { name: file.name, size: file.size })
  }

  async function handleContinue(event: FormEvent) {
    event.preventDefault()
    setNameTouched(true)
    if (!session.dataset || nameError) return
    setCreating(true)
    setCreateError(null)
    try {
      const project = await service.createProject({ name: projectName.trim(), datasetId: session.dataset.id })
      session.setProjectId(project.id)
      navigate('/analisis/asistente')
    } catch (err) {
      setCreateError(getErrorMessage(err))
    } finally {
      setCreating(false)
    }
  }

  const profile = status === 'ready' ? session.profile : null
  const dataset = status === 'ready' ? session.dataset : null

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={<Badge tone="blue">Paso 1 de 3</Badge>}
        title="Cargá tu dataset"
        description="Subí un archivo CSV o Excel con tus datos en forma de tabla: una fila por registro y una columna por variable."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          {service.mode === 'demo' && (
            <Alert tone="warning" title="No cargues datos confidenciales">
              En la demo pública tu archivo se lee solo en este navegador para la vista previa y no se envía a ningún
              servidor. Aun así, usá datos de prueba o anonimizados.
            </Alert>
          )}

          <Dropzone onFile={handleFile} disabled={busy} maxSizeMb={appConfig.maxUploadMb} />

          {service.mode === 'demo' && (
            <div className="flex flex-col items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 sm:flex-row sm:items-center">
              <FlaskConical className="size-5 shrink-0 text-amber-700" aria-hidden />
              <p className="flex-1 text-sm text-amber-950">
                ¿No tenés un archivo a mano? Probá el recorrido completo con un <strong>dataset ficticio</strong> de ventas.
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void ingest(() => service.loadDemoDataset(), { name: 'Dataset de ejemplo (ficticio)', size: -1 })}
              >
                Usar dataset de ejemplo
              </Button>
            </div>
          )}

          {selected && status !== 'idle' && (
            <Card className="flex items-center gap-4 p-4" aria-live="polite">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                <FileSpreadsheet className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm font-semibold text-slate-900">
                  <span className="truncate">{selected.name}</span>
                  {dataset?.source === 'demo' && <DemoBadge label="FICTICIO" />}
                </p>
                <p className="text-xs text-slate-500">
                  {formatBytes(selected.size)} · {STATUS_TEXT[status]}
                </p>
                {(status === 'uploading' || status === 'profiling') && (
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400 transition-all duration-700 ${status === 'uploading' ? 'w-1/3' : 'w-3/4'}`} />
                  </div>
                )}
              </div>
              {status === 'ready' && <CheckCircle2 className="size-5 shrink-0 text-emerald-600" aria-label="Archivo listo" />}
              {status === 'error' && <XCircle className="size-5 shrink-0 text-red-600" aria-label="Error" />}
              {(status === 'uploading' || status === 'profiling') && <Loader2 className="size-5 shrink-0 animate-spin text-blue-600" aria-hidden />}
            </Card>
          )}

          {error && (
            <Alert tone="error" title="No pudimos usar este archivo">
              {error}
            </Alert>
          )}

          {dataset?.format === 'xlsx' && (
            <Alert tone="info" title="Vista previa de Excel pendiente">
              El archivo se recibió correctamente, pero la vista previa completa de Excel se habilitará al conectar el
              backend con Pandas. No mostramos columnas que todavía no fueron leídas.
            </Alert>
          )}

          {profile && <DatasetPreview profile={profile} />}
        </div>

        <aside className="space-y-4">
          {profile ? (
            <QualityPanel profile={profile} />
          ) : (
            <Card className="p-5">
              <h3 className="text-sm font-semibold text-slate-900">Recomendaciones para tu archivo</h3>
              <ul className="mt-3 space-y-2 text-sm text-slate-600">
                {[
                  'La primera fila debe tener los nombres de las columnas.',
                  'Evitá celdas combinadas, totales o títulos dentro de la tabla.',
                  'Usá un formato consistente para fechas y números.',
                  'Los PDF no se aceptan: exportá la tabla como CSV o Excel.',
                ].map((tip) => (
                  <li key={tip} className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-blue-600" aria-hidden />
                    {tip}
                  </li>
                ))}
              </ul>
              <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
                Esta validación es preliminar. El backend hará la validación definitiva del contenido.
              </p>
            </Card>
          )}

          {status === 'ready' && session.dataset && (
            <Card className="p-5">
              <form onSubmit={handleContinue} noValidate className="space-y-4">
                <div>
                  <label htmlFor="project-name" className="text-sm font-semibold text-slate-900">
                    Nombre del proyecto
                  </label>
                  <input
                    id="project-name"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    onBlur={() => setNameTouched(true)}
                    maxLength={100}
                    aria-invalid={(nameTouched && !!nameError) || undefined}
                    aria-describedby="project-name-help"
                    className="mt-1.5 block h-10 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100 focus:outline-none aria-invalid:border-red-400"
                  />
                  <p id="project-name-help" className={`mt-1 text-xs ${nameTouched && nameError ? 'text-red-600' : 'text-slate-400'}`}>
                    {nameTouched && nameError ? nameError : 'Te ayuda a identificar el análisis en el workspace.'}
                  </p>
                </div>
                {createError && <Alert tone="error">{createError}</Alert>}
                <Button type="submit" className="w-full" loading={creating} iconRight={<ArrowRight className="size-4" />}>
                  Continuar con el asistente
                </Button>
                <Button
                  variant="ghost"
                  className="w-full"
                  icon={<RefreshCw className="size-4" />}
                  disabled={busy}
                  onClick={() => {
                    session.reset()
                    setSelected(null)
                    setStatus('idle')
                    setProjectName('')
                  }}
                >
                  Cambiar archivo
                </Button>
              </form>
            </Card>
          )}
        </aside>
      </div>
    </div>
  )
}
