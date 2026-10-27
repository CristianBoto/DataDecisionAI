import { Link, Outlet, useLocation } from 'react-router-dom'
import { BarChart3, Check, ClipboardCheck, ClipboardList, Lock, MessagesSquare, Upload, X, type LucideIcon } from 'lucide-react'
import { DemoBanner } from '@/components/DemoBanner'
import { Logo } from '@/components/ui/Logo'
import { useAnalysisSession } from '@/hooks/useAnalysisSession'
import { cn } from '@/lib/cn'
import { stepAccess, WIZARD_STEPS, type StepKey } from '@/lib/wizardSteps'

const ICONS: Record<StepKey, LucideIcon> = {
  cargar: Upload,
  revisar: ClipboardList,
  asistente: MessagesSquare,
  confirmar: ClipboardCheck,
  resultados: BarChart3,
}

export function WizardLayout() {
  const { pathname } = useLocation()
  const session = useAnalysisSession()
  const access = stepAccess(session)
  const current = Math.max(0, WIZARD_STEPS.findIndex((s) => pathname.startsWith(s.path)))

  return (
    <div className="flex min-h-svh flex-col">
      <DemoBanner />
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" aria-label="DataDecision AI, inicio">
            <Logo />
          </Link>

          <nav aria-label="Pasos del análisis" className="hidden md:block">
            <ol className="flex items-center gap-2">
              {WIZARD_STEPS.map((step, index) => {
                const Icon = ICONS[step.key]
                const active = index === current
                const { available, reason } = access[step.key]
                const done = index < current && available
                const base = 'flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors'
                const content = (
                  <>
                    {done ? <Check className="size-3.5" aria-hidden /> : available || active ? <Icon className="size-3.5" aria-hidden /> : <Lock className="size-3.5" aria-hidden />}
                    {step.label}
                  </>
                )
                return (
                  <li key={step.path} className="flex items-center gap-2">
                    {active ? (
                      <span aria-current="step" className={cn(base, 'bg-blue-600 text-white shadow-sm shadow-blue-600/30')}>
                        {content}
                      </span>
                    ) : available ? (
                      // Pasos alcanzados: se pueden abrir (también con teclado).
                      <Link
                        to={step.path}
                        aria-label={`${step.label}${done ? ' (completado)' : ''}`}
                        className={cn(
                          base,
                          'focus-visible:ring-4 focus-visible:ring-blue-200 focus-visible:outline-none',
                          done ? 'bg-blue-50 text-blue-700 hover:bg-blue-100' : 'text-slate-600 hover:bg-slate-100',
                        )}
                      >
                        {content}
                      </Link>
                    ) : (
                      <span aria-disabled="true" title={reason} className={cn(base, 'cursor-not-allowed text-slate-300')}>
                        {content}
                        <span className="sr-only"> (bloqueado: {reason})</span>
                      </span>
                    )}
                    {index < WIZARD_STEPS.length - 1 && <span className="h-px w-6 bg-slate-200" aria-hidden />}
                  </li>
                )
              })}
            </ol>
          </nav>

          <span className="text-xs font-medium text-slate-500 md:hidden">
            Paso {current + 1} de {WIZARD_STEPS.length}
          </span>

          <Link
            to="/"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <X className="size-4" aria-hidden />
            <span className="hidden sm:inline">Salir</span>
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
        <Outlet />
      </main>
    </div>
  )
}
