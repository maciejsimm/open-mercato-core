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
  test('datasets API returns module-declared datasets', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(request, 'GET', '/api/reports/datasets', { token })
    expect(response.ok(), `Datasets API should respond 2xx (got ${response.status()})`).toBe(true)
    const payload = (await response.json()) as {
      items?: Array<{ id?: unknown; moduleId?: unknown }>
    }
    const items = Array.isArray(payload.items) ? payload.items : []
    expect(items.length, 'expected at least one declared dataset').toBeGreaterThan(0)
    const customerDatasets = items.filter((item) => (item as { moduleId?: string }).moduleId === 'customers')
    expect(customerDatasets.length, 'expected at least one customers-module dataset').toBeGreaterThan(0)
  })

  test('backend reports list page loads with folder navigator', async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend/reports', { waitUntil: 'domcontentloaded' })
    // The "New report" link is the canonical CTA for this page; assert against
    // it rather than the heading text (which races the folder navigator load).
    await expect(page.getByRole('link', { name: /New report/i }).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('heading', { name: /^Folders$/ }).first()).toBeVisible({ timeout: 15_000 })
  })

  test('new report page renders the dataset picker', async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend/reports/new', { waitUntil: 'domcontentloaded' })
    // The form's primary action is the most reliable signal that the page
    // hydrated. The title is rendered as a non-heading element on this route.
    await expect(page.getByRole('button', { name: /Create report/i }).first()).toBeVisible({ timeout: 30_000 })
    // The dataset picker label comes from `reports.new.fields.dataset` in
    // en.json — "Dataset *" because the field is required.
    await expect(page.getByText(/Dataset \*/).first()).toBeVisible({ timeout: 15_000 })
  })

  test('schedules list page renders', async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend/reports/schedules', { waitUntil: 'domcontentloaded' })
    // Empty-state or list-toolbar CTA must be visible regardless of whether
    // any schedules exist.
    await expect(page.getByRole('link', { name: /New schedule/i }).first()).toBeVisible({ timeout: 30_000 })
  })
})
