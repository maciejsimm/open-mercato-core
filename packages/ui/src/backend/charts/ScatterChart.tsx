"use client"

import * as React from 'react'
import {
  ScatterChart as RechartsScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ChartTooltipContent, resolveChartColor } from './ChartUtils'

export type ScatterChartDataItem = Record<string, string | number | null | undefined>

export type ScatterSeries = {
  /** Stable identifier used for legend and color resolution. */
  name: string
  /** Data points; each item must carry the `xField` and `yField` keys. */
  data: ScatterChartDataItem[]
  /** Optional override color. */
  color?: string
}

export type ScatterChartProps = {
  title?: string
  series: ScatterSeries[]
  xField: string
  yField: string
  /** Optional bubble-size field. */
  zField?: string
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

export function ScatterChart({
  title,
  series,
  xField,
  yField,
  zField,
  loading,
  error,
  valueFormatter = defaultValueFormatter,
  showLegend = true,
  showGridLines = true,
  className = '',
  emptyMessage = 'No data available',
}: ScatterChartProps) {
  const getColor = (idx: number, override?: string): string => resolveChartColor(override, idx)

  const hasWrapper = !!title
  const wrapperClass = hasWrapper ? `rounded-lg border bg-card p-4 ${className}` : className
  const flatLen = series.reduce((acc, s) => acc + s.data.length, 0)

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

  if (flatLen === 0) {
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
        <RechartsScatterChart margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          {showGridLines && <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />}
          <XAxis type="number" dataKey={xField} tick={{ fontSize: 11 }} tickFormatter={valueFormatter} />
          <YAxis type="number" dataKey={yField} tick={{ fontSize: 10 }} tickFormatter={valueFormatter} width={50} />
          {zField ? <ZAxis type="number" dataKey={zField} range={[40, 240]} /> : null}
          <Tooltip
            cursor={{ strokeDasharray: '3 3' }}
            content={<ChartTooltipContent valueFormatter={valueFormatter} />}
          />
          {showLegend && series.length > 1 && <Legend verticalAlign="top" height={36} />}
          {series.map((s, idx) => (
            <Scatter key={s.name} name={s.name} data={s.data} fill={getColor(idx, s.color)} />
          ))}
        </RechartsScatterChart>
      </ResponsiveContainer>
    </div>
  )
}

export default ScatterChart
