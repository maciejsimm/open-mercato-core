/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const apiCallMock = jest.fn()
const flashMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: jest.fn(),
  readApiResultOrThrow: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

import ReportBuilderPage from '../backend/reports/[id]/page'

const REPORT_ID = '11111111-1111-4111-8111-111111111111'

const REPORT = {
  id: REPORT_ID,
  name: 'Deals',
  description: null,
  type: 'flat_list',
  datasetId: 'customers.deals',
  folderId: 'f1',
  permission: 'edit',
  definition: { type: 'flat_list', fields: ['title'], filters: [], sort: [{ field: 'title', dir: 'asc' }] },
  parameters: [{ key: 'region', kind: 'string' }],
  version: 1,
  lastExecutedAt: null,
  updatedAt: null,
}

const DATASET = {
  id: 'customers.deals',
  moduleId: 'customers',
  labelKey: 'Deals',
  entityType: 'customers:deal',
  fields: [
    { key: 'title', labelKey: 'customers.deals.title', kind: 'text' },
    { key: 'status', labelKey: 'customers.deals.status', kind: 'enum', options: ['open', 'won'] },
    { key: 'amount', labelKey: 'customers.deals.amount', kind: 'money' },
  ],
}

function previewCalls(): unknown[][] {
  return apiCallMock.mock.calls.filter(([url]) => url === '/api/reports/preview')
}

function setup() {
  apiCallMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/reports/reports')) return { ok: true, status: 200, result: { items: [REPORT] } }
    if (url.startsWith('/api/reports/datasets/')) return { ok: true, status: 200, result: DATASET }
    if (url === '/api/reports/preview') return { ok: true, status: 200, result: { rows: [{ title: 'A' }], total: 1 } }
    return { ok: false, status: 404, result: null }
  })
}

async function renderPage() {
  renderWithProviders(<ReportBuilderPage params={{ id: REPORT_ID }} />)
  await screen.findByTestId('reports-fields-sidebar')
  await waitFor(() => expect(previewCalls()).toHaveLength(1), { timeout: 2000 })
}

describe('report builder page', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    flashMock.mockReset()
    window.localStorage.clear()
    setup()
  })

  it('does not re-run the preview while a parameter name is typed', async () => {
    await renderPage()
    fireEvent.click(screen.getByRole('tab', { name: /Parameters/ }))
    const keyInput = screen.getByDisplayValue('region')
    fireEvent.change(keyInput, { target: { value: 'regio' } })
    fireEvent.change(keyInput, { target: { value: 'regionCode' } })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 700)) })
    expect(previewCalls()).toHaveLength(1)
  })

  it('debounces definition edits into a single preview request', async () => {
    await renderPage()
    fireEvent.click(screen.getByRole('tab', { name: /Filters & Sorting/ }))
    const limit = screen.getByPlaceholderText('No limit')
    fireEvent.change(limit, { target: { value: '1' } })
    fireEvent.change(limit, { target: { value: '12' } })
    fireEvent.change(limit, { target: { value: '120' } })
    await waitFor(() => expect(previewCalls()).toHaveLength(2), { timeout: 2000 })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 700)) })
    expect(previewCalls()).toHaveLength(2)
    const body = JSON.parse(String((previewCalls()[1][1] as { body: string }).body))
    expect(body.definition.limit).toBe(120)
    expect(body.parameters).toEqual([])
  })

  it('reports dropped items of a type switch through a warning flash', async () => {
    await renderPage()
    fireEvent.change(screen.getByRole('combobox', { name: /Report type/ }), { target: { value: 'pivot' } })
    expect(flashMock).toHaveBeenCalledTimes(1)
    const [message, kind] = flashMock.mock.calls[0] as [string, string]
    expect(kind).toBe('warning')
    expect(message).toContain('cannot keep everything')
    expect(message).toContain('Sort')
    expect(screen.queryByTestId('reports-type-switch-notice')).toBeNull()
  })

  it('filters the field list and remembers the collapsed sidebar', async () => {
    await renderPage()
    fireEvent.change(screen.getByPlaceholderText('Search fields…'), { target: { value: 'amou' } })
    expect(screen.getAllByText('amount').length).toBeGreaterThan(0)
    expect(screen.queryByText('status')).toBeNull()

    fireEvent.click(screen.getByTestId('reports-fields-collapse'))
    expect(screen.queryByTestId('reports-fields-sidebar')).toBeNull()
    expect(screen.getByTestId('reports-fields-expand')).toBeTruthy()
    expect(window.localStorage.getItem('om:reports:builder:fields-sidebar')).toBe('true')

    fireEvent.click(screen.getByTestId('reports-fields-expand'))
    expect(screen.getByTestId('reports-fields-sidebar')).toBeTruthy()
    expect(window.localStorage.getItem('om:reports:builder:fields-sidebar')).toBe('false')
  })
})
