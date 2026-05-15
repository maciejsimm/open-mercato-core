import {
  __setDatasetSource,
  isDatasetVisible,
  listVisibleDatasets,
  loadDataset,
} from '../lib/datasets-registry'
import { defineDataset, type Dataset } from '@open-mercato/shared/modules/reports/dsl'

const PUBLIC_DATASET: Dataset = defineDataset({
  id: 'customers.people',
  moduleId: 'customers',
  labelKey: 'customers.reports.datasets.people.label',
  entityType: 'customers:person',
  fields: [{ key: 'id', labelKey: 'customers.fields.id', kind: 'id' }],
})

const GATED_DATASET: Dataset = defineDataset({
  id: 'sales.orders',
  moduleId: 'sales',
  labelKey: 'sales.reports.datasets.orders.label',
  entityType: 'sales:order',
  requiredFeatures: ['sales.view'],
  fields: [{ key: 'id', labelKey: 'sales.fields.id', kind: 'id' }],
})

const PII_DATASET: Dataset = defineDataset({
  id: 'customers.contacts',
  moduleId: 'customers',
  labelKey: 'customers.reports.datasets.contacts.label',
  entityType: 'customers:person',
  requiredFeatures: ['customers.view_pii', 'customers.admin'],
  fields: [{ key: 'id', labelKey: 'customers.fields.id', kind: 'id' }],
})

beforeEach(() => {
  __setDatasetSource({
    list: () => [PUBLIC_DATASET, GATED_DATASET, PII_DATASET],
    get: (id) =>
      [PUBLIC_DATASET, GATED_DATASET, PII_DATASET].find((d) => d.id === id),
    ids: () => [PUBLIC_DATASET, GATED_DATASET, PII_DATASET].map((d) => d.id),
  })
})

afterEach(() => __setDatasetSource(null))

describe('isDatasetVisible', () => {
  test('datasets with no requiredFeatures are visible to everyone', () => {
    expect(isDatasetVisible(PUBLIC_DATASET, new Set())).toBe(true)
  })
  test('gated dataset is hidden when the feature is missing', () => {
    expect(isDatasetVisible(GATED_DATASET, new Set(['customers.view']))).toBe(false)
  })
  test('gated dataset becomes visible with the right feature', () => {
    expect(isDatasetVisible(GATED_DATASET, new Set(['sales.view']))).toBe(true)
  })
  test('any-of semantics — having one of multiple required features suffices', () => {
    expect(isDatasetVisible(PII_DATASET, new Set(['customers.admin']))).toBe(true)
  })
  test('wildcard customers.* opens PII dataset', () => {
    expect(isDatasetVisible(PII_DATASET, new Set(['customers.*']))).toBe(true)
  })
  test('god-mode * opens any dataset', () => {
    expect(isDatasetVisible(GATED_DATASET, new Set(['*']))).toBe(true)
  })
})

describe('listVisibleDatasets', () => {
  test('returns only datasets the user can see', async () => {
    const out = await listVisibleDatasets(new Set(['sales.view']))
    expect(out.map((d) => d.id).sort()).toEqual(['customers.people', 'sales.orders'])
  })
  test('returns all datasets when user has god-mode', async () => {
    const out = await listVisibleDatasets(new Set(['*']))
    expect(out).toHaveLength(3)
  })
  test('returns only public datasets when user has nothing', async () => {
    const out = await listVisibleDatasets(new Set())
    expect(out.map((d) => d.id)).toEqual(['customers.people'])
  })
})

describe('loadDataset', () => {
  test('returns the dataset when allowed', async () => {
    const d = await loadDataset('sales.orders', new Set(['sales.view']))
    expect(d?.id).toBe('sales.orders')
  })
  test('returns undefined when the dataset is unknown', async () => {
    const d = await loadDataset('nope.unknown', new Set(['*']))
    expect(d).toBeUndefined()
  })
  test('returns undefined when the user is not allowed (404-ish)', async () => {
    const d = await loadDataset('sales.orders', new Set())
    expect(d).toBeUndefined()
  })
})
