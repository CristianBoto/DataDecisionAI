import type { IndicatorFormat } from '@/types/domain'

const LOCALE = 'es-AR'

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toLocaleString(LOCALE, { maximumFractionDigits: 1 })} ${units[unit]}`
}

export function formatNumber(value: number, maximumFractionDigits = 0): string {
  return value.toLocaleString(LOCALE, { maximumFractionDigits })
}

export function formatCompact(value: number): string {
  return value.toLocaleString(LOCALE, { notation: 'compact', maximumFractionDigits: 1 })
}

export function formatValue(value: number, format: IndicatorFormat = 'number'): string {
  switch (format) {
    case 'currency':
      return value.toLocaleString(LOCALE, {
        style: 'currency',
        currency: 'ARS',
        maximumFractionDigits: 0,
      })
    case 'percent':
      // Un valor menor a 1 nunca se redondea a "100 %" (por ejemplo, completitud con faltantes).
      return Math.min(value, value < 1 ? 0.999 : value).toLocaleString(LOCALE, { style: 'percent', maximumFractionDigits: 1 })
    default:
      return formatNumber(value, 1)
  }
}

export function formatChange(change: number): string {
  const sign = change > 0 ? '+' : ''
  return `${sign}${(change * 100).toLocaleString(LOCALE, { maximumFractionDigits: 1 })} %`
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(LOCALE, { dateStyle: 'medium', timeStyle: 'short' })
}

export function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })
}

export function todayIso(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}
