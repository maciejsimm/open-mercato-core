import { defineDataset, type Dataset } from '@open-mercato/shared/modules/reports/dsl'
import { datasets as sales } from '../../sales/reports'
import { datasets as customers } from '../../customers/reports'
import { datasets as catalog } from '../../catalog/reports'
import { datasets as staff } from '../../staff/reports'
import { datasets as wms } from '../../wms/reports'

const all: Dataset[] = [...sales, ...customers, ...catalog, ...staff, ...wms]

const NEW_IDS = [
  'sales.invoices',
  'sales.payments',
  'sales.shipments',
  'customers.activities',
  'catalog.variants',
  'staff.time_entries',
  'wms.inventory_balances',
]

describe('module report datasets', () => {
  it('registers the new datasets', () => {
    const ids = all.map((dataset) => dataset.id)
    for (const id of NEW_IDS) expect(ids).toContain(id)
  })

  it('has unique dataset ids and unique field keys per dataset', () => {
    const ids = all.map((dataset) => dataset.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const dataset of all) {
      const keys = dataset.fields.map((field) => field.key)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it.each(all.map((dataset) => [dataset.id, dataset] as const))('%s passes defineDataset', (_id, dataset) => {
    expect(() => defineDataset(dataset)).not.toThrow()
    expect(dataset.moduleId).toBe(dataset.id.split('.')[0])
    expect(dataset.requiredFeatures?.length).toBeGreaterThan(0)
    expect(dataset.labelKey.startsWith(`${dataset.moduleId}.reports.`)).toBe(true)
  })

  it.each(all.map((dataset) => [dataset.id, dataset] as const))('%s money fields reference an existing currency field', (_id, dataset) => {
    const keys = new Set(dataset.fields.map((field) => field.key))
    for (const field of dataset.fields.filter((candidate) => candidate.kind === 'money')) {
      expect(field.currencyField || field.currency).toBeTruthy()
      if (field.currencyField) expect(keys.has(field.currencyField)).toBe(true)
    }
  })

  it.each(all.map((dataset) => [dataset.id, dataset] as const))('%s enum options are non-empty when declared', (_id, dataset) => {
    for (const field of dataset.fields.filter((candidate) => candidate.kind === 'enum')) {
      const options = (field as { options?: unknown[] }).options
      if (options !== undefined) expect(options.length).toBeGreaterThan(0)
    }
  })

  it.each(all.map((dataset) => [dataset.id, dataset] as const))('%s fieldAcl and default sort reference existing fields', (_id, dataset) => {
    const keys = new Set(dataset.fields.map((field) => field.key))
    for (const key of Object.keys(dataset.fieldAcl ?? {})) expect(keys.has(key)).toBe(true)
    for (const sort of dataset.defaultSort ?? []) expect(keys.has(sort.field)).toBe(true)
  })

  it('has i18n keys for every new dataset and field in all locales', () => {
    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')
    const modulesDir = path.resolve(__dirname, '../..')
    for (const dataset of all.filter((candidate) => NEW_IDS.includes(candidate.id))) {
      const keys = [dataset.labelKey, dataset.descriptionKey, ...dataset.fields.map((field) => field.labelKey)]
      for (const locale of ['en', 'de', 'es', 'pl', 'ko']) {
        const messages = JSON.parse(
          fs.readFileSync(path.join(modulesDir, dataset.moduleId, 'i18n', `${locale}.json`), 'utf8'),
        ) as Record<string, string>
        for (const key of keys) expect(messages[key as string]).toBeTruthy()
      }
    }
  })
})
