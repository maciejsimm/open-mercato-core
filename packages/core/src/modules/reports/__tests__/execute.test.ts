import { executeFlatList, executeReport, shouldDispatchAsync } from '../lib/execute'
import { FieldAclDeniedError } from '../lib/field-redact'
import { defineDataset, type Dataset, type ReportDefinition } from '@open-mercato/shared/modules/reports/dsl'
import type { QueryEngine, QueryOptions, QueryResult } from '@open-mercato/shared/lib/query/types'
import { SortDir } from '@open-mercato/shared/lib/query/types'

const dataset: Dataset = defineDataset({
  id: 'customers.people',
  moduleId: 'customers',
  labelKey: 'customers.reports.datasets.people.label',
  entityType: 'customers:person',
  fields: [
    { key: 'id', labelKey: 'customers.fields.id', kind: 'id' },
    { key: 'email', labelKey: 'customers.fields.email', kind: 'text' },
    { key: 'status', labelKey: 'customers.fields.status', kind: 'enum' },
    { key: 'created_at', labelKey: 'customers.fields.created_at', kind: 'datetime' },
  ],
  fieldAcl: { email: ['customers.view_pii'] },
  defaultSort: [{ field: 'created_at', dir: 'desc' }],
})

function mockEngine(items: Record<string, unknown>[], total?: number): { engine: QueryEngine; calls: Array<{ entity: string; opts: QueryOptions | undefined }> } {
  const calls: Array<{ entity: string; opts: QueryOptions | undefined }> = []
  const engine: QueryEngine = {
    async query(entity, opts) {
      calls.push({ entity, opts })
      return {
        items,
        page: opts?.page?.page ?? 1,
        pageSize: opts?.page?.pageSize ?? 100,
        total: total ?? items.length,
      } as QueryResult
    },
  }
  return { engine, calls }
}

describe('executeFlatList', () => {
  test('happy path: runs the query, returns rows + meta', async () => {
    const def: ReportDefinition = {
      type: 'flat_list',
      fields: ['id', 'status'],
      filters: [{ kind: 'literal', field: 'status', op: 'eq', value: 'active' }],
      sort: [{ field: 'created_at', dir: 'desc' }],
    }
    const { engine, calls } = mockEngine([{ id: 'p_1', status: 'active' }, { id: 'p_2', status: 'active' }], 2)
    const out = await executeFlatList(engine, {
      dataset,
      definition: def,
      userFeatures: new Set(['customers.view']),
      tenantId: 't1',
      organizationId: 'o1',
    })
    expect(out.mode).toBe('sync')
    expect(out.rows).toEqual([{ id: 'p_1', status: 'active' }, { id: 'p_2', status: 'active' }])
    expect(out.total).toBe(2)
    expect(out.meta.truncated).toBe(false)
    expect(calls).toHaveLength(1)
    expect(calls[0].entity).toBe('customers:person')
    expect(calls[0].opts?.tenantId).toBe('t1')
    expect(calls[0].opts?.organizationId).toBe('o1')
    expect(calls[0].opts?.sort).toEqual([{ field: 'created_at', dir: SortDir.Desc }])
  })

  test('refuses when the running user cannot see a referenced field', async () => {
    const def: ReportDefinition = {
      type: 'flat_list',
      fields: ['id', 'email'],
      filters: [],
      sort: [],
    }
    const { engine } = mockEngine([])
    await expect(
      executeFlatList(engine, {
        dataset,
        definition: def,
        userFeatures: new Set(['customers.view']),
        tenantId: 't1',
        organizationId: 'o1',
      }),
    ).rejects.toBeInstanceOf(FieldAclDeniedError)
  })

  test('binds parameter filters before translation', async () => {
    const def: ReportDefinition = {
      type: 'flat_list',
      fields: ['id'],
      filters: [{ kind: 'parameter', field: 'status', op: 'eq', parameter: 'status' }],
      sort: [],
    }
    const { engine, calls } = mockEngine([])
    await executeFlatList(engine, {
      dataset,
      definition: def,
      userFeatures: new Set(['customers.view']),
      tenantId: 't1',
      organizationId: 'o1',
      params: { status: 'inactive' },
      parameterDefs: [{ key: 'status', kind: 'string' }],
    })
    expect(calls[0].opts?.filters).toEqual([{ field: 'status', op: 'eq', value: 'inactive' }])
  })

  test('resolves date_range filters via the now-pin', async () => {
    const def: ReportDefinition = {
      type: 'flat_list',
      fields: ['id'],
      filters: [{ kind: 'date_range', field: 'created_at', token: 'last_7_days' }],
      sort: [],
    }
    const { engine, calls } = mockEngine([])
    await executeFlatList(engine, {
      dataset,
      definition: def,
      userFeatures: new Set(['customers.view']),
      tenantId: 't1',
      organizationId: 'o1',
      now: new Date(Date.UTC(2026, 4, 15, 12)),
    })
    // The translator gets a flattened AND group from bindFiltersToParameters
    // which it must flatten to two literal filters at translation time.
    expect(calls[0].opts?.filters).toEqual([
      { field: 'created_at', op: 'gte', value: '2026-05-09T00:00:00.000Z' },
      { field: 'created_at', op: 'lte', value: '2026-05-15T23:59:59.999Z' },
    ])
  })

  test('marks the result truncated when row count hits the cap', async () => {
    const def: ReportDefinition = {
      type: 'flat_list',
      fields: ['id'],
      filters: [],
      sort: [],
    }
    const items = Array.from({ length: 3 }, (_, i) => ({ id: `p_${i}` }))
    const { engine } = mockEngine(items, 1_000_000)
    const out = await executeFlatList(engine, {
      dataset,
      definition: def,
      userFeatures: new Set(['customers.view']),
      tenantId: 't1',
      organizationId: 'o1',
      inMemoryCap: 3,
    })
    expect(out.meta.truncated).toBe(true)
    expect(out.meta.cap).toBe(3)
  })

  test('passes tenantId + organizationId straight through to the engine', async () => {
    const def: ReportDefinition = { type: 'flat_list', fields: ['id'], filters: [], sort: [] }
    const { engine, calls } = mockEngine([])
    await executeFlatList(engine, {
      dataset,
      definition: def,
      userFeatures: new Set(['*']),
      tenantId: 't-XYZ',
      organizationId: 'o-ABC',
    })
    expect(calls[0].opts?.tenantId).toBe('t-XYZ')
    expect(calls[0].opts?.organizationId).toBe('o-ABC')
  })
})

describe('shouldDispatchAsync', () => {
  test('returns null when sync is fine', () => {
    expect(shouldDispatchAsync(100, undefined, 25_000)).toBeNull()
  })
  test('returns over_cap when row count exceeds cap', () => {
    expect(shouldDispatchAsync(30_000, undefined, 25_000)).toEqual({
      mode: 'async',
      reason: 'over_cap',
      estimatedRows: 30_000,
      cap: 25_000,
    })
  })
  test('respects explicit async request', () => {
    expect(shouldDispatchAsync(100, 'async', 25_000)).toEqual({
      mode: 'async',
      reason: 'requested',
      estimatedRows: 100,
      cap: 25_000,
    })
  })
})

// ----------------------------------------------------------------------------
// executeReport — aggregated paths (grouped / pivot / summary / chart)
// ----------------------------------------------------------------------------

const salesDataset: Dataset = defineDataset({
  id: 'sales.orders',
  moduleId: 'sales',
  labelKey: 'sales.reports.datasets.orders.label',
  entityType: 'sales:order',
  fields: [
    { key: 'id', labelKey: 'sales.fields.id', kind: 'id' },
    { key: 'region', labelKey: 'sales.fields.region', kind: 'enum' },
    { key: 'segment', labelKey: 'sales.fields.segment', kind: 'enum' },
    { key: 'amount', labelKey: 'sales.fields.amount', kind: 'money', aggregations: ['sum', 'avg', 'min', 'max', 'count'] },
    { key: 'customer_id', labelKey: 'sales.fields.customer_id', kind: 'fk', joinTo: 'customers' },
  ],
})

const SALES_ROWS = [
  { region: 'EU', segment: 'enterprise', amount: 100, customer_id: 'c1' },
  { region: 'EU', segment: 'enterprise', amount: 200, customer_id: 'c1' },
  { region: 'EU', segment: 'smb', amount: 30, customer_id: 'c2' },
  { region: 'US', segment: 'enterprise', amount: 500, customer_id: 'c3' },
  { region: 'US', segment: 'smb', amount: 50, customer_id: 'c4' },
  { region: 'US', segment: 'smb', amount: 70, customer_id: 'c4' },
]

describe('executeReport — grouped', () => {
  test('aggregates rows by groupBy and emits one row per group', async () => {
    const def: ReportDefinition = {
      type: 'grouped',
      fields: ['region', 'amount'],
      groupBy: ['region'],
      measures: [
        { field: 'amount', aggregation: 'sum', alias: 'total' },
        { field: 'amount', aggregation: 'count' },
      ],
      filters: [],
      sort: [{ field: 'total', dir: 'desc' }],
    }
    const { engine } = mockEngine([...SALES_ROWS], SALES_ROWS.length)
    const out = await executeReport(engine, {
      dataset: salesDataset,
      definition: def,
      userFeatures: new Set(['*']),
      tenantId: 't1',
      organizationId: 'o1',
    })
    expect(out.mode).toBe('sync')
    expect(out.rows).toEqual([
      { region: 'US', total: 620, count_amount: 3 },
      { region: 'EU', total: 330, count_amount: 3 },
    ])
    expect(out.meta.fields).toEqual(['region', 'total', 'count_amount'])
  })

  test('honors limit on the aggregated result', async () => {
    const def: ReportDefinition = {
      type: 'grouped',
      fields: ['region', 'segment', 'amount'],
      groupBy: ['region', 'segment'],
      measures: [{ field: 'amount', aggregation: 'sum', alias: 'total' }],
      filters: [],
      sort: [{ field: 'total', dir: 'desc' }],
      limit: 2,
    }
    const { engine } = mockEngine([...SALES_ROWS], SALES_ROWS.length)
    const out = await executeReport(engine, {
      dataset: salesDataset,
      definition: def,
      userFeatures: new Set(['*']),
      tenantId: 't1',
      organizationId: 'o1',
    })
    expect(out.rows).toHaveLength(2)
    expect(out.rows[0]).toMatchObject({ region: 'US', segment: 'enterprise', total: 500 })
  })
})

describe('executeReport — pivot', () => {
  test('flattens to wide rows; missing combinations are null', async () => {
    const def: ReportDefinition = {
      type: 'pivot',
      rows: ['region'],
      cols: ['segment'],
      value: { field: 'amount', aggregation: 'sum' },
      filters: [],
    }
    const { engine } = mockEngine([...SALES_ROWS], SALES_ROWS.length)
    const out = await executeReport(engine, {
      dataset: salesDataset,
      definition: def,
      userFeatures: new Set(['*']),
      tenantId: 't1',
      organizationId: 'o1',
    })
    expect(out.rows).toEqual([
      { region: 'EU', enterprise: 300, smb: 30 },
      { region: 'US', enterprise: 500, smb: 120 },
    ])
    expect(out.meta.fields).toEqual(['region', 'enterprise', 'smb'])
  })
})

describe('executeReport — summary', () => {
  test('returns a single row across the whole input', async () => {
    const def: ReportDefinition = {
      type: 'summary',
      measures: [
        { field: 'amount', aggregation: 'sum' },
        { field: 'amount', aggregation: 'avg' },
        { field: 'customer_id', aggregation: 'count_distinct' },
      ],
      filters: [],
    }
    const { engine } = mockEngine([...SALES_ROWS], SALES_ROWS.length)
    const out = await executeReport(engine, {
      dataset: salesDataset,
      definition: def,
      userFeatures: new Set(['*']),
      tenantId: 't1',
      organizationId: 'o1',
    })
    expect(out.rows).toHaveLength(1)
    expect(out.rows[0]).toEqual({
      sum_amount: 950,
      avg_amount: 950 / 6,
      count_distinct_customer_id: 4,
    })
  })
})

describe('executeReport — chart', () => {
  test('uses declared groupBy + measures and projects via aggregator', async () => {
    const def: ReportDefinition = {
      type: 'chart',
      chart: { type: 'bar', xField: 'region', yFields: ['total'] },
      groupBy: ['region'],
      measures: [{ field: 'amount', aggregation: 'sum', alias: 'total' }],
      filters: [],
    }
    const { engine, calls } = mockEngine([...SALES_ROWS], SALES_ROWS.length)
    const out = await executeReport(engine, {
      dataset: salesDataset,
      definition: def,
      userFeatures: new Set(['*']),
      tenantId: 't1',
      organizationId: 'o1',
    })
    expect(out.rows).toEqual([
      { region: 'EU', total: 330 },
      { region: 'US', total: 620 },
    ])
    expect(out.meta.fields).toEqual(['region', 'total'])
    // Sanity: the query projection includes the X field and the measure field.
    const projection = (calls[0].opts?.fields ?? []) as string[]
    expect(projection).toEqual(expect.arrayContaining(['region', 'amount']))
  })
})

describe('executeReport — flat_list passthrough', () => {
  test('delegates to executeFlatList and back-fills meta.fields', async () => {
    const def: ReportDefinition = {
      type: 'flat_list',
      fields: ['id', 'region'],
      filters: [],
      sort: [],
    }
    const { engine } = mockEngine([{ id: 'a', region: 'EU' }], 1)
    const out = await executeReport(engine, {
      dataset: salesDataset,
      definition: def,
      userFeatures: new Set(['*']),
      tenantId: 't1',
      organizationId: 'o1',
    })
    expect(out.meta.fields).toEqual(['id', 'region'])
    expect(out.rows).toEqual([{ id: 'a', region: 'EU' }])
  })
})
