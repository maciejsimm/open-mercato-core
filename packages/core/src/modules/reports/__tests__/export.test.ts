import { pickExportColumns, runReportExport } from '../lib/export'
import { defineDataset, type Dataset, type ReportDefinition } from '@open-mercato/shared/modules/reports/dsl'
import type { QueryEngine, QueryOptions, QueryResult } from '@open-mercato/shared/lib/query/types'
import type { ExecutionResult } from '../lib/execute'

const customersDataset: Dataset = defineDataset({
  id: 'customers.people',
  moduleId: 'customers',
  labelKey: 'customers.reports.datasets.people.label',
  entityType: 'customers:person',
  fields: [
    { key: 'id', labelKey: 'customers.fields.id', kind: 'id' },
    { key: 'kind', labelKey: 'customers.fields.kind', kind: 'enum' },
    { key: 'created_at', labelKey: 'customers.fields.created_at', kind: 'datetime' },
  ],
})

const salesDataset: Dataset = defineDataset({
  id: 'sales.orders',
  moduleId: 'sales',
  labelKey: 'sales.reports.datasets.orders.label',
  entityType: 'sales:order',
  fields: [
    { key: 'id', labelKey: 'sales.fields.id', kind: 'id' },
    { key: 'region', labelKey: 'sales.fields.region', kind: 'enum' },
    { key: 'amount', labelKey: 'sales.fields.amount', kind: 'money', aggregations: ['sum', 'avg', 'min', 'max', 'count'] },
  ],
})

function mockEngine(items: Record<string, unknown>[], total?: number): QueryEngine {
  return {
    async query(_entity, opts) {
      const safeOpts = opts as QueryOptions | undefined
      return {
        items,
        page: safeOpts?.page?.page ?? 1,
        pageSize: safeOpts?.page?.pageSize ?? 100,
        total: total ?? items.length,
      } as QueryResult
    },
  }
}

describe('pickExportColumns', () => {
  test('prefers executor meta.fields when present', () => {
    const def: ReportDefinition = {
      type: 'grouped',
      fields: ['region', 'amount'],
      groupBy: ['region'],
      measures: [{ field: 'amount', aggregation: 'sum', alias: 'total' }],
      filters: [],
      sort: [],
    }
    const result: ExecutionResult = {
      mode: 'sync',
      rows: [{ region: 'EU', total: 100 }],
      total: 1,
      meta: { duration_ms: 1, truncated: false, cap: 1000, fields: ['region', 'total'] },
    }
    expect(pickExportColumns(def, result).map((c) => c.field)).toEqual(['region', 'total'])
  })

  test('falls back to definition.fields for flat_list when meta.fields is absent', () => {
    const def: ReportDefinition = {
      type: 'flat_list',
      fields: ['id', 'kind'],
      filters: [],
      sort: [],
    }
    const result: ExecutionResult = {
      mode: 'sync',
      rows: [{ id: 'a', kind: 'person' }],
      total: 1,
      meta: { duration_ms: 1, truncated: false, cap: 1000 },
    }
    expect(pickExportColumns(def, result).map((c) => c.field)).toEqual(['id', 'kind'])
  })

  test('derives columns from measure aliases for grouped/summary if meta.fields is missing', () => {
    const def: ReportDefinition = {
      type: 'summary',
      measures: [
        { field: 'amount', aggregation: 'sum' },
        { field: 'amount', aggregation: 'avg', alias: 'aov' },
      ],
      filters: [],
    }
    const result: ExecutionResult = {
      mode: 'sync',
      rows: [{ sum_amount: 100, aov: 50 }],
      total: 1,
      meta: { duration_ms: 1, truncated: false, cap: 1000 },
    }
    expect(pickExportColumns(def, result).map((c) => c.field)).toEqual(['sum_amount', 'aov'])
  })
})

describe('runReportExport (csv)', () => {
  test('returns a CSV body with humanised headers + Content-Type for flat_list', async () => {
    const def: ReportDefinition = {
      type: 'flat_list',
      fields: ['id', 'kind'],
      filters: [],
      sort: [],
    }
    const engine = mockEngine([
      { id: 'p1', kind: 'person' },
      { id: 'p2', kind: 'company' },
    ])
    const artifact = await runReportExport(
      engine,
      {
        dataset: customersDataset,
        definition: def,
        userFeatures: new Set(['*']),
        tenantId: 't1',
        organizationId: 'o1',
      },
      'csv',
    )
    expect(artifact.contentType).toBe('text/csv; charset=utf-8')
    expect(artifact.fileExtension).toBe('csv')
    expect(artifact.body.split('\n')).toEqual([
      'Id,Kind',
      'p1,person',
      'p2,company',
    ])
    expect(artifact.total).toBe(2)
    expect(artifact.truncated).toBe(false)
  })

  test('aggregated grouped reports export the executor-produced aliases', async () => {
    const def: ReportDefinition = {
      type: 'grouped',
      fields: ['region', 'amount'],
      groupBy: ['region'],
      measures: [{ field: 'amount', aggregation: 'sum', alias: 'total' }],
      filters: [],
      sort: [{ field: 'total', dir: 'desc' }],
    }
    const engine = mockEngine([
      { region: 'EU', amount: 100 },
      { region: 'EU', amount: 200 },
      { region: 'US', amount: 500 },
    ])
    const artifact = await runReportExport(
      engine,
      {
        dataset: salesDataset,
        definition: def,
        userFeatures: new Set(['*']),
        tenantId: 't1',
        organizationId: 'o1',
      },
      'csv',
    )
    const lines = artifact.body.split('\n')
    expect(lines[0]).toBe('Region,Total')
    expect(lines).toContain('US,500')
    expect(lines).toContain('EU,300')
  })
})

describe('runReportExport (other formats)', () => {
  test('json round-trips the rows under humanised header keys', async () => {
    const def: ReportDefinition = {
      type: 'flat_list',
      fields: ['id', 'kind'],
      filters: [],
      sort: [],
    }
    const engine = mockEngine([{ id: 'p1', kind: 'person' }])
    const artifact = await runReportExport(
      engine,
      {
        dataset: customersDataset,
        definition: def,
        userFeatures: new Set(['*']),
        tenantId: 't1',
        organizationId: 'o1',
      },
      'json',
    )
    expect(artifact.contentType).toBe('application/json; charset=utf-8')
    expect(JSON.parse(artifact.body)).toEqual([{ Id: 'p1', Kind: 'person' }])
  })

  test('markdown emits a header / divider / one-row-per-data shape', async () => {
    const def: ReportDefinition = {
      type: 'flat_list',
      fields: ['id'],
      filters: [],
      sort: [],
    }
    const engine = mockEngine([{ id: 'p1' }, { id: 'p2' }])
    const artifact = await runReportExport(
      engine,
      {
        dataset: customersDataset,
        definition: def,
        userFeatures: new Set(['*']),
        tenantId: 't1',
        organizationId: 'o1',
      },
      'markdown',
    )
    const lines = artifact.body.split('\n')
    expect(lines[0]).toBe('| Id |')
    expect(lines[1]).toBe('| --- |')
    expect(lines).toContain('| p1 |')
    expect(lines).toContain('| p2 |')
  })

  test('xml wraps each row in a <record> with field tags', async () => {
    const def: ReportDefinition = {
      type: 'flat_list',
      fields: ['id'],
      filters: [],
      sort: [],
    }
    const engine = mockEngine([{ id: 'p1' }])
    const artifact = await runReportExport(
      engine,
      {
        dataset: customersDataset,
        definition: def,
        userFeatures: new Set(['*']),
        tenantId: 't1',
        organizationId: 'o1',
      },
      'xml',
    )
    expect(artifact.contentType).toBe('application/xml; charset=utf-8')
    expect(artifact.body).toContain('<record>')
    expect(artifact.body).toContain('<id>p1</id>')
  })
})
