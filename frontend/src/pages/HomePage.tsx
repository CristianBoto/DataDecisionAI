import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BarChart3,
  Bot,
  BrainCircuit,
  CheckCircle2,
  ClipboardCheck,
  FileDown,
  FlaskConical,
  GraduationCap,
  LineChart,
  MessagesSquare,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Upload,
  Users,
  Wallet,
} from 'lucide-react'
import { useService } from '@/hooks/useService'

const STEPS = [
  { Icon: Upload, title: 'Cargá tus datos', text: 'Subí un archivo CSV o Excel. Revisamos su estructura y la calidad de los datos.' },
  { Icon: MessagesSquare, title: 'Contá qué necesitás', text: 'Explicá tu objetivo con tus palabras. El asistente te hace preguntas para entenderlo.' },
  { Icon: ClipboardCheck, title: 'Aprobá la propuesta', text: 'Ves qué indicadores y gráficos se van a calcular, y qué limitaciones existen.' },
  { Icon: LineChart, title: 'Decidí con evidencia', text: 'Obtenés indicadores, gráficos, hallazgos y un informe exportable.' },
]

const SECTORS = [
  { Icon: GraduationCap, label: 'Educación' },
  { Icon: ShoppingCart, label: 'Ventas' },
  { Icon: Wallet, label: 'Finanzas' },
  { Icon: Users, label: 'Recursos humanos' },
  { Icon: Truck, label: 'Logística' },
]

/** Ilustración del producto (no muestra datos reales). */
function ProductIllustration() {
  const bars = [38, 52, 46, 64, 58, 72, 80, 76, 88]
  return (
    <div className="relative rounded-2xl bg-white/[0.04] p-2 shadow-2xl ring-1 shadow-black/40 ring-white/10 backdrop-blur" aria-hidden>
      <div className="rounded-xl bg-white p-4 text-left">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-red-300" />
            <span className="size-2.5 rounded-full bg-amber-300" />
            <span className="size-2.5 rounded-full bg-emerald-300" />
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">Vista ilustrativa</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {['Indicador A', 'Indicador B', 'Indicador C'].map((label, i) => (
            <div key={label} className="rounded-lg border border-slate-100 p-2.5">
              <p className="text-[10px] text-slate-400">{label}</p>
              <div className="mt-1.5 h-2.5 rounded bg-slate-800" style={{ width: `${60 + i * 12}%` }} />
              <div className="mt-1.5 h-1.5 w-1/3 rounded bg-emerald-200" />
            </div>
          ))}
        </div>
        <div className="mt-3 flex h-32 items-end gap-1.5 rounded-lg border border-slate-100 p-3">
          {bars.map((h, i) => (
            <div key={i} className="flex-1 rounded-t bg-gradient-to-t from-blue-600 to-cyan-400" style={{ height: `${h}%`, opacity: 0.55 + i * 0.05 }} />
          ))}
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-blue-50 p-2.5">
          <Bot className="mt-0.5 size-3.5 shrink-0 text-blue-600" />
          <div className="flex-1 space-y-1">
            <div className="h-1.5 w-11/12 rounded bg-blue-200" />
            <div className="h-1.5 w-2/3 rounded bg-blue-200" />
          </div>
        </div>
      </div>
    </div>
  )
}

export function HomePage() {
  const { mode } = useService()
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-navy-950 text-white">
        <div className="grid-backdrop absolute inset-0 opacity-[0.15]" aria-hidden />
        <div className="absolute -top-40 left-1/2 h-[480px] w-[880px] -translate-x-1/2 rounded-full bg-blue-600/25 blur-3xl" aria-hidden />
        <div className="absolute right-0 bottom-0 h-72 w-72 rounded-full bg-cyan-400/10 blur-3xl" aria-hidden />

        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.1fr_1fr]">
          <div className="animate-slide-up">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-cyan-200 ring-1 ring-white/15">
              <BrainCircuit className="size-3.5" aria-hidden />
              Ciencia de datos + inteligencia artificial
            </span>
            <h1 className="mt-6 text-4xl leading-[1.1] font-bold tracking-tight sm:text-5xl">
              Convertí tus datos en{' '}
              <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">decisiones claras</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg">
              DataDecision AI analiza tus planillas CSV o Excel, entiende qué necesitás decidir y te devuelve
              indicadores, gráficos y recomendaciones explicadas en lenguaje simple.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                to="/analisis/cargar"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 text-base font-semibold text-white shadow-lg shadow-blue-600/30 transition hover:bg-blue-500"
              >
                Comenzar un análisis <ArrowRight className="size-4" aria-hidden />
              </Link>
              <a
                href="#como-funciona"
                className="inline-flex h-12 items-center justify-center rounded-xl px-6 text-base font-medium text-slate-200 ring-1 ring-white/20 transition hover:bg-white/5"
              >
                Ver cómo funciona
              </a>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-400">
              {['Sin conocimientos técnicos', 'Sin inventar datos', 'Aprobás antes de analizar'].map((item) => (
                <li key={item} className="flex items-center gap-1.5">
                  <CheckCircle2 className="size-4 text-cyan-300" aria-hidden /> {item}
                </li>
              ))}
            </ul>
            {mode === 'demo' && (
              <div className="mt-8 max-w-xl rounded-xl bg-amber-400/10 p-4 text-sm text-amber-100 ring-1 ring-amber-300/30">
                <p className="flex items-center gap-2 font-semibold text-amber-200">
                  <FlaskConical className="size-4" aria-hidden /> Sobre esta demo pública
                </p>
                <ul className="mt-2 list-inside list-disc space-y-1 text-amber-100/90">
                  <li>Los análisis y gráficos del ejemplo son ficticios.</li>
                  <li>Las funciones avanzadas (IA, cálculos reales, exportación) todavía requieren backend.</li>
                  <li>No cargues datos confidenciales: los archivos se leen solo en tu navegador.</li>
                </ul>
              </div>
            )}
          </div>
          <div className="animate-fade-in lg:pl-6">
            <ProductIllustration />
          </div>
        </div>
      </section>

      {/* Cómo funciona */}
      <section id="como-funciona" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 sm:py-20">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold text-blue-600">Cómo funciona</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">De la planilla a la decisión, en cuatro pasos</h2>
          <p className="mt-3 text-slate-500">Un flujo guiado para que cualquier persona pueda analizar datos tabulares con rigor.</p>
        </div>
        <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ Icon, title, text }, i) => (
            <li key={title} className="relative rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
              <span className="absolute top-5 right-5 text-xs font-bold text-slate-300">0{i + 1}</span>
              <span className="flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <Icon className="size-5" aria-hidden />
              </span>
              <h3 className="mt-4 font-semibold text-slate-900">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Dos roles de IA */}
      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-16 sm:px-6 md:grid-cols-2">
          <div className="rounded-2xl bg-gradient-to-br from-navy-900 to-navy-700 p-6 text-white shadow-elevated">
            <MessagesSquare className="size-6 text-cyan-300" aria-hidden />
            <h3 className="mt-4 text-lg font-semibold">Asistente de requisitos</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              Conversa con vos, revisa el perfil del dataset, detecta información faltante y te propone un
              análisis antes de ejecutarlo. Nunca inventa datos que no existen.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <BarChart3 className="size-6 text-blue-600" aria-hidden />
            <h3 className="mt-4 text-lg font-semibold text-slate-900">Analista de datos</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Planifica los cálculos con Python y Pandas, adapta el análisis a tus columnas, evalúa si la
              evidencia respalda cada conclusión y prepara el informe.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3 md:col-span-2">
            {[
              { Icon: ShieldCheck, title: 'Datos protegidos', text: 'Las claves de IA viven solo en el servidor.' },
              { Icon: ClipboardCheck, title: 'Vos tenés el control', text: 'Nada se analiza sin tu aprobación.' },
              { Icon: FileDown, title: 'Resultados exportables', text: 'PDF, Excel, Word y formatos para Canva.' },
            ].map(({ Icon, title, text }) => (
              <div key={title} className="flex gap-3 rounded-xl p-2">
                <Icon className="mt-0.5 size-5 shrink-0 text-blue-600" aria-hidden />
                <div>
                  <p className="text-sm font-semibold text-slate-900">{title}</p>
                  <p className="text-sm text-slate-500">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Sectores + CTA */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="flex flex-col items-center text-center">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Para cualquier conjunto de datos tabulares</h2>
          <ul className="mt-6 flex flex-wrap justify-center gap-2">
            {SECTORS.map(({ Icon, label }) => (
              <li key={label} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm">
                <Icon className="size-4 text-blue-600" aria-hidden /> {label}
              </li>
            ))}
          </ul>
          <Link
            to="/analisis/cargar"
            className="mt-10 inline-flex h-12 items-center gap-2 rounded-xl bg-navy-900 px-6 font-semibold text-white transition hover:bg-navy-800"
          >
            Empezar ahora <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </section>
    </>
  )
}
