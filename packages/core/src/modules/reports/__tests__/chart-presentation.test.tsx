/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import {
  AUTO_DATA_LABEL_MAX_POINTS,
  REPORT_CHART_PALETTE,
  buildChartRenderPlan,
  chartColorName,
  chartPaletteFor,
  isChartPlanEmpty,
  shouldShowDataLabels,
  truncateAxisLabel,
  type ChartSpec,
} from '../lib/chart-spec'
import { ReportChart } from '../widgets/ReportChart'

const spec = (overrides: Partial<ChartSpec> = {}): ChartSpec => ({
  type: 'bar',
  xField: 'region',
  yFields: ['sum_amount'],
  ...overrides,
})

describe('chart palette', () => {
  it('defaults to the named DS palette and starts away from the theme orange', () => {
    expect(chartPaletteFor(spec())).toBe(REPORT_CHART_PALETTE)
    expect(REPORT_CHART_PALETTE[0]).toBe('blue')
  })

  it('honours a persisted palette and wraps around', () => {
    const palette = chartPaletteFor(spec({ palette: ['rose', 'teal'] }))
    expect(palette).toEqual(['rose', 'teal'])
    expect(chartColorName(palette, 0)).toBe('rose')
    expect(chartColorName(palette, 3)).toBe('teal')
  })
})

describe('shouldShowDataLabels', () => {
  const bar = { kind: 'bar' as const, pointCount: 5, seriesCount: 1 }

  it('labels a small single bar series automatically', () => {
    expect(shouldShowDataLabels('auto', bar)).toBe(true)
    expect(shouldShowDataLabels(undefined, bar)).toBe(true)
  })

  it('skips automatic labels for dense, multi-series, stacked or non-bar charts', () => {
    expect(shouldShowDataLabels('auto', { ...bar, pointCount: AUTO_DATA_LABEL_MAX_POINTS + 1 })).toBe(false)
    expect(shouldShowDataLabels('auto', { ...bar, seriesCount: 2 })).toBe(false)
    expect(shouldShowDataLabels('auto', { ...bar, stacked: true })).toBe(false)
    expect(shouldShowDataLabels('auto', { ...bar, kind: 'line' })).toBe(false)
  })

  it('respects an explicit choice', () => {
    expect(shouldShowDataLabels(true, { ...bar, kind: 'line', seriesCount: 3 })).toBe(true)
    expect(shouldShowDataLabels(false, bar)).toBe(false)
  })
})

describe('isChartPlanEmpty', () => {
  it('detects plans without numeric values', () => {
    expect(isChartPlanEmpty(buildChartRenderPlan(spec(), []))).toBe(true)
    expect(isChartPlanEmpty(buildChartRenderPlan(spec(), [{ region: 'EU', sum_amount: null }]))).toBe(true)
    expect(isChartPlanEmpty(buildChartRenderPlan(spec(), [{ region: 'EU', sum_amount: 3 }]))).toBe(false)
    expect(isChartPlanEmpty(buildChartRenderPlan(spec({ type: 'pie' }), []))).toBe(true)
  })
})

describe('truncateAxisLabel', () => {
  it('keeps short labels and ellipsises long ones', () => {
    expect(truncateAxisLabel('EU')).toBe('EU')
    expect(truncateAxisLabel('A very long region name here', 10)).toBe('A very lo…')
    expect(truncateAxisLabel(null)).toBe('')
  })
})

describe('ReportChart', () => {
  it('renders the empty state when there is nothing to plot', () => {
    renderWithProviders(<ReportChart spec={spec()} rows={[]} />)
    expect(screen.getByTestId('report-chart-empty')).toBeTruthy()
    expect(screen.getByText('No data to chart yet.')).toBeTruthy()
  })

  it('uses a caller-supplied empty message', () => {
    renderWithProviders(<ReportChart spec={spec()} rows={[]} emptyMessage="Nothing here" />)
    expect(screen.getByText('Nothing here')).toBeTruthy()
  })

  it('renders the cartesian chart host for bar data', () => {
    renderWithProviders(
      <ReportChart spec={spec()} rows={[{ region: 'EU', sum_amount: 3 }, { region: 'US', sum_amount: 5 }]} height={240} />,
    )
    const host = screen.getByTestId('report-chart')
    expect(host).toBeTruthy()
    expect(host.querySelector('[style*="height: 240px"]')).toBeTruthy()
  })
})
