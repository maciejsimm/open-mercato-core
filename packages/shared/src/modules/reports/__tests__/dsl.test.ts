import { defineDataset, defineMeasure } from '../dsl'

describe('reports DSL', () => {
  test('defineDataset returns the spec unchanged when valid', () => {
    const ds = defineDataset({
      id: 'customers.people',
      moduleId: 'customers',
      labelKey: 'customers.reports.datasets.people.label',
      entityType: 'customers:person',
      requiredFeatures: ['customers.view'],
      fields: [
        { key: 'id', labelKey: 'customers.fields.id', kind: 'id' },
        { key: 'email', labelKey: 'customers.fields.email', kind: 'text' },
      ],
      defaultSort: [{ field: 'created_at', dir: 'desc' }],
    })
    expect(ds.id).toBe('customers.people')
    expect(ds.fields).toHaveLength(2)
    expect(ds.defaultSort?.[0]).toEqual({ field: 'created_at', dir: 'desc' })
  })

  test('defineDataset rejects bad ids', () => {
    expect(() =>
      defineDataset({
        id: 'no-dot',
        moduleId: 'x',
        labelKey: 'x',
        entityType: 'x:y',
        fields: [{ key: 'id', labelKey: 'x', kind: 'id' }],
      } as any),
    ).toThrow(/<module>\.<entity>/)
  })

  test('defineDataset requires at least one field', () => {
    expect(() =>
      defineDataset({
        id: 'x.y',
        moduleId: 'x',
        labelKey: 'x',
        entityType: 'x:y',
        fields: [],
      }),
    ).toThrow(/at least one field/)
  })

  test('defineMeasure returns a MeasureExpr', () => {
    expect(defineMeasure('total', 'sum', 'revenue')).toEqual({
      field: 'total',
      aggregation: 'sum',
      alias: 'revenue',
    })
  })

  test('joins + customField fields type-check', () => {
    const ds = defineDataset({
      id: 'sales.orders',
      moduleId: 'sales',
      labelKey: 'sales.reports.datasets.orders.label',
      entityType: 'sales:order',
      fields: [
        { key: 'id', labelKey: 'sales.fields.id', kind: 'id' },
        { key: 'total', labelKey: 'sales.fields.total', kind: 'money', aggregations: ['sum', 'avg'] },
        {
          key: 'customer_id',
          labelKey: 'sales.fields.customer_id',
          kind: 'fk',
          joinTo: 'customers.people',
        } as any,
        {
          key: 'cf:vip',
          labelKey: 'sales.fields.cf_vip',
          kind: 'custom_field',
          customField: { entityId: 'sales:order', key: 'vip', valueKind: 'boolean' },
        } as any,
      ],
      joins: [
        { id: 'customer', dataset: 'customers.people', on: { local: 'customer_id', remote: 'id' }, cardinality: 'many-to-one' },
      ],
      fieldAcl: {
        'customer.email': ['customers.view_pii'],
      },
    })
    expect(ds.joins).toHaveLength(1)
    expect(ds.fieldAcl?.['customer.email']).toEqual(['customers.view_pii'])
  })
})
