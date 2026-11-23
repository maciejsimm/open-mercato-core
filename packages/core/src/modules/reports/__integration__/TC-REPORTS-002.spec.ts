import { test, expect } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createCompanyFixture, deleteEntityByBody } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

/**
 * TC-REPORTS-002: aggregation covers the full result set (spec Phase 6 F1).
 *
 * Creates 105 companies with a unique name prefix — more than one 100-row
 * QueryEngine page — and asserts that summary and grouped aggregates over
 * them count all 105, not just the first page.
 */
const FIXTURE_COUNT = 105

test.describe('TC-REPORTS-002: aggregation over more than one page', () => {
  test('summary + grouped counts include every matching row', async ({ request }) => {
    test.setTimeout(240_000)
    const token = await getAuthToken(request)
    const prefix = `TC002-${Date.now().toString(36)}`
    const ids: string[] = []
    try {
      for (let i = 0; i < FIXTURE_COUNT; i += 1) {
        ids.push(await createCompanyFixture(request, token, `${prefix}-${String(i).padStart(3, '0')}`))
      }
      const filters = [{ kind: 'literal', field: 'display_name', op: 'starts_with', value: prefix }]

      const summary = await apiRequest(request, 'POST', '/api/reports/preview', {
        token,
        data: {
          datasetId: 'customers.entities',
          definition: { type: 'summary', measures: [{ field: 'id', aggregation: 'count' }], filters },
        },
      })
      expect(summary.ok(), `summary preview should succeed (got ${summary.status()})`).toBe(true)
      const summaryBody = (await summary.json()) as { rows: Array<Record<string, unknown>>; meta: { truncated: boolean } }
      expect(Number(summaryBody.rows[0]?.count_id)).toBe(FIXTURE_COUNT)
      expect(summaryBody.meta.truncated).toBe(false)

      const grouped = await apiRequest(request, 'POST', '/api/reports/preview', {
        token,
        data: {
          datasetId: 'customers.entities',
          definition: {
            type: 'grouped',
            fields: [],
            groupBy: ['kind'],
            measures: [{ field: 'id', aggregation: 'count' }],
            filters,
            sort: [],
          },
        },
      })
      expect(grouped.ok()).toBe(true)
      const groupedBody = (await grouped.json()) as {
        rows: Array<Record<string, unknown>>
        meta: { columns?: Array<{ key: string; kind: string }> }
      }
      const total = groupedBody.rows.reduce((acc, row) => acc + Number(row.count_id ?? 0), 0)
      expect(total).toBe(FIXTURE_COUNT)
      expect(groupedBody.meta.columns?.find((c) => c.key === 'count_id')?.kind).toBe('integer')
    } finally {
      for (const id of ids) await deleteEntityByBody(request, token, '/api/customers/companies', id)
    }
  })
})
