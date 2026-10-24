import { useState } from 'react'
import { Link, NavLink, Outlet, useParams } from 'react-router-dom'
import {
  Bot,
  Database,
  FileDown,
  FolderKanban,
  LayoutDashboard,
  Menu,
  Plus,
  X,
} from 'lucide-react'
import { DemoBanner } from '@/components/DemoBanner'
import { AssistantPanel } from '@/components/workspace/AssistantPanel'
import { BackendStatus } from '@/components/workspace/BackendStatus'
import { Button } from '@/components/ui/Button'
import { DemoBadge } from '@/components/ui/Badge'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback'
import { Logo } from '@/components/ui/Logo'
import { useAsync } from '@/hooks/useAsync'
import { useService } from '@/hooks/useService'
import type { WorkspaceContextValue } from '@/hooks/useWorkspace'
import { cn } from '@/lib/cn'
import { formatBytes } from '@/lib/format'

const NAV_ITEMS = [
  { to: '', label: 'Resumen', Icon: LayoutDashboard, end: true },
  { to: 'datos', label: 'Dataset', Icon: Database, end: false },
  { to: 'exportar', label: 'Exportar análisis', Icon: FileDown, end: false },
]

function prefersWideLayout(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(min-width: 1280px)').matches
    : false
}

export function WorkspaceLayout() {
  const { projectId = '' } = useParams()
  const service = useService()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(prefersWideLayout)

  const workspace = useAsync(async () => {
    const project = await service.getProject(projectId)
    const profile = await service.getDatasetProfile(project.datasetId)
    return { project, profile }
  }, [projectId, service])

  const results = useAsync(() => service.getResults(projectId), [projectId, service])

  const sidebar = (
    <div className="flex h-full flex-col bg-navy-950 text-slate-300">
      <div className="flex h-16 items-center justify-between px-5">
        <Link to="/" aria-label="DataDecision AI, inicio">
          <Logo inverted />
        </Link>
        <button
          type="button"
          className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-label="Cerrar menú"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>

      {workspace.status === 'success' && (
        <div className="mx-3 mb-4 rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
          <p className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-slate-400 uppercase">
            <FolderKanban className="size-3.5" aria-hidden /> Proyecto
          </p>
          <p className="mt-1 truncate text-sm font-semibold text-white">{workspace.data.project.name}</p>
          <p className="mt-2 flex items-center gap-1.5 truncate text-xs text-slate-400">
            <Database className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{workspace.data.project.dataset.fileName}</span>
          </p>
          <p className="mt-0.5 pl-5 text-[11px] text-slate-500">
            {workspace.data.project.dataset.format.toUpperCase()} · {formatBytes(workspace.data.project.dataset.sizeBytes)}
          </p>
        </div>
      )}

      <nav className="flex-1 space-y-1 px-3" aria-label="Secciones del workspace">
        {NAV_ITEMS.map(({ to, label, Icon, end }) => (
          <NavLink
            key={label}
            to={to}
            end={end}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive ? 'bg-blue-600 text-white shadow-sm shadow-blue-900/40' : 'hover:bg-white/5 hover:text-white',
              )
            }
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => {
            setAssistantOpen(true)
            setSidebarOpen(false)
          }}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-white/5 hover:text-white"
        >
          <Bot className="size-4" aria-hidden />
          Asistente
        </button>
      </nav>

      <div className="space-y-3 p-3">
        <Link
          to="/analisis/cargar"
          className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-white/20 px-3 py-2 text-sm text-slate-300 transition hover:border-cyan-300/60 hover:text-white"
        >
          <Plus className="size-4" aria-hidden /> Nuevo análisis
        </Link>
        <BackendStatus />
      </div>
    </div>
  )

  let content
  if (workspace.status === 'loading') {
    content = (
      <div className="space-y-6 p-4 sm:p-8">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-80" />
      </div>
    )
  } else if (workspace.status === 'error') {
    content = (
      <ErrorState
        message={workspace.error}
        onRetry={workspace.retry}
        action={
          <Link to="/analisis/cargar">
            <Button>Iniciar un nuevo análisis</Button>
          </Link>
        }
      />
    )
  } else if (!workspace.data.project.approvedPlan) {
    content = (
      <EmptyState
        icon={<FolderKanban className="size-6" />}
        title="Este proyecto todavía no tiene un plan aprobado"
        description="Los resultados se muestran solo después de que apruebes la propuesta de análisis."
        action={
          <Link to="/analisis/confirmar">
            <Button>Revisar la propuesta</Button>
          </Link>
        }
      />
    )
  } else {
    const context: WorkspaceContextValue = {
      project: workspace.data.project,
      profile: workspace.data.profile,
      results,
      openAssistant: () => setAssistantOpen(true),
    }
    content = <Outlet context={context} />
  }

  return (
    <div className="relative flex h-svh flex-col overflow-clip">
      <DemoBanner />
      <div className="flex min-h-0 flex-1">
        {/* Sidebar escritorio */}
        <div className="hidden w-64 shrink-0 lg:block">{sidebar}</div>

        {/* Sidebar móvil */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button className="absolute inset-0 animate-fade-in bg-navy-950/60" aria-label="Cerrar menú" onClick={() => setSidebarOpen(false)} />
            <div className="relative h-full w-72 max-w-[85%] animate-slide-up shadow-elevated">{sidebar}</div>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                className="-ml-1 rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden"
                onClick={() => setSidebarOpen(true)}
                aria-label="Abrir menú"
              >
                <Menu className="size-5" aria-hidden />
              </button>
              <span className="truncate text-sm font-semibold text-slate-800">
                {workspace.status === 'success' ? workspace.data.project.name : 'Workspace'}
              </span>
              {service.mode === 'demo' && <DemoBadge />}
            </div>
            <Button
              variant={assistantOpen ? 'secondary' : 'outline'}
              size="sm"
              icon={<Bot className="size-4" />}
              onClick={() => setAssistantOpen((open) => !open)}
              aria-pressed={assistantOpen}
            >
              Asistente
            </Button>
          </header>

          <div className="flex min-h-0 flex-1">
            {/* relative: los elementos absolutos (p. ej. sr-only) quedan dentro del área con scroll. */}
            <main className="scrollbar-thin relative min-w-0 flex-1 overflow-y-auto">{content}</main>

            {assistantOpen && workspace.status === 'success' && (
              <>
                {/* En pantallas chicas el panel se superpone; en xl ocupa una columna. */}
                <button
                  className="fixed inset-0 z-30 animate-fade-in bg-navy-950/40 xl:hidden"
                  aria-label="Cerrar panel del asistente"
                  onClick={() => setAssistantOpen(false)}
                />
                <div className="fixed inset-y-0 right-0 z-40 w-full max-w-sm animate-slide-up border-l border-slate-200 shadow-elevated xl:static xl:z-auto xl:w-96 xl:max-w-none xl:animate-none xl:shadow-none">
                  <AssistantPanel projectId={projectId} onClose={() => setAssistantOpen(false)} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
