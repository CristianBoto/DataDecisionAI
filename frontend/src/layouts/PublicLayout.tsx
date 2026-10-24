import { Link, Outlet } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { DemoBanner } from '@/components/DemoBanner'
import { Logo } from '@/components/ui/Logo'

export function PublicLayout() {
  return (
    <div className="flex min-h-svh flex-col">
      <DemoBanner />
      <header className="sticky top-0 z-30 border-b border-white/10 bg-navy-950/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" aria-label="DataDecision AI, inicio">
            <Logo inverted />
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <a href="#como-funciona" className="hidden rounded-lg px-3 py-2 text-slate-300 hover:text-white sm:block">
              Cómo funciona
            </a>
            <Link
              to="/analisis/cargar"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 font-medium text-white ring-1 ring-white/15 transition hover:bg-white/15"
            >
              Comenzar <ArrowRight className="size-4" aria-hidden />
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>DataDecision AI · Proyecto de Prácticas Profesionalizantes — Tecnicatura en Ciencia de Datos</span>
          <span>Versión 0.1.0 (MVP)</span>
        </div>
      </footer>
    </div>
  )
}
