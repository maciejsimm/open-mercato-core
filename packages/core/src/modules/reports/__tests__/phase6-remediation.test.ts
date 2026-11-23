import { defineDataset, measureAlias, type Dataset, type ReportDefinition } from '@open-mercato/shared/modules/reports/dsl'
import type { QueryEngine, QueryOptions, QueryResult } from '@open-mercato/shared/lib/query/types'
import { estimateReportRows, executeReport } from '../lib/execute'
import { reportDefinitionSchema } from '../data/validators'
import { serializeReportResult } from '../lib/export'
import { buildXlsx } from '../lib/xlsx'

const dataset: Dataset = defineDataset({
  id: 'sales.orders',
  moduleId: 'sales',
  labelKey: 'sales.reports.datasets.orders.label',
  entityType: 'sales:sales_order',
  fields: [
    { key: 'id', labelKey: 'x.id', kind: 'id' },
    { key: 'status', labelKey: 'x.status', kind: 'enum', options: [{ value: 'open', labelKey: 'x.open' }, 'paid'] },
    { key: 'total', labelKey: 'x.total', kind: 'money', currencyField: 'currency', aggregations: ['sum', 'avg', 'count'] },
    { key: 'currency', labelKey: 'x.currency', kind: 'text' },
    { key: 'qty', labelKey: 'x.qty', kind: 'integer', aggregations: ['sum', 'avg'] },
    { key: 'placed_on', labelKey: 'x.placed_on', kind: 'date' },
    { key: 'cf:vip', labelKey: 'x.vip', kind: 'custom_field', customField: { entityId: 'sales:sales_order', key: 'vip', valueKind: 'integer' }, aggregations: ['sum'] },
  ],
})

/** A paginating engine over a fixed row set — honours page/pageSize like the real engine. */
function pagingEngine(all: Record<string, unknown>[]) {
  const calls: QueryOptions[] = []
  const engine: QueryEngine = {
    async query(_entity, opts) {
      calls.push(opts ?? {})
      const page = opts?.page?.page ?? 1
      const pageSize = opts?.page?.pageSize ?? 100
      const start = (page - 1) * pageSize
      return { items: all.slice(start, start + pageSize), page, pageSize, total: all.length } as QueryResult
    },
  }
  return { engine, calls }
}

function orders(count: number, currency: (i: number) => string = () => 'EUR') {
  return Array.from({ length: count }, (_, i) => ({
    id: `o_${i}`,
    status: i % 2 === 0 ? 'open' : 'paid',
    total: 10,
    currency: currency(i),
    qty: 1,
    'cf:vip': 1,
  }))
}

const baseInput = {
  dataset,
  userFeatures: new Set(['sales.view']),
  userId: 'u_1',
  tenantId: 't1',
  organizationId: 'o1',
}

describe('F1 — aggregation covers the full result set', () => {
  test('250 rows with cap 25 000 → sum/count cover all 250', async () => {
    const { engine, calls } = pagingEngine(orders(250))
    const def: ReportDefinition = {
      type: 'grouped',
      fields: [],
      groupBy: ['status'],
      measures: [{ field: 'total', aggregation: 'sum' }, { field: 'id', aggregation: 'count' }],
      filters: [],
      sort: [],
    }
    const out = await executeReport(engine, { ...baseInput, definition: def, inMemoryCap: 25_000 })
    const sum = out.rows.reduce((acc, row) => acc + Number(row.sum_total), 0)
    const count = out.rows.reduce((acc, row) => acc + Number(row.count_id), 0)
    expect(sum).toBe(2500)
    expect(count).toBe(250)
    expect(out.meta.truncated).toBe(false)
    expect(out.meta.scannedRows).toBe(250)
    expect(calls.length).toBe(3)
    expect(calls.every((c) => (c.page?.pageSize ?? 0) <= 100)).toBe(true)
  })

  test('over-cap total is flagged truncated', async () => {
    const { engine } = pagingEngine(orders(250))
    const def: ReportDefinition = { type: 'summary', measures: [{ field: 'id', aggregation: 'count' }], filters: [] }
    const out = await executeReport(engine, { ...baseInput, definition: def, inMemoryCap: 150 })
    expect(out.rows[0].count_id).toBe(150)
    expect(out.meta.truncated).toBe(true)
  })
})

describe('F6 — row-count probe', () => {
  test('estimateReportRows issues a pageSize 1 query and returns total', async () => {
    const { engine, calls } = pagingEngine(orders(4321))
    const def: ReportDefinition = { type: 'summary', measures: [{ field: 'id', aggregation: 'count' }], filters: [] }
    const estimate = await estimateReportRows(engine, { ...baseInput, definition: def })
    expect(estimate).toBe(4321)
    expect(calls).toHaveLength(1)
    expect(calls[0].page?.pageSize).toBe(1)
  })
})

describe('F7 — row-level RBAC pass-through', () => {
  test('flat_list and aggregated reads forward userId + userFeatures as query extensions', async () => {
    const { engine, calls } = pagingEngine(orders(3))
    await executeReport(engine, {
      ...baseInput,
      definition: { type: 'flat_list', fields: ['id'], filters: [], sort: [] },
    })
    await executeReport(engine, {
      ...baseInput,
      definition: { type: 'summary', measures: [{ field: 'id', aggregation: 'count' }], filters: [] },
    })
    for (const call of calls) {
      expect(call.extensions?.userId).toBe('u_1')
      expect(call.extensions?.userFeatures).toEqual(['sales.view'])
    }
  })

  test('readAllPages returns every flat-list row up to the cap', async () => {
    const { engine } = pagingEngine(orders(230))
    const out = await executeReport(engine, {
      ...baseInput,
      readAllPages: true,
      definition: { type: 'flat_list', fields: ['id'], filters: [], sort: [] },
    })
    expect(out.rows).toHaveLength(230)
    expect(out.meta.truncated).toBe(false)
  })
})

describe('F13 — chart alias parity + implicit X group key', () => {
  test('validator accepts sanitized cf:* aliases that the aggregator produces', () => {
    const measure = { field: 'cf:vip', aggregation: 'sum' as const }
    const alias = measureAlias(measure)
    expect(alias).toBe('sum_cf_vip')
    const parsed = reportDefinitionSchema.safeParse({
      type: 'chart',
      chart: { type: 'bar', xField: 'status', yFields: [alias] },
      filters: [],
      measures: [measure],
    })
    expect(parsed.success).toBe(true)
  })

  test('chart without groupBy groups by xField', async () => {
    const { engine } = pagingEngine(orders(10))
    const out = await executeReport(engine, {
      ...baseInput,
      definition: {
        type: 'chart',
        chart: { type: 'bar', xField: 'status', yFields: ['sum_qty'] },
        filters: [],
        measures: [{ field: 'qty', aggregation: 'sum' }],
      },
    })
    expect(out.rows).toHaveLength(2)
    expect(out.rows.map((r) => r.status).sort()).toEqual(['open', 'paid'])
    expect(out.meta.fields).toEqual(['status', 'sum_qty'])
  })
})

describe('F19 — column descriptors + currency handling', () => {
  test('measures inherit kind; single currency is resolved', async () => {
    const { engine } = pagingEngine(orders(6))
    const out = await executeReport(engine, {
      ...baseInput,
      definition: {
        type: 'grouped',
        fields: [],
        groupBy: ['status'],
        measures: [
          { field: 'total', aggregation: 'sum' },
          { field: 'qty', aggregation: 'avg' },
          { field: 'id', aggregation: 'count' },
        ],
        filters: [],
        sort: [],
        columnFormats: { sum_total: { precision: 0 } },
      },
    })
    const byKey = Object.fromEntries((out.meta.columns ?? []).map((c) => [c.key, c]))
    expect(byKey.status.kind).toBe('enum')
    expect(byKey.sum_total).toMatchObject({ kind: 'money', currency: 'EUR', format: { precision: 0 } })
    expect(byKey.avg_qty.kind).toBe('float')
    expect(byKey.count_id.kind).toBe('integer')
    expect(out.meta.mixedCurrencyColumns).toBeUndefined()
  })

  test('money summed across currencies is flagged, never presented as one currency', async () => {
    const { engine } = pagingEngine(orders(6, (i) => (i % 2 ? 'USD' : 'EUR')))
    const out = await executeReport(engine, {
      ...baseInput,
      definition: { type: 'summary', measures: [{ field: 'total', aggregation: 'sum' }], filters: [] },
    })
    expect(out.meta.mixedCurrencyColumns).toEqual(['sum_total'])
    const column = out.meta.columns?.find((c) => c.key === 'sum_total')
    expect(column?.currency).toBeUndefined()
  })

  test('grouping by the currency column keeps per-row currency', async () => {
    const { engine } = pagingEngine(orders(6, (i) => (i % 2 ? 'USD' : 'EUR')))
    const out = await executeReport(engine, {
      ...baseInput,
      definition: {
        type: 'grouped',
        fields: [],
        groupBy: ['currency'],
        measures: [{ field: 'total', aggregation: 'sum' }],
        filters: [],
        sort: [],
      },
    })
    expect(out.meta.mixedCurrencyColumns).toBeUndefined()
    expect(out.meta.columns?.find((c) => c.key === 'sum_total')?.currencyField).toBe('currency')
  })
})

/** Read a STORED zip (no compression) into name → utf8 content. */
function readStoredZip(buffer: Buffer): Record<string, string> {
  const out: Record<string, string> = {}
  let offset = 0
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8)
    expect(method).toBe(0)
    const size = buffer.readUInt32LE(offset + 18)
    const nameLength = buffer.readUInt16LE(offset + 26)
    const extraLength = buffer.readUInt16LE(offset + 28)
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8')
    const start = offset + 30 + nameLength + extraLength
    out[name] = buffer.subarray(start, start + size).toString('utf8')
    offset = start + size
  }
  expect(buffer.readUInt32LE(offset)).toBe(0x02014b50)
  return out
}

describe('Q10 / 3.6b — XLSX export', () => {
  test('workbook has the OOXML parts and typed cells', () => {
    const buffer = buildXlsx({
      sheetName: 'Orders',
      columns: [
        { key: 'name', header: 'Name', kind: 'string' },
        { key: 'amount', header: 'Amount', kind: 'money' },
        { key: 'day', header: 'Day', kind: 'date' },
        { key: 'ok', header: 'OK', kind: 'boolean' },
      ],
      rows: [{ name: 'A & B <c>', amount: '12.50', day: '2026-01-02', ok: true }],
    })
    const parts = readStoredZip(buffer)
    expect(Object.keys(parts)).toEqual(
      expect.arrayContaining(['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/styles.xml']),
    )
    const sheet = parts['xl/worksheets/sheet1.xml']
    expect(sheet).toContain('A &amp; B &lt;c&gt;')
    expect(sheet).toContain('<c r="B2" s="2"><v>12.5</v></c>')
    expect(sheet).toContain('<c r="C2" s="3"><v>46024</v></c>')
    expect(sheet).toContain('<c r="D2" t="b"><v>1</v></c>')
  })

  test('serializeReportResult adds a currency column for money and writes xlsx', () => {
    const definition: ReportDefinition = { type: 'flat_list', fields: ['id', 'total'], filters: [], sort: [] }
    const result = {
      mode: 'sync' as const,
      rows: [{ id: 'o_1', total: 10, currency: 'EUR' }],
      total: 1,
      meta: {
        duration_ms: 1,
        truncated: false,
        cap: 100,
        fields: ['id', 'total'],
        columns: [
          { key: 'id', kind: 'id' as const },
          { key: 'total', kind: 'money' as const, currencyField: 'currency' },
        ],
      },
    }
    const csv = serializeReportResult(definition, result, 'csv')
    expect(String(csv.body).split('\n')[0]).toBe('Id,Total,Total Currency')
    expect(String(csv.body)).toContain('o_1,10,EUR')
    const xlsx = serializeReportResult(definition, result, 'xlsx')
    expect(xlsx.fileExtension).toBe('xlsx')
    expect(Buffer.isBuffer(xlsx.body)).toBe(true)
  })
})
