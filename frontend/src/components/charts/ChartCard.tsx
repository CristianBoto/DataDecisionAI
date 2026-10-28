import React, { useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'
import { Activity, BarChart3, LineChart as LineIcon, PieChart as PieIcon, ScatterChart as ScatterIcon, Sigma, Table2, TrendingUp } from 'lucide-react'
import type { Chart, ChartSeries, ChartType } from '@/types/domain'
import { Card, CardHeader } from '@/components/ui/Card'
import { cn } from '@/lib/cn'
import { seriesColor } from '@/lib/chartColors'
import { formatCompact, formatValue } from '@/lib/format'

const GRID_COLOR = '#e2e8f0'
const AXIS_TICK = { fill: '#64748b', fontSize: 12 }

const TYPE_META: Record<ChartType, { label: string; Icon: typeof BarChart3 }> = {
  bar: { label: 'Barras', Icon: BarChart3 },
  line: { label: 'Líneas', Icon: LineIcon },
  area: { label: 'Áreas', Icon: TrendingUp },
  histogram: { label: 'Distribución', Icon: Sigma },
  pie: { label: 'Torta', Icon: PieIcon },
  scatter: { label: 'Dispersión', Icon: ScatterIcon },
  roc: { label: 'Curva ROC', Icon: Activity },
}

/** Tooltip de gráficos con eje X numérico (dispersión y ROC): muestra ambos valores exactos. */
function PointTooltip({ active, payload, chart }: TooltipContentProps<number, string> & { chart: Chart }) {
  if (!active || !payload || payload.length === 0) return null
  const point = payload[0].payload as Record<string, number>
  const ySeries = chart.series[0]
  return (
    <div className="min-w-36 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-elevated backdrop-blur">
      <p className="flex justify-between gap-4 text-slate-600">
        <span>{chart.xLabel ?? chart.xKey}</span>
        <span className="font-semibold text-slate-900 tabular-nums">{display(point[chart.xKey], { key: 'x', label: '', unit: chart.xUnit })}</span>
      </p>
      <p className="flex justify-between gap-4 text-slate-600">
        <span>{ySeries.label}</span>
        <span className="font-semibold text-slate-900 tabular-nums">{display(point[ySeries.key], ySeries)}</span>
      </p>
    </div>
  )
}

/** Valor con su formato y, si se conoce, su unidad (por ejemplo, "23.000 ARS"). */
function display(value: number, series?: ChartSeries): string {
  const formatted = formatValue(value, series?.format)
  return series?.unit ? `${formatted} ${series.unit}` : formatted
}

function ChartTooltip({ active, payload, label, series }: TooltipContentProps<number, string> & { series: ChartSeries[] }) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="min-w-36 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-elevated backdrop-blur">
      <p className="mb-1 font-semibold text-slate-900">{String(label)}</p>
      {payload.map((item) => {
        const index = series.findIndex((s) => s.key === item.dataKey)
        const meta = series[index]
        return (
          <p key={String(item.dataKey)} className="flex items-center justify-between gap-4 text-slate-600">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ backgroundColor: seriesColor(index) }} aria-hidden />
              {meta?.label ?? item.name}
            </span>
            <span className="font-semibold text-slate-900 tabular-nums">
              {typeof item.value === 'number' ? display(item.value, meta) : '—'}
            </span>
          </p>
        )
      })}
    </div>
  )
}

function Legend({ series }: { series: ChartSeries[] }) {
  if (series.length < 2) return null
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 px-5 pt-3 text-xs text-slate-600">
      {series.map((s, index) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: seriesColor(index) }} aria-hidden />
          {s.label}
        </li>
      ))}
    </ul>
  )
}

function ChartPlot({ chart }: { chart: Chart }) {
  const animated = chart.animated ?? true
  const common = {
    data: chart.data,
    // Con títulos de ejes (resultados reales) se reserva espacio para leerlos.
    margin: { top: 8, right: 12, left: chart.yLabel ? 8 : 0, bottom: chart.xLabel && chart.yLabel ? 16 : 0 },
  }
  const grid = <CartesianGrid vertical={false} stroke={GRID_COLOR} strokeDasharray="0" />
  const xAxis = (
    <XAxis
      dataKey={chart.xKey}
      tick={AXIS_TICK}
      tickLine={false}
      axisLine={{ stroke: GRID_COLOR }}
      tickMargin={8}
      interval="preserveStartEnd"
      label={chart.yLabel && chart.xLabel ? { value: chart.xLabel, position: 'insideBottom', offset: -12, fill: '#64748b', fontSize: 11 } : undefined}
    />
  )
  const yAxis = (
    <YAxis
      tick={AXIS_TICK}
      tickLine={false}
      axisLine={false}
      width={chart.yLabel ? 56 : 44}
      tickFormatter={(v: number) => formatCompact(v)}
      label={chart.yLabel ? { value: chart.yLabel, angle: -90, position: 'insideLeft', offset: 4, fill: '#64748b', fontSize: 11 } : undefined}
    />
  )
  const tooltip = (
    <Tooltip
      cursor={chart.type === 'bar' || chart.type === 'histogram' ? { fill: '#f1f5f9' } : { stroke: '#94a3b8', strokeWidth: 1 }}
      content={(props) => <ChartTooltip {...(props as TooltipContentProps<number, string>)} series={chart.series} />}
    />
  )

  const numericX = (domain?: [number, number]) => (
    <XAxis
      type="number"
      dataKey={chart.xKey}
      domain={domain ?? ['auto', 'auto']}
      tick={AXIS_TICK}
      tickLine={false}
      axisLine={{ stroke: GRID_COLOR }}
      tickMargin={8}
      tickFormatter={(v: number) => formatCompact(v)}
      label={chart.xLabel ? { value: chart.xLabel, position: 'insideBottom', offset: -12, fill: '#64748b', fontSize: 11 } : undefined}
    />
  )
  const pointTooltip = <Tooltip cursor={{ strokeDasharray: '3 3' }} content={(props) => <PointTooltip {...(props as TooltipContentProps<number, string>)} chart={chart} />} />

  switch (chart.type) {
    case 'scatter':
      return (
        <ScatterChart margin={{ top: 8, right: 12, left: 8, bottom: 16 }}>
          <CartesianGrid stroke={GRID_COLOR} />
          {numericX()}
          {React.cloneElement(yAxis, { type: 'number', dataKey: chart.series[0].key, domain: ['auto', 'auto'] })}
          {pointTooltip}
          <Scatter data={chart.data} fill={seriesColor(0)} fillOpacity={0.7} isAnimationActive={animated} />
        </ScatterChart>
      )
    case 'roc':
      return (
        <LineChart data={chart.data} margin={{ top: 8, right: 12, left: 8, bottom: 16 }}>
          <CartesianGrid stroke={GRID_COLOR} />
          {numericX([0, 1])}
          {React.cloneElement(yAxis, { type: 'number', domain: [0, 1], tickFormatter: (v: number) => String(v) })}
          {pointTooltip}
          {/* Diagonal de referencia: un clasificador al azar (AUC = 0,5). */}
          <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="#94a3b8" strokeDasharray="5 5" ifOverflow="extendDomain" />
          <Line type="linear" dataKey={chart.series[0].key} stroke={seriesColor(0)} strokeWidth={2} dot={false} isAnimationActive={animated} />
        </LineChart>
      )
    case 'pie': {
      const s = chart.series[0]
      return (
        <PieChart>
          {tooltip}
          <Pie data={chart.data} dataKey={s.key} nameKey={chart.xKey} innerRadius="45%" outerRadius="80%" paddingAngle={1} isAnimationActive={false}>
            {chart.data.map((row, index) => (
              <Cell key={String(row[chart.xKey])} fill={seriesColor(index)} stroke="#fff" />
            ))}
          </Pie>
        </PieChart>
      )
    }
    case 'line':
      return (
        <LineChart {...common}>
          {grid}
          {xAxis}
          {yAxis}
          {tooltip}
          {chart.series.map((s, index) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={seriesColor(index)} strokeWidth={2} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }} isAnimationActive={animated} />
          ))}
        </LineChart>
      )
    case 'area':
      return (
        <AreaChart {...common}>
          <defs>
            {chart.series.map((s, index) => (
              <linearGradient key={s.key} id={`grad-${chart.id}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={seriesColor(index)} stopOpacity={0.18} />
                <stop offset="100%" stopColor={seriesColor(index)} stopOpacity={0.01} />
              </linearGradient>
            ))}
          </defs>
          {grid}
          {xAxis}
          {yAxis}
          {tooltip}
          {chart.series.map((s, index) => (
            <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={seriesColor(index)} strokeWidth={2} fill={`url(#grad-${chart.id}-${s.key})`} activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }} isAnimationActive={animated} />
          ))}
        </AreaChart>
      )
    case 'histogram':
      return (
        <BarChart {...common} barCategoryGap={2}>
          {grid}
          {xAxis}
          {yAxis}
          {tooltip}
          {chart.series.map((s, index) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={seriesColor(index)} fillOpacity={0.85} radius={[4, 4, 0, 0]} isAnimationActive={animated} />
          ))}
        </BarChart>
      )
    default:
      return (
        <BarChart {...common} barCategoryGap="28%">
          {grid}
          {xAxis}
          {yAxis}
          {tooltip}
          {chart.series.map((s, index) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={seriesColor(index)} radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={animated} />
          ))}
        </BarChart>
      )
  }
}

function ChartTable({ chart }: { chart: Chart }) {
  return (
    <div className="scrollbar-thin max-h-64 overflow-auto">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-slate-50 text-slate-500">
          <tr>
            <th className="px-3 py-2 font-medium">{chart.xLabel ?? chart.xKey}</th>
            {chart.series.map((s) => (
              <th key={s.key} className="px-3 py-2 text-right font-medium">{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {chart.data.map((row, i) => (
            <tr key={i}>
              <td className="px-3 py-1.5 text-slate-700">{String(row[chart.xKey] ?? '—')}</td>
              {chart.series.map((s) => {
                const value = row[s.key]
                return (
                  <td key={s.key} className="px-3 py-1.5 text-right text-slate-900 tabular-nums">
                    {typeof value === 'number' ? display(value, s) : '—'}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface ChartCardProps {
  chart: Chart
  className?: string
}

export function ChartCard({ chart, className }: ChartCardProps) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const { label, Icon } = TYPE_META[chart.type]

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader
        icon={<Icon className="size-4" aria-hidden />}
        title={chart.title}
        description={chart.description}
        actions={
          <div className="flex rounded-lg bg-slate-100 p-0.5" role="group" aria-label={`Vista de ${chart.title}`}>
            <button
              type="button"
              onClick={() => setView('chart')}
              aria-pressed={view === 'chart'}
              title={`Ver gráfico (${label})`}
              className={cn('rounded-md p-1.5 transition', view === 'chart' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-800')}
            >
              <Icon className="size-3.5" aria-hidden />
              <span className="sr-only">Gráfico</span>
            </button>
            <button
              type="button"
              onClick={() => setView('table')}
              aria-pressed={view === 'table'}
              title="Ver tabla"
              className={cn('rounded-md p-1.5 transition', view === 'table' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-800')}
            >
              <Table2 className="size-3.5" aria-hidden />
              <span className="sr-only">Tabla</span>
            </button>
          </div>
        }
      />
      {chart.type === 'pie' ? (
        <Legend series={chart.data.map((row) => ({ key: String(row[chart.xKey]), label: String(row[chart.xKey]) }))} />
      ) : (
        <Legend series={chart.series} />
      )}
      <div className="flex-1 p-3 pt-2 sm:p-5 sm:pt-3">
        {view === 'chart' ? (
          <div className="h-64 w-full" role="img" aria-label={`${chart.title}. ${chart.description}`}>
            <ResponsiveContainer width="100%" height="100%">
              <ChartPlot chart={chart} />
            </ResponsiveContainer>
          </div>
        ) : (
          <ChartTable chart={chart} />
        )}
      </div>
    </Card>
  )
}
