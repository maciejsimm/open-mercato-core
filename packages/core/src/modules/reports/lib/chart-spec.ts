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
