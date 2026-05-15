import {
  aggregateGroupBy,
  aggregatePivot,
  aggregateSummary,
  hashKey,
  measureAlias,
  pivotCellKey,
  pivotToWideRows,
  readFieldValue,
  type MeasureExpr,
  type Row,
} from '../lib/aggregator'

const SAMPLE: Row[] = [
  { region: 'EU', segment: 'enterprise', amount: 100, customerId: 'c1' },
  { region: 'EU', segment: 'smb', amount: 30, customerId: 'c2' },
  { region: 'EU', segment: 'enterprise', amount: 200, customerId: 'c1' },
  { region: 'US', segment: 'enterprise', amount: 500, customerId: 'c3' },
  { region: 'US', segment: 'smb', amount: 50, customerId: 'c4' },
  { region: 'US', segment: 'smb', amount: 70, customerId: 'c4' },
  { region: 'APAC', segment: 'smb', amount: null, customerId: 'c5' },
]

const sum = (field: string): MeasureExpr => ({ field, aggregation: 'sum' })
const count = (field: string): MeasureExpr => ({ field, aggregation: 'count' })
const avg = (field: string): MeasureExpr => ({ field, aggregation: 'avg' })
const min = (field: string): MeasureExpr => ({ field, aggregation: 'min' })
const max = (field: string): MeasureExpr => ({ field, aggregation: 'max' })
const distinct = (field: string): MeasureExpr => ({ field, aggregation: 'count_distinct' })

describe('readFieldValue', () => {
  it('reads top-level fields', () => {
    expect(readFieldValue({ a: 1 }, 'a')).toBe(1)
  })
  it('reads nested paths', () => {
    expect(readFieldValue({ customer: { name: 'Alice' } }, 'customer.name')).toBe('Alice')
  })
  it('returns undefined when the chain is broken', () => {
    expect(readFieldValue({ customer: null }, 'customer.name')).toBeUndefined()
    expect(readFieldValue({ customer: 'oops' }, 'customer.name')).toBeUndefined()
    expect(readFieldValue({}, 'missing.path')).toBeUndefined()
  })
  it('preserves null distinct from undefined', () => {
    expect(readFieldValue({ a: null }, 'a')).toBeNull()
    expect(readFieldValue({}, 'a')).toBeUndefined()
  })
})

describe('measureAlias', () => {
  it('uses the explicit alias when present', () => {
    expect(measureAlias({ field: 'amount', aggregation: 'sum', alias: 'total' })).toBe('total')
  })
  it('falls back to <aggregation>_<sanitizedField>', () => {
    expect(measureAlias(sum('amount'))).toBe('sum_amount')
    expect(measureAlias(avg('order.total'))).toBe('avg_order_total')
    expect(measureAlias(distinct('cf:vip'))).toBe('count_distinct_cf_vip')
  })
})

describe('hashKey', () => {
  it('returns empty string for empty group-by', () => {
    expect(hashKey({ a: 1 }, [])).toBe('')
  })
  it('distinguishes null, undefined, and strings', () => {
    const a = hashKey({ a: null }, ['a'])
    const b = hashKey({}, ['a'])
    const c = hashKey({ a: 'null' }, ['a'])
    expect(new Set([a, b, c]).size).toBe(3)
  })
  it('serializes nested keys via JSON', () => {
    const h1 = hashKey({ a: { x: 1 } }, ['a'])
    const h2 = hashKey({ a: { x: 1 } }, ['a'])
    const h3 = hashKey({ a: { x: 2 } }, ['a'])
    expect(h1).toBe(h2)
    expect(h1).not.toBe(h3)
  })
})

describe('aggregateGroupBy', () => {
  it('groups by a single key and sums numeric measures', () => {
    const result = aggregateGroupBy({ rows: SAMPLE, groupBy: ['region'], measures: [sum('amount')] })
    expect(result).toEqual(
      expect.arrayContaining([
        { region: 'EU', sum_amount: 330 },
        { region: 'US', sum_amount: 620 },
        { region: 'APAC', sum_amount: 0 },
      ]),
    )
    expect(result).toHaveLength(3)
  })

  it('groups by multiple keys and supports multiple measures with aliases', () => {
    const result = aggregateGroupBy({
      rows: SAMPLE,
      groupBy: ['region', 'segment'],
      measures: [
        { field: 'amount', aggregation: 'sum', alias: 'total' },
        count('amount'),
        avg('amount'),
        distinct('customerId'),
      ],
    })
    const us_smb = result.find((row) => row.region === 'US' && row.segment === 'smb')
    expect(us_smb).toEqual({
      region: 'US',
      segment: 'smb',
      total: 120,
      count_amount: 2,
      avg_amount: 60,
      count_distinct_customerId: 1,
    })
    const apac_smb = result.find((row) => row.region === 'APAC' && row.segment === 'smb')
    expect(apac_smb).toEqual({
      region: 'APAC',
      segment: 'smb',
      total: 0,
      count_amount: 1,
      avg_amount: null,
      count_distinct_customerId: 1,
    })
  })

  it('min/max ignore nulls and undefined and return null for empty', () => {
    const result = aggregateGroupBy({
      rows: SAMPLE.filter((r) => r.region === 'APAC'),
      groupBy: ['region'],
      measures: [min('amount'), max('amount')],
    })
    expect(result).toEqual([{ region: 'APAC', min_amount: null, max_amount: null }])
  })

  it('count counts every row, count_distinct ignores undefined', () => {
    const rows: Row[] = [
      { region: 'EU', id: 'a' },
      { region: 'EU', id: 'a' },
      { region: 'EU', id: 'b' },
      { region: 'EU' },
    ]
    const result = aggregateGroupBy({
      rows,
      groupBy: ['region'],
      measures: [count('id'), distinct('id')],
    })
    expect(result).toEqual([{ region: 'EU', count_id: 4, count_distinct_id: 2 }])
  })

  it('treats numeric strings as numbers but ignores non-numeric strings', () => {
    const rows: Row[] = [
      { region: 'EU', amount: '100.5' },
      { region: 'EU', amount: 'forty' },
      { region: 'EU', amount: '200' },
    ]
    const result = aggregateGroupBy({
      rows,
      groupBy: ['region'],
      measures: [sum('amount'), avg('amount'), count('amount')],
    })
    expect(result).toEqual([{ region: 'EU', sum_amount: 300.5, avg_amount: 150.25, count_amount: 3 }])
  })

  it('returns a summary row when groupBy is empty', () => {
    const result = aggregateGroupBy({ rows: SAMPLE, groupBy: [], measures: [sum('amount')] })
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ sum_amount: 950 })
  })

  it('returns an empty array when input rows are empty AND groupBy is non-empty', () => {
    const result = aggregateGroupBy({ rows: [], groupBy: ['region'], measures: [sum('amount')] })
    expect(result).toEqual([])
  })

  it('preserves first-seen group order', () => {
    const result = aggregateGroupBy({ rows: SAMPLE, groupBy: ['region'], measures: [count('region')] })
    expect(result.map((r) => r.region)).toEqual(['EU', 'US', 'APAC'])
  })

  it('resolves dotted field paths in groupBy and measures', () => {
    const rows: Row[] = [
      { customer: { country: 'PL' }, order: { total: 100 } },
      { customer: { country: 'PL' }, order: { total: 50 } },
      { customer: { country: 'DE' }, order: { total: 200 } },
    ]
    const result = aggregateGroupBy({
      rows,
      groupBy: ['customer.country'],
      measures: [sum('order.total')],
    })
    const pl = result.find((r) => r['customer.country'] === 'PL')
    expect(pl).toEqual({ 'customer.country': 'PL', sum_order_total: 150 })
  })
})

describe('aggregateSummary', () => {
  it('produces a single row of measures over the whole input', () => {
    const result = aggregateSummary({
      rows: SAMPLE,
      measures: [sum('amount'), count('amount'), distinct('customerId'), min('amount'), max('amount')],
    })
    expect(result).toEqual({
      sum_amount: 950,
      count_amount: 7,
      count_distinct_customerId: 5,
      min_amount: 30,
      max_amount: 500,
    })
  })

  it('returns null for avg over empty input', () => {
    const result = aggregateSummary({ rows: [], measures: [avg('amount')] })
    expect(result).toEqual({ avg_amount: null })
  })
})

describe('aggregatePivot', () => {
  it('builds a region × segment pivot keyed by sum of amount', () => {
    const pivot = aggregatePivot({
      rows: SAMPLE,
      rowKeys: ['region'],
      colKeys: ['segment'],
      value: { field: 'amount', aggregation: 'sum' },
    })
    expect(pivot.rowHeaders.map((r) => r.region)).toEqual(['EU', 'US', 'APAC'])
    expect(pivot.colHeaders.map((r) => r.segment)).toEqual(['enterprise', 'smb'])

    const cellOf = (region: string, segment: string) => {
      const rh = pivot.rowHeaders.find((r) => r.region === region)!
      const ch = pivot.colHeaders.find((c) => c.segment === segment)!
      return pivot.cells[pivotCellKey(pivot.rowHash(rh), pivot.colHash(ch))]
    }
    expect(cellOf('EU', 'enterprise')).toBe(300)
    expect(cellOf('EU', 'smb')).toBe(30)
    expect(cellOf('US', 'enterprise')).toBe(500)
    expect(cellOf('US', 'smb')).toBe(120)
    expect(cellOf('APAC', 'enterprise')).toBeUndefined()
    expect(cellOf('APAC', 'smb')).toBe(0)
  })

  it('flattens to wide rows with missing cells as null', () => {
    const pivot = aggregatePivot({
      rows: SAMPLE,
      rowKeys: ['region'],
      colKeys: ['segment'],
      value: { field: 'amount', aggregation: 'sum' },
    })
    const wide = pivotToWideRows(pivot)
    const apac = wide.find((r) => r.region === 'APAC')!
    expect(apac.enterprise ?? null).toBeNull()
    expect(apac.smb).toBe(0)
  })

  it('supports count_distinct as the pivot value', () => {
    const pivot = aggregatePivot({
      rows: SAMPLE,
      rowKeys: ['region'],
      colKeys: ['segment'],
      value: { field: 'customerId', aggregation: 'count_distinct' },
    })
    const wide = pivotToWideRows(pivot)
    const eu = wide.find((r) => r.region === 'EU')!
    expect(eu.enterprise).toBe(1)
    expect(eu.smb).toBe(1)
    const us = wide.find((r) => r.region === 'US')!
    expect(us.enterprise).toBe(1)
    expect(us.smb).toBe(1)
  })

  it('honors composite row and column keys', () => {
    const rows: Row[] = [
      { year: 2024, quarter: 'Q1', channel: 'web', device: 'desktop', revenue: 10 },
      { year: 2024, quarter: 'Q1', channel: 'web', device: 'mobile', revenue: 20 },
      { year: 2024, quarter: 'Q2', channel: 'retail', device: 'desktop', revenue: 30 },
      { year: 2024, quarter: 'Q2', channel: 'retail', device: 'desktop', revenue: 40 },
    ]
    const pivot = aggregatePivot({
      rows,
      rowKeys: ['year', 'quarter'],
      colKeys: ['channel', 'device'],
      value: { field: 'revenue', aggregation: 'sum' },
    })
    expect(pivot.rowHeaders).toHaveLength(2)
    expect(pivot.colHeaders).toHaveLength(3)
    const wide = pivotToWideRows(pivot)
    const q2 = wide.find((r) => r.quarter === 'Q2')!
    expect(q2['retail|desktop']).toBe(70)
    expect(q2['web|desktop'] ?? null).toBeNull()
  })

  it('returns empty pivot for empty input', () => {
    const pivot = aggregatePivot({
      rows: [],
      rowKeys: ['region'],
      colKeys: ['segment'],
      value: { field: 'amount', aggregation: 'sum' },
    })
    expect(pivot.rowHeaders).toEqual([])
    expect(pivot.colHeaders).toEqual([])
    expect(pivotToWideRows(pivot)).toEqual([])
  })
})
