import { Link, Outlet, useLocation } from 'react-router-dom'
import { Check, ClipboardCheck, MessagesSquare, Upload, X } from 'lucide-react'
import { DemoBanner } from '@/components/DemoBanner'
import { Logo } from '@/components/ui/Logo'
import { cn } from '@/lib/cn'

const STEPS = [
  { path: '/analisis/cargar', label: 'Cargar datos', Icon: Upload },
  { path: '/analisis/asistente', label: 'Conversar', Icon: MessagesSquare },
  { path: '/analisis/confirmar', label: 'Confirmar', Icon: ClipboardCheck },
]

export function WizardLayout() {
  const { pathname } = useLocation()
  const current = Math.max(0, STEPS.findIndex((s) => pathname.startsWith(s.path)))

  return (
    <div className="flex min-h-svh flex-col">
      <DemoBanner />
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" aria-label="DataDecision AI, inicio">
            <Logo />
          </Link>

          <ol className="hidden items-center gap-2 md:flex" aria-label="Pasos del análisis">
            {STEPS.map((step, index) => {
              const done = index < current
              const active = index === current
              return (
                <li key={step.path} className="flex items-center gap-2">
                  <span
                    aria-current={active ? 'step' : undefined}
                    className={cn(
                      'flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                      active && 'bg-blue-600 text-white shadow-sm shadow-blue-600/30',
                      done && 'bg-blue-50 text-blue-700',
                      !active && !done && 'text-slate-400',
                    )}
                  >
                    {done ? <Check className="size-3.5" aria-hidden /> : <step.Icon className="size-3.5" aria-hidden />}
                    {step.label}
                  </span>
                  {index < STEPS.length - 1 && <span className="h-px w-6 bg-slate-200" aria-hidden />}
                </li>
              )
            })}
          </ol>

          <span className="text-xs font-medium text-slate-500 md:hidden">
            Paso {current + 1} de {STEPS.length}
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
