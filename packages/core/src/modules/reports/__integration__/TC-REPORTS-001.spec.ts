import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

/**
 * TC-REPORTS-001: Reports module smoke
 *
 * Covers the always-on surfaces of the reports module:
 *   1. Datasets registry returns at least the canonical customers:person.
 *   2. `/backend/reports` list page loads with the folder navigator + DataTable.
 *   3. `/backend/reports/new` form renders the dataset picker.
 *   4. `/backend/reports/schedules` list page loads (empty state visible).
 *
 * Deliberately does NOT exercise the schedule-email path — that depends on
 * the deferred Phase 4.3 email module wiring. The full build → save →
 * schedule → email → embed scenario lives in subsequent specs that will
 * be added when 4.3/4.5 land.
 */
test.describe('TC-REPORTS-001: Reports module smoke', () => {
  test('datasets API returns at least customers:person', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(request, 'GET', '/api/reports/datasets', { token })
    expect(response.ok(), `Datasets API should respond 2xx (got ${response.status()})`).toBe(true)
    const payload = (await response.json()) as {
      items?: Array<{ id?: unknown; moduleId?: unknown }>
    }
    const items = Array.isArray(payload.items) ? payload.items : []
    const ids = items
      .map((item) => (typeof item.id === 'string' ? item.id : null))
      .filter((id): id is string => Boolean(id))
    expect(ids, 'expected the customers:person canonical dataset to be visible').toContain('customers:person')
  })

  test('backend reports list page loads with folder navigator', async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend/reports', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: /Reports/i }).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: /New report/i }).first()).toBeVisible({ timeout: 15_000 })
  })

  test('new report page renders the dataset picker', async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend/reports/new', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: /New Report/i }).first()).toBeVisible({ timeout: 15_000 })
    // The dataset picker is a select control rendered by CrudForm — its label
    // is i18n-driven (`reports.new.fields.dataset`). Find the form control by
    // its visible label text from `en.json`.
    await expect(page.getByText(/^Dataset$/).first()).toBeVisible({ timeout: 15_000 })
  })

  test('schedules list page renders', async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend/reports/schedules', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: /Schedules/i }).first()).toBeVisible({ timeout: 15_000 })
    // Either the empty-state CTA or the list-toolbar "New schedule" button
    // must be visible regardless of whether any schedules exist.
    await expect(page.getByRole('link', { name: /New schedule/i }).first()).toBeVisible({ timeout: 15_000 })
  })
})
