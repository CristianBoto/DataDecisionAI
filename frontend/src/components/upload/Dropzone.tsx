import { useId, useRef, useState, type DragEvent } from 'react'
import { FileSpreadsheet, UploadCloud } from 'lucide-react'
import { ACCEPT_ATTRIBUTE } from '@/lib/fileValidation'
import { cn } from '@/lib/cn'

interface DropzoneProps {
  onFile: (file: File) => void
  disabled?: boolean
  maxSizeMb: number
}

/** Zona para arrastrar o seleccionar un archivo. La validación la hace el padre. */
export function Dropzone({ onFile, disabled = false, maxSizeMb }: DropzoneProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setDragging(false)
    if (disabled) return
    const file = event.dataTransfer.files[0]
    if (file) onFile(file)
  }

  return (
    <label
      htmlFor={inputId}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={cn(
        'group relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-all',
        dragging ? 'border-blue-500 bg-blue-50/80 ring-4 ring-blue-100' : 'border-slate-300 bg-white hover:border-blue-400 hover:bg-blue-50/30',
        disabled && 'pointer-events-none opacity-60',
      )}
    >
      <div className="grid-backdrop absolute inset-0 opacity-50" aria-hidden />
      <span
        className={cn(
          'relative flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-navy-900 to-blue-600 text-white shadow-lg shadow-blue-600/25 transition-transform',
          dragging ? 'scale-110' : 'group-hover:scale-105',
        )}
      >
        <UploadCloud className="size-6" aria-hidden />
      </span>
      <p className="relative mt-4 text-base font-semibold text-slate-900">
        {dragging ? 'Soltá el archivo para cargarlo' : 'Arrastrá tu archivo acá'}
      </p>
      <p className="relative mt-1 text-sm text-slate-500">
        o <span className="font-semibold text-blue-600 underline-offset-2 group-hover:underline">seleccioná uno desde tu equipo</span>
      </p>
      <div className="relative mt-5 flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1">
          <FileSpreadsheet className="size-3.5" aria-hidden /> CSV
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1">
          <FileSpreadsheet className="size-3.5" aria-hidden /> Excel (.xlsx)
        </span>
        <span>· Máximo {maxSizeMb} MB</span>
      </div>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        className="sr-only"
        disabled={disabled}
        data-testid="file-input"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
          // Permite volver a elegir el mismo archivo.
          if (inputRef.current) inputRef.current.value = ''
        }}
      />
    </label>
  )
}
