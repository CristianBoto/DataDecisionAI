import { useRef, useState, type DragEvent } from 'react'
import { ImagePlus, Palette, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { defaultCustomization, LIMITS, readLogo, type PdfCustomization } from '@/lib/pdfCustomization'

const inputClass =
  'block h-10 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100 focus:outline-none'

/**
 * «Personalizar PDF» (Fases 4E y 5). Dos áreas: identidad (logo, organización, marca) e información del
 * informe (título, autor, fecha); la vista previa se actualiza al instante debajo. Cambia solo la
 * presentación del PDF: los resultados, el objetivo y la sesión no se tocan, y nada sale del navegador.
 */
export function PdfCustomizer({
  value,
  defaultTitle,
  onChange,
  readLogoFile = readLogo,
}: {
  value: PdfCustomization
  defaultTitle: string
  onChange: (next: PdfCustomization) => void
  /** Inyectable en las pruebas (jsdom no decodifica imágenes). */
  readLogoFile?: typeof readLogo
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [logoError, setLogoError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const set = <K extends keyof PdfCustomization>(key: K, v: PdfCustomization[K]) => onChange({ ...value, [key]: v })

  async function pickLogo(file: File) {
    setLoading(true)
    setLogoError(null)
    try {
      const result = await readLogoFile(file)
      if (result.ok) onChange({ ...value, logo: result.logo })
      else setLogoError(result.error)
    } finally {
      setLoading(false)
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (file) void pickLogo(file)
  }

  const field = (key: 'title' | 'author' | 'organization', label: string, placeholder: string) => (
    <div>
      <label htmlFor={`pdf-${key}`} className="mb-1 block text-xs font-medium text-slate-700">
        {label}
      </label>
      <input
        id={`pdf-${key}`}
        className={inputClass}
        value={value[key]}
        maxLength={LIMITS[key]}
        placeholder={placeholder}
        onChange={(e) => set(key, e.target.value)}
      />
    </div>
  )

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4" aria-label="Personalizar PDF">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
          <Palette className="size-4 text-slate-500" aria-hidden /> Personalizar PDF
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          Opcional. Cambia solo la presentación del PDF y su vista previa: los resultados no se modifican y estos datos
          no se envían a ningún servidor ni a la IA.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <fieldset className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
          <legend className="px-1 text-xs font-semibold text-slate-700">Identidad del informe</legend>
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            data-testid="pdf-logo-dropzone"
            className={cn(
              'flex flex-wrap items-center gap-3 rounded-lg border-2 border-dashed p-3 transition-colors',
              dragging ? 'border-blue-400 bg-blue-50' : 'border-slate-200',
            )}
          >
            {value.logo ? (
              <img src={value.logo.dataUrl} alt="Vista previa del logo" className="h-12 max-w-40 rounded bg-white object-contain p-1" />
            ) : (
              <p className="text-xs text-slate-500">Arrastrá tu logo acá (PNG o JPG, hasta 1 MB)</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" icon={<ImagePlus className="size-4" />} loading={loading} onClick={() => fileRef.current?.click()}>
                {value.logo ? 'Reemplazar logo' : 'Cargar logo'}
              </Button>
              {value.logo && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 className="size-4" />}
                  onClick={() => {
                    setLogoError(null)
                    set('logo', null)
                  }}
                >
                  Quitar logo
                </Button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,.png,.jpg,.jpeg"
              className="sr-only"
              data-testid="pdf-logo-input"
              aria-label="Archivo del logo"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) void pickLogo(file)
              }}
            />
          </div>
          {logoError && (
            <p className="text-xs text-red-700" role="alert">
              {logoError}
            </p>
          )}
          {field('organization', 'Empresa o institución (opcional)', 'Empresa, institución o área')}
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="size-4 accent-blue-600" checked={value.showBrand} onChange={(e) => set('showBrand', e.target.checked)} />
            Mostrar la marca DataDecision AI
          </label>
          {!value.showBrand && (
            <p className="text-xs text-slate-500">La metodología sigue indicando que los cálculos se hicieron con DataDecision AI (Python y Pandas).</p>
          )}
        </fieldset>

        <fieldset className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
          <legend className="px-1 text-xs font-semibold text-slate-700">Información del informe</legend>
          {field('title', 'Título del informe', defaultTitle)}
          {field('author', 'Autor o responsable (opcional)', 'Nombre y apellido')}
          <div className="grid gap-2 sm:grid-cols-[auto_1fr] sm:items-end">
            <div>
              <label htmlFor="pdf-date" className="mb-1 block text-xs font-medium text-slate-700">
                Fecha
              </label>
              <input
                id="pdf-date"
                type="date"
                className={cn(inputClass, 'w-44')}
                value={value.date}
                disabled={!value.showDate}
                onChange={(e) => set('date', e.target.value)}
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm text-slate-700">
              <input type="checkbox" className="size-4 accent-blue-600" checked={value.showDate} onChange={(e) => set('showDate', e.target.checked)} />
              Mostrar la fecha de elaboración
            </label>
          </div>
          <p className="text-[11px] text-slate-400">Si no elegís una fecha, se usa la de hoy. Las fechas de los datos y los gráficos no cambian.</p>
        </fieldset>
      </div>

      <Button
        size="sm"
        variant="ghost"
        icon={<RotateCcw className="size-4" />}
        onClick={() => {
          setLogoError(null)
          onChange(defaultCustomization())
        }}
      >
        Restablecer
      </Button>
    </section>
  )
}
