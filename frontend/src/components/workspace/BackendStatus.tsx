import { useAsync } from '@/hooks/useAsync'
import { useService } from '@/hooks/useService'
import { cn } from '@/lib/cn'

/** Indicador del estado de conexión con el backend (o del proveedor DEMO). */
export function BackendStatus() {
  const service = useService()
  const health = useAsync(() => service.checkHealth(), [service])

  const label =
    service.mode === 'demo'
      ? 'Proveedor DEMO activo'
      : health.status === 'success'
        ? 'Backend conectado'
        : health.status === 'loading'
          ? 'Verificando backend…'
          : 'Backend no disponible'

  const dot =
    service.mode === 'demo'
      ? 'bg-amber-400'
      : health.status === 'success'
        ? 'bg-emerald-400'
        : health.status === 'loading'
          ? 'bg-slate-400'
          : 'bg-red-400'

  return (
    <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs text-slate-300 ring-1 ring-white/10" title={health.error ?? undefined}>
      <span className={cn('size-2 rounded-full', dot)} aria-hidden />
      {label}
    </div>
  )
}
