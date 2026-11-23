import {
  REPORT_TYPES,
  defaultDefinition,
  migrateDefinition,
  reconcileChartDefinition,
  switchDefinitionType,
  type BuilderDefinition,
  type BuilderFilter,
  type DraftStash,
} from '../lib/definition-migrate'
import type { ReportType } from '@open-mercato/shared/modules/reports/dsl'

const FILTERS: BuilderFilter[] = [
  { kind: 'literal', field: 'status', op: 'eq', value: 'open' },
  { kind: 'date_range', field: 'createdAt', token: 'last_30_days' },
]
const COLUMN_FORMATS = { sum_amount: { precision: 0 } }

const SAMPLES: Record<ReportType, BuilderDefinition> = {
  flat_list: {
    type: 'flat_list',
    fields: ['name', 'status', 'amount'],
    filters: FILTERS,
    sort: [{ field: 'name', dir: 'asc' }],
    limit: 50,
    columnFormats: COLUMN_FORMATS,
  },
  grouped: {
    type: 'grouped',
    fields: ['name'],
    groupBy: ['status', 'region'],
    measures: [
      { field: 'amount', aggregation: 'sum' },
      { field: 'id', aggregation: 'count' },
    ],
    filters: FILTERS,
    sort: [{ field: 'status', dir: 'desc' }, { field: 'sum_amount', dir: 'desc' }],
    limit: 20,
    columnFormats: COLUMN_FORMATS,
  },
  pivot: {
    type: 'pivot',
    rows: ['status'],
    cols: ['region'],
    value: { field: 'amount', aggregation: 'sum' },
    filters: FILTERS,
    columnFormats: COLUMN_FORMATS,
  },
  chart: {
    type: 'chart',
    chart: { type: 'line', xField: 'status', yFields: ['sum_amount'] },
    groupBy: [],
    measures: [
      { field: 'amount', aggregation: 'sum' },
      { field: 'id', aggregation: 'count' },
    ],
    filters: FILTERS,
    limit: 10,
    columnFormats: COLUMN_FORMATS,
  },
  summary: {
    type: 'summary',
    measures: [
      { field: 'amount', aggregation: 'sum' },
      { field: 'amount', aggregation: 'avg' },
    ],
    filters: FILTERS,
    columnFormats: COLUMN_FORMATS,
  },
}

/** What every type pair must keep, expressed per target. */
const EXPECTED: Record<ReportType, Record<ReportType, Partial<BuilderDefinition> & Record<string, unknown>>> = {
  flat_list: {
    flat_list: {},
    grouped: { fields: ['name', 'status', 'amount'], groupBy: [], measures: [], sort: [{ field: 'name', dir: 'asc' }], limit: 50 },
    pivot: { rows: [], cols: [], value: null },
    chart: { groupBy: [], measures: [], chart: { type: 'bar', xField: '', yFields: [] }, limit: 50 },
    summary: { measures: [] },
  },
  grouped: {
    flat_list: { fields: ['name', 'status', 'region'], sort: [{ field: 'status', dir: 'desc' }], limit: 20 },
    grouped: {},
    pivot: { rows: ['status', 'region'], cols: [], value: { field: 'amount', aggregation: 'sum' } },
    chart: {
      groupBy: ['status', 'region'],
      measures: [
        { field: 'amount', aggregation: 'sum' },
        { field: 'id', aggregation: 'count' },
      ],
      chart: { type: 'bar', xField: 'status', yFields: ['sum_amount', 'count_id'] },
      limit: 20,
    },
    summary: {
      measures: [
        { field: 'amount', aggregation: 'sum' },
        { field: 'id', aggregation: 'count' },
      ],
    },
  },
  pivot: {
    flat_list: { fields: ['status', 'region'], sort: [] },
    grouped: { fields: [], groupBy: ['status', 'region'], measures: [{ field: 'amount', aggregation: 'sum' }], sort: [] },
    pivot: {},
    chart: {
      groupBy: ['status', 'region'],
      measures: [{ field: 'amount', aggregation: 'sum' }],
      chart: { type: 'bar', xField: 'status', yFields: ['sum_amount'] },
    },
    summary: { measures: [{ field: 'amount', aggregation: 'sum' }] },
  },
  chart: {
    flat_list: { fields: ['status'], sort: [], limit: 10 },
    grouped: {
      fields: [],
      groupBy: ['status'],
      measures: [
        { field: 'amount', aggregation: 'sum' },
        { field: 'id', aggregation: 'count' },
      ],
      limit: 10,
    },
    pivot: { rows: ['status'], cols: [], value: { field: 'amount', aggregation: 'sum' } },
    chart: {},
    summary: {
      measures: [
        { field: 'amount', aggregation: 'sum' },
        { field: 'id', aggregation: 'count' },
      ],
    },
  },
  summary: {
    flat_list: { fields: [], sort: [] },
    grouped: {
      fields: [],
      groupBy: [],
      measures: [
        { field: 'amount', aggregation: 'sum' },
        { field: 'amount', aggregation: 'avg' },
      ],
    },
    pivot: { rows: [], cols: [], value: { field: 'amount', aggregation: 'sum' } },
    chart: {
      groupBy: [],
      measures: [
        { field: 'amount', aggregation: 'sum' },
        { field: 'amount', aggregation: 'avg' },
      ],
      chart: { type: 'bar', xField: '', yFields: ['sum_amount', 'avg_amount'] },
    },
    summary: {},
  },
}

/** Dropped slots expected for each pair (order-insensitive, by slot:field). */
const EXPECTED_DROPS: Record<ReportType, Record<ReportType, string[]>> = {
  flat_list: {
    flat_list: [],
    grouped: [],
    pivot: ['fields:name', 'fields:status', 'fields:amount', 'sort:name', 'limit:50'],
    chart: ['fields:name', 'fields:status', 'fields:amount', 'sort:name'],
    summary: ['fields:name', 'fields:status', 'fields:amount', 'sort:name', 'limit:50'],
  },
  grouped: {
    flat_list: ['measures:sum_amount', 'measures:count_id', 'sort:sum_amount'],
    grouped: [],
    pivot: ['fields:name', 'measures:count_id', 'sort:status', 'sort:sum_amount', 'limit:20'],
    chart: ['fields:name', 'sort:status', 'sort:sum_amount'],
    summary: ['fields:name', 'groupBy:status', 'groupBy:region', 'sort:status', 'sort:sum_amount', 'limit:20'],
  },
  pivot: {
    flat_list: ['measures:sum_amount'],
    grouped: [],
    pivot: [],
    chart: [],
    summary: ['groupBy:status', 'cols:region'],
  },
  chart: {
    flat_list: ['chart:line', 'measures:sum_amount', 'measures:count_id'],
    grouped: ['chart:line'],
    pivot: ['chart:line', 'measures:count_id', 'limit:10'],
    chart: [],
    summary: ['chart:line', 'groupBy:status', 'limit:10'],
  },
  summary: {
    flat_list: ['measures:sum_amount', 'measures:avg_amount'],
    grouped: [],
    pivot: ['measures:avg_amount'],
    chart: [],
    summary: [],
  },
}

function dropKeys(result: ReturnType<typeof migrateDefinition>): string[] {
  return result.dropped.map((item) => {
    if (item.slot === 'measures') return `measures:${item.alias}`
    if (item.slot === 'limit') return `limit:${item.value}`
    if (item.slot === 'chart') return `chart:${item.chartType}`
    return `${item.slot}:${item.field}`
  })
}

describe('migrateDefinition — every type pair', () => {
  for (const from of REPORT_TYPES) {
    for (const to of REPORT_TYPES) {
      it(`${from} → ${to} keeps equivalent slots`, () => {
        const result = migrateDefinition(SAMPLES[from], to)
        expect(result.definition.type).toBe(to)
        if (from === to) {
          expect(result.definition).toBe(SAMPLES[from])
          expect(result.dropped).toEqual([])
          return
        }
        expect(result.definition).toMatchObject(EXPECTED[from][to])
        expect(result.definition.filters).toEqual(FILTERS)
        expect(result.definition.columnFormats).toEqual(COLUMN_FORMATS)
        expect(dropKeys(result).sort()).toEqual([...EXPECTED_DROPS[from][to]].sort())
      })
    }
  }

  it('does not share mutable arrays with the source definition', () => {
    const source = SAMPLES.grouped
    const { definition } = migrateDefinition(source, 'chart')
    if (definition.type !== 'chart') throw new Error('expected chart')
    definition.measures.push({ field: 'x', aggregation: 'count' })
    definition.filters.push({ kind: 'literal', field: 'y', op: 'eq', value: 1 })
    expect(source.type === 'grouped' && source.measures).toHaveLength(2)
    expect(source.filters).toHaveLength(2)
  })

  it('keeps a pivot row/col disjoint when moving from chart groupBy', () => {
    const chart: BuilderDefinition = {
      ...defaultDefinition('chart'),
      type: 'chart',
      chart: { type: 'bar', xField: 'status', yFields: ['count'] },
      groupBy: ['status', 'region'],
      measures: [{ field: 'id', aggregation: 'count', alias: 'count' }],
      filters: [],
    }
    const { definition } = migrateDefinition(chart, 'pivot')
    expect(definition).toMatchObject({ rows: ['status', 'region'], cols: [], value: { field: 'id', aggregation: 'count', alias: 'count' } })
  })

  it('limits chart yFields when the target chart type would be single-series', () => {
    const result = migrateDefinition(SAMPLES.grouped, 'chart')
    if (result.definition.type !== 'chart') throw new Error('expected chart')
    const pie = reconcileChartDefinition(result.definition, {
      ...result.definition,
      chart: { ...result.definition.chart, type: 'pie' },
    })
    expect(pie.type === 'chart' && pie.chart.yFields).toEqual(['sum_amount'])
  })
})

describe('switchDefinitionType — per-type draft stash', () => {
  it('A → B → A restores A exactly when nothing was edited', () => {
    for (const from of REPORT_TYPES) {
      for (const to of REPORT_TYPES) {
        if (from === to) continue
        let stash: DraftStash = {}
        const forward = switchDefinitionType(SAMPLES[from], to, stash, 3)
        stash = forward.stash
        const back = switchDefinitionType(forward.definition, from, stash, 3)
        expect(back.restored).toBe(true)
        expect(back.definition).toBe(SAMPLES[from])
        expect(back.dropped).toEqual([])
      }
    }
  })

  it('A → B → C → A restores A when nothing was edited in between', () => {
    const step1 = switchDefinitionType(SAMPLES.grouped, 'pivot', {}, 0)
    const step2 = switchDefinitionType(step1.definition, 'summary', step1.stash, 0)
    const step3 = switchDefinitionType(step2.definition, 'grouped', step2.stash, 0)
    expect(step3.restored).toBe(true)
    expect(step3.definition).toBe(SAMPLES.grouped)
  })

  it('migrates from the edited definition once the user changed B', () => {
    const forward = switchDefinitionType(SAMPLES.grouped, 'summary', {}, 1)
    const edited: BuilderDefinition = {
      type: 'summary',
      measures: [{ field: 'amount', aggregation: 'max' }],
      filters: [],
    }
    const back = switchDefinitionType(edited, 'grouped', forward.stash, 2)
    expect(back.restored).toBe(false)
    expect(back.definition).toMatchObject({ type: 'grouped', groupBy: [], measures: [{ field: 'amount', aggregation: 'max' }] })
  })

  it('is a no-op when the type does not change', () => {
    const stash: DraftStash = {}
    const result = switchDefinitionType(SAMPLES.pivot, 'pivot', stash, 0)
    expect(result.definition).toBe(SAMPLES.pivot)
    expect(result.stash).toBe(stash)
  })
})

describe('reconcileChartDefinition (F13a/b)', () => {
  const base: BuilderDefinition = {
    type: 'chart',
    chart: { type: 'bar', xField: 'status', yFields: ['sum_amount'] },
    groupBy: [],
    measures: [{ field: 'amount', aggregation: 'sum' }],
    filters: [],
  }

  it('adds a new measure alias to yFields', () => {
    if (base.type !== 'chart') throw new Error('expected chart')
    const next = reconcileChartDefinition(base, {
      ...base,
      measures: [...base.measures, { field: 'cf:priority', aggregation: 'avg' }],
    })
    expect(next.type === 'chart' && next.chart.yFields).toEqual(['sum_amount', 'avg_cf_priority'])
  })

  it('removes a removed measure alias from yFields', () => {
    if (base.type !== 'chart') throw new Error('expected chart')
    const two = { ...base, measures: [...base.measures, { field: 'id', aggregation: 'count' as const }], chart: { ...base.chart, yFields: ['sum_amount', 'count_id'] } }
    const next = reconcileChartDefinition(two, { ...two, measures: [two.measures[1]] })
    expect(next.type === 'chart' && next.chart.yFields).toEqual(['count_id'])
  })

  it('keeps a single series for pie/donut/scatter when a measure is added', () => {
    if (base.type !== 'chart') throw new Error('expected chart')
    const pie = { ...base, chart: { ...base.chart, type: 'pie' as const } }
    const next = reconcileChartDefinition(pie, { ...pie, measures: [...pie.measures, { field: 'id', aggregation: 'count' }] })
    expect(next.type === 'chart' && next.chart.yFields).toEqual(['sum_amount'])
  })

  it('renames yFields when a measure alias is edited', () => {
    if (base.type !== 'chart') throw new Error('expected chart')
    const next = reconcileChartDefinition(base, { ...base, measures: [{ field: 'amount', aggregation: 'sum', alias: 'revenue' }] })
    expect(next.type === 'chart' && next.chart.yFields).toEqual(['revenue'])
  })

  it('moves a stale X field onto the first explicit group key', () => {
    if (base.type !== 'chart') throw new Error('expected chart')
    const next = reconcileChartDefinition(base, { ...base, groupBy: ['region'] })
    expect(next.type === 'chart' && next.chart.xField).toBe('region')
  })

  it('leaves the X field alone while groupBy is empty (implicit group key)', () => {
    const next = reconcileChartDefinition(base, base)
    expect(next).toBe(base)
  })

  it('passes non-chart definitions through untouched', () => {
    expect(reconcileChartDefinition(SAMPLES.grouped, SAMPLES.flat_list)).toBe(SAMPLES.flat_list)
  })
})
