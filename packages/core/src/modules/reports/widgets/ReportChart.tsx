"use client"

import * as React from 'react'
import {
  AreaChart,
  BarChart,
  ComboChart,
  DonutChart,
  LineChart,
  PieChart,
  ScatterChart,
  type AreaChartDataItem,
  type BarChartDataItem,
  type ComboChartDataItem,
  type LineChartDataItem,
  type ScatterSeries,
} from '@open-mercato/ui/backend/charts'
import { buildChartRenderPlan, type ChartSpec } from '../lib/chart-spec'
import type { Row } from '../lib/aggregator'

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
  /** Optional chart title rendered by the underlying wrapper. */
  title?: string
  loading?: boolean
  error?: string | null
  /** Override the empty-state copy ("No data available" by default). */
  emptyMessage?: string
  /** Wrapper class forwarded to whichever chart wrapper is selected. */
  className?: string
}

/**
 * Thin discriminating adapter that switches on `spec.type` and renders the matching
 * `@open-mercato/ui/backend/charts/*` wrapper. Never re-implements `<ChartContainer>` /
 * `<ChartTooltip>` primitives — those live in `@open-mercato/ui`.
 */
export function ReportChart({ spec, rows, title, loading, error, emptyMessage, className }: ReportChartProps) {
  const plan = React.useMemo(() => buildChartRenderPlan(spec, rows), [spec, rows])

  if (plan.kind === 'pie') {
    return (
      <PieChart
        title={title}
        data={plan.data}
        loading={loading}
        error={error}
        emptyMessage={emptyMessage}
        className={className}
        showTooltip
      />
    )
  }
  if (plan.kind === 'donut') {
    return (
      <DonutChart
        title={title}
        data={plan.data}
        loading={loading}
        error={error}
        emptyMessage={emptyMessage}
        className={className}
        showTooltip
      />
    )
  }
  if (plan.kind === 'scatter') {
    const series: ScatterSeries[] = plan.series.map((s) => ({
      name: s.name,
      data: asChartData(s.data),
    }))
    return (
      <ScatterChart
        title={title}
        series={series}
        xField={plan.xField}
        yField={plan.yField}
        loading={loading}
        error={error}
        emptyMessage={emptyMessage}
        className={className}
        showLegend={plan.showLegend}
      />
    )
  }
  if (plan.kind === 'combo') {
    return (
      <ComboChart
        title={title}
        data={asChartData<ComboChartDataItem>(plan.data)}
        index={plan.index}
        series={plan.series}
        loading={loading}
        error={error}
        emptyMessage={emptyMessage}
        className={className}
        showLegend={plan.showLegend}
      />
    )
  }
  if (plan.kind === 'area') {
    return (
      <AreaChart
        title={title}
        data={asChartData<AreaChartDataItem>(plan.data)}
        index={plan.index}
        categories={plan.categories}
        stacked={plan.stacked}
        loading={loading}
        error={error}
        emptyMessage={emptyMessage}
        className={className}
        showLegend={plan.showLegend}
      />
    )
  }
  if (plan.kind === 'line') {
    return (
      <LineChart
        title={title}
        data={asChartData<LineChartDataItem>(plan.data)}
        index={plan.index}
        categories={plan.categories}
        loading={loading}
        error={error}
        emptyMessage={emptyMessage}
        className={className}
        showLegend={plan.showLegend}
      />
    )
  }
  if (plan.kind === 'bar') {
    return (
      <BarChart
        title={title}
        data={asChartData<BarChartDataItem>(plan.data)}
        index={plan.index}
        categories={plan.categories}
        loading={loading}
        error={error}
        emptyMessage={emptyMessage}
        className={className}
        showLegend={plan.showLegend}
      />
    )
  }
  return null
}

export default ReportChart
