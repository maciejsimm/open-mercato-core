import {
  aliasesFor,
  buildChartRenderPlan,
  buildComboSeries,
  buildPieChartData,
  buildScatterChartData,
  buildWideChartData,
  type ChartSpec,
} from '../lib/chart-spec'
import type { MeasureExpr, Row } from '../lib/aggregator'

const ROWS: Row[] = [
  { region: 'EU', sum_amount: 330, count_amount: 3, avg_amount: 110 },
  { region: 'US', sum_amount: 620, count_amount: 3, avg_amount: 207 },
  { region: 'APAC', sum_amount: 0, count_amount: 1, avg_amount: null },
]

const SCATTER_ROWS: Row[] = [
  { age: 21, salary: 30, dept: 'eng' },
  { age: 35, salary: 60, dept: 'eng' },
  { age: 42, salary: 50, dept: 'sales' },
  { age: 50, salary: 80, dept: 'sales' },
  { age: 28, salary: '45', dept: 'eng' },
  { age: 19, salary: 'oops', dept: 'sales' },
]

const barSpec = (overrides: Partial<ChartSpec> = {}): ChartSpec => ({
  type: 'bar',
  xField: 'region',
  yFields: ['sum_amount'],
  ...overrides,
})

describe('buildWideChartData', () => {
  it('projects rows to { index, categories, data } using the spec', () => {
    const result = buildWideChartData(barSpec({ yFields: ['sum_amount', 'count_amount'] }), ROWS)
    expect(result.index).toBe('region')
    expect(result.categories).toEqual(['sum_amount', 'count_amount'])
    expect(result.data).toEqual([
      { region: 'EU', sum_amount: 330, count_amount: 3 },
      { region: 'US', sum_amount: 620, count_amount: 3 },
      { region: 'APAC', sum_amount: 0, count_amount: 1 },
    ])
  })

  it('infers numeric keys when yFields is empty', () => {
    const result = buildWideChartData(barSpec({ yFields: [] }), ROWS)
    expect(result.categories).toEqual(expect.arrayContaining(['sum_amount', 'count_amount']))
    expect(result.categories).not.toContain('region')
  })

  it('returns empty arrays when input is empty', () => {
    const result = buildWideChartData(barSpec(), [])
    expect(result.data).toEqual([])
    expect(result.categories).toEqual(['sum_amount'])
  })
})

describe('buildPieChartData', () => {
  it('uses the first yField as the slice value, with xField as slice name', () => {
    const result = buildPieChartData(barSpec({ type: 'pie' }), ROWS)
    expect(result).toEqual([
      { name: 'EU', value: 330 },
      { name: 'US', value: 620 },
      { name: 'APAC', value: 0 },
    ])
  })

  it('drops rows whose value is not numeric', () => {
    const rows: Row[] = [
      { region: 'EU', value: 100 },
      { region: 'US', value: null },
      { region: 'APAC', value: 'oops' },
    ]
    const result = buildPieChartData({ type: 'pie', xField: 'region', yFields: ['value'] }, rows)
    expect(result).toEqual([{ name: 'EU', value: 100 }])
  })

  it('returns empty array when no value key can be inferred', () => {
    const result = buildPieChartData({ type: 'pie', xField: 'region', yFields: [] }, [{ region: 'EU' }])
    expect(result).toEqual([])
  })
})

describe('buildScatterChartData', () => {
  it('groups all points into one series when no groupKey is provided', () => {
    const result = buildScatterChartData(
      { type: 'scatter', xField: 'age', yFields: ['salary'] },
      SCATTER_ROWS,
    )
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('salary')
    // 5 valid points (the 6th has salary='oops')
    expect(result[0].data).toHaveLength(5)
    expect(result[0].data[0]).toEqual({ age: 21, salary: 30 })
  })

  it('splits into per-group series when groupKey is set', () => {
    const result = buildScatterChartData(
      { type: 'scatter', xField: 'age', yFields: ['salary'] },
      SCATTER_ROWS,
      { groupKey: 'dept' },
    )
    expect(result.map((s) => s.name)).toEqual(['eng', 'sales'])
    expect(result.find((s) => s.name === 'eng')!.data).toHaveLength(3)
    expect(result.find((s) => s.name === 'sales')!.data).toHaveLength(2)
  })

  it('returns empty array when yFields is empty', () => {
    const result = buildScatterChartData(
      { type: 'scatter', xField: 'age', yFields: [] },
      SCATTER_ROWS,
    )
    expect(result).toEqual([])
  })
})

describe('buildComboSeries', () => {
  it('defaults to bar for first series and line for the rest', () => {
    const result = buildComboSeries({
      type: 'combo',
      xField: 'region',
      yFields: ['sum_amount', 'count_amount', 'avg_amount'],
    })
    expect(result.map((s) => s.kind)).toEqual(['bar', 'line', 'line'])
    expect(result.map((s) => s.key)).toEqual(['sum_amount', 'count_amount', 'avg_amount'])
  })

  it('respects kindFor override', () => {
    const result = buildComboSeries(
      { type: 'combo', xField: 'region', yFields: ['a', 'b'] },
      { kindFor: () => 'area' },
    )
    expect(result.map((s) => s.kind)).toEqual(['area', 'area'])
  })

  it('emits stackId only for bar series when stacked is set', () => {
    const result = buildComboSeries({
      type: 'combo',
      xField: 'region',
      yFields: ['sum_amount', 'count_amount'],
      stacked: true,
    })
    expect(result[0].kind).toBe('bar')
    expect(result[0].stackId).toBe('combo-stack-1')
    expect(result[1].kind).toBe('line')
    expect(result[1].stackId).toBeUndefined()
  })
})

describe('buildChartRenderPlan', () => {
  it('routes pie / donut into the pie payload shape', () => {
    const plan = buildChartRenderPlan({ type: 'pie', xField: 'region', yFields: ['sum_amount'] }, ROWS)
    expect(plan.kind).toBe('pie')
    if (plan.kind === 'pie') {
      expect(plan.data.map((d) => d.name)).toEqual(['EU', 'US', 'APAC'])
    }
    const donutPlan = buildChartRenderPlan({ type: 'donut', xField: 'region', yFields: ['sum_amount'] }, ROWS)
    expect(donutPlan.kind).toBe('donut')
  })

  it('routes scatter into the scatter payload shape', () => {
    const plan = buildChartRenderPlan(
      { type: 'scatter', xField: 'age', yFields: ['salary'] },
      SCATTER_ROWS,
    )
    expect(plan.kind).toBe('scatter')
    if (plan.kind === 'scatter') {
      expect(plan.xField).toBe('age')
      expect(plan.yField).toBe('salary')
      expect(plan.series).toHaveLength(1)
    }
  })

  it('routes combo into the combo payload shape with derived series', () => {
    const plan = buildChartRenderPlan(
      { type: 'combo', xField: 'region', yFields: ['sum_amount', 'count_amount'] },
      ROWS,
    )
    expect(plan.kind).toBe('combo')
    if (plan.kind === 'combo') {
      expect(plan.series.map((s) => s.kind)).toEqual(['bar', 'line'])
      expect(plan.data[0]).toEqual({ region: 'EU', sum_amount: 330, count_amount: 3 })
    }
  })

  it('routes bar / line / area into the wide payload shape', () => {
    const bar = buildChartRenderPlan(barSpec(), ROWS)
    expect(bar.kind).toBe('bar')
    const line = buildChartRenderPlan({ ...barSpec(), type: 'line' }, ROWS)
    expect(line.kind).toBe('line')
    const area = buildChartRenderPlan({ ...barSpec(), type: 'area', stacked: true }, ROWS)
    expect(area.kind).toBe('area')
    if (area.kind === 'area') expect(area.stacked).toBe(true)
  })
})

describe('aliasesFor', () => {
  it('mirrors aggregator measureAlias for each measure', () => {
    const measures: MeasureExpr[] = [
      { field: 'amount', aggregation: 'sum' },
      { field: 'order.total', aggregation: 'avg', alias: 'aov' },
      { field: 'id', aggregation: 'count_distinct' },
    ]
    expect(aliasesFor(measures)).toEqual(['sum_amount', 'aov', 'count_distinct_id'])
  })
})
