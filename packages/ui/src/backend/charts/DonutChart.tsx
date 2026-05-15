"use client"

import * as React from 'react'
import { PieChart, type PieChartDataItem, type PieChartProps } from './PieChart'

export type DonutChartDataItem = PieChartDataItem

export type DonutChartProps = Omit<PieChartProps, 'variant'>

/**
 * Thin wrapper around `<PieChart variant="donut" />` so consumers can
 * import a dedicated `DonutChart` component (matches the chart-type ↔ wrapper
 * mapping used by the reports module's `<ReportChart>` adapter).
 */
export function DonutChart(props: DonutChartProps) {
  return <PieChart {...props} variant="donut" />
}

export default DonutChart
