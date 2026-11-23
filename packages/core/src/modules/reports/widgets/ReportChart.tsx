"use client"

import * as React from 'react'
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { BarChart3 } from 'lucide-react'
import {
  DonutChart,
  PieChart,
  ScatterChart,
  type ScatterSeries,
} from '@open-mercato/ui/backend/charts'
import { resolveChartColor } from '@open-mercato/ui/backend/charts/ChartUtils'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useOptionalLocale, useOptionalT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type { ColumnFormats, ReportColumnDescriptor } from '@open-mercato/shared/modules/reports/dsl'
import {
  buildChartRenderPlan,
  chartColorName,
  chartPaletteFor,
  formatChartRenderPlan,
  isChartPlanEmpty,
  shouldShowDataLabels,
  truncateAxisLabel,
  type ChartRenderPlan,
  type ChartSpec,
  type DataLabelsMode,
} from '../lib/chart-spec'
import type { Row } from '../lib/aggregator'
import { findColumn, formatReportValue } from '../lib/format'

function asChartData<T>(rows: readonly Row[]): T[] {
  // The chart wrappers expect Record<string, string | number | null | undefined>; the
  // upstream helpers in chart-spec.ts already coerce values to that shape, so the cast
  // is sound at runtime.
  return rows as unknown as T[]
}

export type ReportChartProps = {
  /** Persisted chart specification (from definition.chart). */
  spec: ChartSpec
  /** Aggregated rows produced by the executor. Pass an empty array to show the empty state. */
  rows: readonly Row[]
  /** Optional chart title rendered above the plot. */
  title?: string
  loading?: boolean
  error?: string | null
  /** Override the empty-state copy. */
  emptyMessage?: string
  /** Wrapper class for the chart host. */
  className?: string
  /** Column descriptors from the run response `meta.columns`; drive axis, tooltip and legend formatting. */
  columns?: readonly ReportColumnDescriptor[]
  /** Per-report format overrides (`definition.columnFormats`). */
  columnFormats?: ColumnFormats
  /** Human labels for Y series keyed by measure alias (legend + tooltip). */
  seriesLabels?: Readonly<Record<string, string>>
  /** Value labels on the marks: `auto` (default) labels a single bar series with few points. */
  dataLabels?: DataLabelsMode
  /** Plot height in px for bar / line / area / combo charts. */
  height?: number
}

function sameFormatting(a: ReportColumnDescriptor, b: ReportColumnDescriptor): boolean {
  return a.kind === b.kind && a.currency === b.currency && JSON.stringify(a.format ?? {}) === JSON.stringify(b.format ?? {})
}

type SeriesMark = { key: string; alias: string; label: string; kind: 'bar' | 'line' | 'area'; stackId?: string; color: string }

type CartesianModel = {
  index: string
  data: Row[]
  series: SeriesMark[]
  showLegend: boolean
}

function cartesianModel(
  raw: Extract<ChartRenderPlan, { kind: 'bar' | 'line' | 'area' | 'combo' }>,
  display: ChartRenderPlan,
  palette: readonly string[],
): CartesianModel | null {
  const colorAt = (idx: number) => resolveChartColor(chartColorName(palette, idx), idx)
  if (raw.kind === 'combo' && display.kind === 'combo') {
    return {
      index: display.index,
      data: display.data,
      series: display.series.map((s, idx) => ({
        key: s.key,
        alias: s.key,
        label: s.label,
        kind: s.kind,
        stackId: s.stackId,
        color: colorAt(idx),
      })),
      showLegend: display.showLegend !== false && display.series.length > 1,
    }
  }
  if (raw.kind !== 'combo' && (display.kind === 'bar' || display.kind === 'line' || display.kind === 'area')) {
    const kind = raw.kind
    return {
      index: display.index,
      data: display.data,
      series: display.categories.map((key, idx) => ({
        key,
        alias: raw.categories[idx] ?? key,
        label: key,
        kind,
        stackId: raw.stacked && kind !== 'line' ? 'report-stack' : undefined,
        color: colorAt(idx),
      })),
      showLegend: display.showLegend !== false && display.categories.length > 1,
    }
  }
  return null
}

type TooltipEntry = { dataKey?: unknown; name?: unknown; value?: unknown; color?: string }

function ReportChartTooltip({
  active,
  payload,
  label,
  formatSeries,
  labelOf,
}: {
  active?: boolean
  payload?: readonly TooltipEntry[]
  label?: string | number
  formatSeries: (value: unknown, dataKey: string) => string
  labelOf: (dataKey: string) => string
}) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-md">
      {label !== undefined && label !== '' ? <div className="mb-1 text-sm font-medium">{String(label)}</div> : null}
      <div className="flex flex-col gap-1">
        {payload.map((item, idx) => {
          const dataKey = String(item.dataKey ?? item.name ?? '')
          return (
            <div key={`${dataKey}-${idx}`} className="flex items-center justify-between gap-6">
              <div className="flex items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="text-sm text-muted-foreground">{labelOf(dataKey)}</span>
              </div>
              <span className="text-sm font-medium tabular-nums">{formatSeries(item.value, dataKey)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ChartState({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex h-48 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-4 text-center', className)}>
      {children}
    </div>
  )
}

const AXIS_TICK = { fontSize: 11, fill: 'var(--muted-foreground)' }

/**
 * Discriminating adapter over `spec.type`. Bar / line / area / combo render a
 * styled composed chart (DS palette via `resolveChartColor`, rounded bars,
 * subtle grid, formatted tooltips, optional data labels); pie / donut /
 * scatter delegate to the `@open-mercato/ui/backend/charts` wrappers.
 */
export function ReportChart({
  spec,
  rows,
  title,
  loading,
  error,
  emptyMessage,
  className,
  columns,
  columnFormats,
  seriesLabels,
  dataLabels = 'auto',
  height = 320,
}: ReportChartProps) {
  const locale = useOptionalLocale() ?? 'en'
  const translate = useOptionalT()
  const translateFn = React.useMemo(
    () => (translate ? (labelKey: string, fallback: string) => translate(labelKey, fallback) : undefined),
    [translate],
  )
  const formatValue = React.useCallback(
    (value: unknown, key: string, row?: Row) =>
      formatReportValue(value, findColumn(columns, key), {
        locale,
        translate: translateFn,
        row,
        override: columnFormats?.[key],
      }),
    [columnFormats, columns, locale, translateFn],
  )
  const rawPlan = React.useMemo(() => buildChartRenderPlan(spec, rows), [rows, spec])
  const plan = React.useMemo(() => {
    if (!columns || columns.length === 0) return rawPlan
    return formatChartRenderPlan(rawPlan, rows, spec, {
      formatValue,
      seriesLabel: (key) => seriesLabels?.[key] ?? key,
    })
  }, [columns, formatValue, rawPlan, rows, seriesLabels, spec])
  const palette = React.useMemo(() => chartPaletteFor(spec), [spec])
  const sharedYColumn = React.useMemo(() => {
    const yColumns = spec.yFields.map((key) => findColumn(columns, key)).filter((c): c is ReportColumnDescriptor => !!c)
    if (yColumns.length === 0 || yColumns.length !== spec.yFields.length) return undefined
    const first = yColumns[0]
    return yColumns.every((c) => sameFormatting(c, first)) ? first : undefined
  }, [columns, spec.yFields])
  const valueFormatter = React.useMemo(() => {
    if (!sharedYColumn) return undefined
    return (value: number) => formatValue(value, sharedYColumn.key)
  }, [formatValue, sharedYColumn])
  const compactNumber = React.useMemo(
    () => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }),
    [locale],
  )
  const axisFormatter = React.useCallback(
    (value: number) => {
      if (sharedYColumn) {
        return formatReportValue(value, sharedYColumn, {
          locale,
          translate: translateFn,
          override: { ...(columnFormats?.[sharedYColumn.key] ?? {}), compact: true },
        })
      }
      return Number.isFinite(value) ? compactNumber.format(value) : String(value)
    },
    [columnFormats, compactNumber, locale, sharedYColumn, translateFn],
  )

  const emptyCopy = emptyMessage ?? (translate ? translate('reports.chart.empty', 'No data to chart yet.') : 'No data to chart yet.')
  const heading = title ? <h3 className="mb-3 text-sm font-medium text-foreground">{title}</h3> : null

  if (error) {
    return (
      <div className={className}>
        {heading}
        <ChartState>
          <p className="text-sm text-status-error-text">{error}</p>
        </ChartState>
      </div>
    )
  }
  if (loading) {
    return (
      <div className={className}>
        {heading}
        <div className="flex h-48 items-center justify-center">
          <Spinner className="size-6 text-muted-foreground" />
        </div>
      </div>
    )
  }
  if (isChartPlanEmpty(plan)) {
    return (
      <div className={className} data-testid="report-chart-empty">
        {heading}
        <ChartState>
          <BarChart3 className="size-6 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">{emptyCopy}</p>
        </ChartState>
      </div>
    )
  }

  const paletteColors = plan.kind === 'pie' || plan.kind === 'donut'
    ? plan.data.map((_, idx) => chartColorName(palette, idx))
    : []

  if (plan.kind === 'pie' || plan.kind === 'donut') {
    const Wrapper = plan.kind === 'pie' ? PieChart : DonutChart
    return (
      <div className={className}>
        {heading}
        <Wrapper
          data={plan.data}
          colors={paletteColors}
          emptyMessage={emptyCopy}
          valueFormatter={valueFormatter}
          showTooltip
        />
      </div>
    )
  }
  if (plan.kind === 'scatter') {
    const series: ScatterSeries[] = plan.series.map((s, idx) => ({
      name: s.name,
      data: asChartData(s.data),
      color: resolveChartColor(chartColorName(palette, idx), idx),
    }))
    return (
      <div className={className}>
        {heading}
        <ScatterChart
          series={series}
          xField={plan.xField}
          yField={plan.yField}
          emptyMessage={emptyCopy}
          valueFormatter={valueFormatter}
          showLegend={plan.showLegend}
        />
      </div>
    )
  }

  const cartesianPlan = rawPlan.kind === 'bar' || rawPlan.kind === 'line' || rawPlan.kind === 'area' || rawPlan.kind === 'combo'
    ? rawPlan
    : null
  if (!cartesianPlan) return null
  const model = cartesianModel(cartesianPlan, plan, palette)
  if (!model) return null

  const labelByKey = new Map(model.series.map((s) => [s.key, s.label]))
  const aliasByKey = new Map(model.series.map((s) => [s.key, s.alias]))
  const formatSeries = (value: unknown, dataKey: string): string => {
    const alias = aliasByKey.get(dataKey) ?? dataKey
    if (findColumn(columns, alias)) return formatValue(value, alias)
    return typeof value === 'number' ? value.toLocaleString(locale) : String(value ?? '')
  }
  const barSeries = model.series.filter((s) => s.kind === 'bar')
  const showLabels = shouldShowDataLabels(dataLabels, {
    kind: cartesianPlan.kind,
    pointCount: model.data.length,
    seriesCount: model.series.length,
    stacked: cartesianPlan.kind === 'combo' ? false : cartesianPlan.stacked,
  })
  const denseX = model.data.length > 8
  const topSeriesByStack = new Map<string, string>()
  for (const s of barSeries) topSeriesByStack.set(s.stackId ?? s.key, s.key)

  return (
    <div className={className} data-testid="report-chart">
      {heading}
      <div className="w-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={model.data}
            margin={{ top: showLabels ? 24 : 12, right: 16, left: 4, bottom: denseX ? 24 : 4 }}
            barCategoryGap={model.data.length <= 4 ? '30%' : '18%'}
          >
            <CartesianGrid vertical={false} strokeDasharray="4 4" stroke="var(--border)" />
            <XAxis
              dataKey={model.index}
              tickLine={false}
              axisLine={{ stroke: 'var(--border)' }}
              tick={AXIS_TICK}
              tickMargin={8}
              interval={denseX ? 'preserveStartEnd' : 0}
              angle={denseX ? -30 : 0}
              textAnchor={denseX ? 'end' : 'middle'}
              height={denseX ? 56 : 32}
              tickFormatter={(value: unknown) => truncateAxisLabel(value)}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={AXIS_TICK}
              width={64}
              tickFormatter={axisFormatter}
            />
            <Tooltip
              cursor={{ fill: 'var(--muted)', opacity: 0.5 }}
              content={(props) => (
                <ReportChartTooltip
                  active={props.active}
                  payload={props.payload as readonly TooltipEntry[] | undefined}
                  label={props.label as string | number | undefined}
                  formatSeries={formatSeries}
                  labelOf={(key) => labelByKey.get(key) ?? key}
                />
              )}
            />
            {model.showLegend ? (
              <Legend
                verticalAlign="top"
                align="right"
                iconType="circle"
                iconSize={8}
                height={32}
                wrapperStyle={{ fontSize: 12 }}
              />
            ) : null}
            {model.series.map((s) => {
              if (s.kind === 'bar') {
                const isTop = topSeriesByStack.get(s.stackId ?? s.key) === s.key
                return (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    name={s.label}
                    fill={s.color}
                    stackId={s.stackId}
                    radius={s.stackId && !isTop ? [0, 0, 0, 0] : [6, 6, 0, 0]}
                    maxBarSize={56}
                    isAnimationActive={false}
                  >
                    {showLabels ? (
                      <LabelList
                        dataKey={s.key}
                        position="top"
                        offset={6}
                        fill="var(--muted-foreground)"
                        fontSize={11}
                        formatter={(value: unknown) => formatSeries(value, s.key)}
                      />
                    ) : null}
                  </Bar>
                )
              }
              if (s.kind === 'area') {
                return (
                  <Area
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={s.label}
                    stroke={s.color}
                    fill={s.color}
                    fillOpacity={0.15}
                    strokeWidth={2}
                    stackId={s.stackId}
                    isAnimationActive={false}
                  />
                )
              }
              return (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2.5}
                  dot={model.data.length <= 24 ? { r: 3, strokeWidth: 0, fill: s.color } : false}
                  activeDot={{ r: 5 }}
                  connectNulls
                  isAnimationActive={false}
                >
                  {showLabels ? (
                    <LabelList
                      dataKey={s.key}
                      position="top"
                      offset={8}
                      fill="var(--muted-foreground)"
                      fontSize={11}
                      formatter={(value: unknown) => formatSeries(value, s.key)}
                    />
                  ) : null}
                </Line>
              )
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default ReportChart
