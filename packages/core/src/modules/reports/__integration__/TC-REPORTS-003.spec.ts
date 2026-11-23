import { test, expect } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { deleteEntityByBody } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

/**
 * TC-REPORTS-003: exports and async runs (spec Phase 6 step 9 / Q10).
 *
 *  1. XLSX export returns a real OOXML zip (PK header, spreadsheet content type).
 *  2. CSV export carries raw values.
 *  3. `mode: 'async'` dispatches to the worker (202 + executionId) and the
 *     execution status endpoint is visible to the requester.
 */
type FolderItem = { id: string; kind: string; ownedByViewer?: boolean; permission?: string }

test.describe('TC-REPORTS-003: exports and async execution', () => {
  test('xlsx/csv export and async dispatch', async ({ request }) => {
    const token = await getAuthToken(request)
    const folders = await apiRequest(request, 'GET', '/api/reports/folders?pageSize=100', { token })
    expect(folders.ok()).toBe(true)
    const folderItems = ((await folders.json()) as { items: FolderItem[] }).items
    const myRoot = folderItems.find((f) => f.kind === 'private' && f.ownedByViewer) ?? folderItems.find((f) => f.permission === 'edit')
    expect(myRoot, 'expected an editable folder (My Reports root)').toBeTruthy()

    let reportId: string | null = null
    try {
      const created = await apiRequest(request, 'POST', '/api/reports/reports', {
        token,
        data: {
          folderId: myRoot!.id,
          name: `TC003 ${Date.now().toString(36)}`,
          type: 'grouped',
          datasetId: 'customers.entities',
          definition: {
            type: 'grouped',
            fields: [],
            groupBy: ['kind'],
            measures: [{ field: 'id', aggregation: 'count' }],
            filters: [],
            sort: [],
          },
        },
      })
      expect(created.status(), 'report create should return 201').toBe(201)
      reportId = ((await created.json()) as { id: string }).id

      const xlsx = await apiRequest(request, 'GET', `/api/reports/reports/${reportId}/export?format=xlsx`, { token })
      expect(xlsx.ok()).toBe(true)
      expect(xlsx.headers()['content-type']).toContain('spreadsheetml')
      const bytes = await xlsx.body()
      expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK')

      const csv = await apiRequest(request, 'GET', `/api/reports/reports/${reportId}/export?format=csv`, { token })
      expect(csv.ok()).toBe(true)
      expect((await csv.text()).split('\n')[0]).toContain('Count Id')

      const run = await apiRequest(request, 'POST', `/api/reports/reports/${reportId}/run`, {
        token,
        data: { mode: 'async' },
      })
      expect(run.status()).toBe(202)
      const { executionId } = (await run.json()) as { executionId: string }
      expect(executionId).toBeTruthy()
      const status = await apiRequest(request, 'GET', `/api/reports/executions/${executionId}`, { token })
      expect(status.ok()).toBe(true)
      expect(['running', 'completed', 'failed']).toContain(((await status.json()) as { status: string }).status)
    } finally {
      await deleteEntityByBody(request, token, '/api/reports/reports', reportId)
    }
  })
})
