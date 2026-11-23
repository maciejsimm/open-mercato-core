import {
  buildChartRenderPlan,
  formatChartRenderPlan,
  limitChartYFields,
  resolveChartXField,
  syncChartYFields,
  type ChartSpec,
} from '../lib/chart-spec'
import { formatReportValue, findColumn } from '../lib/format'
import type { ReportColumnDescriptor } from '@open-mercato/shared/modules/reports/dsl'
import type { Row } from '../lib/aggregator'

const ROWS: Row[] = [
  { createdOn: '2026-01-05', sum_amount: 1234.5, count_id: 3 },
  { createdOn: '2026-02-10', sum_amount: 99, count_id: 1 },
]

const COLUMNS: ReportColumnDescriptor[] = [
  { key: 'createdOn', kind: 'date' },
  { key: 'sum_amount', kind: 'money', currency: 'EUR', sourceField: 'amount', aggregation: 'sum' },
  { key: 'count_id', kind: 'integer', sourceField: 'id', aggregation: 'count' },
]

const formatValue = (value: unknown, key: string, row?: Row) =>
  formatReportValue(value, findColumn(COLUMNS, key), { locale: 'en-US', row })

const LABELS: Record<string, string> = { sum_amount: 'Sum · Amount', count_id: 'Count · ID' }

describe('formatChartRenderPlan (F19 chart axes, tooltips, legend)', () => {
  it('formats category values and renames series to their labels for bar charts', () => {
    const spec: ChartSpec = { type: 'bar', xField: 'createdOn', yFields: ['sum_amount', 'count_id'] }
    const plan = formatChartRenderPlan(buildChartRenderPlan(spec, ROWS), ROWS, spec, {
      formatValue,
      seriesLabel: (key) => LABELS[key] ?? key,
    })
    if (plan.kind !== 'bar') throw new Error('expected bar plan')
    expect(plan.categories).toEqual(['Sum · Amount', 'Count · ID'])
    expect(plan.data[0]).toEqual({ createdOn: 'Jan 5, 2026', 'Sum · Amount': 1234.5, 'Count · ID': 3 })
  })

  it('disambiguates duplicate series labels', () => {
    const spec: ChartSpec = { type: 'line', xField: 'createdOn', yFields: ['sum_amount', 'count_id'] }
    const plan = formatChartRenderPlan(buildChartRenderPlan(spec, ROWS), ROWS, spec, {
      formatValue,
      seriesLabel: () => 'Same',
    })
    if (plan.kind !== 'line') throw new Error('expected line plan')
    expect(plan.categories).toEqual(['Same', 'Same (count_id)'])
  })

  it('formats pie slice names with the X column formatter', () => {
    const spec: ChartSpec = { type: 'pie', xField: 'createdOn', yFields: ['sum_amount'] }
    const plan = formatChartRenderPlan(buildChartRenderPlan(spec, ROWS), ROWS, spec, { formatValue })
    if (plan.kind !== 'pie') throw new Error('expected pie plan')
    expect(plan.data).toEqual([
      { name: 'Jan 5, 2026', value: 1234.5 },
      { name: 'Feb 10, 2026', value: 99 },
    ])
  })

  it('labels combo series', () => {
    const spec: ChartSpec = { type: 'combo', xField: 'createdOn', yFields: ['sum_amount', 'count_id'] }
    const plan = formatChartRenderPlan(buildChartRenderPlan(spec, ROWS), ROWS, spec, {
      formatValue,
      seriesLabel: (key) => LABELS[key] ?? key,
    })
    if (plan.kind !== 'combo') throw new Error('expected combo plan')
    expect(plan.series.map((s) => s.label)).toEqual(['Sum · Amount', 'Count · ID'])
    expect(plan.data[1].createdOn).toBe('Feb 10, 2026')
  })

  it('money values format with the currency symbol', () => {
    expect(formatValue(1234.5, 'sum_amount')).toBe('€1,234.50')
  })
})

describe('syncChartYFields / limitChartYFields / resolveChartXField (F13)', () => {
  const sum = { field: 'amount', aggregation: 'sum' as const }
  const count = { field: 'id', aggregation: 'count' as const }

  it('appends the alias of an added measure', () => {
    expect(syncChartYFields({ type: 'bar', yFields: ['sum_amount'] }, [sum], [sum, count])).toEqual(['sum_amount', 'count_id'])
  })

  it('drops the alias of a removed measure', () => {
    expect(syncChartYFields({ type: 'bar', yFields: ['sum_amount', 'count_id'] }, [sum, count], [count])).toEqual(['count_id'])
  })

  it('respects the single-series limit for pie, donut and scatter', () => {
    for (const type of ['pie', 'donut', 'scatter'] as const) {
      expect(syncChartYFields({ type, yFields: ['sum_amount'] }, [sum], [sum, count])).toEqual(['sum_amount'])
    }
  })

  it('selects the first alias when nothing would be plotted', () => {
    expect(syncChartYFields({ type: 'bar', yFields: [] }, [], [sum])).toEqual(['sum_amount'])
    expect(limitChartYFields('pie', [], ['sum_amount', 'count_id'])).toEqual(['sum_amount'])
  })

  it('uses the shared alias rule for cf:* fields', () => {
    const cf = { field: 'cf:priority', aggregation: 'avg' as const }
    expect(syncChartYFields({ type: 'bar', yFields: [] }, [], [cf])).toEqual(['avg_cf_priority'])
  })

  it('keeps the X field inside an explicit groupBy', () => {
    expect(resolveChartXField('status', [])).toBe('status')
    expect(resolveChartXField('status', ['region', 'status'])).toBe('status')
    expect(resolveChartXField('status', ['region'])).toBe('region')
  })
})
