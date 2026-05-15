"use client"

import * as React from 'react'
import {
  AreaChart as RechartsAreaChart,
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

export type AreaChartDataItem = Record<string, string | number | null | undefined>

export type AreaChartProps = {
  title?: string
  data: AreaChartDataItem[]
  index: string
  categories: string[]
  loading?: boolean
  error?: string | null
  colors?: string[]
  stacked?: boolean
  valueFormatter?: (value: number) => string
  showLegend?: boolean
  showGridLines?: boolean
  curveType?: 'linear' | 'natural' | 'monotone' | 'step'
  connectNulls?: boolean
  className?: string
  emptyMessage?: string
  categoryLabels?: Record<string, string>
}

function defaultValueFormatter(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export function AreaChart({
  title,
  data,
  index,
  categories,
  loading,
  error,
  colors,
  stacked = false,
  valueFormatter = defaultValueFormatter,
  showLegend = true,
  showGridLines = true,
  curveType = 'monotone',
  connectNulls = false,
  className = '',
  emptyMessage = 'No data available',
  categoryLabels,
}: AreaChartProps) {
  const getColor = (idx: number): string => resolveChartColor(colors?.[idx], idx)

  const hasWrapper = !!title
  const wrapperClass = hasWrapper ? `rounded-lg border bg-card p-4 ${className}` : className

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
      <ResponsiveContainer width="100%" height={220}>
        <RechartsAreaChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <defs>
            {categories.map((category, idx) => (
              <linearGradient key={`grad-${category}`} id={`area-${category}-${idx}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={getColor(idx)} stopOpacity={0.4} />
                <stop offset="95%" stopColor={getColor(idx)} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          {showGridLines && <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />}
          <XAxis dataKey={index} tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={valueFormatter} width={50} tick={{ fontSize: 10 }} />
          <Tooltip
            content={
              <ChartTooltipContent
                valueFormatter={valueFormatter}
                categoryLabels={categoryLabels}
                labelFormatter={(label, payload) => {
                  const entry = payload?.[0] as { payload?: AreaChartDataItem } | undefined
                  const item = entry?.payload
                  return item?.[index] ? String(item[index]) : label
                }}
              />
            }
            cursor={{ fill: 'hsl(var(--muted))', opacity: 0.2 }}
          />
          {showLegend && categories.length > 1 && <Legend verticalAlign="top" height={36} />}
          {categories.map((category, idx) => (
            <Area
              key={category}
              type={curveType}
              dataKey={category}
              stackId={stacked ? 'stack-1' : undefined}
              stroke={getColor(idx)}
              fill={`url(#area-${category}-${idx})`}
              strokeWidth={2}
              connectNulls={connectNulls}
            />
          ))}
        </RechartsAreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export default AreaChart
