import type { MeasureExpr, Row } from './aggregator'
import { measureAlias, readFieldValue } from './aggregator'

export type ChartType = 'bar' | 'line' | 'pie' | 'donut' | 'area' | 'scatter' | 'combo'

export type ChartSpec = {
  type: ChartType
  xField: string
  yFields: string[]
  stacked?: boolean
  showLegend?: boolean
}

/**
 * Project aggregated rows + a ChartSpec into the wide-format `{ index, data, categories }`
 * shape consumed by `BarChart` / `LineChart` / `AreaChart`.
 *
 * - `index` is `spec.xField`.
 * - `categories` are `spec.yFields`. When `yFields` is empty we fall back to every numeric
 *   key on the first row that is not the xField — so a freshly-saved chart still renders
 *   something on first preview.
 * - Rows are returned as-is, projected to `{ [index]: ..., [yField]: ... }` so the chart
 *   wrappers (which read `dataKey={category}`) can plot them.
 */
export function buildWideChartData(spec: ChartSpec, rows: readonly Row[]): {
  index: string
  categories: string[]
  data: Row[]
} {
  const categories = spec.yFields.length > 0
    ? [...spec.yFields]
    : inferNumericKeys(rows, spec.xField)
  const data: Row[] = rows.map((row) => {
    const projection: Row = { [spec.xField]: readFieldValue(row, spec.xField) }
    for (const key of categories) projection[key] = readFieldValue(row, key)
    return projection
  })
  return { index: spec.xField, categories, data }
}

/**
 * Project rows into `[{ name, value }]` for `PieChart` / `DonutChart`. Pie/donut charts
 * accept exactly one yField — the spec validator enforces that. We pick the first yField
 * (or the first inferred numeric key) and label each slice by the xField value.
 */
export function buildPieChartData(spec: ChartSpec, rows: readonly Row[]): Array<{ name: string; value: number }> {
  const valueKey = spec.yFields[0] ?? inferNumericKeys(rows, spec.xField)[0]
  if (!valueKey) return []
  const out: Array<{ name: string; value: number }> = []
  for (const row of rows) {
    const rawName = readFieldValue(row, spec.xField)
    const rawValue = readFieldValue(row, valueKey)
    const num = coerceNumber(rawValue)
    if (num === undefined) continue
    out.push({ name: String(rawName ?? ''), value: num })
  }
  return out
}

/**
 * Project rows into the `series` shape consumed by `ScatterChart`. A scatter chart has
 * exactly one yField. Each row becomes a point with `{ [xField]: x, [yField]: y }`.
 *
 * If `groupKey` is supplied, points are split into one series per distinct group value
 * (so the chart legend shows multiple colored clouds). Otherwise the whole set is a
 * single series labeled with the yField alias.
 */
export function buildScatterChartData(
  spec: ChartSpec,
  rows: readonly Row[],
  options?: { groupKey?: string },
): Array<{ name: string; data: Row[] }> {
  const yKey = spec.yFields[0]
  if (!yKey) return []
  const groupKey = options?.groupKey
  if (!groupKey) {
    const points: Row[] = []
    for (const row of rows) {
      const x = coerceNumber(readFieldValue(row, spec.xField))
      const y = coerceNumber(readFieldValue(row, yKey))
      if (x === undefined || y === undefined) continue
      points.push({ [spec.xField]: x, [yKey]: y })
    }
    return [{ name: yKey, data: points }]
  }
  const groups = new Map<string, Row[]>()
  const groupOrder: string[] = []
  for (const row of rows) {
    const x = coerceNumber(readFieldValue(row, spec.xField))
    const y = coerceNumber(readFieldValue(row, yKey))
    if (x === undefined || y === undefined) continue
    const rawGroup = readFieldValue(row, groupKey)
    const groupLabel = rawGroup === null || rawGroup === undefined ? '∅' : String(rawGroup)
    if (!groups.has(groupLabel)) {
      groups.set(groupLabel, [])
      groupOrder.push(groupLabel)
    }
    groups.get(groupLabel)!.push({ [spec.xField]: x, [yKey]: y })
  }
  return groupOrder.map((label) => ({ name: label, data: groups.get(label) ?? [] }))
}

/**
 * Build the `series` array for `ComboChart`. Each yField becomes a series; the first
 * yField is rendered as bar by default, subsequent as line. Callers can override with
 * a `kindFor` function for finer control.
 */
export function buildComboSeries(
  spec: ChartSpec,
  options?: { kindFor?: (alias: string, index: number) => 'bar' | 'line' | 'area' },
): Array<{ key: string; label: string; kind: 'bar' | 'line' | 'area'; stackId?: string }> {
  const kindFor = options?.kindFor ?? ((_alias, index) => (index === 0 ? 'bar' : 'line'))
  return spec.yFields.map((alias, idx) => ({
    key: alias,
    label: alias,
    kind: kindFor(alias, idx),
    stackId: spec.stacked && kindFor(alias, idx) === 'bar' ? 'combo-stack-1' : undefined,
  }))
}

/**
 * Convenience: render-ready props for whichever chart wrapper matches `spec.type`.
 * Use this when you want one switch site instead of branching on chart.type yourself.
 */
export type ChartRenderPlan =
  | { kind: 'bar' | 'line' | 'area'; index: string; categories: string[]; data: Row[]; stacked?: boolean; showLegend?: boolean }
  | { kind: 'pie' | 'donut'; data: Array<{ name: string; value: number }>; showLegend?: boolean }
  | { kind: 'scatter'; xField: string; yField: string; series: Array<{ name: string; data: Row[] }>; showLegend?: boolean }
  | { kind: 'combo'; index: string; data: Row[]; series: Array<{ key: string; label: string; kind: 'bar' | 'line' | 'area'; stackId?: string }>; showLegend?: boolean }

export function buildChartRenderPlan(spec: ChartSpec, rows: readonly Row[]): ChartRenderPlan {
  if (spec.type === 'pie' || spec.type === 'donut') {
    return {
      kind: spec.type,
      data: buildPieChartData(spec, rows),
      showLegend: spec.showLegend,
    }
  }
  if (spec.type === 'scatter') {
    return {
      kind: 'scatter',
      xField: spec.xField,
      yField: spec.yFields[0] ?? '',
      series: buildScatterChartData(spec, rows),
      showLegend: spec.showLegend,
    }
  }
  if (spec.type === 'combo') {
    const wide = buildWideChartData(spec, rows)
    return {
      kind: 'combo',
      index: wide.index,
      data: wide.data,
      series: buildComboSeries(spec),
      showLegend: spec.showLegend,
    }
  }
  const wide = buildWideChartData(spec, rows)
  return {
    kind: spec.type,
    index: wide.index,
    categories: wide.categories,
    data: wide.data,
    stacked: spec.stacked,
    showLegend: spec.showLegend,
  }
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) return undefined
    const num = Number(trimmed)
    return Number.isFinite(num) ? num : undefined
  }
  if (typeof value === 'bigint') {
    const num = Number(value)
    return Number.isFinite(num) ? num : undefined
  }
  return undefined
}

function inferNumericKeys(rows: readonly Row[], excludeKey: string): string[] {
  const first = rows[0]
  if (!first) return []
  const out: string[] = []
  for (const key of Object.keys(first)) {
    if (key === excludeKey) continue
    if (coerceNumber(first[key]) !== undefined) out.push(key)
  }
  return out
}

/**
 * Helper used by callers that hold `MeasureExpr` arrays (e.g. the builder save path):
 * derive the wire-format alias the aggregator will write under for each measure, so
 * the chart's `yFields` align with whatever the executor produced.
 */
export function aliasesFor(measures: readonly MeasureExpr[]): string[] {
  return measures.map((m) => measureAlias(m))
}

/** Chart kinds that plot exactly one Y series. */
export function isSingleSeriesChart(type: ChartType): boolean {
  return type === 'pie' || type === 'donut' || type === 'scatter'
}

/**
 * Keep `yFields` in step with the measure list: a new measure's alias is
 * added, a removed measure's alias is removed, and a renamed alias (same
 * position, new alias) is renamed in place. Single-series kinds keep at most
 * one Y field; when measures exist but nothing is plotted, the first alias is
 * selected so the chart stays valid for the server validator.
 */
export function syncChartYFields(
  spec: Pick<ChartSpec, 'type' | 'yFields'>,
  prevMeasures: readonly MeasureExpr[],
  nextMeasures: readonly MeasureExpr[],
): string[] {
  const prevAliases = aliasesFor(prevMeasures)
  const nextAliases = aliasesFor(nextMeasures)
  const nextSet = new Set(nextAliases)
  const renames = new Map<string, string>()
  if (prevAliases.length === nextAliases.length) {
    prevAliases.forEach((alias, idx) => {
      if (alias !== nextAliases[idx]) renames.set(alias, nextAliases[idx])
    })
  }
  const kept: string[] = []
  for (const y of spec.yFields) {
    const mapped = renames.get(y) ?? y
    if (nextSet.has(mapped) && !kept.includes(mapped)) kept.push(mapped)
  }
  const prevSet = new Set(prevAliases)
  for (const alias of nextAliases) {
    if (prevSet.has(alias) || renames.size > 0) continue
    if (!kept.includes(alias)) kept.push(alias)
  }
  return limitChartYFields(spec.type, kept, nextAliases)
}

/** Apply the single-series limit and the "at least one series" default. */
export function limitChartYFields(type: ChartType, yFields: readonly string[], aliases: readonly string[]): string[] {
  const available = new Set(aliases)
  const valid = yFields.filter((y) => available.has(y))
  if (isSingleSeriesChart(type) && valid.length > 1) return valid.slice(0, 1)
  if (valid.length === 0 && aliases.length > 0) return [aliases[0]]
  return valid
}

/**
 * Client mirror of `effectiveChartGroupBy`: with an explicit `groupBy`, the X
 * field must be one of its keys (the server validator rejects anything else),
 * so a stale X field falls back to the first group key.
 */
export function resolveChartXField(xField: string, groupBy: readonly string[]): string {
  if (groupBy.length === 0) return xField
  return groupBy.includes(xField) ? xField : groupBy[0]
}

export type ChartFormatOptions = {
  /** Format one value of the column `key`; `row` is the source row when available. */
  formatValue?: (value: unknown, key: string, row?: Row) => string
  /** Human label of a Y series (measure alias). */
  seriesLabel?: (key: string) => string
}

function uniqueLabels(keys: readonly string[], seriesLabel: (key: string) => string): Map<string, string> {
  const out = new Map<string, string>()
  const used = new Set<string>()
  for (const key of keys) {
    let label = seriesLabel(key) || key
    if (used.has(label)) label = `${label} (${key})`
    used.add(label)
    out.set(key, label)
  }
  return out
}

/**
 * Turn a raw render plan into a display plan: category (X) values are run
 * through `formatValue`, and series keys are renamed to their human labels so
 * the legend and tooltips show labels instead of aliases. Numeric scatter axes
 * stay numeric.
 */
export function formatChartRenderPlan(
  plan: ChartRenderPlan,
  rows: readonly Row[],
  spec: ChartSpec,
  options: ChartFormatOptions,
): ChartRenderPlan {
  const formatValue = options.formatValue
  const seriesLabel = options.seriesLabel ?? ((key: string) => key)
  if (plan.kind === 'pie' || plan.kind === 'donut') {
    if (!formatValue) return plan
    const valueKey = spec.yFields[0]
    const data: Array<{ name: string; value: number }> = []
    for (const row of rows) {
      const raw = readFieldValue(row, valueKey ?? '')
      const num = coerceNumber(raw)
      if (num === undefined) continue
      data.push({ name: formatValue(readFieldValue(row, spec.xField), spec.xField, row), value: num })
    }
    return valueKey ? { ...plan, data } : plan
  }
  if (plan.kind === 'scatter') {
    return { ...plan, series: plan.series.map((s) => ({ ...s, name: s.name === plan.yField ? seriesLabel(s.name) || s.name : s.name })) }
  }
  if (plan.kind === 'combo') {
    const data = plan.data.map((row, idx) => ({
      ...row,
      [plan.index]: formatValue ? formatValue(row[plan.index], plan.index, rows[idx]) : row[plan.index],
    }))
    const labels = uniqueLabels(plan.series.map((s) => s.key), seriesLabel)
    return { ...plan, data, series: plan.series.map((s) => ({ ...s, label: labels.get(s.key) ?? s.label })) }
  }
  if (plan.kind === 'bar' || plan.kind === 'line' || plan.kind === 'area') {
    return formatWidePlan(plan, rows, formatValue, seriesLabel)
  }
  return plan
}

function formatWidePlan(
  plan: Extract<ChartRenderPlan, { kind: 'bar' | 'line' | 'area' }>,
  rows: readonly Row[],
  formatValue: ChartFormatOptions['formatValue'],
  seriesLabel: (key: string) => string,
): ChartRenderPlan {
  const labels = uniqueLabels(plan.categories, seriesLabel)
  const data = plan.data.map((row, idx) => {
    const projected: Row = {
      [plan.index]: formatValue ? formatValue(row[plan.index], plan.index, rows[idx]) : row[plan.index],
    }
    for (const key of plan.categories) projected[labels.get(key) ?? key] = row[key]
    return projected
  })
  return { ...plan, data, categories: plan.categories.map((key) => labels.get(key) ?? key) }
}
