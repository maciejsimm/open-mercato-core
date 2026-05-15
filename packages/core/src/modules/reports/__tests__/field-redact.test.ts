import {
  FieldAclDeniedError,
  collectReferencedFieldPaths,
  isFieldVisible,
  redactDatasetFields,
  validateDefinitionAgainstAcl,
} from '../lib/field-redact'
import { defineDataset, type Dataset, type ReportDefinition } from '@open-mercato/shared/modules/reports/dsl'

function dataset(): Dataset {
  return defineDataset({
    id: 'sales.orders',
    moduleId: 'sales',
    labelKey: 'sales.reports.datasets.orders.label',
    entityType: 'sales:order',
    fields: [
      { key: 'id', labelKey: 'sales.fields.id', kind: 'id' },
      { key: 'total', labelKey: 'sales.fields.total', kind: 'money', aggregations: ['sum', 'avg'] },
      { key: 'status', labelKey: 'sales.fields.status', kind: 'enum' },
      { key: 'customer.email', labelKey: 'customers.fields.email', kind: 'text' },
      { key: 'customer.phone', labelKey: 'customers.fields.phone', kind: 'text' },
    ],
    fieldAcl: {
      'customer.email': ['customers.view_pii'],
      'customer.phone': ['customers.view_pii'],
    },
  })
}

describe('isFieldVisible', () => {
  test('allows field with no ACL', () => {
    const decision = isFieldVisible('total', { 'customer.email': ['customers.view_pii'] }, new Set())
    expect(decision.allowed).toBe(true)
  })

  test('denies field when missing required feature', () => {
    const decision = isFieldVisible('customer.email', { 'customer.email': ['customers.view_pii'] }, new Set(['sales.view']))
    expect(decision.allowed).toBe(false)
    expect(decision.missingFeatures).toEqual(['customers.view_pii'])
  })

  test('allows field via wildcard `customers.*`', () => {
    const decision = isFieldVisible('customer.email', { 'customer.email': ['customers.view_pii'] }, new Set(['customers.*']))
    expect(decision.allowed).toBe(true)
  })

  test('allows field via god-mode `*`', () => {
    const decision = isFieldVisible('customer.email', { 'customer.email': ['customers.view_pii'] }, new Set(['*']))
    expect(decision.allowed).toBe(true)
  })
})

describe('redactDatasetFields', () => {
  test('strips fields the user cannot see', () => {
    const ds = dataset()
    const out = redactDatasetFields(ds, new Set(['sales.view']))
    expect(out.visibleFields.map((f) => f.key)).toEqual(['id', 'total', 'status'])
    expect(out.hiddenFieldPaths).toEqual(['customer.email', 'customer.phone'])
  })

  test('exposes all fields when user has all features', () => {
    const ds = dataset()
    const out = redactDatasetFields(ds, new Set(['customers.view_pii']))
    expect(out.visibleFields).toHaveLength(5)
    expect(out.hiddenFieldPaths).toEqual([])
  })
})

describe('collectReferencedFieldPaths', () => {
  test('collects fields from flat_list filters + sort + projection', () => {
    const def: ReportDefinition = {
      type: 'flat_list',
      fields: ['id', 'total'],
      filters: [{ kind: 'literal', field: 'status', op: 'eq', value: 'paid' }],
      sort: [{ field: 'total', dir: 'desc' }],
    }
    expect(collectReferencedFieldPaths(def).sort()).toEqual(['id', 'status', 'total'])
  })

  test('collects fields from grouped + measures', () => {
    const def: ReportDefinition = {
      type: 'grouped',
      fields: ['customer_id'],
      groupBy: ['customer_id'],
      measures: [{ field: 'total', aggregation: 'sum', alias: 'revenue' }],
      filters: [],
      sort: [],
    }
    expect(collectReferencedFieldPaths(def).sort()).toEqual(['customer_id', 'total'])
  })

  test('collects fields from pivot rows/cols/value', () => {
    const def: ReportDefinition = {
      type: 'pivot',
      rows: ['region'],
      cols: ['quarter'],
      value: { field: 'total', aggregation: 'sum' },
      filters: [],
    }
    expect(collectReferencedFieldPaths(def).sort()).toEqual(['quarter', 'region', 'total'])
  })

  test('collects fields from chart spec', () => {
    const def: ReportDefinition = {
      type: 'chart',
      chart: {
        type: 'bar',
        dimension: 'status',
        series: [{ measure: { field: 'total', aggregation: 'sum' } }],
      },
      filters: [],
    }
    expect(collectReferencedFieldPaths(def).sort()).toEqual(['status', 'total'])
  })

  test('collects fields from nested OR/AND filter groups', () => {
    const def: ReportDefinition = {
      type: 'flat_list',
      fields: ['id'],
      filters: [
        {
          kind: 'group',
          op: 'or',
          children: [
            { kind: 'literal', field: 'a', op: 'eq', value: 1 },
            { kind: 'literal', field: 'b', op: 'eq', value: 2 },
          ],
        },
      ],
      sort: [],
    }
    expect(collectReferencedFieldPaths(def).sort()).toEqual(['a', 'b', 'id'])
  })
})

describe('validateDefinitionAgainstAcl (three-point enforcement)', () => {
  const ds = dataset()

  test('passes when no referenced field is redacted', () => {
    expect(() =>
      validateDefinitionAgainstAcl(
        {
          type: 'flat_list',
          fields: ['id', 'total'],
          filters: [{ kind: 'literal', field: 'status', op: 'eq', value: 'paid' }],
          sort: [],
        },
        ds,
        new Set(['sales.view']),
      ),
    ).not.toThrow()
  })

  test('rejects projection on redacted field', () => {
    expect(() =>
      validateDefinitionAgainstAcl(
        {
          type: 'flat_list',
          fields: ['id', 'customer.email'],
          filters: [],
          sort: [],
        },
        ds,
        new Set(['sales.view']),
      ),
    ).toThrow(FieldAclDeniedError)
  })

  test('rejects filter on redacted field (no oracle attack)', () => {
    expect(() =>
      validateDefinitionAgainstAcl(
        {
          type: 'flat_list',
          fields: ['id'],
          filters: [{ kind: 'literal', field: 'customer.phone', op: 'eq', value: '+1' }],
          sort: [],
        },
        ds,
        new Set(['sales.view']),
      ),
    ).toThrow(FieldAclDeniedError)
  })

  test('rejects group-by on redacted field', () => {
    expect(() =>
      validateDefinitionAgainstAcl(
        {
          type: 'grouped',
          fields: ['id'],
          groupBy: ['customer.email'],
          measures: [{ field: 'total', aggregation: 'sum' }],
          filters: [],
          sort: [],
        },
        ds,
        new Set(['sales.view']),
      ),
    ).toThrow(FieldAclDeniedError)
  })

  test('rejects measure over redacted field', () => {
    expect(() =>
      validateDefinitionAgainstAcl(
        {
          type: 'summary',
          measures: [{ field: 'customer.phone', aggregation: 'count' }],
          filters: [],
        },
        ds,
        new Set(['sales.view']),
      ),
    ).toThrow(FieldAclDeniedError)
  })

  test('rejects pivot value measure on redacted field', () => {
    expect(() =>
      validateDefinitionAgainstAcl(
        {
          type: 'pivot',
          rows: ['status'],
          cols: ['status'],
          value: { field: 'customer.email', aggregation: 'count' },
          filters: [],
        },
        ds,
        new Set(['sales.view']),
      ),
    ).toThrow(FieldAclDeniedError)
  })

  test('accepts everything when user has god-mode', () => {
    expect(() =>
      validateDefinitionAgainstAcl(
        {
          type: 'flat_list',
          fields: ['id', 'customer.email', 'customer.phone'],
          filters: [{ kind: 'literal', field: 'customer.phone', op: 'eq', value: '+1' }],
          sort: [],
        },
        ds,
        new Set(['*']),
      ),
    ).not.toThrow()
  })

  test('FieldAclDeniedError carries every denied field for UI display', () => {
    try {
      validateDefinitionAgainstAcl(
        {
          type: 'flat_list',
          fields: ['customer.email', 'customer.phone'],
          filters: [],
          sort: [],
        },
        ds,
        new Set(['sales.view']),
      )
      throw new Error('expected to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(FieldAclDeniedError)
      const fae = err as FieldAclDeniedError
      expect(fae.code).toBe('REPORT_FIELD_ACL_DENIED')
      expect(fae.fields.sort()).toEqual(['customer.email', 'customer.phone'])
    }
  })
})
