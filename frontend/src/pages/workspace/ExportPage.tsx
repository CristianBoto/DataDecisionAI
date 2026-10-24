import { useState, type FormEvent, type ReactNode } from 'react'
import {
  Check,
  FileDown,
  FileSpreadsheet,
  FileText,
  FileType2,
  Info,
  Palette,
  ServerCog,
} from 'lucide-react'
import type { CanvaFileType, ExportFormat, ReportSections } from '@/types/domain'
import { Alert } from '@/components/ui/Alert'
import { Badge, DemoBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { useService } from '@/hooks/useService'
import { useWorkspace } from '@/hooks/useWorkspace'
import { cn } from '@/lib/cn'
import { CANVA_FILE_TYPES, EXPORT_FORMATS, getExportExtension, getExportOption } from '@/lib/exportFormats'
import { todayIso } from '@/lib/format'
import { getErrorMessage, isBackendRequiredError } from '@/services'

const FORMAT_ICONS: Record<ExportFormat, ReactNode> = {
  pdf: <FileText className="size-5" aria-hidden />,
  xlsx: <FileSpreadsheet className="size-5" aria-hidden />,
  docx: <FileType2 className="size-5" aria-hidden />,
  canva: <Palette className="size-5" aria-hidden />,
}

const SECTION_LABELS: Record<keyof ReportSections, string> = {
  objectives: 'Objetivos',
  indicators: 'Indicadores',
  charts: 'Gráficos',
  analysis: 'Análisis y hallazgos',
  limitations: 'Limitaciones y fuentes de datos',
}

interface FormState {
  title: string
  author: string
  organization: string
  date: string
  objectives: string
}

type FormErrors = Partial<Record<keyof FormState, string>>

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {}
  if (form.title.trim().length < 3) errors.title = 'Ingresá un título de al menos 3 caracteres.'
  if (form.title.length > 120) errors.title = 'El título no puede superar los 120 caracteres.'
  if (form.author.trim().length < 2) errors.author = 'Ingresá el nombre del autor.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) errors.date = 'Ingresá una fecha válida.'
  if (form.objectives.length > 1500) errors.objectives = 'Máximo 1500 caracteres.'
  return errors
}

type ExportStatus =
  | { kind: 'idle' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'done'; fileName: string }

function Field({ id, label, error, optional, children }: { id: string; label: string; error?: string; optional?: boolean; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
        {label}
        {optional && <span className="font-normal text-slate-400">(opcional)</span>}
      </label>
      <div className="mt-1.5">{children}</div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

const inputClass =
  'block w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100 focus:outline-none aria-invalid:border-red-400'

export function ExportPage() {
  const service = useService()
  const { project, results } = useWorkspace()
  const [format, setFormat] = useState<ExportFormat>('pdf')
  const [canvaFileType, setCanvaFileType] = useState<CanvaFileType>('pptx')
  const [form, setForm] = useState<FormState>({
    title: `Informe — ${project.name}`,
    author: '',
    organization: '',
    date: todayIso(),
    objectives: project.approvedPlan?.objective ?? '',
  })
  const [sections, setSections] = useState<ReportSections>({
    objectives: true,
    indicators: true,
    charts: true,
    analysis: true,
    limitations: true,
  })
  const [submitted, setSubmitted] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [status, setStatus] = useState<ExportStatus>({ kind: 'idle' })

  const errors = validate(form)
  const shownErrors = submitted ? errors : {}
  const noSections = !Object.values(sections).some(Boolean)
  const option = getExportOption(format)
  const extension = getExportExtension({ format, canvaFileType })
  const resultsAvailable = results.status === 'success' && results.data.status === 'available'

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function handleExport(event: FormEvent) {
    event.preventDefault()
    setSubmitted(true)
    setStatus({ kind: 'idle' })
    if (Object.keys(errors).length > 0 || noSections) return

    setExporting(true)
    try {
      const file = await service.exportAnalysis(project.id, {
        format,
        canvaFileType: format === 'canva' ? canvaFileType : undefined,
        title: form.title.trim(),
        author: form.author.trim(),
        organization: form.organization.trim(),
        date: form.date,
        objectives: form.objectives.trim(),
        sections,
      })
      // Descarga real: solo ocurre cuando el backend devuelve un archivo.
      const url = URL.createObjectURL(file.blob)
      const link = document.createElement('a')
      link.href = url
      link.download = file.fileName
      link.click()
      URL.revokeObjectURL(url)
      setStatus({ kind: 'done', fileName: file.fileName })
    } catch (err) {
      setStatus(
        isBackendRequiredError(err)
          ? { kind: 'unavailable', message: err.message }
          : { kind: 'error', message: getErrorMessage(err) },
      )
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow={<Badge tone="amber" icon={<ServerCog className="size-3" aria-hidden />}>Requiere integración con backend</Badge>}
        title="Exportar análisis"
        description="Elegí el formato, completá los datos del informe y exportá. La generación de archivos se implementará en el backend con Python."
      />

      <Alert tone="info" title="Función en preparación">
        La interfaz y la estructura de servicios ya están listas. Hoy ningún formato genera archivos: al exportar vas a
        ver un aviso, nunca una descarga simulada.
      </Alert>

      <form onSubmit={handleExport} noValidate className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          {/* Selección de formato */}
          <Card>
            <CardHeader icon={<FileDown className="size-4" aria-hidden />} title="Formato de exportación" description="Cada formato está pensado para un uso distinto." />
            <div role="radiogroup" aria-label="Formato de exportación" className="grid gap-3 p-5 sm:grid-cols-2">
              {EXPORT_FORMATS.map((o) => {
                const selected = o.format === format
                return (
                  <button
                    key={o.format}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setFormat(o.format)}
                    className={cn(
                      'relative flex flex-col rounded-xl border p-4 text-left transition',
                      selected ? 'border-blue-500 bg-blue-50/50 ring-4 ring-blue-100' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className={cn('flex size-10 items-center justify-center rounded-xl', selected ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600')}>
                        {FORMAT_ICONS[o.format]}
                      </span>
                      <Badge tone="neutral">No disponible aún</Badge>
                    </div>
                    <p className="mt-3 text-sm font-semibold text-slate-900">
                      {o.label} <span className="font-normal text-slate-400">{o.extensionLabel}</span>
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{o.description}</p>
                    <ul className="mt-3 flex flex-wrap gap-1.5">
                      {o.contents.map((c) => (
                        <li key={c} className="rounded-md bg-white px-1.5 py-0.5 text-[11px] text-slate-600 ring-1 ring-slate-200">{c}</li>
                      ))}
                    </ul>
                    {selected && (
                      <span className="absolute top-3 left-3 flex size-4 items-center justify-center rounded-full bg-blue-600 text-white" aria-hidden>
                        <Check className="size-3" />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            {format === 'canva' && (
              <div className="mx-5 mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold text-slate-700">Archivo para importar en Canva</p>
                <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Tipo de archivo para Canva">
                  {CANVA_FILE_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      role="radio"
                      aria-checked={canvaFileType === t.value}
                      onClick={() => setCanvaFileType(t.value)}
                      className={cn(
                        'rounded-lg border px-3 py-1.5 text-xs font-medium transition',
                        canvaFileType === t.value ? 'border-blue-500 bg-white text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <p className="mt-2 flex gap-1.5 text-[11px] leading-relaxed text-slate-500">
                  <Info className="mt-px size-3 shrink-0" aria-hidden />
                  Se generará un archivo que luego podés subir a Canva. No hay conexión directa con tu cuenta de Canva.
                </p>
              </div>
            )}
          </Card>

          {/* Datos del informe */}
          <Card>
            <CardHeader icon={<FileText className="size-4" aria-hidden />} title="Datos del informe" />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field id="report-title" label="Título" error={shownErrors.title}>
                  <input id="report-title" className={cn(inputClass, 'h-10')} value={form.title} maxLength={140} aria-invalid={!!shownErrors.title || undefined} onChange={(e) => update('title', e.target.value)} />
                </Field>
              </div>
              <Field id="report-author" label="Autor" error={shownErrors.author}>
                <input id="report-author" className={cn(inputClass, 'h-10')} value={form.author} maxLength={100} placeholder="Nombre y apellido" aria-invalid={!!shownErrors.author || undefined} onChange={(e) => update('author', e.target.value)} />
              </Field>
              <Field id="report-org" label="Organización" optional>
                <input id="report-org" className={cn(inputClass, 'h-10')} value={form.organization} maxLength={120} placeholder="Empresa, institución o área" onChange={(e) => update('organization', e.target.value)} />
              </Field>
              <Field id="report-date" label="Fecha" error={shownErrors.date}>
                <input id="report-date" type="date" className={cn(inputClass, 'h-10')} value={form.date} aria-invalid={!!shownErrors.date || undefined} onChange={(e) => update('date', e.target.value)} />
              </Field>
              <div className="sm:col-span-2">
                <Field id="report-objectives" label="Objetivos" error={shownErrors.objectives} optional>
                  <textarea id="report-objectives" rows={3} className={cn(inputClass, 'resize-y py-2')} value={form.objectives} aria-invalid={!!shownErrors.objectives || undefined} onChange={(e) => update('objectives', e.target.value)} />
                </Field>
              </div>
            </div>
          </Card>

          {/* Secciones */}
          <Card>
            <CardHeader title="Contenido a incluir" description="Indicadores, gráficos y análisis provienen del plan aprobado." />
            <fieldset className="grid gap-2 p-5 sm:grid-cols-2">
              <legend className="sr-only">Secciones del informe</legend>
              {(Object.keys(SECTION_LABELS) as Array<keyof ReportSections>).map((key) => (
                <label key={key} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={sections[key]}
                    onChange={(e) => setSections((s) => ({ ...s, [key]: e.target.checked }))}
                    className="size-4 accent-blue-600"
                  />
                  {SECTION_LABELS[key]}
                </label>
              ))}
              {submitted && noSections && <p className="text-xs text-red-600 sm:col-span-2">Elegí al menos una sección.</p>}
            </fieldset>
          </Card>
        </div>

        {/* Resumen y acción */}
        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <Card className="overflow-hidden">
            <div className="bg-gradient-to-br from-navy-950 to-navy-800 p-5 text-white">
              <p className="text-[11px] font-semibold tracking-wide text-cyan-300 uppercase">Vista previa de la estructura</p>
              <p className="mt-2 line-clamp-2 text-base font-semibold">{form.title || 'Sin título'}</p>
              <p className="mt-1 text-xs text-slate-300">
                {[form.author || 'Autor', form.organization, form.date].filter(Boolean).join(' · ')}
              </p>
            </div>
            <ol className="space-y-1.5 p-5 text-xs">
              {(Object.keys(SECTION_LABELS) as Array<keyof ReportSections>).map((key, i) => (
                <li key={key} className={cn('flex items-center gap-2', sections[key] ? 'text-slate-700' : 'text-slate-300 line-through')}>
                  <span className="w-4 text-right font-semibold text-slate-400">{i + 1}.</span>
                  {SECTION_LABELS[key]}
                </li>
              ))}
            </ol>
            <div className="border-t border-slate-100 p-5">
              <div className="mb-3 flex items-center justify-between text-xs">
                <span className="text-slate-500">Archivo</span>
                <span className="font-mono text-slate-700">informe.{extension}</span>
              </div>
              {!resultsAvailable && (
                <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
                  Este proyecto todavía no tiene resultados calculados; el informe los incluirá cuando existan.
                </p>
              )}
              {results.status === 'success' && results.data.isDemo && (
                <div className="mb-3">
                  <DemoBadge label="Contiene resultados ficticios" />
                </div>
              )}
              <Button type="submit" className="w-full" loading={exporting} icon={<FileDown className="size-4" />}>
                Exportar como {option.label}
              </Button>
              <p className="mt-2 text-center text-[11px] font-medium text-amber-700">
                No disponible aún · requiere backend
              </p>
            </div>
          </Card>

          {status.kind === 'unavailable' && (
            <Alert tone="warning" title="Exportación no disponible todavía">
              {status.message}
            </Alert>
          )}
          {status.kind === 'error' && (
            <Alert tone="error" title="No se pudo exportar">
              {status.message}
            </Alert>
          )}
          {status.kind === 'done' && (
            <Alert tone="success" title="Archivo generado">
              Se descargó «{status.fileName}».
            </Alert>
          )}
        </aside>
      </form>
    </div>
  )
}
