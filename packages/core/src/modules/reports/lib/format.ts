import type {
  FieldFormat,
  ReportColumnDescriptor,
} from '@open-mercato/shared/modules/reports/dsl'

export type FormatContext = {
  locale: string
  /** IANA timezone used for `datetime` values. Defaults to the runtime zone. */
  timeZone?: string
  /** Translate an i18n key (enum option labels, Yes/No). */
  translate?: (key: string, fallback: string) => string
  /** Row the value belongs to — used to read a per-row currency column. */
  row?: Record<string, unknown>
  /** Override formats from the report's `columnFormats`. */
  override?: FieldFormat
  /** Labels for `fk` values, keyed by raw id. */
  fkLabels?: Readonly<Record<string, string>>
}

export const NULL_DISPLAY = '—'

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function readPath(row: Record<string, unknown> | undefined, path: string | undefined): unknown {
  if (!row || !path) return undefined
  if (!path.includes('.')) return row[path]
  let cursor: unknown = row
  for (const segment of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string' && value.trim().length > 0) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function isNumericString(value: unknown): value is string {
  return typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())
}

type NumberFormatInput = number | string

function formatNumberExact(formatter: Intl.NumberFormat, value: unknown): string | null {
  if (isNumericString(value)) {
    const format = formatter.format as (input: NumberFormatInput) => string
    return format(value.trim())
  }
  const n = toFiniteNumber(value)
  return n === null ? null : formatter.format(n)
}

function numberOptions(format: FieldFormat, defaults: Intl.NumberFormatOptions): Intl.NumberFormatOptions {
  const options: Intl.NumberFormatOptions = { ...defaults }
  if (typeof format.precision === 'number') {
    options.minimumFractionDigits = format.precision
    options.maximumFractionDigits = format.precision
  }
  if (format.compact) {
    options.notation = 'compact'
    if (typeof format.precision !== 'number') options.maximumFractionDigits = 1
  }
  if (format.percent) options.style = 'percent'
  return options
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

function formatDateOnly(value: unknown, locale: string, dateStyle: FieldFormat['dateStyle']): string | null {
  if (typeof value === 'string') {
    const match = DATE_ONLY_RE.exec(value.trim().slice(0, 10))
    if (match) {
      const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
      return new Intl.DateTimeFormat(locale, { dateStyle: dateStyle ?? 'medium', timeZone: 'UTC' }).format(utc)
    }
  }
  const d = parseDate(value)
  if (!d) return null
  return new Intl.DateTimeFormat(locale, { dateStyle: dateStyle ?? 'medium', timeZone: 'UTC' }).format(d)
}

function formatDateTime(
  value: unknown,
  locale: string,
  timeZone: string | undefined,
  dateStyle: FieldFormat['dateStyle'],
): string | null {
  const d = parseDate(value)
  if (!d) return null
  const options: Intl.DateTimeFormatOptions = { dateStyle: dateStyle ?? 'medium', timeStyle: 'short' }
  if (timeZone) options.timeZone = timeZone
  try {
    return new Intl.DateTimeFormat(locale, options).format(d)
  } catch {
    return new Intl.DateTimeFormat(locale, { dateStyle: dateStyle ?? 'medium', timeStyle: 'short' }).format(d)
  }
}

function enumLabel(value: unknown, column: ReportColumnDescriptor, ctx: FormatContext): string {
  const raw = String(value)
  for (const option of column.options ?? []) {
    if (typeof option === 'object' && option !== null) {
      if (String(option.value) === raw && option.labelKey && ctx.translate) {
        return ctx.translate(option.labelKey, raw)
      }
    }
  }
  return raw
}

function resolveCurrency(column: ReportColumnDescriptor, row: Record<string, unknown> | undefined): string | null {
  const fromRow = readPath(row, column.currencyField)
  if (typeof fromRow === 'string' && /^[A-Za-z]{3}$/.test(fromRow)) return fromRow.toUpperCase()
  if (column.currency && /^[A-Za-z]{3}$/.test(column.currency)) return column.currency.toUpperCase()
  return null
}

function formatMoney(value: unknown, column: ReportColumnDescriptor, ctx: FormatContext, format: FieldFormat): string | null {
  const currency = resolveCurrency(column, ctx.row)
  if (!currency) {
    return formatNumberExact(
      new Intl.NumberFormat(ctx.locale, numberOptions(format, { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
      value,
    )
  }
  let formatter: Intl.NumberFormat
  try {
    formatter = new Intl.NumberFormat(ctx.locale, numberOptions(format, { style: 'currency', currency }))
  } catch {
    formatter = new Intl.NumberFormat(ctx.locale, numberOptions(format, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
  }
  return formatNumberExact(formatter, value)
}

/**
 * The single display formatter for report values. Used by the result table,
 * pivot cells, chart axes / tooltips / legends, dashboard tiles, embeds and
 * the Markdown / email output. Exports (CSV / JSON / XLSX) keep raw values.
 */
export function formatReportValue(
  value: unknown,
  column: ReportColumnDescriptor | undefined,
  ctx: FormatContext,
): string {
  if (value === null || value === undefined || value === '') return NULL_DISPLAY
  const format: FieldFormat = { ...(column?.format ?? {}), ...(ctx.override ?? {}) }
  const kind = column?.kind
  const translate = ctx.translate ?? ((_key: string, fallback: string) => fallback)
  switch (kind) {
    case 'boolean': {
      const truthy = value === true || value === 'true' || value === 1 || value === '1'
      return truthy ? translate('reports.format.yes', 'Yes') : translate('reports.format.no', 'No')
    }
    case 'date':
      return formatDateOnly(value, ctx.locale, format.dateStyle) ?? String(value)
    case 'datetime':
      return formatDateTime(value, ctx.locale, ctx.timeZone, format.dateStyle) ?? String(value)
    case 'integer':
      return (
        formatNumberExact(new Intl.NumberFormat(ctx.locale, numberOptions(format, { maximumFractionDigits: 0 })), value) ??
        String(value)
      )
    case 'float':
    case 'pivot_cell':
      return (
        formatNumberExact(
          new Intl.NumberFormat(ctx.locale, numberOptions(format, { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
          value,
        ) ?? String(value)
      )
    case 'money':
      return formatMoney(value, column as ReportColumnDescriptor, ctx, format) ?? String(value)
    case 'enum':
      return enumLabel(value, column as ReportColumnDescriptor, ctx)
    case 'fk': {
      const label = ctx.fkLabels?.[String(value)]
      return label ?? String(value)
    }
    case 'json':
      return typeof value === 'object' ? JSON.stringify(value) : String(value)
    default:
      if (typeof value === 'boolean') {
        return value ? translate('reports.format.yes', 'Yes') : translate('reports.format.no', 'No')
      }
      if (typeof value === 'number') {
        return new Intl.NumberFormat(ctx.locale, numberOptions(format, { maximumFractionDigits: 2 })).format(value)
      }
      if (typeof value === 'object') return JSON.stringify(value)
      return String(value)
  }
}

/** Find a column descriptor by output key. */
export function findColumn(
  columns: readonly ReportColumnDescriptor[] | undefined,
  key: string,
): ReportColumnDescriptor | undefined {
  return columns?.find((c) => c.key === key)
}
