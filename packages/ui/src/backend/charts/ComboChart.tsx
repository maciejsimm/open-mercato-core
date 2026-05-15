"use client"

import * as React from 'react'
import {
  ComposedChart,
  Bar,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ChartTooltipContent, resolveChartColor } from './ChartUtils'

export type ComboChartDataItem = Record<string, string | number | null | undefined>

export type ComboSeriesKind = 'bar' | 'line' | 'area'

export type ComboSeries = {
  /** Data-key on each row that holds the value for this series. */
  key: string
  /** Display label (used in legend and tooltip). */
  label?: string
  /** Render kind for this series. */
  kind: ComboSeriesKind
  /** Optional color override (else the theme palette is used). */
  color?: string
  /** Bar-only: stack id (siblings sharing a stackId render stacked). */
  stackId?: string
  /** Line/area: curve interpolation. */
  curveType?: 'linear' | 'natural' | 'monotone' | 'step'
}

export type ComboChartProps = {
  title?: string
  data: ComboChartDataItem[]
  index: string
  series: ComboSeries[]
  loading?: boolean
  error?: string | null
  valueFormatter?: (value: number) => string
  showLegend?: boolean
  showGridLines?: boolean
  className?: string
  emptyMessage?: string
}

function defaultValueFormatter(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export function ComboChart({
  title,
  data,
  index,
  series,
  loading,
  error,
  valueFormatter = defaultValueFormatter,
  showLegend = true,
  showGridLines = true,
  className = '',
  emptyMessage = 'No data available',
}: ComboChartProps) {
  const colorOf = (idx: number, override?: string): string => resolveChartColor(override, idx)

  const hasWrapper = !!title
  const wrapperClass = hasWrapper ? `rounded-lg border bg-card p-4 ${className}` : className
  const categoryLabels = React.useMemo(() => {
    const out: Record<string, string> = {}
    for (const s of series) if (s.label) out[s.key] = s.label
    return out
  }, [series])

  if (error) {
    return (
      <div className={wrapperClass}>
        {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
        <div className="flex h-40 sm:h-48 items-center justify-center">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className={wrapperClass}>
        {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
        <div className="flex h-40 sm:h-48 items-center justify-center">
          <Spinner className="h-6 w-6 text-muted-foreground" />
        </div>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className={wrapperClass}>
        {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
        <div className="flex h-40 sm:h-48 items-center justify-center">
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={wrapperClass}>
      {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          {showGridLines && <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />}
          <XAxis dataKey={index} tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={valueFormatter} width={50} tick={{ fontSize: 10 }} />
          <Tooltip
            cursor={{ fill: 'hsl(var(--muted))', opacity: 0.2 }}
            content={
              <ChartTooltipContent
                valueFormatter={valueFormatter}
                categoryLabels={categoryLabels}
                labelFormatter={(label, payload) => {
                  const entry = payload?.[0] as { payload?: ComboChartDataItem } | undefined
                  const item = entry?.payload
                  return item?.[index] ? String(item[index]) : label
                }}
              />
            }
          />
          {showLegend && series.length > 1 && <Legend verticalAlign="top" height={36} />}
          {series.map((s, idx) => {
            const color = colorOf(idx, s.color)
            if (s.kind === 'bar') {
              return (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label ?? s.key}
                  stackId={s.stackId}
                  fill={color}
                  radius={[4, 4, 0, 0]}
                />
              )
            }
            if (s.kind === 'area') {
              return (
                <Area
                  key={s.key}
                  type={s.curveType ?? 'monotone'}
                  dataKey={s.key}
                  name={s.label ?? s.key}
                  stroke={color}
                  fill={color}
                  fillOpacity={0.25}
                  strokeWidth={2}
                />
              )
            }
            return (
              <Line
                key={s.key}
                type={s.curveType ?? 'monotone'}
                dataKey={s.key}
                name={s.label ?? s.key}
                stroke={color}
                strokeWidth={2}
                dot={false}
              />
            )
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export default ComboChart
