import { useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, CheckCircle2, FlaskConical, Link2, RefreshCw } from 'lucide-react'
import type { Dataset } from '@/types/domain'
import { Dropzone } from '@/components/upload/Dropzone'
import { DatasetPreview } from '@/components/upload/DatasetPreview'
import { QualityPanel } from '@/components/upload/QualityPanel'
import { SourceList, type UploadItem } from '@/components/upload/SourceList'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { useAnalysisSession } from '@/hooks/useAnalysisSession'
import { useService } from '@/hooks/useService'
import { appConfig } from '@/lib/config'
import { buildDatasetCatalog, MAX_SOURCES, MAX_TOTAL_UPLOAD_MB } from '@/lib/datasetCatalog'
import { validateDatasetFile } from '@/lib/fileValidation'
import { getErrorMessage } from '@/services'

const DEMO_DATASET_NAME = 'Dataset de ejemplo (ficticio)'

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
  const keyCounter = useRef(0)
  const nextKey = () => `src_${(keyCounter.current += 1)}`

  // Los archivos ya listos se recuperan de la sesión (por ejemplo, al volver del asistente).
  const [items, setItems] = useState<UploadItem[]>(() =>
    session.sources.map(({ dataset, profile }) => ({
      key: nextKey(),
      name: dataset.source === 'demo' ? DEMO_DATASET_NAME : dataset.fileName,
      size: dataset.source === 'demo' ? -1 : dataset.sizeBytes,
      status: 'ready',
      datasetId: dataset.id,
      profile,
      isDemo: dataset.source === 'demo',
    })),
  )
  const [activeKey, setActiveKey] = useState<string | null>(items[0]?.key ?? null)
  const [notice, setNotice] = useState<string | null>(null)
  const [projectName, setProjectName] = useState(
    session.projectName || (session.dataset ? `Análisis de ${session.dataset.name}` : ''),
  )
  const [nameTouched, setNameTouched] = useState(false)

  const usesBackendProfiling = service.profiling === 'backend'
  const uploading = items.some((i) => i.status === 'uploading')
  const busy = uploading
  const nameError = validateProjectName(projectName)
  const readyItems = items.filter((i) => i.status === 'ready')
  const hasErrors = items.some((i) => i.status === 'error')
  const activeItem = items.find((i) => i.key === activeKey && i.status === 'ready' && i.profile)
  const catalog = useMemo(() => buildDatasetCatalog(session.sources), [session.sources])

  const patch = (key: string, changes: Partial<UploadItem>) =>
    setItems((current) => current.map((i) => (i.key === key ? { ...i, ...changes } : i)))

  const usedBytes = (exceptKey?: string) =>
    items.filter((i) => i.status !== 'error' && i.key !== exceptKey && i.size > 0).reduce((sum, i) => sum + i.size, 0)

  /** Sube y perfila una fuente. Devuelve el dataset y su perfil, o lanza el error. */
  async function profileSource(load: () => Promise<Dataset>) {
    const dataset = await load()
    const profile = await service.getDatasetProfile(dataset.id)
    return { dataset, profile }
  }

  /** Propone un nombre con la primera fuente lista, sin pisar lo que escribió el usuario. */
  function suggestName(dataset: Dataset) {
    if (!nameTouched) setProjectName((current) => current || `Análisis de ${dataset.name}`)
  }

  async function handleFiles(files: File[]) {
    setNotice(null)
    const slots = MAX_SOURCES - items.length
    if (slots <= 0) {
      setNotice(`Un análisis admite hasta ${MAX_SOURCES} archivos. Quitá uno para agregar otro.`)
      return
    }
    if (files.length > slots) {
      setNotice(`Un análisis admite hasta ${MAX_SOURCES} archivos: se tomaron ${slots} y se ignoraron ${files.length - slots}.`)
    }

    let budget = MAX_TOTAL_UPLOAD_MB * 1024 * 1024 - usedBytes()
    const accepted: { key: string; file: File }[] = []
    const added = files.slice(0, slots).map((file): UploadItem => {
      const key = nextKey()
      const base = { key, name: file.name, size: file.size }
      const validation = validateDatasetFile(file, appConfig.maxUploadMb)
      if (!validation.ok) return { ...base, status: 'error', error: validation.error }
      if (items.some((i) => i.status !== 'error' && i.name === file.name && i.size === file.size)) {
        return { ...base, status: 'error', error: 'Este archivo ya forma parte del análisis.' }
      }
      if (file.size > budget) {
        return { ...base, status: 'error', error: `Entre todas las fuentes no pueden superar los ${MAX_TOTAL_UPLOAD_MB} MB.` }
      }
      budget -= file.size
      accepted.push({ key, file })
      return { ...base, status: 'uploading' }
    })
    setItems((current) => [...current, ...added])

    // De a un archivo por vez: limita la memoria usada en el navegador y en el backend.
    for (const { key, file } of accepted) {
      try {
        const { dataset, profile } = await profileSource(() => service.uploadDataset(file))
        session.addSource(dataset, profile)
        suggestName(dataset)
        patch(key, { status: 'ready', datasetId: dataset.id, profile, name: dataset.fileName, size: dataset.sizeBytes })
        setActiveKey(key)
      } catch (err) {
        patch(key, { status: 'error', error: getErrorMessage(err) })
      }
    }
  }

  async function handleDemoDataset() {
    setNotice(null)
    if (items.length >= MAX_SOURCES) {
      setNotice(`Un análisis admite hasta ${MAX_SOURCES} archivos. Quitá uno para agregar otro.`)
      return
    }
    const key = nextKey()
    setItems((current) => [...current, { key, name: DEMO_DATASET_NAME, size: -1, status: 'uploading', isDemo: true }])
    try {
      const { dataset, profile } = await profileSource(() => service.loadDemoDataset())
      session.addSource(dataset, profile)
      suggestName(dataset)
      patch(key, { status: 'ready', datasetId: dataset.id, profile })
      setActiveKey(key)
    } catch (err) {
      patch(key, { status: 'error', error: getErrorMessage(err) })
    }
  }

  async function handleReplace(key: string, file: File) {
    const item = items.find((i) => i.key === key)
    if (!item) return
    setNotice(null)
    const validation = validateDatasetFile(file, appConfig.maxUploadMb)
    const keepsPrevious = item.status === 'ready' ? ' Se conserva el archivo anterior.' : ''
    if (!validation.ok) {
      patch(key, { error: validation.error + keepsPrevious })
      return
    }
    if (file.size > MAX_TOTAL_UPLOAD_MB * 1024 * 1024 - usedBytes(key)) {
      patch(key, { error: `Entre todas las fuentes no pueden superar los ${MAX_TOTAL_UPLOAD_MB} MB.${keepsPrevious}` })
      return
    }

    const previous = { ...item }
    patch(key, { status: 'uploading', error: undefined, name: file.name, size: file.size })
    try {
      const { dataset, profile } = await profileSource(() => service.uploadDataset(file))
      if (previous.status === 'ready' && previous.datasetId) {
        session.replaceSource(previous.datasetId, dataset, profile)
        service.discardDataset(previous.datasetId)
      } else {
        session.addSource(dataset, profile)
      }
      patch(key, { status: 'ready', datasetId: dataset.id, profile, name: dataset.fileName, size: dataset.sizeBytes, isDemo: false })
      setActiveKey(key)
    } catch (err) {
      // Si falla el reemplazo, la fuente anterior sigue intacta.
      patch(key, { ...previous, error: getErrorMessage(err) + keepsPrevious })
    }
  }

  function handleRemove(key: string) {
    const item = items.find((i) => i.key === key)
    if (item?.datasetId && item.status === 'ready') {
      session.removeSource(item.datasetId)
      service.discardDataset(item.datasetId)
    }
    const remaining = items.filter((i) => i.key !== key)
    setItems(remaining)
    setNotice(null)
    if (activeKey === key) setActiveKey(remaining.find((i) => i.status === 'ready')?.key ?? null)
    if (remaining.length === 0) {
      setProjectName('')
      setNameTouched(false)
    }
  }

  function handleResetAll() {
    session.sources.forEach((s) => service.discardDataset(s.dataset.id))
    session.reset()
    setItems([])
    setActiveKey(null)
    setNotice(null)
    setProjectName('')
    setNameTouched(false)
  }

  /** El proyecto se crea recién al confirmar la revisión obligatoria (paso 2). */
  function handleContinue(event: FormEvent) {
    event.preventDefault()
    setNameTouched(true)
    if (!session.dataset || nameError || uploading) return
    session.setProjectName(projectName.trim())
    navigate('/analisis/revisar')
  }

  const showDemoSample = service.mode === 'demo' && !items.some((i) => i.isDemo)

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={<Badge tone="blue">Paso 1 de 4</Badge>}
        title="Cargá tu dataset"
        description={`Subí hasta ${MAX_SOURCES} archivos CSV o Excel con datos en forma de tabla: una fila por registro y una columna por variable. Cada archivo se analiza por separado.`}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          {service.mode === 'demo' && !usesBackendProfiling && (
            <Alert tone="warning" title="No cargues datos confidenciales">
              En la demo pública tus archivos se leen solo en este navegador para la vista previa y no se envían a
              ningún servidor. Aun así, usá datos de prueba o anonimizados.
            </Alert>
          )}

          {service.mode === 'demo' && usesBackendProfiling && (
            <Alert tone="info" title="Perfilado real con el backend local">
              Cada archivo se envía por separado a FastAPI ({appConfig.apiBaseUrl}) para leerlo con Pandas y no se
              guarda. El asistente y los resultados siguen en modo DEMO.
            </Alert>
          )}

          {items.length < MAX_SOURCES && (
            <Dropzone onFiles={(files) => void handleFiles(files)} disabled={busy} maxSizeMb={appConfig.maxUploadMb} maxFiles={MAX_SOURCES} />
          )}

          {showDemoSample && items.length < MAX_SOURCES && (
            <div className="flex flex-col items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 sm:flex-row sm:items-center">
              <FlaskConical className="size-5 shrink-0 text-amber-700" aria-hidden />
              <p className="flex-1 text-sm text-amber-950">
                ¿No tenés un archivo a mano? Probá el recorrido completo con un <strong>dataset ficticio</strong> de ventas.
              </p>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void handleDemoDataset()}>
                Usar dataset de ejemplo
              </Button>
            </div>
          )}

          {notice && <Alert tone="warning">{notice}</Alert>}

          {items.length > 0 && (
            <SourceList
              items={items}
              activeKey={activeItem?.key ?? null}
              busy={busy}
              uploadingText={usesBackendProfiling ? 'Perfilando con Python (Pandas)…' : 'Analizando estructura y calidad…'}
              errorTitle={usesBackendProfiling ? 'El backend no pudo perfilar el archivo' : 'No pudimos usar este archivo'}
              onSelect={setActiveKey}
              onRemove={handleRemove}
              onReplace={(key, file) => void handleReplace(key, file)}
            />
          )}

          {activeItem?.profile && activeItem.profile.origin !== 'backend' && activeItem.name.toLowerCase().endsWith('.xlsx') && (
            <Alert tone="info" title="Vista previa de Excel pendiente">
              El archivo se recibió correctamente, pero la vista previa completa de Excel se habilitará al conectar el
              backend con Pandas. No mostramos columnas que todavía no fueron leídas.
            </Alert>
          )}

          {activeItem?.profile && (
            <>
              {readyItems.length > 1 && <p className="text-xs font-medium text-slate-500">Detalle de «{activeItem.name}»</p>}
              <DatasetPreview profile={activeItem.profile} />
            </>
          )}
        </div>

        <aside className="space-y-4">
          {activeItem?.profile ? (
            <QualityPanel profile={activeItem.profile} />
          ) : (
            <Card className="p-5">
              <h3 className="text-sm font-semibold text-slate-900">Recomendaciones para tus archivos</h3>
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

          {session.sources.length > 1 && (
            <Card className="p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Link2 className="size-4 text-blue-600" aria-hidden /> Fuentes del análisis ({session.sources.length} de {MAX_SOURCES})
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Los archivos se mantienen separados: no se unen, concatenan ni transforman. Cualquier combinación
                requerirá un plan validado y tu aprobación.
              </p>
              {catalog.sharedColumns.length > 0 ? (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-slate-700">Columnas con el mismo nombre (posibles relaciones, no confirmadas)</p>
                  <ul className="mt-1 space-y-1 text-xs text-slate-600">
                    {catalog.sharedColumns.map((c) => (
                      <li key={c.name}>
                        «{c.name}» en fuentes {c.sources.join(', ')}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-3 text-xs text-slate-500">No hay columnas con el mismo nombre entre las fuentes.</p>
              )}
              {catalog.sameColumnSets.length > 0 && (
                <p className="mt-2 text-xs text-slate-600">
                  Misma estructura de columnas: {catalog.sameColumnSets.map(([a, b]) => `${a} y ${b}`).join('; ')} (posible
                  concatenación, a confirmar).
                </p>
              )}
            </Card>
          )}

          {session.sources.length > 0 && (
            <Card className="p-5">
              <form onSubmit={handleContinue} noValidate className="space-y-4">
                <div>
                  <label htmlFor="project-name" className="text-sm font-semibold text-slate-900">
                    Nombre del proyecto
                  </label>
                  <input
                    id="project-name"
                    value={projectName}
                    onChange={(e) => {
                      setProjectName(e.target.value)
                      setNameTouched(true)
                    }}
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
                {hasErrors && (
                  <p className="text-xs text-slate-500">Los archivos con error no se incluirán en el análisis.</p>
                )}
                <Button type="submit" className="w-full" disabled={uploading} iconRight={<ArrowRight className="size-4" />}>
                  Continuar con la revisión
                </Button>
                <Button variant="ghost" className="w-full" icon={<RefreshCw className="size-4" />} disabled={busy} onClick={handleResetAll}>
                  Empezar de nuevo
                </Button>
              </form>
            </Card>
          )}
        </aside>
      </div>
    </div>
  )
}
