import { useRef, useState } from 'react'
import { ImagePlus, Palette, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { defaultCustomization, LIMITS, readLogo, type PdfCustomization } from '@/lib/pdfCustomization'

const inputClass =
  'block h-10 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100 focus:outline-none'

/**
 * «Personalizar PDF» (Fase 4E). Cambia solo la portada y la presentación del documento que se
 * descarga: los resultados, el objetivo y la sesión no se tocan, y nada de esto sale del navegador.
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

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">{field('title', 'Título del informe', defaultTitle)}</div>
        {field('author', 'Autor o responsable (opcional)', 'Nombre y apellido')}
        {field('organization', 'Empresa o institución (opcional)', 'Empresa, institución o área')}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-slate-700">Logo (opcional · PNG o JPG, hasta 1 MB)</p>
        <div className="flex flex-wrap items-center gap-3">
          {value.logo && (
            <img
              src={value.logo.dataUrl}
              alt="Vista previa del logo"
              className="h-12 max-w-40 rounded border border-slate-200 bg-white object-contain p-1"
            />
          )}
          <Button
            size="sm"
            variant="outline"
            icon={<ImagePlus className="size-4" />}
            loading={loading}
            onClick={() => fileRef.current?.click()}
          >
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
      </div>

      <fieldset className="flex flex-wrap gap-x-5 gap-y-2">
        <legend className="sr-only">Elementos de la portada</legend>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" className="size-4 accent-blue-600" checked={value.showDate} onChange={(e) => set('showDate', e.target.checked)} />
          Mostrar la fecha de elaboración
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" className="size-4 accent-blue-600" checked={value.showBrand} onChange={(e) => set('showBrand', e.target.checked)} />
          Mostrar la marca DataDecision AI
        </label>
      </fieldset>
      {!value.showBrand && (
        <p className="text-xs text-slate-500">
          La metodología sigue indicando que los cálculos se hicieron con DataDecision AI (Python y Pandas).
        </p>
      )}

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
