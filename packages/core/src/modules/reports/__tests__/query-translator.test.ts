import { UnsupportedFilterError, translateFlatList } from '../lib/query-translator'
import { defineDataset, type Dataset, type ReportDefinition } from '@open-mercato/shared/modules/reports/dsl'
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
    { key: 'cf:vip', labelKey: 'customers.fields.vip', kind: 'custom_field', customField: { entityId: 'customers:person', key: 'vip', valueKind: 'boolean' } },
  ],
  defaultSort: [{ field: 'created_at', dir: 'desc' }],
})

const CTX = { tenantId: 't1', organizationId: 'o1' }

describe('translateFlatList', () => {
  test('emits fields, sort, tenant+org scope, and default page size', () => {
    const def: ReportDefinition = {
      type: 'flat_list',
      fields: ['id', 'email'],
      filters: [{ kind: 'literal', field: 'status', op: 'eq', value: 'active' }],
      sort: [{ field: 'created_at', dir: 'desc' }],
    }
    const opts = translateFlatList(def, dataset, CTX)
    expect(opts.fields).toEqual(['id', 'email'])
    expect(opts.filters).toEqual([{ field: 'status', op: 'eq', value: 'active' }])
    expect(opts.sort).toEqual([{ field: 'created_at', dir: SortDir.Desc }])
    expect(opts.tenantId).toBe('t1')
    expect(opts.organizationId).toBe('o1')
    expect(opts.page).toEqual({ page: 1, pageSize: 100 })
  })

  test('falls back to dataset.defaultSort when sort is empty', () => {
    const def: ReportDefinition = {
      type: 'flat_list',
      fields: ['id'],
      filters: [],
      sort: [],
    }
    const opts = translateFlatList(def, dataset, CTX)
    expect(opts.sort).toEqual([{ field: 'created_at', dir: SortDir.Desc }])
  })

  test('caps pageSize at 100', () => {
    const def: ReportDefinition = {
      type: 'flat_list',
      fields: ['id'],
      filters: [],
      sort: [],
      limit: 500,
    }
    const opts = translateFlatList(def, dataset, CTX)
    expect(opts.page).toEqual({ page: 1, pageSize: 100 })
  })

  test('respects an explicit ctx.pageSize within the cap', () => {
    const def: ReportDefinition = { type: 'flat_list', fields: ['id'], filters: [], sort: [] }
    const opts = translateFlatList(def, dataset, { ...CTX, pageSize: 50 })
    expect(opts.page).toEqual({ page: 1, pageSize: 50 })
  })

  test('rejects unknown fields in the projection', () => {
    const def: ReportDefinition = {
      type: 'flat_list',
      fields: ['nope'],
      filters: [],
      sort: [],
    }
    expect(() => translateFlatList(def, dataset, CTX)).toThrow(/not declared in dataset/)
  })

  test('rejects unbound parameter filters (must run bindFiltersToParameters first)', () => {
    const def: ReportDefinition = {
      type: 'flat_list',
      fields: ['id'],
      filters: [{ kind: 'parameter', field: 'status', op: 'eq', parameter: 'status' }],
      sort: [],
    }
    expect(() => translateFlatList(def, dataset, CTX)).toThrow(UnsupportedFilterError)
  })

  test('rejects unbound date_range filters', () => {
    const def: ReportDefinition = {
      type: 'flat_list',
      fields: ['id'],
      filters: [{ kind: 'date_range', field: 'created_at', token: 'last_7_days' }],
      sort: [],
    }
    expect(() => translateFlatList(def, dataset, CTX)).toThrow(UnsupportedFilterError)
  })

  test('rejects OR groups (Phase 1 keeps it simple)', () => {
    const def: ReportDefinition = {
      type: 'flat_list',
      fields: ['id'],
      filters: [
        {
          kind: 'group',
          op: 'or',
          children: [
            { kind: 'literal', field: 'status', op: 'eq', value: 'a' },
            { kind: 'literal', field: 'status', op: 'eq', value: 'b' },
          ],
        },
      ],
      sort: [],
    }
    expect(() => translateFlatList(def, dataset, CTX)).toThrow(/OR filter groups/)
  })

  test('flattens AND groups but preserves their leaf filters', () => {
    const def: ReportDefinition = {
      type: 'flat_list',
      fields: ['id'],
      filters: [
        {
          kind: 'group',
          op: 'and',
          children: [
            { kind: 'literal', field: 'status', op: 'eq', value: 'active' },
            { kind: 'literal', field: 'email', op: 'contains', value: 'acme' },
          ],
        },
      ],
      sort: [],
    }
    const opts = translateFlatList(def, dataset, CTX)
    expect(opts.filters).toEqual([
      { field: 'status', op: 'eq', value: 'active' },
      { field: 'email', op: 'ilike', value: '%acme%' },
    ])
  })

  test('rewrites contains / starts_with / ends_with to ilike', () => {
    const def: ReportDefinition = {
      type: 'flat_list',
      fields: ['id'],
      filters: [
        { kind: 'literal', field: 'email', op: 'starts_with', value: 'jane' },
        { kind: 'literal', field: 'email', op: 'ends_with', value: 'acme.com' },
      ],
      sort: [],
    }
    const opts = translateFlatList(def, dataset, CTX)
    expect(opts.filters).toEqual([
      { field: 'email', op: 'ilike', value: 'jane%' },
      { field: 'email', op: 'ilike', value: '%acme.com' },
    ])
  })

  test('expands between into a gte+lte pair', () => {
    const def: ReportDefinition = {
      type: 'flat_list',
      fields: ['id'],
      filters: [
        {
          kind: 'literal',
          field: 'created_at',
          op: 'between',
          value: { from: '2026-01-01T00:00:00Z', to: '2026-01-31T23:59:59Z' },
        },
      ],
      sort: [],
    }
    const opts = translateFlatList(def, dataset, CTX)
    expect(opts.filters).toEqual([
      { field: 'created_at', op: 'gte', value: '2026-01-01T00:00:00Z' },
      { field: 'created_at', op: 'lte', value: '2026-01-31T23:59:59Z' },
    ])
  })

  test('maps is_null to exists:false and is_not_null to exists:true', () => {
    const def: ReportDefinition = {
      type: 'flat_list',
      fields: ['id'],
      filters: [
        { kind: 'literal', field: 'email', op: 'is_null' },
        { kind: 'literal', field: 'status', op: 'is_not_null' },
      ],
      sort: [],
    }
    const opts = translateFlatList(def, dataset, CTX)
    expect(opts.filters).toEqual([
      { field: 'email', op: 'exists', value: false },
      { field: 'status', op: 'exists', value: true },
    ])
  })

  test('passes through cf:* fields with includeCustomFields enabled', () => {
    const def: ReportDefinition = {
      type: 'flat_list',
      fields: ['id', 'cf:vip'],
      filters: [],
      sort: [],
    }
    const opts = translateFlatList(def, dataset, CTX)
    expect(opts.includeCustomFields).toEqual(['vip'])
    expect(opts.fields).toEqual(['id', 'cf:vip'])
  })

  test('refuses to translate without tenantId / organizationId', () => {
    const def: ReportDefinition = { type: 'flat_list', fields: ['id'], filters: [], sort: [] }
    expect(() => translateFlatList(def, dataset, { ...CTX, tenantId: '' })).toThrow(/tenantId/)
    expect(() => translateFlatList(def, dataset, { ...CTX, organizationId: '' })).toThrow(/organizationId/)
  })

  test('refuses non-flat_list definitions', () => {
    const def: ReportDefinition = {
      type: 'grouped',
      fields: ['id'],
      groupBy: ['id'],
      measures: [{ field: 'id', aggregation: 'count' }],
      filters: [],
      sort: [],
    }
    expect(() => translateFlatList(def, dataset, CTX)).toThrow(/only supports flat_list/)
  })
})
